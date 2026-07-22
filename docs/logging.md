# Production Logging

Phase 10 adds request-scoped structured context on top of the existing pino logger (`packages/shared/src/logger.ts`).

## Request context

`packages/shared/src/request-context.ts` provides an `AsyncLocalStorage`-based request context:

```ts
interface RequestContext {
  requestId: string;      // fresh UUID per request
  correlationId: string;  // from x-correlation-id header, else generated
  userId?: string;        // set by requireAuth
  organizationId?: string;// set by requireActiveOrganizationId
  route?: string;
  method?: string;
}
```

- `apiHandler` establishes the context for every API request (requestId, correlationId, route, method) and runs the handler inside `runWithRequestContext`.
- `requireAuth` fills in `userId`; `requireActiveOrganizationId` fills in `organizationId` (via `updateRequestContext`).
- Every response carries `x-request-id` and `x-correlation-id` headers.

## Automatic log correlation

The logger folds the active request context into **every** log line automatically:

```
logger.child('api').error('Unhandled API error', { path })
// → { level, time, service, scope:'api', requestId, correlationId, userId, organizationId, path, msg }
```

Outside a request (jobs, build, module init) the context is empty and behaviour is unchanged. Explicit `meta` always wins over context on key collision.

## Levels & format

pino, JSON in production / `pino-pretty` in development. Level from `LOG_LEVEL` (default `info` in prod, `debug` in dev). `NODE_ENV` and `LOG_LEVEL` are read directly from `process.env` (not the validated env) so importing the logger never forces full env validation.

## Correlation across systems

Pass an incoming `x-correlation-id` to correlate a request with upstream systems; it propagates to logs and error reports. Workflow/event `correlationId`s (Phase 8) are a separate domain concept and are unaffected.
