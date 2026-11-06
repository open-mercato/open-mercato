# Checkpoint 6 — Steps 4.1..4.5

- **When:** 2026-10-27
- **Steps:** 4.1 `7cc0e18f2`, 4.2 `aee587723`, 4.3 `252363a3c`, 4.4 `03ba2daa7`, 4.5 `f4e3e82d0`
- **Touched areas:** agent_orchestrator eval — `lib/eval/{manifest,canonicalInputKey,evalReplayService,llmJudge,evalGate}.ts`, `lib/eval/report/*`, `commands/evalRuns.ts`, `api/eval-runs/{route,[id]/route}.ts`, `data/validators.ts`, `cli.ts`, `RunEvaluationDrawer.tsx`, i18n ×5
- **Runner:** local mode

| Check | Result |
|---|---|
| `packages/enterprise` jest `agent_orchestrator` (incl. `i18n-coverage`) | ✅ 179 suites, 1638 tests (run in Step 4.5) |
| Enterprise `tsc --noEmit` | ✅ |
| `packages/core/src/__tests__` guard suites (incl. command-interceptor HTTP coverage) | ✅ 25 suites, 244 tests |
| `yarn build:app --force` | ✅ (run in Step 4.5) |
| `yarn i18n:check-sync` / `yarn i18n:check-usage` | ✅ |
| `yarn lint` | ✅ |
| UI verification (eval start drawer snapshot picker) | ⏭️ skipped — the Agent Orchestrator cannot be registered in the local ephemeral app; covered by `run-evaluation-snapshot.test.tsx` and by `TC-AGENT-EVAL-SET-002` (Step 4.6) in an AO-enabled environment |

## Decisions in this window
- 4.1: no `rubricRef` exists yet, so judge assertions freeze the normalized rubric; DB cases use their id as `key`.
- 4.2/4.3: the carrier is any run that still holds the body for that version (queued, failed or cancelled carriers keep serving it) — review fix folded into 4.3.
- 4.4: `evalCaseIds` with a snapshot narrows the manifest's cases; snapshot + label pin is rejected; `--require-snapshot` without a pin exits 2.
- 4.5: `GET /eval-runs` list items gain `eval_set_version` and `manifest_hash` (pointer only, never the body); the list now reads through `findAndCountWithDecryption`.
