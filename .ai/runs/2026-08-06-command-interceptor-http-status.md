# Execution plan — let a command interceptor's rejection carry an HTTP status

Closes #5045.

## Goal

A command interceptor that deliberately blocks a command can say *how* the rejection should surface
over HTTP. Today every `{ ok: false, message }` becomes a generic
`500 { error: 'Internal server error', message: 'Something went wrong. Please try again later.' }`
and the interceptor's message — in the reporter's case a localized list of missing fields — is lost.

## Context

`CommandInterceptorBeforeResult` (`packages/shared/src/lib/commands/command-interceptor.ts`) exposes
only `ok` / `message` / `modifiedInput` / `metadata`. Its sibling contract for the same job on the
sync-event side, `SyncCrudEventResult` (`packages/shared/src/lib/crud/sync-event-types.ts`), has
carried `status` and `body` from the start, and `runSyncBeforeEvent`'s caller in the CRUD factory
already maps them (`json(syncResult.errorBody ?? …, { status: syncResult.errorStatus ?? 422 })`). The
command-interceptor path never grew the equivalent, so:

1. `runCommandInterceptorsBefore` / `runCommandInterceptorsBeforeUndo` narrow the verdict to
   `error: { message }`;
2. `CommandBus` rethrows it as `new CommandInterceptorError(beforeResult.error!.message)`
   (`command-bus.ts`, both the execute and the undo path);
3. `CommandInterceptorError` (`commands/errors.ts`) is a bare `extends Error` with no transport data;
4. `handleError` (`crud/factory.ts`) recognizes only `isCrudHttpError`, `ZodError` and transient DB
   errors, so the rejection reaches the final generic-500 branch.

The reporter's workaround is to throw `CrudHttpError(422, …)` straight from the interceptor, which
couples command-layer code to the CRUD transport — exactly the coupling the interceptor contract
exists to avoid.

## Scope

- `packages/shared/src/lib/commands/command-interceptor.ts` — `CommandInterceptorBeforeResult` gains
  optional `status?: number` and `body?: Record<string, unknown>`, documented like their
  `SyncCrudEventResult` counterparts.
- `packages/shared/src/lib/commands/command-interceptor-runner.ts` — a `CommandInterceptorBlockedError`
  type and a `buildBlockedError` helper normalize the verdict once for both before-hooks; `status`
  and a derived `body` are attached only when the interceptor supplied a numeric status.
- `packages/shared/src/lib/commands/errors.ts` — `CommandInterceptorError` gains an optional second
  constructor argument (`{ status?, body?, cause? }`), readonly `status` / `body`, a
  `Symbol.for('@open-mercato/CommandInterceptorError')` marker, and an exported
  `isCommandInterceptorError()` guard.
- `packages/shared/src/lib/commands/command-bus.ts` — both throw sites forward the verdict's
  `status` / `body`.
- `packages/shared/src/lib/commands/index.ts` — additive re-export of the guard and the options type.
- `packages/shared/src/lib/crud/factory.ts` — `handleError` maps a `CommandInterceptorError` that
  carries a numeric status onto `json(body ?? { error: message }, { status })`.

## Non-goals

- **No default status.** A rejection without an explicit status keeps today's generic 500. Defaulting
  to 422 (as sync events do) would change the response of every existing interceptor — a behavior
  change on a contract surface, and one nobody asked for. Interceptors opt in per rejection.
- **No reuse of the `CrudHttpError` marker.** It is the other option the issue floats, and it is the
  wrong one: 98 `isCrudHttpError` call sites across 9 modules would start matching interceptor
  rejections, including behavioral checks like checkout's `const isConflict = isCrudHttpError(error)`.
  A distinct marker keeps the blast radius at the one handler that opts in.
- **The app catch-all route** (`apps/mercato/src/app/api/[...slug]/route.ts`) keeps its narrow
  tenant-guard mapping. It is not a general error handler.

## Migration & Backward Compatibility

