# Stabilize Flaky Integration Tests

**Brief**: Use the integration-tests skill to stabilize the failing/flaky integration tests surfaced by the CI runs on PR #2045 (Standalone App Integration Tests, run 26368148301, job 77615825419) and PR #2043 (ephemeral integration shard 12 + 13, run 26368100618, jobs 77615786510 and the shard-13 sibling). Then run the full integration suite and continue stabilizing until green, push as a fresh PR against `develop`, wait on CI, and fix any remaining failures.

**Branch**: `fix/stabilize-flaky-integration-tests`

**Type**: Test stabilization (corrective work — root-cause fix, not retry/timeout cranking).

## Goal

Make the four CI-observed failures deterministically green by fixing the root causes, not by masking them with retries or longer timeouts. Then run the rest of the suite, fix any further flakes that surface, and ship as a single PR against `develop`.

## Scope

- `packages/shared/src/lib/modules/registry.ts` — the shared modules registry (root cause of the standalone failures).
- `packages/core/src/modules/sales/__integration__/TC-SALES-005.spec.ts` and `TC-SALES-019.spec.ts` — UI tests whose orchestration regularly overruns Playwright's 20 s default test timeout.
- The Playwright config at `.ai/qa/tests/playwright.config.ts` is NOT in scope for global timeout cranking. Project policy in `.ai/lessons.md` is "fix the root cause, not the timeout"; per-test `test.slow()` is the documented escape hatch for tests that legitimately do many UI hops.
- Any additional flake that the empirical run surfaces and that resolves cleanly without rewriting tests wholesale.

## Non-goals

- New test coverage. This run is purely about stability of *existing* tests.
- Rewriting the sales UI helpers wholesale or restructuring `salesUi.ts`.
- Raising the global Playwright `timeout` value in `playwright.config.ts`.
- Mass-adding `test.slow()` everywhere as a blunt fix — only on tests that legitimately need it AND whose CI traces show the >20 s wall-clock orchestration time.
- Modifying `.ai/qa/scenarios/` markdown documentation.

## Overview

### CI failures observed

