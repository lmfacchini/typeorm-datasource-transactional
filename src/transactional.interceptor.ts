import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, defer, from, lastValueFrom } from "rxjs";
import { QueryRunner } from "typeorm";
import { TransactedDataSource } from "./transacted-datasource";
import {
  Propagation,
  TRANSACTIONAL_DECORATOR_KEY,
} from "./transactional.decorator";
import { TransactionException } from "./transactional.exception";

interface TransactionalRequest {
  queryRunners?: QueryRunner[];
}

@Injectable()
export class TransactionalInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly datasource: TransactedDataSource,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const propagation =
      this.reflector.get<Propagation>(
        TRANSACTIONAL_DECORATOR_KEY,
        context.getHandler(),
      ) ??
      this.reflector.get<Propagation>(
        TRANSACTIONAL_DECORATOR_KEY,
        context.getClass(),
      );

    if (propagation === undefined) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<TransactionalRequest>();

    // Run the whole transaction lifecycle inside the Observable subscription.
    // The HTTP response is not completed before commit/rollback and release.
    return defer(() => from(this.execute(request, propagation, next)));
  }

  private async execute(
    request: TransactionalRequest,
    propagation: Propagation,
    next: CallHandler,
  ): Promise<any> {
    const stack = (request.queryRunners ??= []);
    const current = stack[stack.length - 1];
    const active = current?.isTransactionActive ?? false;

    let createRunner = false;
    let startTransaction = false;

    switch (propagation) {
      case Propagation.REQUIRED:
        // An existing non-transactional runner cannot satisfy REQUIRED.
        createRunner = !active;
        startTransaction = !active;
        break;

      case Propagation.REQUIRES_NEW:
        createRunner = true;
        startTransaction = true;
        break;

      case Propagation.MANDATORY:
        if (!active) {
          throw new TransactionException("Transaction is required");
        }
        break;

      case Propagation.NEVER:
        if (active) {
          throw new TransactionException("Transaction is not supported");
        }
        createRunner = !current;
        break;

      case Propagation.NOT_SUPPORTED:
        // Temporarily shadow an active transaction with a non-transactional runner.
        createRunner = !current || active;
        break;

      case Propagation.SUPPORTS:
        // The repositories still need a runner when no transaction exists.
        createRunner = !current;
        break;
    }

    if (!createRunner) {
      // The outer scope owns this runner: never commit, rollback or release it here.
      return lastValueFrom(next.handle(), { defaultValue: undefined });
    }

    const runner = this.datasource.createQueryRunner();
    let pushed = false;

    try {
      if (startTransaction) {
        // startTransaction can acquire a connection; wait before invoking handlers.
        await runner.startTransaction();
      }

      stack.push(runner);
      pushed = true;

      // NestJS HTTP handlers normally emit a single response value.
      // Converting to a Promise ensures commit and cleanup are awaited.
      const result = await lastValueFrom(next.handle(), {
        defaultValue: undefined,
      });

      if (startTransaction) {
        await runner.commitTransaction();
      }

      return result;
    } finally {
      try {
        // Roll back on handler/commit failure, including failed startup if active.
        if (!runner.isReleased && runner.isTransactionActive) {
          await runner.rollbackTransaction();
        }
      } finally {
        try {
          // Commit/rollback do not return the connection to pg-pool.
          if (!runner.isReleased) {
            await runner.release();
          }
        } finally {
          if (pushed) {
            // Restore even if another nested scope changed the stack.
            const index = stack.lastIndexOf(runner);
            if (index !== -1) {
              stack.splice(index, 1);
            }
          }
        }
      }
    }
  }
}
