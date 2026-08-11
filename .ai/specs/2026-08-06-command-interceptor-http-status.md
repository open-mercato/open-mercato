# Command interceptor rejections carry an HTTP status

**Status:** implemented
**Issue:** #5045 (transport rollout: #5097)
**PR:** #5067
**Extends:** [`SPEC-041m4-command-interceptors.md`](implemented/SPEC-041m4-command-interceptors.md)

## Problem

A command interceptor that deliberately blocks a command can say *that* it blocked, but not *how*
the rejection should surface over HTTP. `CommandInterceptorBeforeResult` carried only
`ok` / `message` / `modifiedInput` / `metadata`, so every `{ ok: false, message }` reached the CRUD
transport layer as a bare `CommandInterceptorError` and fell through `handleError`'s final branch to

```
500 { error: 'Internal server error', message: 'Something went wrong. Please try again later.' }
```

The interceptor's message — in the reporting case a localized list of missing fields — was lost, and
a deliberate business rejection was reported to the client as a server fault. The only workaround was
to throw `CrudHttpError(422, …)` straight from the interceptor, which couples command-layer code to
the CRUD transport — exactly the coupling the interceptor contract exists to avoid.

The sibling contract for the same job on the sync-event side, `SyncCrudEventResult`
(`packages/shared/src/lib/crud/sync-event-types.ts`), has carried `status` and `body` from the start,
and the CRUD factory already maps them. The command-interceptor path never grew the equivalent.

## Design

The verdict travels unchanged from the interceptor to the transport layer, normalized once in the
runner and validated once at the point of use.

| Layer | File | Change |
|---|---|---|
| Contract | `packages/shared/src/lib/commands/command-interceptor.ts` | `CommandInterceptorBeforeResult` gains optional `status?: number` and `body?: Record<string, unknown>`, documented like their `SyncCrudEventResult` counterparts. |
| Runner | `packages/shared/src/lib/commands/command-interceptor-runner.ts` | A `CommandInterceptorBlockedError` type and a `buildBlockedError` helper normalize the blocking verdict once for **both** before-hooks (`beforeExecute`, `beforeUndo`); `status` and a derived `body` are attached only when the interceptor supplied a numeric status. |
| Error class | `packages/shared/src/lib/commands/errors.ts` | `CommandInterceptorError` gains an optional second constructor argument (`{ status?, body?, cause? }`), readonly `status` / `body`, a `Symbol.for('@open-mercato/CommandInterceptorError')` marker, an exported `isCommandInterceptorError()` guard, and the `getCommandInterceptorHttpRejection()` mapper described below. |
| Bus | `packages/shared/src/lib/commands/command-bus.ts` | Both throw sites forward the verdict's `status` / `body`. |
| Exports | `packages/shared/src/lib/commands/index.ts` | Additive re-export of the guard, the mapper, and their types. |
| CRUD transport | `packages/shared/src/lib/crud/factory.ts` | `handleError` maps a status-carrying rejection onto `json(body, { status })`, ahead of `ZodError` and behind `isCrudHttpError`. |
| Undo transport | `packages/core/src/modules/audit_logs/api/audit-logs/actions/undo/route.ts` | The undo handler maps the same rejection instead of laundering every failure into `400 Undo failed`. |

### `status` and `body` are strictly paired

`CommandInterceptorError`'s constructor sets `body` only when a numeric `status` was supplied,
defaulting it to `{ error: message }`. A `body` without a `status` is ignored. The two can therefore
never drift apart, and the pairing is enforced in the one place that can enforce it.

### One mapper, validated once — `getCommandInterceptorHttpRejection`

Interceptor status codes are third-party data travelling through the runner and the bus, unlike
`CrudHttpError` statuses which come from literals at framework throw sites. Both transports go
through one exported mapper:

```typescript
getCommandInterceptorHttpRejection(err): { status: number; body: Record<string, unknown> } | null
```

It returns `null` — leaving the caller's generic handling in place — unless the error is an
interceptor rejection carrying an **integer status in 400–599**. The bound is deliberate:

- `new Response(body, { status })` throws `RangeError` outside 200–599, and that `RangeError` would
  escape the last-resort error handler itself, replacing a diagnosable 500 with an unhandled route
  error and skipping the structured log that records the original problem.
- A `2xx` on a rejection would report a deliberate block to the client as a success.
- `NaN` passes a bare `typeof x === 'number'` check, so integer-ness is asserted explicitly.

### Transport coverage

