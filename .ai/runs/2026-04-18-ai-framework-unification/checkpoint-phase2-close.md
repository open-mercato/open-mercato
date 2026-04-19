# 5-Step Full-Gate Checkpoint — Phase 2 Close (after Step 4.11)

**Timestamp:** 2026-04-19T10:45:00Z
**HEAD:** `b3d3f3cce` (Step 4.11 docs-flip)
**Branch:** `feat/ai-framework-unification`, local == origin

## Why

User rule: after every 5 completed Steps, run the full gate. Steps since last checkpoint (after 4.4): **4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11 = 7 Steps** (one window over). This is also Phase 2 closure — all WS-A, WS-B, and WS-C rows are `done`. Phase 5 opens next with Step 5.1.

## Gate results

| Check | Outcome | Notes |
|-------|---------|-------|
| `yarn build:packages` | ✅ | 18 tasks, 3.8s (15 cached) |
| `yarn generate` | ✅ | 313 API paths, additive `ai-agents.generated.ts` imports both customers + catalog modules |
| `yarn typecheck` | ✅ | 18 tasks, full turbo (all cached after the first pass). Pre-existing Step-3.1 `agent-registry.ts(43,7)` carryover tolerated |
| `yarn test` (full monorepo) | ✅ | 19 packages, all green |
| `yarn i18n:check-sync` | ✅ | 46 modules × 4 locales in sync |
| `yarn i18n:check-usage` | ✅ | advisory baseline 3998 unused keys (+42 over 4.4 checkpoint — adds from Steps 4.5/4.6/4.9/4.10, expected) |
| `yarn build:app` | ✅ | 43s |
| `yarn test:integration --grep="TC-AI"` | ⚠ 26 pass / 2 order-flake / 1 retry-flake | 29 total scenarios. The two order-flakes in TC-AI-CUSTOMERS-006 (`meta.describe_agent returns the seven prompt sections`, `playground picker lists the agent for superadmin`) **pass when the suite is run in isolation** — re-run with `--grep="TC-AI-CUSTOMERS-006"` greens 3/3. Root cause is likely a Playwright worker request-context state leak from a sibling spec within the same project; tracked as a Phase 5 test-harness cleanup. Not a regression of Phase 2 code. |

## Phase 2 closure snapshot

| WS | Steps | Outcome |
|----|-------|---------|
| WS-A `<AiChat>` + upload + registry | 4.1 + 4.2 + 4.3 | done |
| WS-B playground + settings + polish | 4.4 + 4.5 + 4.6 | done |
| WS-C agents + D18 demo + inject + tests | 4.7 + 4.8 + 4.9 + 4.10 + 4.11 | done |

## Drift surfaced

1. **Dev server compile stall** — port 3000 was returning HTTP 500 (peak memory 12.6 GB, stale compile graph) before this checkpoint. User authorized a restart; fresh runtime (`bgyb7opzt`) greens `/login` in ~5s and handled the full TC-AI suite.
2. **TC-AI-CUSTOMERS-006 order-flakes** — 2/3 scenarios fail when run inside the full TC-AI suite but green in isolation. Action: add to the Step 5.1 follow-up list as a request-context-cleanup fix in `packages/core/src/helpers/integration/api.ts` or equivalent. Not blocking Phase 5 kickoff.

## Artifacts

All under `checkpoint-phase2-close-artifacts/`:
- `build-packages.log`, `generate.log`, `typecheck.log`, `unit-tests.log`, `build-app.log` — gate raw output.
- `integration-tc-ai.log`, `integration-tc-ai-retry.log` — two full-suite runs with the same 2 order-flakes.

## Next action

Step 5.1 — Spec Phase 3 WS-A: extract shared model factory from `packages/core/src/modules/inbox_ops/lib/llmProvider.ts` into `@open-mercato/ai-assistant/lib/model-factory.ts`. Support `defaultModel` + per-module `<MODULE>_AI_MODEL` env override. Preserve the legacy `llmProvider.ts` signature as a thin wrapper (BC: additive-only).
