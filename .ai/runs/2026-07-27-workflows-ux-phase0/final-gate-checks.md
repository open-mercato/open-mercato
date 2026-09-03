# Final Gate — workflows-ux-phase0

**Recorded:** 2026-07-27 (UTC) · **Runner:** local (no compose `app` container; ephemeral Docker for integration)
**Final HEAD:** 612588387 · 23 commits from origin/develop

## Full validation gate (`validation.commands`, in order)

| Command | Result | Notes |
|---|---|---|
| `yarn build:packages` | ✅ | 21/21 |
| `yarn generate` | ✅ | |
| `yarn build:packages` (2nd per config) | ✅ | |
| `yarn i18n:check-sync` | ✅ | 4-locale parity |
| `yarn i18n:check-usage` | ✅ | |
| `yarn typecheck` | ✅ | 21/21 |
| `yarn test` | ✅ (rerun) | First run: 1 failure — pre-existing develop-side explicit-sort-comparators guard violation in `scripts/check-agents-md-budget.mjs` (branch touched 0 script files); fixed forward as Step 7.2; rerun 23/23 tasks green. One jest-worker SIGSEGV flake in cli entity-ids test observed by the review pass — passes in isolation. |
| `yarn build:app` | ✅ | |

Raw log: `final-gate-artifacts/validation-gate.log`

## Integration suite (`yarn test:integration:ephemeral`, Docker)

- **Run 1 (full suite, 16.6m):** 1700 passed · 70 skipped · 1 flaky-passed · 4 failed:
  - 2× `TC-WF-007` — stale selectors written against the legacy dialog; the flag flip (6.4) made CrudForm dialogs default. Artifacts showed **no parity regression** (all capabilities render); spec updated in Step 6.4-review-fix.
  - 2× `TC-ONB-001/002` — classified **unrelated-env** (onboarding-start API 404 + disabled signup input; branch diff touches no onboarding/auth surface).
- **Run 2 (full suite, 2.6h):** 21 failures across unrelated modules — **invalidated as resource contention**: dispatcher mistakenly ran the code-review agent's full validation gate (incl. `build:app`) in parallel; specs green in run 1 on identical code failed with timeout-class errors; duration 9× baseline.
- **Run 3 (scoped `--filter TC-WF`, quiet machine, 1.4m):** **69/69 workflows integration tests passed** on the final code state — including both fixed TC-WF-007 tests and every workflows spec that failed in run 2.

Verdict: PASS (run 1 + run 3 are the representative results; run 2 documented as invalid).

## Design-system / style compliance pass (om-ds-guardian discipline)

- 2 MUST-fix findings (raw `<button>` in the new problems panel) — fixed in Step 3.1-ds-fix (277c05bfb).
- Advisory (non-blocking, listed for the reviewer):
  - `STEP_STATUS_STYLES` uses 3px borderWidth (off the 2/4px DS scale) — deliberate to mirror the previous visual weight on React Flow nodes.
  - `WorkflowNodeCard` error badge pairs `bg-status-error-icon` with `text-primary-foreground` — dark-mode contrast not token-guaranteed.
  - Pre-existing `orange-*` Tailwind shades elsewhere in `backend/instances/[id]/page.tsx` (untouched lines) — follow-up candidate; the new hex-guard test covers hex/rgb only.

## Code review + BC self-review (om-code-review discipline)

- Verdict: **APPROVE**, no blockers. Minors fixed in Step 5.1-review-fix (612588387): role-lookup transient-failure retry, StepsEditor dead-type rename. Remaining non-blocking: problems panel is desktop/compact only (mobile keeps flash summary — documented limitation), duplicate `WorkflowGraphFocusTarget` declaration (cosmetic), signal-timeout aria-label reuses the generic timeout key.
- BC checklist: SEND_EMAIL `sent:false` + additive `reason` field on the no-service path (deliberate honesty fix, called out for UPGRADE notes); flag default flip with documented `false` rollback; everything else additive (ACL grants of existing features, widened form-value type, new exports). No API/event/DB/DI/generated-file contract changes.
- `yarn template:sync` drift: 25 files, all pre-existing on develop; this branch's template i18n mirror is correct.

## Style compliance residual findings

- See DS advisory list above; none blocking.
