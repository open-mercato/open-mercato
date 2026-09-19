# Market display profile - wave 1 (Phases 1 and 2)

- Spec: `.ai/specs/2026-09-18-market-display-profile.md` (spec PR #1, branch `spec/market-display-profile`)
- Branch: `feat/market-display-profile-wave1`
- Base: `develop`
- Run folder: `.ai/runs/2026-09-19-market-display-profile-wave1/`
- Engine: `om-auto-create-pr-loop` (steps: 27, --loop: no, self-routed above the 20-step threshold)

## Scope

Phases 1 and 2 of the spec, in order. **Phase 3 (wave 2, the long tail and the
`no-bespoke-display-format` lint rule) is deferred by the owner and is not implemented here.**

## Owner decisions that override the spec text (2026-09-19)

These were confirmed by the owner after the spec was written. Where they conflict with the spec
document, they win.

1. **The tax parts of this spec are superseded** by the pluggable tax providers change (spec PR #3,
   implementation PR #4, branch `feat/pluggable-tax-providers`, running in parallel). Not
   implemented here:
   - the `TaxCalculator` section: no `sales/lib/tax/*`, no `taxCalculator` DI token, no
     `StubTaxCalculator`, no call site in the totals path;
   - the additive tax columns on the four sales document entities (`tax_status`,
     `tax_calculated_at`, `tax_info`, `tax_strategy_key`) and their migrations;
   - `taxInfoSchema`;
   - the customer exemption fields on `CustomerEntity` (`is_tax_exempt`,
     `exemption_certificate_number`, `entity_use_code`), their encryption map entry and their form
     fields in Phase 2 step 3.

   Phase 2 step 5 therefore shrinks to the catalog fields in decision 2.
2. **Keep the catalog fields** `tax_code` and `is_taxable` on `CatalogProduct` and
   `CatalogProductVariant` (additive, nullable text and boolean default true) with their migration
   and the Phase 2 step 8 form fields. PR #4 does not add them and the application needs them.
3. **The tax line under `price_presentation = single_price_plus_tax`** (Phase 2 steps 6 and 7:
   document pages, the public quote page, the quote emails) renders from the columns that already
   exist today: `tax_total_amount` and, when present, a breakdown array inside the existing
   `tax_info` jsonb on `sales_orders` and `sales_quotes`. Read them, never write them, add no
   validator for `tax_info`. Invoices and credit memos render the tax line from `tax_total_amount`
   only.
4. Everything else stays as written, including D6 (new core module `markets`, entity
   `market_display_profile`, one row per organization, tenant scoped, no backfill) and the resolved
   assumptions A1 to A8.

## Environment

Migrations are added, so the slot runs on its own database (`omw up --fresh`). A plain `omw up`
must not be run afterwards: it rewrites `.env` back to the shared instance database.

## Tasks

| # | Step | Status |
|---|------|--------|
| P1.1 | `markets` module skeleton: `index.ts`, `acl.ts`, `data/entities.ts`, `data/validators.ts`, `di.ts`; `yarn generate` | pending |
| P1.2 | Migration for `market_display_profiles` via `yarn db:generate`; review SQL and snapshot | pending |
| P1.3 | `packages/shared/src/lib/location/subdivisions.ts` with the US seed and the three accessors + unit tests | pending |
| P1.4 | `packages/shared/src/lib/display/`: `profile`, `money`, `datetime`, `address`, `phone`, `units`, `paper` + unit tests | pending |
| P1.4b | `markets/lib/resolve-display-profile.ts` + `displayProfileResolver` DI token | pending |
| P1.5 | Re-export helpers from `packages/ui`; `MarketProfileProvider` + `useDisplayProfile()`; mount in root layout; `yarn template:sync:fix` | pending |
| P1.6 | `markets/commands/display-profile.ts` (create/update/delete with undo + cache tags); `markets/events.ts` | pending |
| P1.7 | CRUD API (`makeCrudRoute`, `metadata`, `openApi`) + read-only subdivisions route | pending |
| P1.8 | `markets/setup.ts`: seed templates, ACL feature sync, `seedDefaults` hook | pending |
| P1.9 | Register `en-US`; `markets/i18n/{en,pl,de,es,ko,en-us}.json`; region-subtag overlay exemption in `scripts/i18n-check-sync.ts` + test | pending |
| P1.10 | Settings page with `CrudForm`, section groups, live preview, template picker | pending |
| P1.11 | Onboarding market selection step wired into the provisioning payload | pending |
| P1.12 | `customers` address format control becomes an info alert when a profile row exists | pending |
| P2.1 | `packages/ui` primitives and shells read week start, hour cycle and patterns from the profile | pending |
| P2.2 | Address layer: descriptor consumed by both `AddressEditor` twins and the formatters | pending |
| P2.3 | Customers surfaces (people, companies, deals, detail cards, phone in `formConfig`) - **no exemption fields** (decision 1) | pending |
| P2.4 | CRM calendar: `range.ts`, `MonthGrid`, `AgendaList`, conflicts route | pending |
| P2.5 | Catalog `tax_code` / `is_taxable` columns + migration only (decision 1 and 2) | pending |
| P2.6 | Sales documents: money and dates through helpers, price presentation switch, tax line from existing columns (decision 3) | pending |
| P2.7 | Public quote page and quote emails via a server-built preformatted view model | pending |
| P2.8 | Catalog product forms: single price field, unit placeholders, `tax_code` and `is_taxable` fields | pending |
| P2.9 | Tax rates wording: "Tax rates" in place of "VAT classes" | pending |
| P2.10 | Sales channel and WMS warehouse address forms pick up the shared layout | pending |
| P2.11 | Shipment wizard: `AddressFields`, `PackageEditor` (lb/in display, metric at the adapter boundary) | pending |
| P2.12 | Documents PDF reads `paperSize(profile)` into the `@page` rule and the puppeteer format | pending |
| P2.13 | CSV export takes the profile for dates, amounts and negative style | pending |
| P2.14 | Portal profile page dates | pending |

## Validation gate

Ordered `validation.commands` from `.ai/agentic.config.json`:
`yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`,
`yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.
