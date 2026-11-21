import "reflect-metadata";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, defer, from, lastValueFrom, of, throwError } from "rxjs";
import { QueryRunner } from "typeorm";
import { TransactedDataSource } from "./transacted-datasource";
import { TransactedRepository } from "./transacted-repository";
import {
  Propagation,
  TRANSACTIONAL_DECORATOR_KEY,
} from "./transactional.decorator";
import { TransactionalInterceptor } from "./transactional.interceptor";
import { TransactionException } from "./transactional.exception";

type FakeRunner = QueryRunner & {
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
};

function fakeRunner(events: string[] = []): FakeRunner {
  const runner = {
    isTransactionActive: false,
    isReleased: false,
    manager: {},
    startTransaction: jest.fn(async () => {
      events.push("start");
      runner.isTransactionActive = true;
    }),
    commitTransaction: jest.fn(async () => {
      events.push("commit");
      runner.isTransactionActive = false;
    }),
    rollbackTransaction: jest.fn(async () => {
      events.push("rollback");
      runner.isTransactionActive = false;
    }),
    release: jest.fn(async () => {
      events.push("release");
      runner.isReleased = true;
    }),
  };
  return runner as unknown as FakeRunner;
}

function contextFor(
  propagation: Propagation | undefined,
  request: { queryRunners?: QueryRunner[] } = {},
): ExecutionContext {
  const handler = () => undefined;
  if (propagation !== undefined) {
    Reflect.defineMetadata(TRANSACTIONAL_DECORATOR_KEY, propagation, handler);
  }
  return {
    getHandler: () => handler,
    getClass: () => class ExampleController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createHarness(runners: FakeRunner[]) {
  const createQueryRunner = jest.fn(() => {
    const runner = runners.shift();
    if (!runner) {
      throw new Error("No fake QueryRunner available");
    }
    return runner;
  });
  const datasource = {
    createQueryRunner,
  } as unknown as TransactedDataSource;
  return {
    interceptor: new TransactionalInterceptor(new Reflector(), datasource),
    createQueryRunner,
  };
}

async function execute(
  interceptor: TransactionalInterceptor,
  propagation: Propagation | undefined,
  request: { queryRunners?: QueryRunner[] },
  handle: () => Observable<any> = () => of("ok"),
): Promise<any> {
  return lastValueFrom(interceptor.intercept(contextFor(propagation, request), { handle }));
}

describe("TransactionalInterceptor lifecycle", () => {
  it("REQUIRED awaits start, commit and release before completing", async () => {
    const events: string[] = [];
    const runner = fakeRunner(events);
    const { interceptor } = createHarness([runner]);
    const request = { queryRunners: [] as QueryRunner[] };

    const result = await execute(interceptor, Propagation.REQUIRED, request, () => {
      events.push("handler");
      expect(runner.isTransactionActive).toBe(true);
      expect(request.queryRunners).toEqual([runner]);
      return of("result");
    });

    expect(result).toBe("result");
    expect(events).toEqual(["start", "handler", "commit", "release"]);
    expect(request.queryRunners).toEqual([]);
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it("REQUIRED rolls back, releases and restores the stack on handler error", async () => {
    const events: string[] = [];
    const runner = fakeRunner(events);
    const { interceptor } = createHarness([runner]);
    const request = { queryRunners: [] as QueryRunner[] };

    await expect(
      execute(interceptor, Propagation.REQUIRED, request, () =>
        throwError(() => new Error("handler failed")),
      ),
    ).rejects.toThrow("handler failed");

    expect(events).toEqual(["start", "rollback", "release"]);
    expect(request.queryRunners).toEqual([]);
  });

  it("releases and restores the stack even if commit fails", async () => {
    const events: string[] = [];
    const runner = fakeRunner(events);
    runner.commitTransaction.mockImplementation(async () => {
      events.push("commit failed");
      throw new Error("commit failed");
    });
    const { interceptor } = createHarness([runner]);
    const request = { queryRunners: [] as QueryRunner[] };

    await expect(execute(interceptor, Propagation.REQUIRED, request)).rejects.toThrow(
      "commit failed",
    );

    expect(events).toEqual(["start", "commit failed", "rollback", "release"]);
    expect(request.queryRunners).toEqual([]);
  });

  it("releases a runner when starting the transaction fails", async () => {
    const events: string[] = [];
    const runner = fakeRunner(events);
    runner.startTransaction.mockImplementation(async () => {
      events.push("start failed");
      throw new Error("cannot connect");
    });
    const { interceptor } = createHarness([runner]);
    const request = { queryRunners: [] as QueryRunner[] };
    const handle = jest.fn(() => of("unexpected"));

    await expect(execute(interceptor, Propagation.REQUIRED, request, handle)).rejects.toThrow(
      "cannot connect",
    );

    expect(events).toEqual(["start failed", "release"]);
    expect(handle).not.toHaveBeenCalled();
    expect(request.queryRunners).toEqual([]);
  });

  it("REQUIRED joins an existing transaction without owning its lifecycle", async () => {
    const parent = fakeRunner();
    parent.isTransactionActive = true;
    const request = { queryRunners: [parent] };
    const { interceptor, createQueryRunner } = createHarness([]);

    expect(await execute(interceptor, Propagation.REQUIRED, request)).toBe("ok");
    expect(createQueryRunner).not.toHaveBeenCalled();
    expect(parent.release).not.toHaveBeenCalled();
    expect(request.queryRunners).toEqual([parent]);
  });

  it("REQUIRED starts its own transaction over a non-transactional runner", async () => {
    const parent = fakeRunner();
    const child = fakeRunner();
    const request = { queryRunners: [parent] };
    const { interceptor } = createHarness([child]);

    await execute(interceptor, Propagation.REQUIRED, request, () => {
      expect(request.queryRunners).toEqual([parent, child]);
      return of("ok");
    });

    expect(child.startTransaction).toHaveBeenCalledTimes(1);
    expect(child.commitTransaction).toHaveBeenCalledTimes(1);
    expect(child.release).toHaveBeenCalledTimes(1);
    expect(parent.release).not.toHaveBeenCalled();
    expect(request.queryRunners).toEqual([parent]);
  });

  it("REQUIRES_NEW suspends an existing runner and restores it afterward", async () => {
    const parent = fakeRunner();
    parent.isTransactionActive = true;
    const child = fakeRunner();
    const request = { queryRunners: [parent] };
    const { interceptor } = createHarness([child]);

    await execute(interceptor, Propagation.REQUIRES_NEW, request, () => {
      expect(request.queryRunners).toEqual([parent, child]);
      return of("ok");
    });

    expect(child.commitTransaction).toHaveBeenCalledTimes(1);
    expect(child.release).toHaveBeenCalledTimes(1);
    expect(parent.commitTransaction).not.toHaveBeenCalled();
    expect(parent.release).not.toHaveBeenCalled();
    expect(request.queryRunners).toEqual([parent]);
  });

  it("MANDATORY requires a transaction and otherwise reuses it", async () => {
    const parent = fakeRunner();
    parent.isTransactionActive = true;
    const { interceptor, createQueryRunner } = createHarness([]);

    await expect(execute(interceptor, Propagation.MANDATORY, {})).rejects.toThrow(
      TransactionException,
    );
    const request = { queryRunners: [parent] };
    expect(await execute(interceptor, Propagation.MANDATORY, request)).toBe("ok");
    expect(createQueryRunner).not.toHaveBeenCalled();
    expect(request.queryRunners).toEqual([parent]);
  });

  it("NEVER rejects an existing transaction", async () => {
    const parent = fakeRunner();
    parent.isTransactionActive = true;
    const { interceptor, createQueryRunner } = createHarness([]);

    await expect(
      execute(interceptor, Propagation.NEVER, { queryRunners: [parent] }),
    ).rejects.toThrow(TransactionException);
    expect(createQueryRunner).not.toHaveBeenCalled();
  });

  it("NEVER creates and releases a non-transactional runner when needed", async () => {
    const runner = fakeRunner();
    const { interceptor } = createHarness([runner]);
    const request = { queryRunners: [] as QueryRunner[] };

    expect(await execute(interceptor, Propagation.NEVER, request)).toBe("ok");
    expect(runner.startTransaction).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(request.queryRunners).toEqual([]);
  });

  it("NOT_SUPPORTED shadows an active transaction with a non-transactional runner", async () => {
    const parent = fakeRunner();
    parent.isTransactionActive = true;
    const child = fakeRunner();
    const request = { queryRunners: [parent] };
    const { interceptor } = createHarness([child]);

    await execute(interceptor, Propagation.NOT_SUPPORTED, request, () => {
      expect(request.queryRunners).toEqual([parent, child]);
      expect(child.isTransactionActive).toBe(false);
      return of("ok");
    });

    expect(child.startTransaction).not.toHaveBeenCalled();
    expect(child.release).toHaveBeenCalledTimes(1);
    expect(parent.release).not.toHaveBeenCalled();
    expect(request.queryRunners).toEqual([parent]);
  });

  it("NOT_SUPPORTED reuses an existing non-transactional runner", async () => {
    const parent = fakeRunner();
    const request = { queryRunners: [parent] };
    const { interceptor, createQueryRunner } = createHarness([]);

    expect(await execute(interceptor, Propagation.NOT_SUPPORTED, request)).toBe("ok");
    expect(createQueryRunner).not.toHaveBeenCalled();
    expect(parent.release).not.toHaveBeenCalled();
  });

  it("SUPPORTS allocates a runner when no transaction exists", async () => {
    const runner = fakeRunner();
    const { interceptor } = createHarness([runner]);
    const request = { queryRunners: [] as QueryRunner[] };

    await execute(interceptor, Propagation.SUPPORTS, request);
    expect(runner.startTransaction).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(request.queryRunners).toEqual([]);
  });

  it("SUPPORTS reuses the current runner without releasing it", async () => {
    const parent = fakeRunner();
    parent.isTransactionActive = true;
    const { interceptor, createQueryRunner } = createHarness([]);
    const request = { queryRunners: [parent] };

    await execute(interceptor, Propagation.SUPPORTS, request);
    expect(createQueryRunner).not.toHaveBeenCalled();
    expect(parent.release).not.toHaveBeenCalled();
  });

  it("releases a non-transactional runner even if the handler fails", async () => {
    const runner = fakeRunner();
    const { interceptor } = createHarness([runner]);
    const request = { queryRunners: [] as QueryRunner[] };

    await expect(
      execute(interceptor, Propagation.SUPPORTS, request, () =>
        throwError(() => new Error("read failed")),
      ),
    ).rejects.toThrow("read failed");
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(request.queryRunners).toEqual([]);
  });

  it("lets the repository resolve the current runner dynamically", async () => {
    const runner = fakeRunner();
    const request = { queryRunners: [] as QueryRunner[] };
    const repository = new TransactedRepository(class ExampleEntity {}, request);
    const { interceptor } = createHarness([runner]);

    await execute(interceptor, Propagation.REQUIRED, request, () => {
      expect(repository.queryRunner).toBe(runner);
      expect(repository.manager).toBe(runner.manager);
      return of("ok");
    });
    expect(request.queryRunners).toEqual([]);
  });

  it("does not create a runner on an undecorated route", async () => {
    const { interceptor, createQueryRunner } = createHarness([]);
    const request = {};
    expect(await execute(interceptor, undefined, request)).toBe("ok");
    expect(createQueryRunner).not.toHaveBeenCalled();
  });

  it("waits for async handler work before committing", async () => {
    const events: string[] = [];
    const runner = fakeRunner(events);
    const { interceptor } = createHarness([runner]);
    await execute(interceptor, Propagation.REQUIRED, {}, () =>
      defer(() =>
        from(
          (async () => {
            await Promise.resolve();
            events.push("async handler");
            return "ok";
          })(),
        ),
      ),
    );
    expect(events).toEqual(["start", "async handler", "commit", "release"]);
  });

  it("cleans up independent concurrent requests", async () => {
    const runners = Array.from({ length: 25 }, () => fakeRunner());
    const { interceptor } = createHarness([...runners]);
    const requests = Array.from({ length: 25 }, () => ({
      queryRunners: [] as QueryRunner[],
    }));

    const values = await Promise.all(
      requests.map((request) =>
        execute(interceptor, Propagation.REQUIRED, request, () => of("ok")),
      ),
    );
    expect(values).toHaveLength(25);
    expect(requests.every((request) => request.queryRunners.length === 0)).toBe(true);
    expect(runners.every((runner) => runner.release.mock.calls.length === 1)).toBe(true);
  });
});