| Transport | Honors interceptor status | Notes |
|---|---|---|
| `makeCrudRoute` handlers (`POST`/`PUT`/`PATCH`/`DELETE`) | ✅ via `handleError` | The `beforeExecute` path. |
| `POST /api/audit_logs/audit-logs/actions/undo` | ✅ | The only route in the repository that undoes a command — the `beforeUndo` path. |
| Routes calling `commandBus.execute` with their own `catch` | ✅ (#5097) | 51 core routes map the rejection inline, ahead of their generic fallback; the 5 checkout routes and 7 enterprise-security routes inherit it from their module-level error mappers (`handleCheckoutRouteError`, `mapSudoError`, `mapMfaError`, `mapEnforcementError`, `mapSecurityUsersError`). |
| Routes calling `commandBus.execute` **without** their own `catch` (12) | ❌ | The rejection propagates out of the handler, so there is no `catch` to map it in — they answer with the framework's unhandled-error response. Listed in `ROUTES_WITHOUT_OWN_ERROR_HANDLING` in `packages/core/src/__tests__/command-interceptor-http-coverage.test.ts`; giving them error handling is a behavior change of its own. |
| App catch-all (`apps/mercato/src/app/api/[...slug]/route.ts`) | ❌ | Keeps its narrow tenant-guard mapping; it is not a general error handler. |

Adoption is pinned by `packages/core/src/__tests__/command-interceptor-http-coverage.test.ts`: every core route that calls
the command bus and catches its own failures must consult the mapper, and the exemption lists must stay free of stale entries.

## Non-goals

- **No default status.** A rejection without an explicit status keeps today's generic 500. Defaulting
  to 422 (as sync events do) would change the response of every existing interceptor — a behavior
  change on a contract surface that nobody asked for. Interceptors opt in per rejection.
- **No reuse of the `CrudHttpError` marker.** 98 `isCrudHttpError` call sites across 9 modules would
  start matching interceptor rejections, including behavioral checks such as checkout's
  `const isConflict = isCrudHttpError(error)`. A distinct marker keeps the blast radius at the
  handlers that opt in.
- **No shared route wrapper.** #5097 migrated the direct-`execute` routes by adopting
  `getCommandInterceptorHttpRejection` at each call site, exactly as the undo transport does. A wrapper
  returning the `Response` was considered and rejected: the mapper already *is* the shared helper, and a
  wrapper would only inline the `NextResponse.json(...)` call while splitting the idiom away from the two
  transports that shipped first. Where a module already funnels route errors through one mapper
  (checkout, enterprise security), the branch went into that mapper instead of into each route.
- **Routes without their own error handling keep the framework response.** The twelve routes that call
  the bus outside any `try/catch` still surface an unhandled error; adding a `catch` to them changes how
  every other failure is answered, which is out of scope for a status-mapping change.

## Migration & Backward Compatibility

Additive throughout, per `BACKWARD_COMPATIBILITY.md` § Type interfaces ("Optional fields may be added
freely"). See the `Command Interceptor HTTP Status (2026-08-06)` entry in `BACKWARD_COMPATIBILITY.md`
for the surface-by-surface classification.

- `CommandInterceptorBeforeResult` — two new optional fields; every existing interceptor compiles and
  behaves identically.
- `CommandInterceptorError` — the constructor's second argument is optional, so every existing
  `new CommandInterceptorError(message)` call site is unaffected, and the class still `extends Error`,
  so existing `catch` blocks and `instanceof Error` checks behave identically.
- The runner's returned `error` object gains two optional fields; callers reading `.message` are
  unaffected.
- `isCommandInterceptorError`, `getCommandInterceptorHttpRejection`, `CommandInterceptorErrorOptions`
  and `CommandInterceptorHttpRejection` are new exports; nothing is removed or renamed.
- HTTP responses are byte-identical for any interceptor that sets no status — asserted by
  `crud-factory.test.ts` ("keeps the generic 500 when an interceptor blocks without a status") and by
  `undo.route.test.ts` ("keeps the generic 400 when the rejection carries no status").

No deprecation bridge is required because nothing is deprecated, and no `UPGRADE_NOTES.md` entry is
owed because the protocol's items 1–4 govern removals and renames, of which there are none.

## Usage

```typescript
// commands/interceptors.ts
export const interceptors: CommandInterceptor[] = [
  {
    id: 'compliance.require-vat-id',
    targetCommand: 'sales.order.*',
    async beforeExecute(input, ctx) {
      const missing = collectMissingFields(input)
      if (!missing.length) return
      return {
        ok: false,
        message: t('compliance.errors.missing_fields', { fields: missing.join(', ') }),
        status: 422,
        body: { error: 'Missing required fields', missingFields: missing },
      }
    },
  },
]
```

The rejection reaches the caller as `422 { error: 'Missing required fields', missingFields: [...] }`
instead of a generic 500. Omitting `status` keeps the historical behaviour.

## Test coverage

| Layer | File | Cases |
|---|---|---|
| Contract / error class | `packages/shared/src/lib/commands/__tests__/command-interceptor-error.test.ts` | Status/body pairing rules, cross-bundle guard (positive and negative), and the mapper: valid rejection, explicit body, no status, non-interceptor error, out-of-range status, non-integer status. |
| Runner | `packages/shared/src/lib/commands/__tests__/command-interceptor-runner.test.ts` | Propagation from `beforeExecute` (no status, status only, explicit body, generated fallback message) and from `beforeUndo` (no status, `status: 409`). |
| Bus forwarding | `packages/shared/src/lib/commands/__tests__/command-bus.test.ts` | A registered interceptor blocking a real `commandBus.execute` — status and derived body forwarded, explicit body forwarded verbatim, no status leaves both undefined, and the command never executes. |
| CRUD transport | `packages/shared/src/lib/crud/__tests__/crud-factory.test.ts` | A real `makeCrudRoute` POST returning 500 (no status), 422 (status), the explicit body, and 500 again for an out-of-range status. |
| Undo transport | `packages/core/src/modules/audit_logs/api/__tests__/undo.route.test.ts` | 409 with the message, 422 with an explicit body, generic 400 without a status, generic 400 for an unrelated failure. |
| Direct-`execute` adoption (#5097) | `packages/core/src/__tests__/command-interceptor-http-coverage.test.ts` | Static guard: every core command-bus route that catches its own failures consults the mapper; exemption lists carry no stale entries. |
| Direct-`execute` behavior (#5097) | `staff/api/leave-requests/accept`, `customers/api/todos`, `directory/api/organization-branding`, `feature_toggles/api/overrides` route tests | Per response shape: 422 with the explicit body, and the route's historical generic answer (400 / 500, adapter headers preserved) for a statusless rejection. |
| Module-level mappers (#5097) | `packages/checkout/src/modules/checkout/api/__tests__/helpers.error-mapping.test.ts`, `packages/enterprise/src/modules/security/api/__tests__/error-mapping.interceptor.test.ts` | Status-carrying rejection, message-derived body, statusless rejection keeping the generic 500, and `CrudHttpError` still mapped first. |
