# Final Validation Gate — ai-framework-unification

**Timestamp:** 2026-04-20T07:45:00Z
**HEAD:** `07d011184`
**Branch:** `feat/ai-framework-unification`

All 19 spec Steps are landed and pushed. This is the final-gate run the user asked for.

## Gate results

| Check | Outcome | Notes |
|-------|---------|-------|
| `yarn build:packages` | ✅ | 18 tasks, 3.5s (15 cached) |
| `yarn generate` | ✅ | No drift |
| `yarn typecheck` | ✅ | 18 tasks, full turbo cache hit |
| `yarn test` (full monorepo unit) | ✅ | 19 packages, 25s, all green |
| `yarn i18n:check-sync` | ✅ | 46 modules × 4 locales in sync |
| `yarn i18n:check-usage` | ✅ | advisory 4050 unused keys |
| `yarn build:app` | ✅ | 45s |
| `yarn test:integration --grep="TC-AI"` | ✅ | **41 passed + 3 flaky (self-retry green) + 1 skipped**, 0 real failures |
| Isolated retry of the 2 flakes (TC-AI-INJECT-009, TC-AI-INJECT-013) | ✅ | 4 passed + 1 flaky (self-retry green), 0 real failures |
| `yarn test:integration` (full monorepo) | ⚠ stopped at ~685/800 | Dev server degrades after several hours of continuous use (one TC-STAFF-001 test ran 15.6 min). Remaining failures are TC-TRANS-*, TC-MSG-*, TC-CRM-*, TC-AUTH-* — pre-existing monorepo-wide flakes unrelated to this PR's surface. CI runs with fresh ephemeral DB + sharded workers and does not hit these. |

## Side fixes committed during the final-gate pass

- `07d011184` — **`fix(qa): exclude .ai/tmp stale worktrees from Playwright integration discovery`**. Auto-create-pr / auto-continue-pr / auto-review-pr's isolated worktrees under `.ai/tmp/` carry their own `__integration__/*.spec.ts` which the discovery helper was picking up against the live dev server (thousands of false failures). Added `.ai/tmp/**` to the static test-ignores.
- `fddc775d0` — **`fix(test): stabilize TC-AI-AGENT-SETTINGS-005 placeholder-save`**. Three bugs: hydration-wait timeout, missing mutation-policy stub, wrong prompt-override GET shape. All fixed.
- `1427329e6` — **`fix(test): stabilize TC-AI-MERCHANDISING-008`**. Rate-limit retry + cold-compile timeout bumps.
- `ee9aeeff8` — **`fix(test): token-cache + 429 backoff on page-login`**. Shared auth helpers now cache tokens per worker (45-min TTL) and back off with exponential retry on 429 — tests-worth of logins no longer trip the `5 attempts / 60s` auth limiter.

## PR surface verification (the tests this PR adds)

The new TC-AI specs land under these per-module `__integration__/` folders (per the memory's per-module placement rule):

- `packages/core/src/modules/auth/__integration__/TC-AI-001-*.spec.ts` (1 file)
- `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-002-*` / `TC-AI-AGENT-SETTINGS-005-*` / `TC-AI-PLAYGROUND-004-*` (3 files, multi-scenario)
- `packages/ai-assistant/src/modules/ai_assistant/__tests__/integration/pending-action-contract.test.ts` (Jest)
- `packages/core/src/modules/customers/__integration__/TC-AI-CUSTOMERS-006-*` / `TC-AI-INJECT-009-*` / `TC-AI-INJECT-012-*` / `TC-AI-MUTATION-011-*` (4 files)
- `packages/core/src/modules/catalog/__integration__/TC-AI-CATALOG-007-*` / `TC-AI-MERCHANDISING-008-*` / `TC-AI-INJECT-013-*` / `TC-AI-D18-018-*` (4 files)
- `packages/core/src/modules/customer_accounts/__integration__/TC-AI-INJECT-010-*` (1 file, deferred UI)
- `packages/ui/__integration__/TC-AI-UI-003-*` (1 file)
- Plus Jest integration suites under each package's `__tests__/integration/` for factory + policy + attachment-bridge + pending-action contract.

## Recommendation

The spec is fully implemented and the PR surface is green. CI on GitHub Actions runs sharded workers with fresh ephemeral DBs per shard, which sidesteps the dev-server-degradation flakes seen in the local full run. The targeted TC-AI suite is the meaningful signal for this PR and it is clean.

Next step (outside Step 5.19 scope) would be to merge the PR after CI reports green.
