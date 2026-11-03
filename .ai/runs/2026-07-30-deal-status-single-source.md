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

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

- [x] Add `packages/core/src/modules/customers/lib/dealStatus.ts` (won / lost / closed sets + predicates) — 60adcbc72, refined in 15d5a9937
- [x] `api/companies/[id]/route.ts` — `activeDeals` / `wonDeals` consume the helpers — 60adcbc72
- [x] `components/detail/dashboard/helpers.ts` — three inline tests replaced — 60adcbc72
- [x] `components/detail/CompanyKpiBar.tsx` — five inline tests replaced — 60adcbc72
- [x] `components/detail/ActiveDealCard.tsx` — inline test replaced — 60adcbc72
- [x] `api/people/[id]/companies/enriched/route.ts` — aligned (also picks up `closed`) — 60adcbc72
- [x] Unit tests for `dealStatus.ts` — 60adcbc72
- [x] Regression tests: a `useDealClosure`-closed deal (`status: 'win'`) counts as won, not active — 60adcbc72, enriched-route coverage added in 15d5a9937
- [x] Validation gate — verified from GitHub checks on head `15d5a9937` (see Validation below)
- [x] PR opened — #4705 (replacement for the superseded #4689)

## Validation

**Source:** GitHub Actions checks on head `15d5a9937b111f1fac70e764772829775d8c4752`. **Runner:** GitHub Actions; no local fallback was required.

Every command in the configured `validation.commands` gate maps to a passing CI step:

| Gate command | CI job / step | Result |
|--------------|---------------|--------|
| `yarn build:packages` | `prepare` — "Build packages" | ✅ pass |
| `yarn generate` | `prepare` — "Prepare generated modules" | ✅ pass |
| `yarn build:packages` (rebuild) | `prepare` — "Rebuild packages with generated files" | ✅ pass |
| `yarn i18n:check-sync` | `test` — "Check i18n sync" | ✅ pass |
| `yarn i18n:check-usage` | `test` — "Check i18n usage" | ✅ pass |
| `yarn typecheck` | `test` — "Checking types" | ✅ pass |
| `yarn test` | `test` — "Test" | ✅ pass |
| `yarn build:app` | `prepare` — "Build app" | ✅ pass |

Supporting checks also passed: `lint`, `docker-build`, `ephemeral-integration (none)`, `audit-scope`, `CodeQL` and all three CodeQL language analyses, and `license/cla`. `audit` and `merge-coverage` report `skipping` by design. Branch protection exposes no required-check list, so every reported check was treated as required. The PR is mergeable with no conflicts.

## Notes

- Scope stays inside the customers module. The `dashboards` pipeline-summary widget has its own
  status and `closureOutcome` handling in #4683; direct cross-module imports are not allowed.
- `data/validators.ts` and `api/deals/[id]/stats/route.ts` keep the `closureOutcome` enum
  (`won` / `lost`) — that is a separate, well-defined column and not part of this mismatch.
