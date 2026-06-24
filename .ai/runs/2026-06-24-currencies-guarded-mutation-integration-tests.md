# Execution Plan — currencies guarded-mutation integration tests

## Overview

Follow-up to **PR #3438** (`fix: route currencies non-CrudForm UI writes through guarded mutations`,
fixes #3191), which routed the currencies / exchange-rates / fetch-config UI writes through
`useGuardedMutation(...).runMutation(...)`. That PR shipped jsdom unit tests only. The
`om-auto-verify-pr-ui` run on #3438 exercised every guarded write surface end-to-end with a
**throwaway** Playwright spec and asked for a committed integration test to lock the behavior in
(see the "🧪 Follow-up: add an integration test for this PR" comment on #3438).

This run converts that manual UI-QA scenario into committed Playwright integration specs under
`packages/core/src/modules/currencies/__integration__/`.

### Goal

Lock in (via committed integration tests) that the currencies UI writes route through the guard:
the fetch-config provider toggle PUT succeeds and flashes "Provider enabled", and both the
currency and exchange-rate row **Delete** actions route through the guard and surface the failure
flash consistently (current behavior — a pre-existing body-vs-query `?id=` delete bug returns HTTP
400, so the guard shows "Failed to delete …").

### Scope

- Add `TC-CUR-012.spec.ts` — currency + exchange-rate **Delete** route through the guard and surface
  the failure flash; the fixture row survives (proves the guarded DELETE failed at the API, not silently).
- Add `TC-CUR-013.spec.ts` — fetch-config provider **toggle on** routes a guarded PUT and flashes
  "Provider enabled"; verified via API.

### Non-goals

- **Not** fixing the pre-existing currency/exchange-rate delete body-vs-query `?id=` bug
  (`packages/shared/src/lib/crud/factory.ts:2771` defaults `idFrom: 'query'`, but the UI sends `id`
  in the body). That is a separate corrective change with its own QA; this run only documents and
  locks the current observable behavior, with a comment on how to flip the asserts once the bug is fixed.
- No set-base happy-path test — already covered by `TC-CUR-004.spec.ts`.
- No production code changes.

### Affected paths

- `packages/core/src/modules/currencies/__integration__/TC-CUR-012.spec.ts` (new)
- `packages/core/src/modules/currencies/__integration__/TC-CUR-013.spec.ts` (new)

### Source reference

- PR #3438 + its `om-auto-verify-pr-ui` evidence + integration-test follow-up comment.
- Conventions: `.ai/qa/AGENTS.md`, existing `TC-CUR-004.spec.ts` (UI row-action + flash pattern).

### Risks (brief)

- UI integration specs are inherently flaky (portalled menus, list re-renders). Mirror the proven
  resilience patterns from `TC-CUR-004.spec.ts` (bounded clicks, retry loop, `test.setTimeout(60_000)`).
- These specs require a live ephemeral app + Postgres to actually run. The sandbox cannot boot one,
  so the deliverable is a correct, well-formed spec verified by typecheck/lint/build; runtime
  execution happens in CI / the ephemeral QA env.
- Asserting current (buggy) delete behavior could read as "locking a bug" — mitigated with an explicit
  in-file comment pointing at the root cause and the flip-to-success instruction.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Guarded DELETE error-surfacing spec

- [x] 1.1 Add `TC-CUR-012.spec.ts` covering currency + exchange-rate delete routing through the guard
- [x] 1.2 Typecheck (specs type-clean; only env `#generated` TS2307 noise) + esbuild compile via `playwright --list`

### Phase 2: Guarded fetch-config toggle spec

- [x] 2.1 Add `TC-CUR-013.spec.ts` covering the fetch-config provider toggle guarded PUT
- [x] 2.2 Typecheck (type-clean) + esbuild compile via `playwright --list`

### Phase 3: Validation + PR

- [x] 3.1 Validation: `playwright --list` compiles all 3 tests; `tsc -p packages/core` reports 0 errors in the new specs (199 pre-existing `#generated` TS2307 errors are env-only, no `yarn generate` in this fresh worktree). Full `yarn test`/`build:app` gate runs in CI — `yarn test` is unit-only and does not execute these `__integration__` Playwright specs (they run via `yarn test:integration` against an ephemeral env).
- [ ] 3.2 Code-review + BC self-review
- [ ] 3.3 Open PR against develop, normalize labels
- [ ] 3.4 Run om-auto-review-pr and apply fixes
