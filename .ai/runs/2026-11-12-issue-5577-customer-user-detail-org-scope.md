# Execution plan — open customer users from the selected organization without data-integrity gaps (adopted from PR #9089)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-11-12 because PR #9089 carried no execution plan.
**PR:** #9089 · **Branch:** `fix/issue-5577-customer-user-detail-org-scope` · **Base:** `main`
**Author:** @RafalDev4You — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal
Admin detail/action routes for customer users follow the organization switcher (#5577), and the selected-organization edit workflow is safe: a rejected save changes nothing, a never-updated record still refuses a stale overwrite, and the role chooser offers the target user's organization roles.

## Scope
- `packages/core/src/modules/customer_accounts/api/admin/users/[id].ts` (PUT ordering, version token, `organizationId` in GET)
- `packages/core/src/modules/customer_accounts/api/admin/users.ts` (list version token)
- `packages/core/src/modules/customer_accounts/lib/customerUserVersion.ts` (version token: `updatedAt ?? createdAt`; no entity or schema change)
- `packages/core/src/modules/customer_accounts/backend/customer_accounts/users/[id]/PortalUserDetailPageClient.tsx` (roles fetched for the user's organization)
- Unit tests next to the changed routes.

## Non-goals
- No DB migration or backfill of existing `updated_at IS NULL` rows (the read-side fallback covers them).
- No transaction refactor of the PUT handler beyond validating before writing.
- Browser-level Playwright regression for the role chooser (follow-up requested by QA bot; tracked separately).

## Evidence
| Conclusion | Drawn from | Confidence |
|---|---|---|
| Goal of the PR (org-scoped detail/actions) | PR body, issue #5577 | high |
| Rejected role save persists displayName/native fields | UI QA evidence comment (row 8, steps 11–12) | high |
| Null `updatedAt` disables the optimistic lock on first save | UI QA evidence comment (row 6, steps 09–10) | high |
| Role chooser lists the staff user's home roles | UI QA evidence comment (row 7, step 06) | high |

## Assumptions
- Using `updatedAt ?? createdAt` as the version token for never-updated rows is acceptable; the response field keeps its name and nullable type.
- Exposing `organizationId` in the GET detail response is an additive contract change.

## Risks
- Clients that treated `updatedAt: null` as "never edited" now get `createdAt` instead; no in-repo consumer relies on that.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Scope admin customer-user detail and action routes to the selected organization — 29613280e3

### Phase 2: Address UI QA failures

- [x] 2.1 Validate requested roles before any write in admin user PUT — 0cc7f88179
- [x] 2.2 Give never-updated customer users a non-null optimistic-lock version — c6b11c3b9e
- [x] 2.3 Load role options for the edited user's organization — 56c6150182
