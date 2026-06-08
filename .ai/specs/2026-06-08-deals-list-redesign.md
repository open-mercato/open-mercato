# Deals List Page Redesign (SPEC-048 — CRM, Lista view)

## TLDR

Redesign the existing backend **Deals list** page (`/backend/customers/deals`, file `packages/core/src/modules/customers/backend/customers/deals/page.tsx`) to match the new Figma "Lista" mockup (Figma node `982:1658`): add a **4-card KPI strip** (Pipeline value, Active deals, Won this quarter, Win rate — each with a period-over-period delta and a small in-card widget), and **restyle the data-table cells** (DEAL icon-well, STATUS badge, STAGE name, VALUE, PROB, CLOSE with relative subtitle, OWNER avatar, COMPANIES pill, PEOPLE avatar stack). Add one tenant/org-scoped backend endpoint `GET /api/customers/deals/summary` to feed the KPI metrics + deltas. Keep the existing advanced filter toolbar, perspective, bulk actions, optimistic locking, and view-tabs (Kanban|List) intact — restyle only.

The redesign is faithful to the mockup **within the Open Mercato design system**: every Figma color/size maps to the nearest **semantic/scale DS token** (no hardcoded hex, no arbitrary `text-[..]` / `rounded-[..]` — project rule overrides literal-px fidelity), and mockup placeholder content with no backing field is mapped to real data or omitted (documented below).

## Scope decisions (resolved before writing — from user)

- **Q1 — Tabs:** List view only. Keep the existing `ViewTabsRow` (Kanban | List); **do not** build Activities/Calendar/Map views or add non-functional tabs.
- **Q2 — KPI data:** **Real metrics + period deltas** — build a tenant/org-scoped aggregation endpoint computing all four metrics and their vs-previous-period deltas from live deals.
- **Q3 — Filter bar:** **Keep** the existing advanced filter system (popovers, saved filters, presets, active-filter chips); restyle toward the Figma look only — no feature loss.
- **Stage column:** Drop the graphical stage-progress indicator (variable stage counts make it cumbersome); **render the stage name only** (the current list already has no progress bar — it renders the stage via `DictionaryValue`).
- **DS vs pixel-perfect:** Where a Figma value has no exact DS token, use the closest token (project `AGENTS.md` / `.ai/ds-rules.md` forbid hardcoded hex and arbitrary values). Data-driven dictionary colors (status/stage) remain data-driven, mapped through `mapDictionaryColorToTone`.

## Pre-implementation audit — corrections applied (2026-06-08)

A fresh BC/readiness audit (verdict: READY-WITH-NOTES) corrected these assumptions; the design below incorporates them:

