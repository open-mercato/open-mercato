# Final gate — agent-platform-wave-1

- **Recorded:** 2026-10-23T10:59:09Z
- **Runner:** local mode (no compose `app` container); integration in isolated ephemeral containers
- **Head at gate:** a31c626c3

## Full validation gate (`validation.commands`)

| Command | Result | Notes |
|---|---|---|
| `yarn build:packages` | ✅ | |
| `yarn generate` | ✅ | no tracked drift |
| `yarn build:packages` | ✅ | |
| `yarn i18n:check-sync` | ✅ | |
| `yarn i18n:check-usage` | ✅ | unused keys advisory only |
| `yarn typecheck` | ✅ | turbo; supplemented by direct app typecheck, core `tsc`, enterprise `tsc` — all 0 errors |
| `yarn test` | ✅ after fix | first full run surfaced 3 guard failures caused by this branch (interceptor catch mapping on `attachments/api/structure/[id]`, three `.sort()` calls without comparators, notification registry docs) → fixed in Step 8.8-gate-fix (a31c626c3). Rerun: 47/48 tasks green; the remaining task (`@open-mercato/cli`) failed only with a Jest worker `SIGSEGV` and passes in full on its own (109 suites, 2082 tests). An earlier `channel-fcm` `SIGSEGV` likewise passed on rerun. |
| `yarn build:app` | ✅ | |

## Full integration suite (`yarn test:integration:ephemeral`, isolated containers, default mode `OM_MCP_MUTATION_MODE` unset)

- **2700 passed, 10 failed, 4 flaky, 84 skipped** (50.1 min). Summary: `final-gate-artifacts/integration-report-summary.log`.
- All 10 failures are **pre-existing on upstream main (9dfdaf8bd)**: verified by running the same specs on a clean baseline worktree in an isolated ephemeral app with identical settings:
  - TC-EXAMPLE-018 (2), TC-START-001 (2), TC-DOCUMENTS-009, TC-DOCUMENTS-013, TC-ONBOARDING-EMAIL-001 — fail on main.
  - TC-ONB-001, TC-ONB-002, TC-ONB-003 — fail on main with the same errors when run with `SELF_SERVICE_ONBOARDING_ENABLED=true` (their discovery gate).
- This branch's own specs passed in their targeted runs: `TC-AI-MCP-*` (approval mode 6 passed; deny mode 1 passed), `TC-ATT-STRUCT-001..005` (5 passed). `TC-AGENT-EVAL-REPORT-001/002` not run locally: `agent_orchestrator` cannot be registered in the ephemeral app (see checkpoint 7).
- The 4 flaky specs (TC-FORMS-UI-002, TC-SALES-ADDR-CONTACT-002, TC-SX-009 ×2) passed on retry and are outside this branch's areas.

## Design-system / style pass

- `eslint --config eslint.ds.config.mjs` (the CI `ds-lint` command) on the 9 changed `.tsx` files: 0 errors, 0 warnings.
- Manual review (`om-ds-guardian` checklist): no violations.
- **Style compliance residual findings:** `PendingActionAwaitingApprovalRenderer.tsx` lines 90 and 104 restate `size="sm"` heights in `className` (`packages/ui/AGENTS.md` primitive rule 5). Kept intentionally: identical classes are used by the existing `ConversationSharedRenderer`, `SalesOrderCreatedRenderer` and `WmsReservationShortfallRenderer`, so all notification renderers stay visually consistent. Pre-existing raw form controls in untouched lines of `AttachmentPartitionSettings.tsx` left for a follow-up.