Additive throughout, per `BACKWARD_COMPATIBILITY.md` §2 ("Optional fields may be added freely"):

- `CommandInterceptorBeforeResult` — two new optional fields; existing interceptors compile unchanged.
- `CommandInterceptorError` — the constructor's second argument is optional, so every existing
  `new CommandInterceptorError(message)` call site is unaffected, and the class still `extends Error`,
  so existing `catch` blocks and `instanceof Error` checks behave identically.
- The runner's returned `error` object gains two optional fields; callers reading `.message` are
  unaffected.
- No exports removed or renamed; no runtime behavior changes for any interceptor that does not set a
  status.

No deprecation bridge is required because nothing is deprecated.

## Progress

- [x] Triage confirmed against `upstream/develop` — real, still-unfixed, no PR or commit in flight
- [x] `CommandInterceptorBeforeResult` carries optional `status` / `body`
- [x] Runner normalizes the blocking verdict and propagates it (execute + undo paths)
- [x] `CommandInterceptorError` carries `status` / `body` behind a `Symbol.for` marker + type guard
- [x] `CommandBus` forwards the verdict at both throw sites
- [x] `handleError` maps a status-carrying interceptor error
- [x] Regression tests — error class, runner (both hooks), CRUD route (500 path and 422 path)
- [x] Full validation gate green (local mode)
- [x] PR opened with labels and summary comment — #5067
- [x] Self-review pass; one minor finding (status/body could drift apart) fixed in `8e74cdd77`
- [x] Gate re-run on the final head `8e74cdd77` — 8/8 green, `yarn test` 25/25 first try, no generated drift
- [x] Latest `develop` merged into the branch (clean, no conflicts) before the review-fix pass
- [x] Review by @adeptofvoltron (changes requested) addressed — see the four items below
- [x] Major — spec `.ai/specs/2026-08-06-command-interceptor-http-status.md`, a `BACKWARD_COMPATIBILITY.md`
      entry, and the three stale blocks in `SPEC-041m4-command-interceptors.md` refreshed
- [x] Minor 1 — the `beforeUndo` half now has an HTTP consumer: the action-log undo route maps the
      rejection instead of flattening everything into `400 Undo failed`
- [x] Minor 2 — `handleError` can no longer throw: `getCommandInterceptorHttpRejection` validates the
      status is an integer in 400-599 before it reaches `new Response(…)`
- [x] Minor 3 — `CommandBus` forwarding covered directly in `command-bus.test.ts` (3 cases)
- [ ] Maintainer approving review (self-approval not possible) and remote `test` / `ephemeral-integration` green

## Validation

Runner mode: **local** — no compose `app` container was running when the gate started, so the
`.ai/agentic.config.json` `validation.commands` list runs as plain `yarn <command>`.

| Command | Result |
|---|---|
| `yarn build:packages` | ✅ |
| `yarn generate` | ✅ (no diff — nothing this change touches is auto-discovered) |
| `yarn build:packages` (2nd) | ✅ |
| `yarn i18n:check-sync` | ✅ all 5 locales in sync |
| `yarn i18n:check-usage` | ✅ (3623 unused keys, advisory, pre-existing) |
| `yarn typecheck` | ✅ 22/22 |
| `yarn test` | ✅ see below |
| `yarn build:app` | ✅ |

`yarn test` needed three runs to attribute its failures, and none of them belong to this change:

- Run 1 — `@open-mercato/telemetry` reported one failed suite; it passes in isolation (82/82).
- Run 2 — `create-mercato-app` failed instead; it passes in isolation (456 pass, 0 fail, exit 0).
- Run 3 — `@open-mercato/core` exited 1 with `Tests: 9141 passed, 9141 total` and a jest worker
  killed by `SIGSEGV`. A crashed worker, not a failed assertion.

The failing package moved between runs and never included a package this branch touches. The one
package that *is* touched, `@open-mercato/shared`, passes in full: **169 suites, 1778 tests, 0
failures**, including all 12 new regression tests.
