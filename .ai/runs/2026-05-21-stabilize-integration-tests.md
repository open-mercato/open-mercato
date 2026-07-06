# Stabilize Integration Tests

**Brief**: Get develop and use the integration-tests skill to run all integration tests, stabilizing any flaky ones until the suite is green.

**Branch**: `fix/stabilize-integration-tests`

**Type**: Test stabilization (corrective work).

## Goal

Bring `yarn test:integration` (815 tests across 396 files) to a deterministic green state by removing known flake patterns and fixing root causes — not by raising retries or timeouts.

## Scope

- All `.spec.ts` files under `packages/*/src/modules/*/__integration__/` and `apps/mercato/src/modules/*/__integration__/`.
- Shared helpers under `packages/core/src/helpers/integration/*`.
- Playwright config at `.ai/qa/tests/playwright.config.ts` (do not edit unless absolutely necessary; the project policy is "no per-test timeout/retry overrides").

## Non-goals

- Adding new test coverage. This run is purely about stability of *existing* tests.
- Rewriting helpers wholesale.
- Adjusting timeouts or retry counts as a workaround for real flakes — the lessons.md guidance is to fix the root cause, not paper over it.
- Updating `.ai/qa/scenarios/` markdown documentation.

## Overview

### Runtime blocker (must be solved by reviewer or follow-up run)

This run was started in a sandboxed worktree where:

- `/var/run/docker.sock` is owned by `root:docker` and the current user is not in the `docker` group; `sudo` is not available.
- No local PostgreSQL is listening on `127.0.0.1:5432`.
- No `.env` file is present at the repo root or `apps/mercato/`; `.ai/qa/ephemeral-env.json` does not exist.

Therefore the standard ways to run the suite are all unavailable from inside this run:

| Path | Why it fails here |
|------|-------------------|
| `yarn test:integration:ephemeral` | Needs Docker for testcontainers postgres. |
| `yarn test:integration:ephemeral:interactive` | Same. |
| `yarn test:integration:ephemeral:start` | Same. |
| `yarn test:integration` | Needs a dev server + seeded DB on `localhost:3000`; nothing is listening. |

This means **the run cannot empirically observe flakes**. The pragmatic path taken instead:

1. Survey the codebase against the documented flake-pattern rules in `.ai/lessons.md` and the integration-tests skill.
2. Fix the *deterministic* matches against those rules.
3. Leave the PR `Status: in-progress` and hand off the empirical "run the whole suite" half to either:
   - a re-run from a host that has Docker access, via `/auto-continue-pr <prNumber>`; or
   - the reviewer running `yarn test:integration:ephemeral` locally and reporting any remaining flakes.

This keeps the PR honest: it does not claim "all green" — it claims "removed a documented-flaky pattern; full green still needs verification on a runnable host".

### Phase 0 discovery results

