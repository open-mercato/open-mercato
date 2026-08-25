# Execution plan — preserve partial user ACL updates without silent permission loss (adopted from PR #5537)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-24 because PR #5537 carried no execution plan.
**PR:** #5537 · **Branch:** `fix/issue-5493-preserve-partial-acl` · **Base:** `develop`
**Author:** @haxiorz — this plan interprets the PR and review intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Make partial user ACL updates preserve omitted dimensions without either widening the user's role-derived permissions or silently replacing them with a zero-feature override.

## Scope

- The `PUT /api/auth/users/acl` merge, validation, and OpenAPI description.
- Regression coverage for organization-only creation, `isSuperAdmin` omission/revocation, and both `null` and empty-array all-dimension clearing.
- Shared ACL warning/rejection copy that explains both valid ways out of an unsafe zero-feature organization override.
- Focused and configured validation followed by a fresh review of PR #5537.

## Non-goals

- Do not seed user ACL rows from dynamically aggregated role grants; rejecting an invalid zero-feature organization override is narrower and explicitly accepted by issue #5493.
- Do not change the role ACL endpoint, whose partial-update merge already preserves stored dimensions.
- Do not attempt to reconstruct ACL rows deleted on affected deployments; that needs a separate operator remediation decision.
- Do not change the ACL editor component; its existing empty-array output remains the supported clear-override path.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Omitted ACL dimensions must preserve stored values | Issue #5493 behavior matrix and the existing PR regression tests | high |
| A zero-feature `UserAcl` row is an absolute override that removes role features | Review by @pkarw and `RbacService.loadAcl` short-circuit behavior | high |
| Rejecting the invalid merged state is acceptable | Issue #5493 expected outcome and the requested-changes review | high |
| `isSuperAdmin` preservation and explicit revocation need coverage | Review by @pkarw and parity with the role ACL route | high |
| Partial-update semantics must be documented | Review by @pkarw and the route's OpenAPI description | high |
| `organizations: []` is the admin UI's clear-scope shape, while only a non-empty array is a restriction | Re-review by @pkarw and `AclEditor.tsx` checkbox behavior | high |

## Assumptions

- A `400` response is the most reversible behavior for a non-empty organization-scoped, zero-feature, non-super-admin result because it writes nothing and asks the operator to select an explicit feature override or clear the scope.
- A non-empty organization array is a restriction; an empty array participates in clearing the override and must not trigger the zero-feature rejection.
- The existing user ACL integration case can cover the partial-update path without new fixtures by applying an organization-only PUT after the initial feature grant.

## Risks

- API clients that previously received a misleading `200` for an organization-only ACL with no stored features will now receive `400`; this is the intentional fail-closed correction allowed by the issue.
- This route controls authorization state, so regression coverage must pin every merged dimension and the explicit clear path.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Merge omitted user ACL dimensions and cover the original partial-update regressions — 27f874c9c

### Phase 2: Address requested changes

- [x] 2.1 Reject organization-scoped zero-feature overrides and document partial-update semantics — 9849d268d
- [x] 2.2 Cover `isSuperAdmin` preservation, explicit revocation, and all-dimension clearing — 9849d268d

### Phase 3: Verify and publish the revision

- [x] 3.1 Run focused and configured validation and complete the follow-up review — 6906d1e4a
- [x] 3.2 Push the reviewed fixes and update PR #5537 for re-review — 6906d1e4a

### Phase 4: Address the empty-array clear regression

- [x] 4.1 Treat `organizations: []` as no restriction and cover both empty-array outcomes — a5a14af33
- [x] 4.2 Widen the shared organization warning so it names clearing scope as well as adding a feature — a5a14af33
- [x] 4.3 Run validation, re-review the final diff, and push the revision for maintainer review — `d2e9a61f6`
