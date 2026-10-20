# Final Gate — workflows-ux-phase2a

**Recorded:** 2026-07-28 (UTC) · **Runner:** local (ephemeral Docker for integration)
**Final HEAD:** 4578e2606 · 24 commits from origin/feat/workflows-ux-phase1 (stacked, 3-deep)

## Full validation gate
All 8 `validation.commands` green. One fix-forward: the #3620 sort-comparator guard caught `context-ledger.ts:497` (third occurrence across the program — comparator discipline now in module docs); fixed as 2.1-review-fix, `yarn test` + forced `build:app` green after.
Log: `final-gate-artifacts/validation-gate.log`

## Integration (`yarn test:integration:ephemeral`, full, solo)
1700 passed · 2 flaky-passed (sales/CRM, known) · 71 skipped · 2 failed: TC-ONB-001/002 — identical unrelated-env signature as the Phase 0 and Phase 1 gates (onboarding-start 404 / disabled signup; no onboarding surface in this diff). **Zero workflows failures.** Verdict: PASS.

## DS pass
CLEAN (0 MUST-fix, 4 advisories). Applied: focus ring on the Context collapse header. Documented for follow-up: Alert-variant refactor of the test-panel notice, template category badge i18n, pre-existing gray/red debt on untouched lines.

## Code review + BC self-review
Initial verdict REQUEST_CHANGES — 1 major: the LEGACY edit page's `buildWorkflowPayload` rebuilt definition/metadata from scratch, stripping `contextSchema` + `metadata.editor.samples` (the exact hazard fixed in the visual editor). Fixed in 1.2-review-fix: loaded definition/metadata now spread through with explicit clear semantics + round-trip regression tests. Minors fixed: ledger change-detection serializes source ids; focus ring. Deferred (documented): samples cap message i18n (2b), typed-contract API path has no product consumer yet (intentional — client uses 'unknown' contracts, API serves typed for future/external consumers).
Security review clear: env interpolation exposes only the operator allowlist (no new exposure class vs runtime activities), mocks pure, tenant scoping tested cross-tenant, 64KB cap on all three input paths, no-redaction documented in three places.
BC: PASS — all additive; `mock`/`outputContract` signature changes touch only the unmerged Phase-1 surfaces in the same stack.

## Residual / follow-ups
- Sub-workflow `outputMapping` never merged into instance context (engine defect candidate — needs its own issue; ledger refuses to advertise it).
- Parallel branch-namespace scoping approximation in the ledger (documented in module AGENTS.md).
- DS advisories above; samples-cap message i18n in 2b.
