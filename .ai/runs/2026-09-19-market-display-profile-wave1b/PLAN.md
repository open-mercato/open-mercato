# Market display profile - wave 1b (the rest of Phase 2)

- Source spec: `.ai/specs/2026-09-18-market-display-profile.md` (spec PR #1, branch `spec/market-display-profile`)
- Branch: `feat/market-display-profile-wave1b`
- Base: `develop`
- Run folder: `.ai/runs/2026-09-19-market-display-profile-wave1b/`
- Engine: `om-auto-create-pr-loop` (steps: 14, --loop: yes, forwarded by `om-auto-implement-spec`)
- Predecessor: PR #5 (`feat/market-display-profile-wave1`) merged Phase 1, P2.1 and P2.5 into `develop`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed - per-Step commits touch only `Status` and `Commit`. A Step's own commit flips its `Status`; its `Commit` cell is filled by the next commit, because a SHA cannot be written into the commit that produces it.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 2 | 2.2a | Address layer: the `packages/ui` detail twins render from the descriptor | inline | done | 0e94e1179 |
| 2 | 2.2b | Address layer: the `customers` twins render from the descriptor | inline | done | abfb0ff75 |
| 2 | 2.3 | Customers surfaces: people, companies, deals, detail cards, phone in `formConfig` | inline | done | 1e4504508 |
| 2 | 2.4 | CRM calendar: `range.ts`, `MonthGrid`, `AgendaList`, conflicts route | inline | done | 45ec3c8f6 |
| 2 | 2.6a | Sales documents: money and dates through the helpers | inline | done | 71102151b |
| 2 | 2.6b | Sales documents: the price presentation switch and the tax line | inline | done | 9fd947875 |
| 2 | 2.7 | Public quote page and quote emails via a server-built preformatted view model | inline | done | 400928046 |
| 2 | 2.8 | Catalog product forms: single price field, unit placeholders, `tax_code` and `is_taxable` | inline | done | b0c13d5d7 |
| 2 | 2.9 | Tax rates wording: "Tax rates" in place of "VAT classes" | inline | done | 6e2362d5e |
| 2 | 2.10 | Sales channel and WMS warehouse address forms pick up the shared layout | inline | done | 11c4fba71 |
| 2 | 2.11 | Shipment wizard: `AddressFields` and `PackageEditor` | inline | done | c80d7ad7d |
| 2 | 2.12 | Documents PDF reads `paperSize(profile)` | inline | done | 1332e15a9 |
| 2 | 2.13 | CSV export takes the profile for dates, amounts and negative style | inline | done | d225166a4 |
| 2 | 2.14 | Portal profile page dates | inline | done | 6b2186c4b |
| 2 | 2.8-ds-fix | Design-system pass: the price kind warning uses the current Alert API | inline | done | b8f3fe9ad |
| 2 | 2.13-review-fix | Review fix: a formatted negative amount must not take the CSV formula escape | inline | done | 240ec857a |

## Goal

Finish wave 1 of the market display profile: migrate every remaining Phase 2 surface named in the spec so a US tenant
sees US conventions end to end, while a tenant that never picked a market renders byte identically to today.

## Scope

The remaining Phase 2 steps of the spec, in spec order: P2.2, P2.3, P2.4, P2.6 through P2.14. Every migrated surface
reads the resolved profile (`useDisplayProfile()` on the client, `resolveDisplayProfileForRequest()` /
`resolveDisplayProfileForScope()` on the server) and passes it to the pure helpers already shipped in
`packages/shared/src/lib/display/*`. No helper gains a new signature unless a consumer genuinely needs one.

## Non-goals

- Phase 3 (wave 2): the `no-bespoke-display-format` lint rule, the long-tail `toLocale*` migration, and collapsing the
  address twins into one implementation. Deferred by the owner (spec decision D4).
- P2.1 (`packages/ui` date primitives) and P2.5 (catalog `tax_code` / `is_taxable` columns): already on `develop`
  through PR #5.
- Any new migration. This run adds no schema change, so the slot runs on the shared instance database.

## Owner decisions that override the spec text (carried from the wave 1 run, 2026-09-19)

These were confirmed by the owner. Where they conflict with the spec document, they win.

1. **The tax parts of this spec are superseded** by the pluggable tax providers change already merged (spec PR #3,
   implementation PR #4). Not implemented here:
   - the `TaxCalculator` section: no `sales/lib/tax/*`, no `taxCalculator` DI token, no `StubTaxCalculator`, no call
     site in the totals path;
   - the additive tax columns on the four sales document entities and their migrations;
   - `taxInfoSchema`;
   - the customer exemption fields on `CustomerEntity` (`is_tax_exempt`, `exemption_certificate_number`,
     `entity_use_code`), their encryption map entry and their form fields. **Step 2.3 therefore ships no exemption
     fields.**
2. The catalog fields `tax_code` and `is_taxable` already exist on `CatalogProduct` and `CatalogProductVariant` from
   PR #5. Step 2.8 adds only their form fields.
3. **The tax line under `price_presentation = single_price_plus_tax`** (steps 2.6b and 2.7) renders from the columns
   that already exist today: `tax_total_amount` and, when present, a breakdown array inside the existing `tax_info`
   jsonb on `sales_orders` and `sales_quotes`. Read them, never write them, add no validator for `tax_info`. Invoices
   and credit memos render the tax line from `tax_total_amount` only.
4. Everything else stays as written, including D6 and the resolved assumptions A1 to A8.

## Implementation Plan

### Phase 2 (continued): wave 1, the hackathon happy path

**Step 2.2a - Address layer: the `packages/ui` detail twins render from the descriptor**

`packages/ui/src/backend/detail/{AddressEditor,AddressTiles,AddressesSection,addressFormat}.tsx` call
`resolveAddressLayout(profile)` and render from the descriptor: profile label keys, a `region` select over
`getSubdivisions(country)` when the market requires a subdivision, postal-code validation against the market pattern on
blur and on submit, hidden building and flat number inputs under the `us` layout, country defaulted from
`default_country_code`, and `normalizePhoneInput` before phone validation. A legacy row that breaks a market rule
renders a warning badge and stays saveable (invariant 5). `addressFormat.tsx` renders through `formatAddress`.

**Step 2.2b - Address layer: the `customers` twins render from the descriptor**

The same descriptor applied to `customers/components/{AddressEditor,AddressTiles}.tsx`,
`customers/components/detail/AddressesSection.tsx` and `customers/utils/addressFormat.tsx`, so the twins cannot drift
while they remain two files (assumption A1). No behavior change without a profile row.

**Step 2.3 - Customers surfaces**

`customers/backend/customers/{people,companies,deals}/page.tsx` and
`customers/components/detail/{CompanyCard,DealDetailHeader,utils}.tsx` take dates and money through the helpers, and
`formConfig.tsx` runs the phone field through `normalizePhoneInput` / `formatPhone`. No exemption fields (decision 1).

**Step 2.4 - CRM calendar**

`customers/lib/calendar/range.ts` takes the week start from `weekStartsOn(profile)`;
`customers/components/calendar/{MonthGrid,AgendaList}.tsx` render weekday headers, day labels and times through the
helpers; `customers/api/interactions/conflicts/route.ts` resolves the profile for its server-side week computation.

**Step 2.6a - Sales documents: money and dates through the helpers**

`sales/backend/sales/documents/[id]/page.tsx` and the document components
(`ItemsSection`, `LineItemDialog`, `ReturnsSection`, `SalesOrderDraftLines`, `SalesDocumentsTable`,
`SalesDocumentForm`, `PaymentsSection`, `AddressesSection`, `lineItemUtils`, `PriceWithCurrency`) format every amount
through `formatMoney` and every date through `formatDate` / `formatDateTime`, and print addresses through
`formatAddress`.

**Step 2.6b - Sales documents: the price presentation switch and the tax line**

Under `single_price_plus_tax`, line tables show Unit price / Quantity / Total and totals show Subtotal / Shipping /
Sales tax / Total, with every `(net)` / `(gross)` label resolved through `resolvePriceLabelKey`. The tax line reads
`tax_total_amount` and the existing `tax_info.breakdown`, never writes them (decision 3), and carries the market's
`taxNoteKey` when one is defined. Under `dual_net_gross`, and with no profile, nothing changes.

**Step 2.7 - Public quote page and quote emails**

`sales/frontend/quote/[token]/page.tsx` and `sales/emails/{QuoteSentEmail,QuoteAcceptedAdminEmail}.tsx` render from a
**server-built preformatted view model**: the server resolves the profile for the quote's scope and hands the templates
already-formatted strings, so no email template formats anything itself.

**Step 2.8 - Catalog product forms**

`catalog/backend/catalog/products/{create,[id]}/page.tsx` and
`catalog/components/products/{VariantBuilder,ProductUomSection}.tsx`: one "Price" field under
`single_price_plus_tax` (the gross input and the "including tax" wording hidden), unit placeholders from the market's
default weight and length units, and the `tax_code` and `is_taxable` fields. The price kind settings page warns on any
kind still marked `including-tax` without rewriting it.

**Step 2.9 - Tax rates wording**

`sales/components/TaxRatesSettings.tsx` and `sales/i18n/*.json`: "Tax rates" in place of "VAT classes".

**Step 2.10 - Sales channel and WMS warehouse address forms**

`sales/backend/sales/channels/[channelId]/edit/page.tsx` and the WMS warehouse form pick up the shared address layout
instead of their own field order and labels.

**Step 2.11 - Shipment wizard**

`shipping_carriers/lib/shipment-wizard/components/{AddressFields,PackageEditor}.tsx`: placeholders and hints from the
profile instead of hardcoded `PL` and `30-624`; pounds and inches under `us_customary`, converted back to the metric
`PackageDimension` contract at the input boundary only, one `convertUnit` call per field (D9).

**Step 2.12 - Documents PDF paper size**

`packages/documents/src/modules/documents/lib/{pdfHtml,pdfRenderer}.ts` read `paperSize(profile)` into the `@page`
rule and into puppeteer's `format`.

**Step 2.13 - CSV export**

`packages/shared/src/lib/crud/exporters.ts` takes the profile for dates, amounts and negative style.

**Step 2.14 - Portal profile page dates**

`portal/frontend/[orgSlug]/portal/profile/page.tsx` renders dates through the helpers.

## Risks

- **A migrated surface changes output for a tenant with no profile row.** Every helper falls back to
  `LEGACY_DISPLAY_DEFAULTS`, but a call site that passes its own option (a forced hour cycle, a hardcoded currency) can
  still drift. Every Step diff is re-read for exactly this, and the unit tests assert the no-profile path.
- **The tax line reads columns another change owns.** `tax_total_amount` and `tax_info` belong to the pluggable tax
  providers change. This run only reads them and adds no validator, so the two cannot conflict on write.
- **Surface breadth.** Fourteen steps across seven packages. Checkpoints every five Steps catch a regression before it
  compounds.

## External References

None. No `--skill-url` was passed.

## Validation gate

Ordered `validation.commands` from `.ai/agentic.config.json`:
`yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`,
`yarn typecheck`, `yarn test`, `yarn build:app`.