| Test | Type | Run | Symptom | Root cause |
|------|------|-----|---------|-----------|
| `TC-CRM-068: moves selected deals to the new stage via the async queue worker` | Standalone | 26368148301 job 77615825419 (PR #2045) | `expect(affectedCount).toBe(2)` — received `0`. Both deals' per-deal `customers.deals.update` call threw `"[Bootstrap] Modules not registered. Call registerModules() at bootstrap."` (recovered from the progress job `resultSummary.failedItems` in the Playwright trace). | The shared modules registry (`packages/shared/src/lib/modules/registry.ts`) keeps `_modules` as a **module-local** variable. In standalone tests, the Playwright runner's in-process `drainQueue` helper bootstraps via the **source** path while the worker handler's `createRequestContainer()` chain pulls the registry through the compiled `node_modules/@open-mercato/shared/dist/...` path. tsx/esbuild gives those two paths different module instances, so the modules registered in instance A are invisible to `getModules()` in instance B. The DI-registrars file already works around this exact tsx/esbuild module-duplication problem by parking its state on `globalThis` (see `packages/shared/src/lib/di/container.ts` lines 17-26). The modules registry must do the same. |
| `TC-CRM-069: reassigns selected deals to a new owner via the async queue worker` | Standalone | 26368148301 job 77615825419 (PR #2045) | Same as TC-CRM-068 — identical `[Bootstrap] Modules not registered` chain captured in the trace's progress job response. | Same root cause. The fix to the shared registry covers both. |
| `TC-SALES-005: should add discount adjustment on order from UI` | Ephemeral | 26368100618 shard 12/15 job 77615786510 (PR #2043) | `Test timeout of 20000ms exceeded.` (both attempts) | Pure UI orchestration test that runs `login → createSalesDocument → addCustomLine → addAdjustment → two visibility assertions`. The sales UI helpers internally cap individual waits at `TEST_WAIT_TIMEOUT_MS = 10_000`, so a single slow step (admin login on a cold ephemeral DB plus the document-detail load) can blow the 20 s budget for the whole test. The test is not currently marked `test.slow()`. The sibling async bulk-deal tests (TC-CRM-068/069) already use `test.slow()` for exactly this reason. The blunt "raise the global timeout" option is rejected by project policy in `.ai/lessons.md`; the per-test `test.slow()` opt-in is the right surgical knob. |
| `TC-SALES-019: should keep grand total stable after payment is recorded` | Ephemeral | 26368100618 shard 13/15 (PR #2043) | `Test timeout of 20000ms exceeded.` (both attempts) | Same shape as TC-SALES-005 — UI test runs `login → createSalesDocument → addCustomLine → readGrandTotalGross → addPayment → readGrandTotalGross`. Same `test.slow()` fix. |

The four failures cluster into two independent root causes (registry duplication + per-test budget on multi-step UI tests). Fixing both is independent and additive.

### External References

None — no `--skill-url` was provided. The user's brief points only at the two CI runs above; both are observed via `gh` and the downloaded Playwright artifacts.

### Verification strategy

- Unit-level: there are no unit tests for the modules registry's globalThis-survival behavior today. Add one mirroring `packages/shared/src/lib/di/__tests__/` style — register modules, drop the in-memory module ref by simulating a second module instance (load registry again under a different cache key via `require.cache` deletion), confirm `getModules()` still returns the registered list. This locks the regression so it does not silently come back.
- Empirical: run the full ephemeral suite locally if a Docker host is available. If Docker is not available in this run-host, leave the PR in CI's hands and rely on CI's ephemeral matrix to catch any remaining flake — the same path the prior `2026-05-21-stabilize-integration-tests.md` run took.
- BC: the fix is internal. `registerModules` / `getModules` signatures stay identical. The behavior change is "survives module duplication" — strictly additive.

## Implementation Plan

### Phase 1 — Standalone failures (TC-CRM-068 / TC-CRM-069)

Move the modules registry's `_modules` state onto `globalThis`, matching the existing tsx/esbuild-duplication workaround in `packages/shared/src/lib/di/container.ts`. Add a regression unit test that proves the registry survives module duplication.

#### Steps

1.1 Refactor `packages/shared/src/lib/modules/registry.ts` to store the registered modules array under a `globalThis` symbol/key (mirroring `__openMercatoDiRegistrars__` in `container.ts`). Preserve the existing `registerModules` / `getModules` contract — same names, same signatures, same exception text. Keep the existing HMR re-registration debug log.

1.2 Add a unit test at `packages/shared/src/lib/modules/__tests__/registry.test.ts` that:
- registers a small module list, asserts `getModules()` returns it;
- simulates a second module instance by re-importing the registry under a fresh `require.cache` entry (or by reading the same global key from a freshly-eval'd copy of the module) and asserts that the second instance also sees the registered list;
- restores the global state in `afterEach` so the test does not bleed.

1.3 Run targeted validation: `yarn workspace @open-mercato/shared test --runTestsByPath src/lib/modules/__tests__/registry.test.ts` (or the closest available shape — discovered at runtime) and `yarn workspace @open-mercato/shared typecheck`.

### Phase 2 — Ephemeral UI test budget (TC-SALES-005 / TC-SALES-019)

Mark the two sales UI tests `test.slow()` — the documented per-test escape hatch for tests that legitimately exceed the 20 s budget because they drive many UI hops, not because they are slow code. Do **not** raise the global `playwright.config.ts` timeout. Add a one-line comment on each test pointing at this run's plan so future maintainers see *why* the opt-in is there and don't strip it.

#### Steps

2.1 Add `test.slow();` as the first line of `should add discount adjustment on order from UI` in `packages/core/src/modules/sales/__integration__/TC-SALES-005.spec.ts`, with a single-line comment explaining the orchestration-budget reason.

2.2 Add `test.slow();` as the first line of `should keep grand total stable after payment is recorded` in `packages/core/src/modules/sales/__integration__/TC-SALES-019.spec.ts`, with the same single-line comment.

2.3 Survey adjacent sales UI specs in `packages/core/src/modules/sales/__integration__/` for the same pattern (multi-step UI orchestration without `test.slow()`) and add `test.slow()` ONLY where the test wall-clock plausibly exceeds 20 s. Conservative — do not blanket-apply. If unsure, leave it alone for this PR.

### Phase 3 — Empirical full-suite run + opportunistic stabilization

Run the full ephemeral integration suite from the run host. If Docker is unavailable here, document the deferral in the PR body's Risks section and let CI on the PR act as the empirical signal.

#### Steps

3.1 Probe runtime — Docker available? Postgres on 127.0.0.1:5432? If yes, run `yarn test:integration:ephemeral`. If no, document the deferral.

3.2 If runnable, triage any additional failures. Apply the same root-cause-fix discipline (no retry cranking, no global timeout cranking, no `networkidle` waits on SSE-active pages, no `page.waitForTimeout(...)` as a sync primitive).

3.3 If unrunnable, push the Phase 1 + Phase 2 changes through CI and rely on CI's matrix as the empirical signal.

### Phase 4 — Validation gate + ship

#### Steps

4.1 Run the full validation gate (`yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`).

4.2 Self code-review per `.ai/skills/code-review/SKILL.md`. Self BC-review per `BACKWARD_COMPATIBILITY.md`.

4.3 Open the PR against `develop` with `Tracking plan:` line, push, label `review`, label `needs-qa` (touches CRM bulk worker behavior end-to-end + sales UI tests — manual QA exercise is reasonable to confirm no false positives).

4.4 Run `.ai/skills/auto-review-pr/SKILL.md` against the PR in autofix mode. Apply any actionable findings as new commits.

4.5 Wait for CI. If anything red, fix and re-push.

## Risks

- **Globalizing the modules registry alters HMR debug log behavior.** Today the debug log fires when `_modules` is re-set in development. The globalThis variant has to be careful that the same condition still trips. Mitigation: keep the conditional explicit (`existing !== null && process.env.NODE_ENV === 'development'`), confirm with the unit test that the log still fires on the second `registerModules` call in dev.
- **`test.slow()` is a per-call multiplier (3×), not an absolute budget.** Worst case it pushes the test to 60 s instead of 20 s. If the underlying slowness is actually a hang (e.g. document-detail page deadlock), `test.slow()` will mask it for one retry cycle and surface later as a 60 s timeout. Mitigation: review the helpers' wait strategy if the tests still time out in CI after this change — see Phase 3 follow-up.
- **Runtime blocker carry-over from `2026-05-21-stabilize-integration-tests.md`**: if Docker is still not available in this run-host, the empirical full-suite step (Phase 3) cannot run locally. The PR ships with the targeted fixes only and CI is the empirical signal. This is documented in the PR body's "Verification phases completed" section.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Standalone failures — modules registry globalThis fix

- [x] 1.1 Refactor `packages/shared/src/lib/modules/registry.ts` to use `globalThis` state, mirroring DI registrars — 870c93eb0
- [x] 1.2 Add regression unit test at `packages/shared/src/lib/modules/__tests__/registry.test.ts` — 870c93eb0
- [x] 1.3 Run targeted validation (shared unit tests + typecheck) — 870c93eb0 (52/52 passing; OLD-registry sanity run confirmed two of the new tests fail without the fix)

### Phase 2: Ephemeral UI test budget — TC-SALES-005 / TC-SALES-019

- [x] 2.1 Add `test.slow()` + reason comment to TC-SALES-005 — 15325c233
- [x] 2.2 Add `test.slow()` + reason comment to TC-SALES-019 — 15325c233
- [x] 2.3 Survey adjacent sales specs; opportunistically opt in clear multi-hop tests, leave others — 15325c233 (surveyed 7 sibling specs with similar shape, but only 005/019 actually failed CI; staying conservative to avoid masking real regressions in passing tests)

### Phase 3: Empirical full-suite run + opportunistic stabilization

- [x] 3.1 Probe runtime (Docker / postgres availability) — Docker daemon present (29.1.3, runc). No local postgres on :5432, but `yarn test:integration:ephemeral` uses testcontainers so that is fine. Standalone path (`yarn test:create-app:integration`) would need a Verdaccio spin-up.
- [x] 3.2 Defer full empirical run to CI — the full ephemeral matrix takes ~45-60 min wall-clock and the standalone matrix needs Verdaccio + scaffold + publish. Phase 1's regression unit test locks the registry behavior; Phase 2's `test.slow()` opt-in is a small surgical change. CI on the PR is the right place to exercise the full matrix.
- [x] 3.3 Document deferral in PR body Risks section so the reviewer sees it explicitly.

### Phase 4: Validation gate + ship

- [x] 4.1 Full validation gate (build/generate/i18n/typecheck/test/build:app) — `yarn typecheck` ✓, `yarn workspace @open-mercato/shared test` 949/949 ✓, `yarn workspace @open-mercato/core test` 4143/4143 ✓, `yarn build:packages` ✓, `yarn generate` ✓, `yarn build:app` ✓. Root `yarn test` skipped (OOM in sandbox); per-package runs cover the changed packages.
- [x] 4.2 Self code-review + BC self-review — none of the five contract surface categories touched.
- [x] 4.3 Open PR against `develop` with labels — #2046 with `review`, `bug`, `needs-qa`.
- [x] 4.4 Run code-review skill — empty findings (diff scope tiny, no actionable defects).
- [x] 4.5 Wait for CI; fix any red checks — first run on PR 2046: standalone PASSED (TC-CRM-068/069 fix verified), ephemeral shard 14/15 FAILED on TC-WF-008 (unrelated workflow event-trigger flake; addressed in Phase 5 + Phase 6).

### Phase 5: Address TC-WF-008 ephemeral flake (added mid-flight)

- [x] 5.1 Diagnose TC-WF-008 shard-14 failure — root cause: `expect(...).toPass({ timeout: 60_000 })` poll loop runs `page.goto('/backend/instances')` plus two `toBeVisible` waits per iteration, burning ~5-7s each. Only ~10 iterations fit in 60s. On a busy ephemeral env the trigger pipeline (event emit → subscriber dispatch → instance create → instance execute → list re-fetch) can legitimately need longer.
- [x] 5.2 Replace poll-and-reload pattern with API-first poll + single-page UI verification — TC-WF-008.spec.ts now polls `/api/workflows/instances?workflowId=...` directly with a 90s/500-1000-2000ms budget, then loads the page once and asserts the row + localized "Completed" label. — 5ab67d47b
- [x] 5.3 Wait for CI to confirm the fix lands green on ephemeral shard 14/15 — RED again: API poll itself timed out at 90s, meaning the workflow instance was never created. Same failure shape repeated on Standalone job 77650443255 and ephemeral shard 14/15 job 77646988969. The UI-polling-cadence theory in 5.1 was wrong — the bottleneck is upstream of the UI, in the wildcard event-trigger subscriber. Phase 6 addresses this root cause.

### Phase 6: Address TC-WF-008 root cause — trigger cache module-duplication (added mid-flight)

- [x] 6.1 Diagnose TC-WF-008 API-poll-timeout failure — root cause: `event-trigger-service.ts` keeps `triggerCache` as a **module-local** `Map`. The PUT /api/workflows/definitions/[id] route calls `invalidateTriggerCache(...)` after persisting a newly added trigger; the wildcard subscriber (`subscribers/event-trigger.ts`) reads triggers via `loadTriggersForTenant(...)`. If the two code paths resolve `event-trigger-service.ts` through different import roots (Next.js server chunk vs. queue worker; tsx/esbuild duplication), `invalidateTriggerCache` clears one `Map` while the subscriber keeps reading the stale copy for up to `TRIGGER_CACHE_TTL` (5 minutes). On a fresh-creation flow inside one test, the subscriber's stale-copy `cache.get(key)` returns the empty trigger list seeded by a prior tenant warm-up, so the new `customers.person.created` trigger is invisible — no workflow instance gets created. The failure mode is identical to the modules-registry duplication that Phase 1 fixed.
- [x] 6.2 Park `triggerCache` on `globalThis.__openMercatoWorkflowTriggerCache__` via a lazy getter, mirroring the modules-registry fix and `getDiRegistrars()`. Preserves `loadTriggersForTenant` and `invalidateTriggerCache` signatures; behavior change is "survives module duplication" — strictly additive. — fb361269b
- [x] 6.3 Add regression unit test at `packages/core/src/modules/workflows/lib/__tests__/event-trigger-cache.test.ts` (4 cases: globalThis install, two-module-instance state sharing, tenant-wide invalidation, no-replace-when-pre-existing). Locks the regression — verified by stashing the fix and re-running: 4/4 fail without, 4/4 pass with. — fb361269b
- [x] 6.4 Wait for CI to confirm Standalone + ephemeral shard 14/15 turn green — GREEN. Run 26384941771 (CI for Develop&Main) and run 26384936635 (Snapshot Release) on commit fb361269b both completed SUCCESS. Duplicate run 26384941789 on docs-only follow-up 6c9321e32 also SUCCESS. All 27 CI checks pass; 0 failures. Ephemeral shards 1-15 all green; Standalone App Integration Tests green.
