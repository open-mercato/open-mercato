# Integration Auth Login Redirect Loop — Auto Create PR Plan

**Date:** 2026-07-07
**Slug:** `integration-auth-login-redirect-loop`
**Branch:** `fix/integration-auth-login-redirect-loop`
**Mode:** Spec-implementation run
**Source spec:** `.ai/specs/2026-07-07-integration-auth-login-redirect-loop.md`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 0 | 0.1 | Land source specification | done | 89cf420db |
| 1 | 1.1 | Add auth helper backend-cookie regression | done | pending |
| 2 | 2.1 | Fix verified auth cookie/session boundary | todo | — |
| 3 | 3.1 | Add cookie-backed ephemeral readiness probe | todo | — |
| 3 | 3.2 | Add readiness probe unit coverage | todo | — |
| 4 | 4.1 | Run checkpoint validation | todo | — |
| 5 | 5.1 | Final gate, self-review, PR handoff | todo | — |

## Goal

Fix the shared Open Mercato integration auth harness so `login(page, 'admin')` reaches `/backend` without an infinite `/backend` ↔ `/api/auth/session/refresh` loop, and make ephemeral readiness catch cookie-backed auth failures before unrelated Playwright specs run.

## Scope

- Add the reviewed source spec from the docs worktree to this implementation branch.
- Add a focused auth integration regression under `packages/core/src/modules/auth/__integration__/`.
- Diagnose and fix the smallest verified boundary in the shared helper and/or session refresh flow.
- Add CLI readiness hardening for cookie-backed `/backend` auth.
- Keep diagnostics redacted: cookie names, statuses, and locations only.

## Non-Goals

- Do not redesign JWT/session token formats, cookie names, auth routes, RBAC semantics, or tenant provisioning.
- Do not replace `login(page, role)` with per-spec UI login.
- Do not touch product UI or introduce new persisted data.
- Do not change 403 access-denied behavior from the coherent access-denied UX spec.

## External References

None.

## Relevant Guides

- `AGENTS.md` root Task Router: specs, integration testing, auth, shared helpers, CLI, BC.
- `.ai/specs/AGENTS.md`: source spec naming and implementation-accuracy rules.
- `.ai/qa/AGENTS.md`: executable Playwright tests live in module `__integration__` folders and use `@open-mercato/core/helpers/integration/*`.
- `packages/core/AGENTS.md`: API route `metadata`/`openApi`, encrypted reads, auth module boundaries.
- `packages/core/src/modules/auth/AGENTS.md`: no token logging; preserve auth/session/RBAC semantics.
- `packages/shared/AGENTS.md`: typed infrastructure helpers only; no ad hoc wildcard matching.
- `packages/cli/AGENTS.md`: standalone/ephemeral integration contract alignment.
- `BACKWARD_COMPATIBILITY.md`: import paths, API URLs, cookie names, response fields, DI names, and session semantics are contract surfaces.

## Risks

- **Auth contract regression:** helper/session changes can affect every browser integration test and standalone apps. Mitigation: preserve public import path and endpoint/cookie contracts; add targeted tests.
- **Secret leakage:** diagnostics could expose tokens in CI logs. Mitigation: unit-test redaction and never print cookie values or Set-Cookie payloads.
- **MFA/interceptor compatibility:** helper could accidentally treat pending login responses as full sessions. Mitigation: only proceed when canonical cookies/full login are present; keep fallback behavior bounded.
- **Readiness flakiness:** extra auth probe could consume rate limit or add slow startup. Mitigation: one bounded probe with explicit redirect limit and redacted failure details.

## Implementation Plan

### Phase 0: Source Spec

#### Step 0.1 — Land source specification
- Copy the reviewed spec from `.worktrees/integration-auth-redirect-loop-spec/.ai/specs/2026-07-07-integration-auth-login-redirect-loop.md` into `.ai/specs/`.
- Confirm the filename follows OSS `{date}-{title}.md`.
- Keep the spec in draft/root state; do not move it to `implemented/`.

### Phase 1: Regression and Diagnostics

#### Step 1.1 — Add auth helper backend-cookie regression
- Add `packages/core/src/modules/auth/__integration__/TC-AUTH-053-login-helper-backend-cookie-flow.spec.ts`.
- Import `login` from `@open-mercato/core/helpers/integration/auth`.
- Assert `login(page, 'admin')` reaches `/backend` and does not loop through session refresh.
- Add redacted redirect/cookie diagnostics in the test or helper utility as needed; no token values.
- Run a targeted scratch check for the new test listing or affected TypeScript compile path.

### Phase 2: Verified Auth Boundary Fix

#### Step 2.1 — Fix verified auth cookie/session boundary
- Inspect current helper, login endpoint, refresh endpoint, and canonical auth resolution before editing.
- Fix only the verified boundary:
  - mirror login cookies into the browser context if request-context cookies do not propagate, or
  - make refresh fail closed to login when canonical auth cannot be satisfied.
- Preserve fallback UI login, bounded 429 retries, endpoint contracts, `metadata`, and `openApi`.
- Add focused unit coverage for any new cookie parsing, diagnostics, or redirect-loop utilities.

### Phase 3: CLI Readiness

#### Step 3.1 — Add cookie-backed ephemeral readiness probe
- Extend `packages/cli/src/lib/testing/integration.ts` with a bounded cookie-backed `/backend` probe.
- Follow redirects manually with a small limit and same-origin/protocol-relative rejection.
- Report statuses, locations, and cookie names only.
- Fail readiness before Playwright starts when `/backend` and `/api/auth/session/refresh` repeat.

#### Step 3.2 — Add readiness probe unit coverage
- Add or update CLI tests for redirect-loop detection, unsafe redirect rejection, and redacted detail formatting.
- Verify diagnostics do not include raw cookie values, JWT-looking values, credentials, refresh tokens, or Set-Cookie payloads.

### Phase 4: Checkpoint

#### Step 4.1 — Run checkpoint validation
- Run targeted validation for packages touched so far:
  - `yarn workspace @open-mercato/core test`
  - `yarn workspace @open-mercato/cli test`
  - focused integration command for `TC-AUTH-052` when the ephemeral stack is available.
- Write `checkpoint-1-checks.md`, rewrite `HANDOFF.md`, append `NOTIFY.md`, and commit the checkpoint.

### Phase 5: Final Gate and PR

#### Step 5.1 — Final gate, self-review, PR handoff
- Run full gate as far as environment permits: `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.
- Run required integration suites or document concrete blockers with evidence.
- Run code-review and BC self-review.
- Update source spec changelog/status with implementation evidence.
- Open PR against `develop`, apply labels, run auto-review handoff if possible, and post the final summary comment.

## Verification Policy

- Per-step checks are scratch only and are not logged separately.
- Checkpoint validation is recorded in `checkpoint-1-checks.md`.
- Final validation is recorded in `final-gate-checks.md`.
- UI screenshot artifacts are N/A unless implementation touches product UI; this run is expected to be non-UI.
