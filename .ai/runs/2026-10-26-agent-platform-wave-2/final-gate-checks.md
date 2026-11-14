# Final gate — agent-platform-wave-2

- **Recorded:** 2026-10-27
- **Runner:** local mode (no compose `app` container); integration in isolated ephemeral containers
- **Head at gate:** 86fd2743a (+ this record)

## Full validation gate (`validation.commands`)

| Command | Result | Notes |
|---|---|---|
| `yarn build:packages` | ✅ | |
| `yarn generate` | ✅ | no tracked drift |
| `yarn build:packages` | ✅ | |
| `yarn i18n:check-sync` | ✅ | |
| `yarn i18n:check-usage` | ✅ | unused keys advisory only |
| `yarn typecheck` | ✅ | supplemented at checkpoints by enterprise `tsc` and `yarn build:app --force` |
| `yarn test` | ✅ (one Jest worker crash) | `yarn test --continue`: 48/49 tasks green. The remaining task (`@open-mercato/cli`) failed only with a Jest worker `SIGSEGV`, and passes in full alone (110 suites, 2102 tests), the same as on wave 1. The first `yarn test` stopped on a `SIGSEGV` in `@open-mercato/documents`, which also passes alone. A heavier rerun without the root script's `--concurrency=2` produced more `SIGSEGV`s and timeouts. Each failing suite was re-run in isolation and passed: cli, core auth settings page + workflows debounce, AO overview-honesty, ui calendar, create-app 928/928. |
| `yarn build:app` | ✅ | |

## Full integration suite (`yarn test:integration:ephemeral`)

- **2774 passed, 11 failed, 7 flaky, 103 skipped** (46.7 min). Summary: `final-gate-artifacts/integration-report-summary.log`.
- 10 failures are the known failures on upstream `main` recorded in the wave-1 baseline: TC-EXAMPLE-018 (2), TC-START-001 (2), TC-DOCUMENTS-009, TC-DOCUMENTS-013, TC-ONB-001/002/003, TC-ONBOARDING-EMAIL-001.
- **TC-CRM-065** (customers people bulk delete) failed in the full run and **passes when re-run alone** against the same branch. It is flaky under load and outside this branch's areas.
- The 7 flaky specs (TC-CRM-028, TC-FORMS-UI-002, TC-LOCK-OSS-030, TC-SALES-ADDR-CONTACT-002, TC-SX-009 ×2, TC-WF-037) passed on retry and are outside this branch's areas.
- This branch's own specs: `TC-AI-RUN-TRACE-016` passed. `TC-AI-CONVERSATIONS-001` passed in full, including the cross-org case that failed in checkpoint 3: that failure came from a standalone run whose direct-DB fixture was not pointed at the ephemeral database. `TC-AGENT-TRACE-004` and `TC-AGENT-EVAL-SET-002` did not run locally because `agent_orchestrator` cannot be registered in the ephemeral app; they need an AO-enabled CI/QA environment, and `TC-AGENT-TRACE-004` also needs a real LLM provider.

## Design-system / style pass

- `eslint --config eslint.ds.config.mjs` (via the repo's TypeScript require hook, as in CI) on the 3 changed non-test `.tsx` files (`RunManifestCard.tsx`, `traces/[id]/page.tsx`, `RunEvaluationDrawer.tsx`): 0 errors, 0 warnings.
- No style compliance residual findings.