- Suite size: **815 tests across 396 files** (verified via `npx playwright test --config .ai/qa/tests/playwright.config.ts --list`).
- Required build prep: `yarn build:packages`, then `yarn generate`. Initial `yarn generate` failed because `packages/core/dist/generated/` was empty after a cache-replay build; forcing `yarn workspace @open-mercato/core build` from a clean `dist/` repopulated it.
- Existing stabilization commits on `develop` (signal that this is an active, ongoing concern):
  - `51c914957` Merge PR 2008 and stabilize CRM integration tests
  - `084ad4e4e` Stabilize translation integration test
  - `5e0221481` test: stabilize sync excel integration runtime
  - `f9a8e1e4c` test: stabilize async ui specs under load
  - `a5d31041d` test(shared): stabilize custom field redos regression
  - `83b661d5a` fix: stabilization fixes
  - `28dd2e937` test(translations): stabilize standalone save integration
  - `b59677036` test(sales): stabilize adjustment dialog input
  - `7aedd7b2b` [bug] fix translation manager save flake (#1847)
  - `45cff5f57` test: catch up selectors after topbar redesign

### Phase 0 deterministic match: `networkidle` antipattern

`.ai/lessons.md` §"Integration tests: avoid `networkidle` on pages with SSE/background streams" forbids using `page.waitForLoadState('networkidle')` as a generic readiness gate on backend pages — the catalog products page is SSE-active (`catalog.product.updated` is `clientBroadcast: true` per `packages/core/src/modules/catalog/AGENTS.md`), so `networkidle` may never resolve.

Concrete matches surveyed via `Grep` on `packages/**/__integration__/**/*.ts`:

| File | Line(s) | Wait timeout |
|------|---------|---------------|
| `packages/core/src/modules/catalog/__integration__/TC-AI-MERCHANDISING-008-products-sheet.spec.ts` | 82, 107, 155 | `30_000ms` |
| `packages/core/src/modules/catalog/__integration__/TC-AI-INJECT-013-merchandising-injection.spec.ts` | 43 | `30_000ms` |

In every case the test already waits for `[data-testid="backend-chrome-ready"][data-ready="true"]` (which flips after `useBackendChrome()` hydrates) *and* for the interaction target's `toBeVisible()` + `toBeEnabled()`. So the `networkidle` line is pure deadweight — and on an SSE-active page it can burn 30 s of the test's 120 s budget for no benefit.

**Excluded from this fix**: `packages/core/src/helpers/integration/salesUi.ts:1100` uses `networkidle` with a bounded `5_000` ms timeout to wait for a specific one-shot `tax-rates` XHR before filling the Add Adjustment dialog. The accompanying comment explains the exact reason (the `useEffect` resets the form via `formResetKey` when tax rates arrive, wiping a too-early `.fill()`). That helper does not violate the lessons.md rule (it is not a "generic readiness gate on backend pages"; it's a scoped wait for a single API completion) and changing it would require a separate `waitForResponse('/api/.../tax-rates')` rewrite — out of scope for this stabilization pass.

### External References

None — no `--skill-url` was provided.

## Implementation Plan

### Phase 1 — Remove `networkidle` generic-readiness antipattern from catalog merchandising specs

Apply the documented `.ai/lessons.md` rule §"Integration tests: avoid `networkidle` on pages with SSE/background streams" to the two known violators. The page-readiness signal (`backend-chrome-ready` data attr) and the per-interaction `toBeVisible()`/`toBeEnabled()` waits already provide a stronger, deterministic readiness contract than `networkidle` can. Removing the `networkidle` line removes a 30-second deadweight window that is the textbook deterministic-flake source for SSE-active pages.

#### Steps

1.1 Remove the three `page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})` calls from `TC-AI-MERCHANDISING-008-products-sheet.spec.ts` (lines 82, 107, 155).

1.2 Remove the one `page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})` call from `TC-AI-INJECT-013-merchandising-injection.spec.ts` (line 43).

1.3 Verify by re-grepping `packages/*/__integration__/` for `waitForLoadState\(.networkidle` — the only remaining hit must be the bounded helper usage in `salesUi.ts:1100`, which is intentionally retained.

1.4 Typecheck the affected package (`packages/core`) and run the unit Jest suite for `packages/core` — no logic changed, but typecheck confirms no syntactic regression.

### Phase 2 — (deferred) Empirical full-suite stabilization

This phase requires a host with Docker access. It is the half of the brief this run cannot complete itself; record it explicitly so `auto-continue-pr` knows what's left.

#### Steps

2.1 Run `yarn test:integration:ephemeral` on a Docker-capable host. Capture per-test pass/fail and the Playwright HTML report.

2.2 Classify each failing test as `regression`, `flake`, or `env-only` per `.ai/qa/AGENTS.md` "Failure Analysis" section.

2.3 For each `flake`, identify the root cause (timing, ordering, fixture, SSE) and apply a targeted fix — never raise retry count or timeout as a workaround.

2.4 Re-run the suite once. Any test that flips state across the two runs is by definition flaky and gets re-investigated.

2.5 Stop when the same passing set is observed twice in a row.

## Risks

- **Runtime blocker (high)**: this run could not execute the suite, so Phase 2 work is fully deferred. Mitigation: PR opens with `Status: in-progress`; summary comment names the `/auto-continue-pr` hand-off explicitly. Without Phase 2, the brief's "all is green" success criterion is unverified.
- **False positive on `networkidle` removal (low)**: theoretically a test could be relying on `networkidle` to wait for an async event the explicit selectors miss. Mitigation: the surrounding waits (`backend-chrome-ready` data-ready + `trigger.toBeVisible()` + `trigger.toBeEnabled()`) are strictly stronger than `networkidle`'s "no in-flight request for 500ms" heuristic; they directly observe what the test is about to interact with. Phase 2 re-run will catch any miss.
- **Scope creep (low)**: there is a strong pull to also fix `salesUi.ts:1100` and refactor it to `waitForResponse`. Held out of scope here because it's a different change (helper refactor, not antipattern removal) and risks breaking a working bounded wait that documents its own reason.
- **External reviewer must run Phase 2**: if no one runs `yarn test:integration:ephemeral` on this branch, the "all green" claim never gets verified. Mitigation: spelled out in the summary comment and in this plan.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Remove `networkidle` generic-readiness antipattern from catalog merchandising specs

- [x] 1.1 Remove three `networkidle` waits from `TC-AI-MERCHANDISING-008-products-sheet.spec.ts` — 1f8482a6c
- [x] 1.2 Remove one `networkidle` wait from `TC-AI-INJECT-013-merchandising-injection.spec.ts` — 1f8482a6c
- [x] 1.3 Confirm grep shows only the intentional `salesUi.ts` retention — 1f8482a6c
- [x] 1.4 Typecheck + Jest unit run for `packages/core` — 1f8482a6c (TS parser sanity-check passed; pre-existing `TS5103` baseline error unrelated to edits; Jest config only matches `__tests__/**/*.test.(ts|tsx)`, so spec edits are not in scope)

### Phase 2: Empirical full-suite stabilization

- [ ] 2.1 Run `yarn test:integration:ephemeral` on a Docker-capable host
- [ ] 2.2 Classify failures (regression / flake / env-only)
- [ ] 2.3 Apply targeted root-cause fixes per flake
- [ ] 2.4 Re-run suite once for repeatability
- [ ] 2.5 Stop at two consecutive identical green runs

## Changelog

- 2026-05-21: Plan drafted. Runtime blocker (no Docker, no local postgres) means Phase 2 is deferred to `/auto-continue-pr` on a runnable host.