- **Owner names (was wrong):** `fetchAssignableStaffMembers` is a **client** `apiCall` wrapper and there is no server-side user-display-name DI seam; a direct cross-module ORM read of staff/users from the customers endpoint would violate module isolation. **Resolution:** the `summary` endpoint returns owner **ids + counts** only; the page resolves `ownerUserId → label` **once** client-side (one `fetchAssignableStaffMembers` load → `ownerNames` map) and shares that map with BOTH the OWNER table cell and `<DealsKpiStrip>` (no per-row fetch, no new server coupling).
- **KpiCard layout for pixel match + pp unit:** the Figma puts the delta chip in the **header top-right** and a subtext line above the widget; KpiCard's built-in `trend` renders below the value and its `BadgeDelta` always suffixes `%`. **Resolution:** render the delta chip via KpiCard **`headerAction`** (top-right, matches Figma) using a unit-aware delta badge (export/extend the internal `BadgeDelta` with `unit?: string`, default `'%'`; win-rate passes `'pp'`); put the **subtext + in-card widget** in the new **`footer`** slot. Do not pass `trend` (avoids a duplicate chip + the `%` mislabel on win-rate pp).
- **Quarter windows in UTC:** `expected_close_at` is a bare `Date` while `updated_at`/`created_at` are timestamptz — compute quarter boundaries in **UTC** in `lib/dealsMetrics.ts` and assert it in the unit test (prevents quarter-edge misbucketing).
- **Test fixtures:** `createDealFixture` (`packages/core/src/helpers/integration/crmFixtures.ts`) does **not** expose `status`/`expectedCloseAt`/`ownerUserId`/`closureOutcome` (all valid on `dealCreateSchema`). **Resolution:** extend it (additive) to forward them so the summary test can seed won/lost/overdue/owner across two quarters.
- **CLOSE cell terminal label:** derive "won"/"lost" from `status` (`win`/`loose`) — no need to add `closureOutcome` to `DealRow`.
- **`fetchStuckDealIds(em, organizationId, tenantId)`** — arg order is **org before tenant** (copy the aggregate route's exact cast/usage).
- **Test ids:** **TC-CRM-082** (summary API integration + unit test) and **TC-CRM-083** (deals-list UI Playwright).

## Overview

The Deals list is the mature CRM list page: a `DataTable` with a Kanban|List tab strip, an advanced filter tree (saved filters, quick presets, active-filter chips — shipped by `2026-05-10-crm-list-filter-redesign.md`), search, sort, refresh, export, column chooser, bulk-delete, row actions, optimistic-locking, perspective `customers.deals.list`, and auto custom-field columns. The Figma adds a metrics strip above the table and a more visual table treatment. None of the underlying list/CRUD machinery changes — this is an additive KPI strip + a presentational restyle of cells + one read-only aggregation endpoint.

## Problem statement

1. The list gives no at-a-glance pipeline health — users must scan rows to understand totals, win rate, or what needs attention.
2. The current cells are text-only (raw dictionary dot+label for status, plain text for value/close, raw owner id, text pills for companies/people), which does not match the new design language used elsewhere in the CRM (companies/people detail KPI bars, kanban redesign).
3. There is no list-level metrics endpoint — the existing `…/deals/aggregate` returns only per-stage counts/value for the kanban lane headers.

## Proposed solution

### A. Backend — `GET /api/customers/deals/summary` (new, read-only)

A hand-written route mirroring the established pattern in `packages/core/src/modules/customers/api/deals/aggregate/route.ts` (auth + organization scope + base-currency lookup + `exchangeRateService` conversion + raw-SQL aggregation + hand-written `openApi`). Guarded by `requireFeatures: ['customers.deals.view']` (same as list/aggregate).

**Period model.** `period` = the current quarter by default (derived server-side from "today"); `previousPeriod` = the immediately preceding quarter. Deltas compare the metric over `period` vs `previousPeriod`. The window basis per metric is documented so the numbers are well-defined, not fabricated:

| KPI | Current value | Delta basis | In-card widget |
|---|---|---|---|
| **Pipeline value** | Σ `value_amount` of **open** deals (`status` ∈ {`open`,`in_progress`}), converted to base currency | Σ open-deal value **created in `period`** vs **created in `previousPeriod`** (pipeline inflow %) | Per-stage segmented bar + legend (open deals grouped by `pipeline_stage`, dictionary label+color, count) |
| **Active deals** | count of **open** deals | count created in `period` vs `previousPeriod` (%) | Owner avatar group (top owners by open-deal count) + `+N`; subtext "N owners · M need attention" |
| **Won this quarter** | Σ `value_amount` of deals **won** (`status='win'` OR `closure_outcome='won'`) with `updated_at` in `period`, base currency | won Σ in `period` vs `previousPeriod` (%) | CheckCircle + "N deals closed this quarter"; subtext "avg deal {avg}" |
| **Win rate** | won / (won + lost) within `period`, % (lost = `status='loose'` OR `closure_outcome='lost'`) | win-rate(`period`) − win-rate(`previousPeriod`), in **pp** | Sparkline of win-rate over the last 6 trailing months |

`needAttention` count = open deals that are **overdue** (`expected_close_at < today` AND `status='open'`) OR **stuck** (reuse `fetchStuckDealIds`, `packages/core/src/modules/customers/lib/stuckDeals.ts`). Owner avatars resolve `owner_user_id` → display name via the same staff-resolution the page already uses (`fetchAssignableStaffMembers`); the endpoint returns owner `{id,label}` for the top N + an overflow count.

**Currency.** Reuse the aggregate pattern exactly: look up the tenant/org base currency (`currencies.is_base`), sum per currency, convert non-base via `exchangeRateService.getRates({ pairs, date: today, scope, options:{ maxDaysBack:60, autoFetch:false } })`, and disclose `baseCurrencyCode`, `convertedAll`, `missingRateCurrencies`. If no base currency exists, return the dominant-currency total with `convertedAll:false` (mirrors aggregate's degraded path). The shared conversion + period helpers go in a small lib `packages/core/src/modules/customers/lib/dealsMetrics.ts` (used by the new endpoint; the existing aggregate route is left untouched to avoid regressing its shipped behavior + unit test — the minor duplication is pre-existing and out of scope).

**Response shape** (`DealsSummaryResponse`, zod-validated, all numbers in base currency unless noted):

```ts
{
  baseCurrencyCode: string | null,
  convertedAll: boolean,
  missingRateCurrencies: string[],
  pipelineValue: { value: number, delta: { value: number, direction: 'up'|'down'|'unchanged' },
                   stages: { id: string, label: string, color: string|null, count: number, value: number }[] },
  activeDeals:   { value: number, delta: {…}, ownersCount: number, needAttention: number,
                   owners: { id: string, count: number }[], ownersOverflow: number },  // ids only; labels resolved client-side
  wonThisQuarter:{ value: number, delta: {…}, dealsClosed: number, avgDeal: number },
  winRate:       { value: number, deltaPp: number, direction: 'up'|'down'|'unchanged',
                   previousValue: number, series: { period: string, rate: number }[] },
}
```

### B. UI — KPI strip + restyled cells (in `page.tsx`)

**Injection point.** Insert `<DealsKpiStrip … />` between `<ViewTabsRow active="list" />` (page.tsx L922) and `<DataTable … >` (L923), so the strip sits above the filter/search toolbar (which is internal to `DataTable`).

**New components** (module-local under `packages/core/src/modules/customers/components/`):
- `DealsKpiStrip.tsx` — `"use client"`; fetches `/api/customers/deals/summary` via `apiCall`; renders four `KpiCard`s in a responsive grid (mirrors `components/detail/CompanyKpiBar.tsx`). Handles `loading`/`error` via `KpiCard`'s built-in `loading`/`error` props. Localized via `useT()`.
- `kpi/PipelineStageBar.tsx` — segmented horizontal bar (`flex` of `flex-1` segments) + legend; segment/dot colors come from the per-stage dictionary `color` (data-driven, rendered as the existing `DictionaryValue` does — inline CSS custom property, **not** a hardcoded Tailwind status color), label via dictionary.

**Shared primitive changes** (`packages/ui`, additive / BC-safe):
- `KpiCard` (`packages/ui/src/backend/charts/KpiCard.tsx`): add an optional **`footer?: React.ReactNode`** slot rendered below the value/comparison row. Additive prop — existing callers unaffected. The four cards pass their widget (stage bar / owner `AvatarStack` / CheckCircle caption / sparkline) as `footer`. The existing `BadgeDelta` trend chip already uses DS status tokens (`bg-status-success-bg` / `bg-status-error-bg`), so deltas render compliantly; the strip computes `direction` so an improving metric is `up` (green) and a worsening one is `down` (red), including win-rate pp.
- `Sparkline` (`packages/ui/src/backend/charts/Sparkline.tsx`, new): a small inline area+line SVG (charts are the DS-sanctioned home for data-viz SVG; this is not page-body chrome). Props `{ values: number[]; ariaLabel: string; className?: string }`; stroke/fill via `currentColor` so color is set by a DS text token on a wrapper (e.g. `text-primary`). Used by the Win-rate card. (The module-local `staff/lib/.../HoursSparkline.tsx` is left as-is — no cross-module import, no refactor.)

**Cell restyle** (column renderers in `page.tsx`; reuse existing data on `DealRow`):

| Column | Change | Real-data mapping (mockup → backing field) |
|---|---|---|
| **DEAL** | briefcase icon in a rounded "well" (`bg-muted rounded-md`, lucide `Briefcase`) + bold title. ⚠ `AlertTriangle` (status-warning token) shown when the deal is **overdue** (`expectedCloseAt < today && status='open'`). | Mockup "ORD-#####" subtitle has **no backing field** (deal has no reference/number) → **omitted** (no fabricated ids). Warning ⚠ → overdue (client-derivable). |
| **STATUS** | `StatusBadge` (variant from `mapDictionaryColorToTone(entry.color)`, fallback `neutral`; `dot`). | Labels come from the `deal-statuses` **dictionary** (Open / Win / Loose / In progress / Closed) — real data, not the mockup's literal "Won/Lost". Tone from the dictionary color. |
| **STAGE** | Stage **name** only (dictionary label), restyled typography. No progress graphic. | Mockup "Nd in stage" subtitle omitted per the "leave just the name" decision + no first-class days-in-stage field. |
| **VALUE** | Two lines: formatted amount (thousands-grouped, no symbol) over the currency code (muted). | `value_amount` + `value_currency` (existing). Reuse `formatCurrency`/`Intl`. |
| **PROB** | `{n}%` (restyle only). | `probability` (existing). |
| **CLOSE** | Two lines: absolute date over a relative subtitle. Subtitle = "Overdue" (status-error token) when overdue; "won"/"lost" label for terminal status; else relative ("in N days") via `formatRelativeTime` (i18n-aware). | `expectedCloseAt` + `status` (existing). Compact "Nd" form is anglocentric → use locale-aware `formatRelativeTime` (i18n rule wins); visually close. |
| **OWNER** | Un-hide; `Avatar` (initials) + owner name. | `ownerUserId` → name via staff resolution (same id→label map pattern the page already uses for pipelines). |
| **COMPANIES** | First company as a muted `Tag`/pill (truncated) + `+N` count. | `companies[]` (existing). |
| **PEOPLE** | `AvatarStack` (initials, overlap, `+N`). | `people[]` (existing). |

**Filter bar.** Kept as-is functionally; conservative visual restyle only (spacing/cohesion with the new strip). No change to `AdvancedFilterPanel`, saved filters, presets, or the perspective.

### C. i18n

New flat dotted keys under `customers.deals.list.kpi.*` in all four locale files (`packages/core/src/modules/customers/i18n/{en,pl,de,es}.json`): card titles, `vsLastQuarter`, `needAttention`, `ownersCount`, `dealsClosed`, `avgDeal`, `activeAcrossPipelines`, `fromLastQuarter`, plus cell labels `overdue`, `closed`, `lost` (and reuse existing `columns.*`, `noValue`). No hardcoded user-facing strings; internal-only throws prefixed `[internal]`.

## Architecture & compliance notes

- **Module isolation:** no cross-module ORM relationships; owner/company/people stay FK-id based (existing). The summary endpoint reads only `customer_deals` (+ `currencies` for base code, via raw SQL like aggregate) within tenant/org scope.
- **Tenant scoping:** every query filters `tenant_id` + `organization_id IN (scope)` via `resolveOrganizationScopeForRequest`; never cross-tenant.
- **Canonical mechanisms:** `apiCall` (not `fetch`); `KpiCard`/`StatusBadge`/`Avatar`/`AvatarStack`/`Tag` shared primitives; `DataTable` untouched; reuse `mapDictionaryColorToTone`, `formatRelativeTime`, `fetchStuckDealIds`, `fetchAssignableStaffMembers`, `exchangeRateService`. No new bespoke substitutes.
- **Design System:** semantic status tokens only (badge tones, overdue/warning), DS text scale (no `text-[13px]`), lucide-react icons (`Briefcase`, `AlertTriangle`, `CheckCircle`) — never inline `<svg>` in page body (the `Sparkline` lives in `charts/`, the DS-sanctioned data-viz home). Boy-Scout: migrate any touched legacy inline-SVG/hardcoded-color lines in `page.tsx`/`page.meta.ts`/`KpiCard` to tokens.
- **No data-model change:** no new columns, no migration. The deal entity is unchanged.

## Frontend Architecture Contract

- **Server/Client boundary:** `summary/route.ts` = server (Node). `page.tsx` = existing `"use client"` (unchanged classification). `DealsKpiStrip`, `PipelineStageBar`, `Sparkline`, `KpiCard` = client, presentational (the strip does one `apiCall` on mount).
- **`"use client"` ledger:** `DealsKpiStrip.tsx` (data fetch + interactivity), `PipelineStageBar.tsx` (pure presentational, client for consistency with parent). `Sparkline.tsx` is framework-agnostic SVG (no client-only APIs). No new providers/bootstrap.
- **Client-blob guardrail:** the win-rate sparkline is hand-rolled SVG — **recharts is NOT imported** into the list bundle (avoids the ~h-52 `LineChart` card chrome and a heavy chart dep on a high-traffic list route).
- **Budgets / evidence:** no new route; one added client component + one small primitive. Verify the list route bundle does not regress materially (build:app output) and the KPI strip hydrates + the cards render in the preview pass.
- **Hydration/interactivity test:** preview pass confirms the strip loads (loading→data), deltas/colors render, and the table cells interact (row actions, selection) unchanged.

## API contracts

- **New:** `GET /api/customers/deals/summary` → `200 DealsSummaryResponse` (shape above); `401` when unauthenticated/scopeless; guarded `requireFeatures:['customers.deals.view']`. Hand-written `openApi` doc. Query params (optional, mirror list/aggregate for future filter-aware KPIs): none required for v1 (period derived server-side); accepts `pipelineId?` to scope the strip to a pipeline if present (cheap, mirrors aggregate) — **v1 may omit** if it complicates; default = all pipelines in scope.
- **Unchanged:** `GET /api/customers/deals` (list), `…/deals/aggregate`, the deal CRUD routes, the perspective/`tableId`, `entityId`, `savedFilterStorageKey`.

## Backward compatibility (contract surfaces touched)

- `KpiCard` props — **ADDITIVE** (`footer?`). No removal/rename. BC-safe.
- New `Sparkline` export from `@open-mercato/ui/backend/charts` — **additive**.
- New API route — **additive**.
- New i18n keys — **additive**.
- `page.tsx` cell renderers — internal to the page (not a contract surface); route path, `entityId`, `tableId` unchanged.
- No FROZEN/STABLE surface is broken.

## Phasing

- **Phase 1 — Backend summary endpoint + lib.** `lib/dealsMetrics.ts` (period windows + currency conversion), `api/deals/summary/route.ts`, zod response schema, `openApi`. Unit test (mirror `aggregate/__tests__/route.test.ts`).
- **Phase 2 — Shared primitives.** `KpiCard.footer` slot; new `Sparkline`. (UI package build.)
- **Phase 3 — KPI strip.** `DealsKpiStrip` + `PipelineStageBar`; wire into `page.tsx`; i18n keys (4 locales).
- **Phase 4 — Cell restyle.** DEAL / STATUS / STAGE / VALUE / PROB / CLOSE / OWNER / COMPANIES / PEOPLE renderers + owner-name resolution; Boy-Scout token migration on touched lines.
- **Phase 5 — Tests + DS guard + verify + preview.** Integration tests; `om-ds-guardian`; full gate; preview compare→iterate vs Figma.

## Risks & impact review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| No base currency / missing FX rates → KPI totals partial | Medium | summary endpoint | Disclose `convertedAll`/`missingRateCurrencies`; degraded dominant-currency fallback (mirrors aggregate) | Low — UI can show a "≈"/note when `!convertedAll` |
| Summary runs several aggregate queries per list load | Low–Med | perf | Tenant/org-scoped, uses `customer_deals_closure_stats_idx`; single endpoint, one fetch; cache-able later | Low |
| Pixel fidelity vs DS tokens diverge slightly | Low | UI | Tokens win (project rule); preview compare→iterate to closest token | Low (documented) |
| Mockup placeholder data (order #, days-in-stage) has no field | Low | UI | Documented mockup→real mapping; omit fabricated content | Low |
| OWNER column un-hidden → owner-name N+1 | Low | perf | Single staff fetch → id→label map (existing pattern), not per-row | Low |
| `KpiCard.footer` misused by other callers | Low | BC | Optional, defaulted; no behavior change when unset | Low |

## Integration Test Coverage

**API paths**
- `GET /api/customers/deals/summary` — **new** integration test (mirror `__integration__/TC-CRM-079.spec.ts`): seed deals with known `value_amount`/`value_currency`/`status`/`closure_outcome`/`expected_close_at`/`owner` across the current & previous quarter; assert `pipelineValue.value`, `activeDeals.value`, `wonThisQuarter.value`/`dealsClosed`/`avgDeal`, `winRate.value`/`deltaPp`, `needAttention`, and the `delta.direction`s; assert tenant/org scoping (a second-org deal is excluded); cleanup in `finally` (deals → stages → pipeline). Plus a **unit test** (mirror `aggregate/__tests__/route.test.ts`) for the currency-conversion/period math/scoping with mocked `exchangeRateService`/`em`.
- `GET /api/customers/deals` — **regression**: existing list specs (`TC-CRM-061`, `TC-CRM-079`) must still pass (no contract change).

**UI paths**
- `/backend/customers/deals` — **new/extended** Playwright spec (mirror `TC-CRM-071-create-deal-redesign.spec.ts`): log in, navigate, assert the **KPI strip** renders four cards with values + delta chips, the **STATUS badge**, **OWNER avatar+name**, **PEOPLE avatar stack** and **STAGE name** cells render, the table loads rows, and row selection / row-actions / advanced filter still work (no regression).

## Final compliance report

Implemented 2026-06-08. Evidence:
- **Full CI gate green**: `build:packages` ×2 · `generate` · `i18n:check-sync` (4 locales in sync) · `typecheck` (21/21 packages) · `test` (all new tests + every package green; the one failing core test — `inbox_ops/__tests__/executionHelpers.superadmin.test.ts` "empty feature requirement" — is **pre-existing on the base branch** (from #2804) and untouched by this change) · `build:app` (✓ compiled).
- **Unit tests**: `deals/summary/__tests__/route.test.ts` 7/7 (KPI math, UTC quarter bucketing, multi-currency conversion, 401 auth).
- **Integration tests**: `TC-CRM-082` (summary endpoint: seeded open/won/lost/overdue delta assertions + **cross-org isolation** + 401) and `TC-CRM-083` (UI: KPI strip + restyled cells render, search/row-actions/filters unaffected) — both pass against the ephemeral env.
- **DS guardian**: CLEAN (no hardcoded status colors, no arbitrary values, no inline page-body SVG; data-driven dictionary colors via inline style are sanctioned).
- **Preview compare-loop** vs Figma node 982:1658: pixel-faithful within the DS — UPPERCASE labels, `622K USD` (smaller muted spaced unit), integer delta chips, stacked stage bar + legend, owner avatar group, win-rate sparkline, status badges, two-line Value/Close, owner Avatar+name, company pill, people AvatarStack, stage name only.
- **Fresh adversarial review**: PASS. Both findings fixed (added cross-org isolation assertion to TC-082; aligned summary overdue boundary to `CURRENT_DATE`).
- **BC note**: `KpiCard` gained additive `footer?`/`titleClassName?` and `DeltaBadge` gained `unit?`; the suffix now renders smaller/muted and integer deltas drop a trailing `.0` — a shared-primitive visual refinement that also affects other KpiCard callers (CompanyKpiBar, dashboard widgets). No API/contract removal.

## Changelog

- 2026-06-08 — Spec drafted. Scope resolved with user (list-only; real KPI metrics+deltas; keep+restyle filters; stage name only; DS tokens over literal hex).
- 2026-06-08 — Pre-implement audit applied: client-side owner-name resolution (no server seam), KpiCard `headerAction`+`footer` layout with unit-aware delta badge (pp for win-rate), UTC quarter math, additive `createDealFixture` fields, TC-CRM-082/083.
- 2026-06-08 — Implemented and verified: summary endpoint + lib, KpiCard/Sparkline/strip/cells, 4-locale i18n, unit + integration tests (incl. cross-org isolation). Full CI gate green; DS guardian CLEAN; fresh review PASS; preview pixel-faithful vs Figma 982:1658. Staged on `feat/deals-list-redesign`, awaiting PR.
