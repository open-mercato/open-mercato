# Checkpoint 1 — Phase 1 (Integrity P3–P5), Steps 1.1..1.11

- **When:** 2026-10-28T04:01:22Z
- **Steps:** 1.1–1.11 + 1.9-review-fix + 1.11-review-fix (`40a4c30cf`..`d51ea26f5`)
- **Cadence:** the user asked for checkpoints every 10+ Steps (2026-10-28).

| Check | Result |
|---|---|
| `yarn typecheck` | pass |
| `npx jest src/modules/agent_orchestrator` | pass — 231 suites, 2515 tests |
| core guards (`optimistic-lock-command-coverage`, `feature-policy-authorization-coverage`, `acl-feature-catalog.i18n`) | pass |
| Integration on the ephemeral app (AO on): `TC-AGENT-INT-*`, `TC-AGENT-ACC-*`, `TC-AGENT-TRACE-005` | 16 passed, 3 skipped (need an LLM provider) |

Artifacts: `checkpoint-1-artifacts/screenshot-trace-integrity-review-hold.png` — trace page with the review-hold run (needs-review outcome, holds-approval badge, input prompt-injection warning). It exposed a narrow-card layout bug (kind label squeezed to one character, badge overflow) → fixed in **1.11-review-fix**; visual re-check on a fresh build at checkpoint 2.

Review notes (main session):
- 1.9 made `ScorerRunView.guardrailChecks` required on a type reachable through the package's `./*` export → made optional in **1.9-review-fix**.
- 1.2 also fixed 1.1's rejection of `null` `set` values for nullable leaves.

Gaps: no registered example agent declares `abstain_or_review` or `untrustedInputs`, so their end-to-end cases cannot run even with a provider (documented in TC-AGENT-INT-005 and the spec changelog).
