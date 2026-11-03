# Final Gate — workflows-ux-phase1

**Recorded:** 2026-07-27 (UTC) · **Runner:** local (ephemeral Docker for integration)
**Final HEAD:** 1affb12c0 · 30 commits from origin/feat/workflows-ux-phase0 (stacked)

## Full validation gate (`validation.commands`, in order)

| Command | Result | Notes |
|---|---|---|
| build:packages ×2, generate, i18n:check-sync, i18n:check-usage, typecheck | ✅ | first pass |
| `yarn test` | ✅ | Two fix-forwards along the way: explicit comparator in draft-restore (8.3-review-fix, same #3620 guard as Phase 0); one cli jest-worker SIGSEGV on rerun — passes 7/7 in isolation, known infra flake (documented in both Phase 0 and Phase 1 gates) |
| `yarn build:app` | ✅ (forced, no cache) | Initially failed: whole-project NFT tracing + lazy executor import chunked into client bundles. Fixed in 7.1-review-fix (static template imports + runtime binding seam `bindActivityExecutor`). Base-commit A/B test in the same worktree proved the regression was ours before fixing. |

Log: `final-gate-artifacts/validation-gate.log`

## Integration (`yarn test:integration:ephemeral`, full, solo — no parallel load)

- 1699 passed · 3 flaky-passed (sales, known) · 70 skipped · 3 failed:
  - `TC-WF-011:347` (ours): spec asserted the retired hardcoded toast literal `"…successfully!"`; the i18n migration uses the canonical locale copy. Assertion aligned (8.3-review-fix-2); scoped ephemeral rerun: **5/5 TC-WF-011 green**.
  - `TC-ONB-001/002`: same unrelated-env failures as the Phase 0 gate (onboarding-start 404 / disabled signup input); no onboarding surface in this diff.

## DS pass (om-ds-guardian discipline)

- Verdict CLEAN, 0 MUST-fix. Two advisories landed anyway (7.2-ds-fix): focus-visible ring + rounded-lg on template cards, valid role=group/aria-labelledby association for command/function pickers. Remaining advisories documented for follow-up: template category badge i18n, DS-guard test extension to the two new component files (blocked on the raw-button card pattern decision), pre-existing gray-*/red-* debt in ActivityArrayEditor/ActivitiesEditor untouched lines.

## Code review + BC self-review (om-code-review discipline)

- Initial verdict REQUEST_CHANGES (3 majors) → all fixed in 3.1-review-fix: production queue worker (`workers/workflow-activities.worker.ts` — a second dispatch switch the migration had missed) now routes through the shared `executeRegistryActivity` registry path; SET_VARIABLE flipped to async-incapable (`asyncResumeMergeDoesNotApplyAssignments`) with enqueue-time refusal; `__proto__`/`constructor`/`prototype` segments rejected in assignment paths with Object.prototype-unpolluted regression tests. Minors fixed (executeSetVariable unknown-typed; enum registration-ordering doc note). Nit (draft route structural em type) left.
- BC checklist: all exports intact (verified by diff), activity-executor suite unedited except additive describe blocks, SET_VARIABLE enum additive, new table/routes additive, CommandHandler.outputSchema optional, config warnings never block saves. Registry extension contract now holds on both queue consumers.

## Residual / follow-ups

- Worker context still drops branchInstanceId/transitionId when rebuilding ActivityContext (pre-existing, PLAN Non-goal, needs its own issue).
- Safe-command allowlist widening (deals/orders/products per resolved Q2) — deliberate follow-up, security-relevant.
- DS advisories listed above.
