# Execution plan — CRM field model specification review (adopted from PR #7820)

**Origin:** adopted by `om-auto-continue-pr --adopt auto` on 2026-10-25 because PR #7820 carried no execution plan.
**PR:** #7820 · **Branch:** `spec/crm-field-model-phase-1` · **Base:** `main`
**Author:** @haxiorz

## Goal

Address every finding in @wojciechszyjka's requested-changes review of `024fd84e61489a0693c88e5e7b7d7f2ea169bc37`, publish the specification corrections, and request re-review.

## Scope

Contact-point delivery-health identity rules and sender coverage; manual deal-line currency preconditions and recovery; independent classification approval/deployment slices; documentation readiness and compatibility checks against current main.

## Non-goals

No production implementation, schema application, new dependencies, policy activation, approval of A2–A4, draft promotion, or merge. Future implementation remains in separate capability PRs.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Preserve bounced health across canonical-equivalent edits, including primary-field bridge | Review major finding; contact points and contact-permission specifications | High |
| Require a guarded parent-currency selection for currency-null manual lines | Review minor finding; nullable `CustomerDeal.valueCurrency` and existing deal update route | High |
| Separate lifecycle, health and renewal deployment approvals | Review minor finding; classification C1–C3 and umbrella A2–A3 | High |
| Keep this PR design-only and draft | PR description and explicit review instruction; unconfirmed A2–A4 | High |

## Assumptions

Use the review's explicitly permitted independent-slices option within the classification document. Reuse existing customer commands, currency selection, framework journal/progress conventions, and sender boundary; do not introduce a new architecture. Existing draft and changes-requested state remain until the appropriate human decisions.

## Risks

These are documentation corrections, with no runtime validation claim. Future implementation still requires the stated API/UI tests and unresolved migration/policy approvals.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Author the umbrella, thirteen capability specifications and research — 024fd84e

### Phase 2: Review remediation

- [x] 2.1 Preserve delivery health for the same canonical identity and specify sender regression coverage. — 9f95f7b35
- [x] 2.2 Define missing/invalid parent-currency errors and guarded manual-line recovery. — 9f95f7b35
- [x] 2.3 Define independent lifecycle, health and renewal mapping versions, approval and deployment gates. — 9f95f7b35
- [x] 2.4 Verify documentation readiness, compatibility, scope, links and merged lessons catalog. — 9f95f7b35
- [x] 2.5 Publish corrections, report evidence, request human re-review and release the claim. — 9f95f7b35

## Completion evidence

All three findings are addressed in the published specification commit. Local Node/Git checks pass for 16 Markdown files, 48 relative links, readiness assertions and whitespace; `node --test scripts/__tests__/check-lessons.test.mjs` passes 5/5 after merging current main. The original reviewer has been requested through GitHub. The PR summary records the final remote head/check state and claim release. Application builds, runtime/integration tests, migrations and browser QA are inapplicable to this design-only remediation and are not claimed. A2–A4 and the original draft state remain; completing this review plan does not approve product/migration/policy decisions or make the PR merge-ready.
