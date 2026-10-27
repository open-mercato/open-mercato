# Final gate — agent-platform-wave-3

- **When:** 2026-10-27
- **Head:** `3695a39e2` (all Tasks rows `done`)
- **Runner:** local mode; integration in ephemeral environments

## 1. `validation.commands` (`.ai/agentic.config.json`, in order)

| Command | Result | Notes |
|---|---|---|
| `yarn build:packages` | pass | |
| `yarn generate` | pass | |
| `yarn build:packages` | pass | |
| `yarn i18n:check-sync` | pass | |
| `yarn i18n:check-usage` | pass | advisory unused-key count only |
| `yarn typecheck` | pass | re-run after 7.3: pass |
| `yarn test --continue` | fail → fixed | 46/49 tasks passed. `@open-mercato/core`: 1 failure, `feature-policy-authorization-coverage.test.ts` (wave-3 code used low-level ACL matchers) → fixed in **Step 7.3** (`authorizeFeatures`); test re-run passes. `@open-mercato/channel-fcm`: Jest worker SIGSEGV (known flake) → 27/27 pass when re-run alone. `open-mercato-docs`: V8 OOM under the gate's 1 GB `--max-old-space-size` → passes with 4 GB. agent_orchestrator re-run after 7.3: 1996 tests pass. |
| `yarn build:app --force` | pass | |
| also: `yarn lint`, `yarn agents:check-budget` | pass | |

## 2. Full integration suite (`yarn test:integration:ephemeral`, enterprise + AO enabled, rebuilt)

2911 passed, 48 failed, 4 flaky, 112 skipped, 4 did not run (53 min). Every failure is outside this branch's changes:

| Failing specs | Count | Classification |
|---|---|---|
| TC-DOCUMENTS-009/013, TC-EXAMPLE-018 ×2, TC-ONB-001/002/003, TC-ONBOARDING-EMAIL-001, TC-START-001 ×2 | 11 | Pre-existing failures on `main` (listed in the wave-2/3 handoff) |
| TC-SSO-001..006 (21), TC-SEC-001..014 + TC-SEC-EMAIL-001 (15) | 36 | Environment: specs are discovered under `OM_ENABLE_ENTERPRISE_MODULES=true`, but the `sso` / `security` modules also need `OM_ENABLE_ENTERPRISE_MODULES_SSO` / `_SECURITY`; routes returned 404. Re-run with those flags: **44 passed**, 3 skipped. The branch touches no `sso` / `security` file. |
| TC-SX-009 | 1 (+1 flaky) | Pre-existing flaky `sync_excel` spec (flaky in the wave-2 final gate too); the branch touches no `sync_excel` / `customers` / `data_sync` file. Still fails when re-run alone. |

Wave-3 specs in the full run: all `TC-AGENT-ACC-*`, `TC-AGENT-INT-*`, `TC-AI-MCP-AGENT-TOOL-012`, `TC-AI-RUN-TRACE-016`, `TC-ATT-STRUCT-001..005, 007` passed; model-dependent cases skipped (no LLM provider).

## 3. Design-system pass

`eslint --config eslint.ds.config.mjs` on the six changed `.tsx` files: clean.

Artifacts: `final-gate-artifacts/integration-full-summary.log`, `final-gate-artifacts/integration-enterprise-rerun.log`; UI screenshots in `checkpoint-8-artifacts/`.
