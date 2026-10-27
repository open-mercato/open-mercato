# Execution plan — gate the integrations credentials form on `integrations.credentials.manage` (adopted from PR #5843)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-09-03 because PR #5843 carried no execution plan.
**PR:** #5843 · **Branch:** `fix/issue-5816-credentials-form-acl-gate` · **Base:** `develop`
**Author:** @adeptofvoltron — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

The integration detail page must stop offering an editable credentials form and an active "Save" button to a viewer who lacks `integrations.credentials.manage`, showing an explicit read-only permission state instead — closing issue #5816.

## Scope

- `packages/core/src/modules/integrations/backend/integrations/[id]/page.tsx` — the credentials tab body and the FormHeader save affordance.
- `packages/core/src/modules/integrations/backend/integrations/useIntegrationCredentialsFeatureAccess.ts` — the client feature-check hook.
- `packages/core/src/modules/integrations/i18n/*.json` — the permission-notice string in all five locales.
- The module's `__tests__` for the credentials tab.

## Non-goals

- Changing the authorization boundary itself. The backend already fails closed with `403` on `GET`/`PUT /api/integrations/{id}/credentials`; this PR only aligns the client affordance with it.
- Gating any other integrations affordance (health check, provider config, webhooks). Issue #5816 names the credentials form only; anything else belongs in a follow-up.
- Manual UI QA. The PR carries `needs-qa`; a QA reviewer (or `om-auto-qa-pr`) owns that gate, and this run never sets `qa`/`qa-approved`.
- Work on #4471, the PR that surfaced this bug. It ships no form component and is not touched here.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The goal is a client-side permission gate on the credentials form, not an authorization fix | Issue #5816 body ("this is an affordance problem rather than a security one"), with the wire-level 403 table proving the data layer is already fail-closed | high |
| The expected end state is a read-only permission notice, consistent with the `sync_excel` rendering | Issue #5816 "Expected" section | high |
| The implementation is complete as of `aec3dd42b` | `git diff origin/develop...HEAD` — hook added, `page.tsx` gated, 5 locales updated, 2 new tests plus 1 updated test | high |
| The full validation gate already passed on this branch | The `om-fix` run-summary comment (#5510161638) and the PR body's Tests section, both listing the ordered gate with results | high |
| CI is green on the head commit | **get-pr-checks** on `aec3dd42b`: `test`, `lint`, `ds-lint`, `docker-build`, `ephemeral-integration`, `documents-multi-instance`, `CodeQL` (×3), `audit-scope`, `scope`, `license/cla` all SUCCESS; no failures | high |
| The authoritative code-review pass never ran | Comment #5510173469 — `om-auto-review-pr` took over the chain lock at 2026-09-02T13:18:48Z and posted nothing afterwards; `gh pr view` reports zero reviews and `reviewDecision: REVIEW_REQUIRED` | high |
| No human or bot has asked for changes | Zero reviews, zero inline review comments on the PR | high |
| Labels and priority/risk were already normalized by `om-open-pr` | Comment #5510158389 (`🏷️ label rationale`) and the current label set (`bug`, `review`, `needs-qa`, `priority-medium`, `risk-medium`) | high |

## Assumptions

- **The implementation needs no further code.** Every acceptance criterion in #5816 traces to a landed change and a landed test, and CI is green. If the review pass disagrees, its findings become new Progress steps rather than a new plan.
- **The 2 pre-existing `warranty_claims/__tests__/quantity.test.ts` failures reported by the earlier run are environmental, not regressions.** They are locale-dependent (`pl_PL.UTF-8` comma decimal separator) and the file has no diff against `develop`; CI's `test` job is green on this head. This run re-runs the gate and will re-confirm rather than assume.
- **The PR stays a draft until the plan completes.** `om-open-pr` opened it as a pipeline draft, so the "draft while in-progress" rule applies and `mark-pr-ready` is the completion signal.

## Risks

- Low. The change is client-side rendering in one module, additively gated on an existing ACL feature, with tests covering both the permitted and denied branches.
- The remaining work is verification, not implementation, so the main risk is a review finding that reopens the code — handled by looping the review pass until clean.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Add `useIntegrationCredentialsFeatureAccess`, gate `showCredentialActions` and the credentials tab body in `page.tsx`, add the `integrations.detail.credentials.noPermission` key to all 5 locales, and cover both branches with `credentials-permission-gate.test.tsx` (plus the `credentials-conflict.test.tsx` mock update) — aec3dd42b

### Phase 2: Verification

- [x] 2.1 Re-run the full `validation.commands` gate on this worktree and record the runner and results — dda52ed64 (no code change; local runner, all commands green except `create-mercato-app`'s AI-harness oracle suites, which need the `codex`/`claude` CLIs)
- [x] 2.2 Run `om-auto-review-pr 5843 --autofix` and drive it to a clean verdict, landing any fixes as new commits — c9ca75eb4

### Phase 3: Finalize

- [x] 3.1 Post the comprehensive resume summary comment on PR #5843 — 98b858f8a (comment #5522660102)
- [x] 3.2 Update the PR body to `Status: complete`, promote the draft with `mark-pr-ready`, reconfirm the label set, and release the `in-progress` lock — 98b858f8a

### Follow-ups this run deliberately did not do

- The "Check health" action on the same page is ungated in the same way (`POST /api/integrations/{id}/health` returns `403` for a viewer without `integrations.manage`, per #5816's evidence table). Out of scope for #5816's stated expectation; wants its own issue.
- The feature-check hook now exists in three near-identical copies (`useWebhookFeatureAccess`, `useWmsInventoryMutationAccess`, `useIntegrationCredentialsFeatureAccess`). Extracting a shared `useFeatureAccess(features)` helper pairs naturally with the health-action fix above.
- Two untested branches in the credentials gate: the in-flight spinner, and the fail-closed path where `/api/auth/feature-check` rejects outright.
