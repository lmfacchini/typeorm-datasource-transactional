# typeorm-datasource-transactional

NestJS HTTP interceptor and request-scoped TypeORM repositories with explicit transaction propagation.

## Transaction lifecycle (1.1.4)

The interceptor now awaits `startTransaction()`, handler completion and `commitTransaction()` (or rollback on failure). Every `QueryRunner` created by the interceptor is released in `finally`, and the request's `queryRunners` stack is restored even when a database operation fails. Reused runners are owned by the outer scope and are **not** released by the inner scope.

| Propagation | Existing active transaction | No active transaction |
| --- | --- | --- |
| `REQUIRED` | Reuse | Create a transaction |
| `REQUIRES_NEW` | Create a new transaction | Create a new transaction |
| `MANDATORY` | Reuse | Throw |
| `NEVER` | Throw | Use/create a non-transactional runner |
| `NOT_SUPPORTED` | Suspend with a new non-transactional runner | Use/create a non-transactional runner |
| `SUPPORTS` | Reuse | Use/create a non-transactional runner |

`TransactedRepository` resolves the current runner from `request.queryRunners` at operation time; it must be used within a decorated controller action or another scope that owns a runner.

**Scope:** This interceptor is intended for standard HTTP controller methods with a finite Observable/promise response. It uses `lastValueFrom()` to ensure transaction finalization occurs before the response completes. It is **not suitable for SSE, infinite streams or WebSockets** without a different lifecycle strategy. Metadata is read from controller handler or class, not automatically from an injected service method.

## Verify

```sh
npm ci
npm test -- --runInBand
npm run build
```

Test with the same Node.js and TypeORM versions as your consuming projects before publishing to npm. Existing projects must install the new published version of this package to pick up the fix. Monitor database pool `total`, `idle`, `waiting` under load; any independent `QueryRunner` usage elsewhere must still call `release()`.
