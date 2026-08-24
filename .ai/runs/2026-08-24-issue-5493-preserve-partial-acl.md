# Execution plan — preserve partial user ACL updates without silent permission loss (adopted from PR #5537)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-24 because PR #5537 carried no execution plan.
**PR:** #5537 · **Branch:** `fix/issue-5493-preserve-partial-acl` · **Base:** `develop`
**Author:** @haxiorz — this plan interprets the PR and review intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Make partial user ACL updates preserve omitted dimensions without either widening the user's role-derived permissions or silently replacing them with a zero-feature override.

## Scope

- The `PUT /api/auth/users/acl` merge, validation, and OpenAPI description.
- Regression coverage for organization-only creation, `isSuperAdmin` omission/revocation, and explicit all-dimension clearing.
- Focused and configured validation followed by a fresh review of PR #5537.

## Non-goals

- Do not seed user ACL rows from dynamically aggregated role grants; rejecting an invalid zero-feature organization override is narrower and explicitly accepted by issue #5493.
- Do not change the role ACL endpoint, whose partial-update merge already preserves stored dimensions.
- Do not attempt to reconstruct ACL rows deleted on affected deployments; that needs a separate operator remediation decision.
- Do not change the ACL editor UI or translations because rejection restores the existing warning's stated contract and the API returns an actionable error for the empty-organization path.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Omitted ACL dimensions must preserve stored values | Issue #5493 behavior matrix and the existing PR regression tests | high |
| A zero-feature `UserAcl` row is an absolute override that removes role features | Review by @pkarw and `RbacService.loadAcl` short-circuit behavior | high |
| Rejecting the invalid merged state is acceptable | Issue #5493 expected outcome and the requested-changes review | high |
| `isSuperAdmin` preservation and explicit revocation need coverage | Review by @pkarw and parity with the role ACL route | high |
| Partial-update semantics must be documented | Review by @pkarw and the route's OpenAPI description | high |

## Assumptions

- A `400` response is the most reversible behavior for an organization-scoped, zero-feature, non-super-admin result because it writes nothing and asks the operator to select an explicit feature override.
- The existing ACL editor warning remains accurate once the API rejects the state it warns about; an empty organization array is still surfaced by the API response even though the banner currently appears only for a non-empty restriction.
- The suggested integration case is valuable follow-up coverage but is not required to resolve the review because focused route tests pin the command boundary and CI already exercises the existing auth integration suite.

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

- [ ] 3.1 Run focused and configured validation and complete the follow-up review
- [ ] 3.2 Push the reviewed fixes and update PR #5537 for re-review
