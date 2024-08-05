import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { catchError, tap } from "rxjs/operators";
import {
  Propagation,
  TRANSACTIONAL_DECORATOR_KEY,
} from "./transactional.decorator";
import { TransactedDataSource } from "./transacted-datasource";
import { QueryRunner } from "typeorm";
import { TransactionException } from "./transactional.exception";

@Injectable()
export class TransactionalInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private datasource: TransactedDataSource
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Promise<Observable<any>> {
    const handler = context.getHandler();
    const classType = context.getClass();

    const propagation: Propagation | undefined =
      this.reflector.get<Propagation>(TRANSACTIONAL_DECORATOR_KEY, handler) ||
      this.reflector.get<Propagation>(TRANSACTIONAL_DECORATOR_KEY, classType);

    if (propagation) {
      const request = context.switchToHttp().getRequest();
      if (!request.queryRunners) {
        request.queryRunners = [];
      }
      const queryRunner: QueryRunner | null = await this.before(
        request,
        propagation
      );
      if (queryRunner) {
        request.queryRunners.push(queryRunner);
      }
      return next.handle().pipe(
        tap(async () => {
          await this.after(request, propagation, queryRunner);
        }),
        catchError(async (err: Error) => {
          await this.after(request, propagation, queryRunner, err);
          throw err;
        })
      );
    }
    return next.handle();
  }

  private createQueryRunner(): QueryRunner {
    return this.datasource.createQueryRunner();
  }

  private createTransaction(): QueryRunner {
    const queryRunner: QueryRunner = this.createQueryRunner();
    queryRunner.startTransaction();
    return queryRunner;
  }

  private before(request: any, propagation: Propagation): QueryRunner | null {
    switch (propagation) {
      case Propagation.REQUIRED:
        if (request.queryRunners.length > 0) {
          break;
        }
      case Propagation.REQUIRES_NEW:
        return this.createTransaction();
      case Propagation.MANDATORY:
        if (
          request.queryRunners.length === 0 ||
          !request.queryRunners[request.queryRunners.length - 1]
            .isTransactionActive
        ) {
          throw new TransactionException("Transaction is required");
        }
        break;

      case Propagation.NEVER:
        if (
          request.queryRunners.length > 0 &&
          request.queryRunners[request.queryRunners.length - 1]
            .isTransactionActive
        ) {
          throw new TransactionException("Transaction is not supported");
        }
      case Propagation.NOT_SUPPORTED:
        if (
          request.queryRunners.length > 0 &&
          !request.queryRunners[request.queryRunners.length - 1]
            .isTransactionActive
        ) {
          break;
        }
      case Propagation.SUPPORTS:
        if (request.queryRunners.length === 0) {
          return this.createQueryRunner();
        }
    }
    return null;
  }

  private async after(
    request: any,
    propagation: Propagation,
    queryRunner: QueryRunner | null,
    error?: Error
  ): Promise<void> {
    if (queryRunner) {
      switch (propagation) {
        case Propagation.REQUIRES_NEW:
        case Propagation.REQUIRED:
        case Propagation.SUPPORTS:
        case Propagation.MANDATORY:
          await this.effect(queryRunner, error);
        case Propagation.NOT_SUPPORTED:
        case Propagation.NEVER:
          request.queryRunners.pop();
          await this.release(queryRunner);
      }
    }
  }

  private async release(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner.isReleased) {
      await queryRunner.release();
    }
  }

  private async effect(queryRunner: QueryRunner, error?: Error): Promise<void> {
    if (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
    } else if (queryRunner.isTransactionActive) {
      await queryRunner.commitTransaction();
    }
  }
}
