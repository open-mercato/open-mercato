# Deal status single source of truth (#4667)

**Issue:** open-mercato/open-mercato#4667
**Branch:** `fix/issue-4667-deal-status-vocabulary`
**Base:** `develop`

## Problem

`customer_deals.status` is a lenient `text` column and the writers disagree on the spelling:

| Writer | Persists |
|--------|----------|
| `backend/customers/deals/[id]/hooks/useDealClosure.ts` | `win` / `loose` |
| `backend/customers/deals/pipeline/page.tsx` (`updateDealStatus`) | `win` / `loose` |
| `ai-tools/deals-pack.ts` (`customers.update_deal_stage`) | `won` / `lost` |
| `cli.ts` seed vocabulary | `closed`, `win`, `loose` |

Company read-side surfaces test only for `won` / `lost` / `closed`, so a deal closed through the
supported UI (`win` / `loose`) keeps counting as **active**, while won-deal count, completed-deal
count and LTV read **0**.

## Approach

Mirror the existing house pattern in `lib/interactionStatus.ts`: one exported definition of the
terminal vocabulary plus predicates, consumed by every call site. Unknown statuses stay **open**
so tenant-specific stages are never silently reclassified.

## Progress

- [x] Add `packages/core/src/modules/customers/lib/dealStatus.ts` (won / lost / closed sets + predicates)
- [x] `api/companies/[id]/route.ts` — `activeDeals` / `wonDeals` consume the helpers
- [x] `components/detail/dashboard/helpers.ts` — three inline tests replaced
- [x] `components/detail/CompanyKpiBar.tsx` — five inline tests replaced
- [x] `components/detail/ActiveDealCard.tsx` — inline test replaced
- [x] `api/people/[id]/companies/enriched/route.ts` — aligned (also picks up `closed`)
- [x] Unit tests for `dealStatus.ts`
- [x] Regression tests: a `useDealClosure`-closed deal (`status: 'win'`) counts as won, not active
- [x] Validation gate
- [x] PR opened

## Notes

- Scope stays inside the customers module. The `dashboards` pipeline-summary widget has its own
  status and `closureOutcome` handling in #4683; direct cross-module imports are not allowed.
- `data/validators.ts` and `api/deals/[id]/stats/route.ts` keep the `closureOutcome` enum
  (`won` / `lost`) — that is a separate, well-defined column and not part of this mismatch.
