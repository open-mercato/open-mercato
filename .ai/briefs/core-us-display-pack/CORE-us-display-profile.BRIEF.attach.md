# Market display profile with a US seed: brief for `om-spec-writing`

**Type:** Requirements brief for one Open Mercato core feature spec (OSS scope, `.ai/specs/`)
**Date:** 2026-09-18
**Platform baseline:** open-mercato/open-mercato `main` at `ab23d45f` (2026-09-18). Paths are relative to the repo root and were verified at that commit; re-verify a cited line if the branch has moved.
**Expected output:** `.ai/specs/2026-09-18-market-display-profile.md`
**Consumer waiting on it:** the SprayBooths Inc hackathon app (an `om-app-spec-writing` program) references this spec's entity, helpers, fields and seed by name and ships no formatting or address code of its own.
**Writing rules:** plain hyphens only, never em or en dashes. No em dashes inside code or i18n strings either.

---

## TLDR for the spec author

Open Mercato renders every date, time, amount, address, phone, unit and paper size the way its Polish and EU origin taught it: Monday weeks, 24 hour grids in some places and 12 hour pickers in others, net and gross columns side by side, "VAT classes", free text "Region / State", Polish building and flat number fields on every address, `kg` and `cm` placeholders, A4 PDFs, `PL` postal code hints. A US merchant needs one price plus a sales tax line, `$1,234.56`, `MM/DD/YYYY`, `3:45 PM`, Sunday weeks, `123 Main St, Suite 200, Plano, TX 75074`, `(214) 555-0100`, `27 ft 6 in`, `12 lb`, Letter paper.

This spec introduces one organization level **market display profile** that every display surface reads, seeds a US profile and a US state list, adds the few data fields a US quote or order needs to display sales tax (not calculate it), and migrates the display surfaces in two waves: the hackathon happy path first, the long tail second. It is display only. Tax calculation, address validation, carriers, Canada and any external service are out of scope.

---

## 1. Owner decisions (apply as given, do not raise as Open Questions)

```
D1  One spec. Do not split. Phases inside the spec carry the delivery order. The cohesion argument: every item is a consumer of the same profile entity and ships no value without it.
D2  Scope is display. Nothing here computes tax, validates addresses, converts currencies at checkout or calls a provider. The TaxCalculator interface below exists so quotes and orders can display a tax line that a later provider package fills; it ships with a stub only.
D3  Universal shape, US seed. The entity is market neutral and market keyed by organization; the seed installs a US profile and a US state list. The existing EU behavior stays the default for existing tenants (metric, A4, tax inclusive display where configured), so nothing changes for them until an admin switches the profile.
D4  Minimal for the hackathon happy path. Wave 1 migrates only the surfaces on the demo path listed in section 6. Wave 2 lists the long tail as a manifest with a lint rule; it may land after the hackathon.
D5  Additive and backward compatible. New entity, additive nullable columns, helpers in packages/shared and packages/ui, the existing env pins stay as fallbacks, existing date helpers keep their signatures and gain optional profile input. Bridges follow BACKWARD_COMPATIBILITY.md.
D6  Storage of the profile: a new core module `markets` with entity `market_display_profile`, one row per organization, tenant scoped. Do not use module_configs for it (ModuleConfigService ignores organization_id on read, configs/lib/module-config-service.ts:134-151).
D7  Price presentation is a profile setting, not a global rewrite: `price_presentation = dual_net_gross` (today) or `single_price_plus_tax` (US). Under single price the same components hide the second column and relabel; the numeric columns in the database do not change.
D8  Region codes: keep the existing `region` column on every address entity and snapshot; add a seeded `subdivision` list and validate `region` against it when the profile's address layout is `us`. Do not rename or migrate columns in this spec.
D9  Units: no dimension engine. Validate weight and dimension unit codes against the existing `unit` dictionary, add display helpers for pounds and for feet and inches from inches, and let the profile pick default unit codes. The shipping adapter contract stays kg and cm; the shipment wizard converts on display and input.
D10 Locale code: register `en-US` as an overlay dictionary that only overrides address labels, tax wording and the seven UK spellings listed in section 5.9. Do not touch the region subtag folding rules beyond what registering the overlay requires; state what you did.
D11 No new external dependencies without asking (phone formatting is done with the existing dial code table in PhoneNumberField plus a national pattern per profile, not libphonenumber).
```

---

## 2. Problem statement (evidence, verified at ab23d45f)

Counts are files, tests excluded.

**Dates, times, calendars**
1. One shared helper pair, `formatDisplayDate` and `formatDisplayDateTime` in `packages/ui/src/primitives/date-format.ts`, reads env pins `NEXT_PUBLIC_OM_DATE_FORMAT` and `NEXT_PUBLIC_OM_DATE_TIME_FORMAT`; 5 files use it (DataTable, sales document detail). No per organization setting, no `NEXT_PUBLIC_OM_TIME_FORMAT`, no `timeZone` passed anywhere.
2. 184 bespoke `toLocaleDateString` and `toLocaleString` call sites in 40 modules, many without a locale argument: customers 36, workflows 15, ui 12, sales 11, eudr 11, staff 8, warranty_claims 7, enterprise 7, ai-assistant 6, documents 5, messages 5, inbox_ops 5, design_system 4, customer_accounts 4, and 26 more modules with 1 to 3 each. Forty backend list and detail pages render date columns bespoke (api_keys, business_rules logs, currencies, exchange rates, customer_accounts users and domain, customers deals, people, companies and close date filter, data_sync, devices, directory tenants, eudr, inbox_ops, integrations, payment_gateways, push_notifications, sales channels and offers and document detail, staff leave and time tracking, warranty_claims detail and registrations, workflows work inbox).
3. 60 files call `date-fns format()` or `Intl.DateTimeFormat` directly (customers 11, staff 9, enterprise 8, wms 7, design_system 5, planner 3, audit_logs 3, scheduler 2, data_sync 2). Hardcoded display patterns: `HH:mm` in `packages/ui/src/backend/schedule/ScheduleCalendar.tsx:207-209`, `yyyy-MM-dd` in `customers/components/calendar/MonthGrid.tsx:20`, `AgendaList.tsx:36`, `customers/components/detail/create/dealCustomFieldControl.tsx:179`, `ui/src/backend/FilterOverlay.tsx:270-271`, `ui/src/backend/detail/InlineEditors.tsx:357-358`.
4. Week starts Monday, hardcoded: `packages/ui/src/backend/date-range/dateRanges.ts:72-76` (presets this week, last week) and `packages/core/src/modules/customers/lib/calendar/range.ts:12` (`MONDAY_WEEK`, CRM calendar week and month grids). Schedule components and the DayPicker calendar derive week start from the date-fns locale.
5. Hour cycle inconsistent: `packages/ui/src/primitives/time-picker.tsx:200, 921` default `'12h'` regardless of locale; `ScheduleGrid.tsx:44`, `ScheduleAgenda.tsx:44`, `staff/backend/staff/time-tracking/page.tsx:173`, `ai-assistant/.../DebugPanel.tsx:132` force `hour12: false`; `customers/api/interactions/conflicts/route.ts:186-187` forces `en-US`; `warranty_claims/lib/businessHours.ts:69` and `tillio/lib/tz.ts:28` force `h23`.
6. Date pickers guess day first order from a language list (`date-format.ts:7-9`, `DAY_FIRST_LOCALE_CODES`); there is no explicit setting.
7. Public and portal pages format bespoke: `sales/frontend/quote/[token]/page.tsx:142`, `messages/frontend/messages/view/[token]/page.tsx`, `portal/frontend/[orgSlug]/portal/profile/page.tsx`, `warranty_claims/frontend/[orgSlug]/portal/claims/{page,new/page,[id]/page}.tsx`, `workflows/frontend/[orgSlug]/portal/tasks/page.tsx`.
8. Emails render dates and amounts inline: `sales/emails/QuoteSentEmail.tsx`, `QuoteAcceptedAdminEmail.tsx`, `checkout/emails/Payment{Start,Success,Error}Email.tsx`, `customer_accounts/emails/*`, `messages/emails/MessageEmail.tsx`, `notifications/emails/NotificationEmail.tsx`, `onboarding/emails/*`, `enterprise/security/emails/*`.
9. CSV export writes ISO dates and joins with commas (`packages/shared/src/lib/crud/exporters.ts:26, 85`).
10. No organization time zone. Zones exist on `SalesDeliveryWindow`, WMS `Warehouse`, staff and planner entities; no display code passes `timeZone`. IANA hint text says "e.g. Europe/Warsaw".

**Money and tax wording**
11. 36 money formatters: `packages/ui/src/utils/format.ts:12` plus 35 module local copies (customers 9: deals pipeline popovers and tables, deal detail hooks, CompanyCard, DealDetailHeader, DealWonPopup, detail/utils, DealLostSummaryDialog, messageObjectPreviews; sales 8: PriceWithCurrency, SalesDocumentsTable, PaymentsSection, lineItemUtils, offerTableUtils, ChannelOfferForm, dashboard shared, search; dashboards 4 in `lib/formatters.ts`; checkout 3; warranty_claims 2; payment_gateways 3; catalog 3; staff 1; design_system 2). All key on the UI language through `Intl`; `Currency.thousands_separator` and `decimal_separator` (`currencies/data/entities.ts:36-39`) are read by nothing.
12. Net and gross side by side: 54 labels in `sales/i18n/en.json`, 16 in `catalog/i18n/en.json`, 6 in design_system, 1 each in checkout, wms, customers, onboarding ("Net unit price", "Gross unit price", "Subtotal (net)", "Subtotal (gross)", "Grand total (gross)", "Net shipping", "Gross shipping", "Min total (net)", "Base rate (gross)", "Incl. tax", "Excl. tax", "Including tax", "Excluding tax", "Amount (gross)"). Both columns render in `sales/backend/sales/documents/[id]/page.tsx`, `components/documents/ItemsSection.tsx`, `LineItemDialog.tsx`, `ReturnsSection.tsx`, `SalesOrderDraftLines.tsx`, `SalesDocumentsTable.tsx`, `SalesDocumentForm.tsx`, `frontend/quote/[token]/page.tsx`.
13. VAT wording: "Maintain VAT classes applied to catalog pricing." (`sales/i18n/en.json`, tax rates settings), seeded rates `vat-23` and `vat-0` (`sales/lib/seeds.ts:6-9`, `sales/setup.ts:12-15`), "VAT / registration number", tax id type labels `plNip`, `euVat`; the product form labels the rate picker "Tax class" (`catalog/i18n/en.json`).
14. Price kind display modes are `including-tax` and `excluding-tax` (`catalog/data/types.ts:89`); seeded kinds are tax inclusive USD (`catalog/lib/seeds.ts:52-53`); the catalog derives a gross price at catalog time and shows it on product and variant forms.
15. Checkout pay page: `fixedPriceIncludesTax` label and `Intl` amounts with the page locale (`checkout/components/PayPage.tsx:1545, 1553`).

**Addresses, phones, identifiers, units, paper, language**
16. Address editor and formatter exist twice: `core/customers/components/AddressEditor.tsx` and `packages/ui/src/backend/detail/AddressEditor.tsx`; `customers/utils/addressFormat.tsx` and `ui/src/backend/detail/addressFormat.tsx`; `AddressTiles.tsx` and `AddressesSection.tsx` twins. Consumers: people, companies, staff team members, sales document addresses (`sales/components/documents/AddressesSection.tsx`, `SalesDocumentForm.tsx`), shipment dialog and shipments section, sales channel edit page, WMS warehouse form. Fields: address line 1 and 2, building number, flat or apartment, city, "Region / State" free text (max 150 customers, 120 sales), postal code free text, country ISO picker. Per organization layout toggle `line_first` or `street_first` (`customers/data/entities.ts:818-819`, `AddressFormatSettings.tsx`). No `CITY ST 12345-6789` print, no required state, no ZIP pattern, Polish building and flat fields shown for every country.
17. No US state list; "Region / State" is typed; territories appear as countries; the word "ZIP" appears zero times in `en`.
18. Shipment wizard: country placeholder `PL` (`shipping_carriers/lib/shipment-wizard/components/AddressFields.tsx:64`), hint "Postal code (e.g. 30-624) or point name (e.g. KRA012)".
19. Phone: core validation rejects values without a leading `+` (`packages/shared/src/lib/phone.ts:39-41`, reason `missing_country_code`); hint "+1 212 555 1234"; `PhoneNumberField` has a dial code table with NANP handling but no national display; carrier API uses a different permissive regex (`shipping_carriers/data/validators.ts:19`).
20. Identifiers: tax id types `pl_nip`, `eu_vat`, `other` (address spec 2026-08-10); no `us_ein`.
21. Units: product form placeholders `kg` and `cm` (`catalog/components/products/VariantBuilder.tsx:241-242`); `weight_unit` and `dimensions.unit` free text max 25 (`catalog/data/validators.ts:210-216`); shipment wizard labels "Weight (kg)", "Length (cm)", "Width (cm)", "Height (cm)" (`PackageEditor.tsx:8-21`); flat rate tiers labeled kg (`sales/seed/examples-data.ts:37, 47`); unit price toggle "Enable EU unit price presentation" with `REFERENCE_UNIT_CODES = kg, l, m2, m3, pc` (`packages/shared/src/lib/units/unitCodes.ts:1`); the `unit` dictionary already seeds `lb, oz, in, ft, ft2` (`catalog/lib/seeds.ts:21-35`).
22. Paper: every PDF is A4 (`packages/documents/src/modules/documents/lib/pdfHtml.ts:21` `@page { size: A4 }`, `pdfRenderer.ts:65, 317`, `preferCSSPageSize: true`; `staff/lib/timesheets-reports/pdf.ts:44-45` `595.28 x 841.89`).
23. Language: `en` carries "cancelled" 92, "organisation" 12, "catalogue" 10, "behaviour" 4, "colour" 2, "fulfil" 1, "customise" 1; region subtags fold to the base language (`packages/shared/src/lib/i18n/locale.ts:27-34`), so `en-US` is not selectable; demo copy mentions PLN budgets; the legal footer names the Polish company.
24. Numbers: 9 `toFixed()` hardcodes in sales, catalog, customers and dashboards components; no negative style; `parseLocaleNumber` (`packages/shared/src/lib/number.ts:62`) already parses US input.

---

## 3. Proposed solution

### 3.1 Entity `market_display_profile` (module `markets`, one row per organization)

| Key | Type | Req | US seed | Notes |
|---|---|---|---|---|
| code | text | yes | `us` | unique per organization; `eu` seeded for existing tenants as the current behavior |
| name | text | yes | United States | |
| language_tag | text | yes | `en-US` | drives the overlay dictionary and Intl |
| currency_code | text | yes | `USD` | default currency for new documents |
| currency_display | select symbol, code, symbol_and_code | yes | `symbol` | `$1,234.56` versus `1,234.56 USD` |
| decimal_separator, thousands_separator | text | yes | `.` `,` | override of Intl when set |
| negative_style | select minus, parentheses | yes | `minus` | exports may use parentheses |
| date_format | text | yes | `MM/dd/yyyy` | date-fns tokens (existing convention) |
| date_time_format | text | yes | `MM/dd/yyyy h:mm a` | |
| time_format | text | yes | `h:mm a` | |
| hour_cycle | select h12, h23 | yes | `h12` | TimePicker, schedule grids, agenda |
| first_day_of_week | integer 0 to 6 | yes | 0 | Sunday |
| time_zone | text | yes | `America/Chicago` | IANA; validated with `Intl.supportedValuesOf('timeZone')` |
| address_layout | select line_first, street_first, us | yes | `us` | supersedes `CustomerSettings.address_format` (bridge: read old value when profile absent) |
| default_country_code | text | yes | `US` | |
| subdivision_required | boolean | yes | true | validates `region` against the subdivision list |
| postal_code_pattern | text | yes | `^\d{5}(-\d{4})?$` | |
| postal_code_label_key, subdivision_label_key, address_line2_label_key | text | yes | ZIP code, State, Apt, suite, unit | i18n keys |
| phone_national_pattern | text | yes | `(###) ###-####` | display only; storage stays E.164 |
| phone_default_dial_code | text | yes | `+1` | lets `214-555-0100` validate by prepending |
| measurement_system | select metric, us_customary | yes | `us_customary` | |
| default_weight_unit, default_length_unit | text | yes | `lb`, `in` | codes from the `unit` dictionary |
| length_display | select decimal, feet_inches | yes | `feet_inches` | `330 in` renders as `27 ft 6 in` |
| paper_size | select a4, letter, legal | yes | `letter` | |
| price_presentation | select dual_net_gross, single_price_plus_tax | yes | `single_price_plus_tax` | see 3.4 |
| tax_line_label_key | text | yes | Sales tax | |
| tax_note_key | text | no | "Sales tax will be calculated at order." | shown when tax_status is estimated |
| is_active | boolean | yes | true | |

Resolution: `resolveDisplayProfile({ organizationId, tenantId })` in `packages/shared` (server) and a `useDisplayProfile()` hook (client) fed by the root layout, following the same seam the i18n provider uses. Fallback order: profile row, then the existing env pins, then Intl defaults for the UI language. Existing tenants get an `eu` row on upgrade that reproduces today's behavior exactly (dual net gross, metric, A4, Monday, line_first) so nothing changes until an admin switches.

Admin: a settings page under the two level settings sidebar, "Market display", editing the one row with a live preview (date, time, amount, address, phone, length, weight). Feature `markets.manage`. Commands with undo. The existing `AddressFormatSettings` page redirects here.

### 3.2 Seeded reference data

- `subdivision` (module `markets`): country_code, code, name, type (state, district, territory). US seed: 50 states, DC, PR, GU, VI, AS, MP. Read only, organization independent, exposed as a dictionary like list for selects.
- `en-US` overlay dictionary (D10): address labels (ZIP code, State, Apt, suite, unit), "Sales tax", "Tax code", and the seven spellings: canceled, organization, catalog, behavior, color, fulfill, customize. Everything else falls through to `en`.
- `unit` dictionary: no new codes needed for the demo (`lb, oz, in, ft` exist); add `mi` and `yd` only if trivial.

### 3.3 Shared formatting layer

In `packages/shared/src/lib/display/` (server safe) and re-exported through `packages/ui`:
- `formatMoney(amount, currencyCode, profile)`: symbol first, two decimals, negative style, `currency_display`.
- `formatDate`, `formatDateTime`, `formatTime`, `formatDateRange` with profile patterns and `time_zone`; `formatDisplayDate` and `formatDisplayDateTime` become thin wrappers so the 5 existing consumers keep working.
- `formatAddress(address, profile)` returning lines and a one line string; `us` layout prints `recipient, company, line1, line2, CITY ST 12345-6789, country only when not the default`.
- `formatPhone(e164, profile)` national display; `normalizePhoneInput(value, profile)` prepends the default dial code so US local input validates.
- `formatLength(valueInBaseUnit, profile)` with feet and inches, `formatWeight`, `convertUnit(value, from, to)` for mass and length only, using factors declared in a small static table for `kg, g, lb, oz, m, cm, mm, in, ft, yd`.
- `weekStartsOn(profile)`, `hourCycle(profile)` helpers for calendars and pickers.
- `paperSize(profile)` for PDF renderers.

### 3.4 Price presentation and tax display fields

Under `single_price_plus_tax`: catalog product and variant price inputs show one "Price" field (the net amount) and hide the gross field and the "including tax" wording; price kind display modes gain a third value `tax-at-checkout` whose gross equals net; document line tables show Unit price, Quantity, Total; document totals show Subtotal, Shipping, Sales tax, Total; every "(net)" and "(gross)" label switches to the neutral key. Under `dual_net_gross` nothing changes.

Additive fields, all nullable, displayed but never computed here:
- `CatalogProduct`, `CatalogProductVariant`: `tax_code` (text, provider tax code), `is_taxable` (boolean default true).
- `CustomerEntity` (or company profile, spec decides): `is_tax_exempt` (boolean), `exemption_certificate_number` (text, encrypted), `entity_use_code` (text).
- `SalesQuote`, `SalesOrder`, `SalesInvoice`, `SalesCreditMemo`: `tax_status` (select estimated, calculated, exempt), `tax_breakdown` (jsonb with a zod schema: jurisdiction name, type, rate, taxable_amount, tax_amount), `tax_provider_key` (text), `tax_calculated_at` (datetime). The existing `tax_total_amount` stays the displayed amount.
- `TaxCalculator` DI interface in `sales`: `calculate({ lines, ship_to, customer }) -> { tax_total_amount, tax_status, tax_breakdown, provider_key }`; default `StubTaxCalculator` returns zero and `estimated`, or zero and `exempt` when the customer is exempt. Called by the document totals path when the profile is `single_price_plus_tax`, so the tax line renders on every document, the public quote page, emails and PDFs.

### 3.5 Address input under `us` layout

`AddressEditor` (both twins, or collapsed into one; spec decides) reads the profile: labels from the profile keys, `region` becomes a select over the subdivision list when `subdivision_required`, `postal_code` validated by `postal_code_pattern`, building and flat number fields hidden, country defaults to `default_country_code`, phone field normalizes with the default dial code. Zod validators on customers, sales and WMS address inputs gain the same rules when the profile says so. Shipment wizard placeholders and hints read the profile. Print format per 3.3.

### 3.6 Units under `us_customary`

Product and variant weight and dimension inputs validate the unit code against the `unit` dictionary, default to the profile units, and display with the helpers. Shipment wizard `PackageEditor` shows pounds and inches and converts to the adapter's kg and cm on submit; flat rate tier labels read the profile unit. The "EU unit price presentation" toggle label becomes "Unit price presentation" and the reference unit list gains `lb, oz, fl_oz, ft2` (five call sites: `catalog/data/validators.ts:124`, `sales/data/validators.ts:372`, `sales/lib/makeSalesLineRoute.ts:95`, `catalog/components/products/ProductUomSection.tsx:54`, `unitCodes.ts`).

### 3.7 Paper

Documents renderer reads `paperSize(profile)` into the CSS `@page` rule and the puppeteer format; staff timesheet PDF reads page dimensions from the same helper.

### 3.8 Exports and emails

`serializeExport` takes the profile: dates in `date_format`, amounts through `formatMoney`, negatives per `negative_style`. Email templates on the happy path receive a preformatted view model built server side with the profile.

---

## 4. Rules and invariants

1. Exactly one active profile per organization; new organizations get the `eu` row unless onboarding picks a market.
2. Stored values never change with the profile: UTC datetimes, numeric amounts with currency code, E.164 phones, unit codes with numeric values, the `region` text.
3. Every helper is pure given a profile; no helper reads env or global locale internally except through the fallback chain in `resolveDisplayProfile`.
4. Under `single_price_plus_tax` a document without a `tax_status` renders the tax line as `0.00` with the note and `estimated`; conversion from quote to order copies the tax fields unchanged.
5. `us` layout requires `region` to be a code from the subdivision list and `postal_code` to match the pattern at validation time; legacy rows that fail render with a warning badge, never an error, and stay editable.
6. Week start and hour cycle come from the profile in every calendar, picker, grid and agenda in wave 1; the two Monday constants and the four hour12 constants are removed.
7. The `en-US` overlay changes only the keys listed; `en` keeps its current spellings for other tenants.

---

## 5. Migration manifest

### 5.1 Wave 1: hackathon happy path (must ship in this spec's first phases)

| Surface | Files | What changes |
|---|---|---|
| Sales document detail, items, line dialog, totals, addresses, payments, returns, draft lines, documents table | `sales/backend/sales/documents/[id]/page.tsx`, `sales/components/documents/{ItemsSection,LineItemDialog,ReturnsSection,SalesOrderDraftLines,SalesDocumentsTable,SalesDocumentForm,PaymentsSection,AddressesSection,lineItemUtils,PriceWithCurrency}.tsx` | money and dates through helpers, price presentation switch, tax line, US address print |
| Public quote page | `sales/frontend/quote/[token]/page.tsx` | dates, money, address, tax line, single price |
| Quote emails | `sales/emails/QuoteSentEmail.tsx`, `QuoteAcceptedAdminEmail.tsx` | preformatted view model |
| Catalog product and variant forms, prices table | `catalog/backend/catalog/products/{create,[id]}/page.tsx`, `catalog/components/products/VariantBuilder.tsx`, `ProductUomSection.tsx`, price kind settings | single price field, unit placeholders and validation, tax code and taxable fields, `tax-at-checkout` mode |
| Tax rates settings wording | `sales/components/TaxRatesSettings.tsx`, `sales/i18n/en.json` | "Tax rates" not "VAT classes"; US seed adds no rate rows |
| Customers people and companies detail and lists | `customers/backend/customers/{people,companies,deals}/page.tsx`, `customers/components/AddressEditor.tsx`, `AddressTiles.tsx`, `detail/AddressesSection.tsx`, `utils/addressFormat.tsx`, `components/detail/{CompanyCard,DealDetailHeader,utils}.tsx`, `formConfig.tsx` (phone) | US address layout, state select, ZIP, phone, money, dates, tax exempt fields on company |
| UI twins | `packages/ui/src/backend/detail/{AddressEditor,AddressTiles,AddressesSection,addressFormat}.tsx`, `packages/ui/src/utils/format.ts`, `packages/ui/src/primitives/{date-format,date-picker,date-range-picker,time-picker,calendar}.tsx`, `packages/ui/src/backend/date-range/dateRanges.ts`, `packages/ui/src/backend/schedule/{ScheduleGrid,ScheduleAgenda,ScheduleCalendar}.tsx`, `packages/ui/src/backend/DataTable.tsx`, `FilterOverlay.tsx`, `detail/InlineEditors.tsx` | helpers, week start, hour cycle, patterns |
| CRM calendar | `customers/lib/calendar/range.ts`, `customers/components/calendar/{MonthGrid,AgendaList}.tsx`, `customers/api/interactions/conflicts/route.ts` | week start, patterns, hour cycle |
| Documents PDF | `packages/documents/.../lib/{pdfHtml,pdfRenderer}.ts` | paper size |
| Shipment wizard | `shipping_carriers/lib/shipment-wizard/components/{AddressFields,PackageEditor}.tsx` | placeholders, hints, pounds and inches with conversion |
| Sales channel and WMS warehouse address forms | `sales/backend/sales/channels/[channelId]/edit/page.tsx`, WMS warehouse form | shared editor picks up the layout |
| Portal pages on the path | `portal/frontend/[orgSlug]/portal/profile/page.tsx` | dates |
| CSV export | `packages/shared/src/lib/crud/exporters.ts` | profile dates and amounts |
| Onboarding | market selection step writing the profile | one select, US or EU |

### 5.2 Wave 2: long tail (manifest plus lint rule, may land after the hackathon)

The remaining 179 `toLocale*` sites, 55 `date-fns`/`Intl.DateTimeFormat` sites and 30 local money formatters listed in section 2 items 2, 3, 11, by module. Add an ESLint rule in `eslint-plugin-ds` (`no-bespoke-display-format`) flagging `toLocaleDateString`, `toLocaleString`, `toLocaleTimeString`, `Intl.NumberFormat(...currency...)` and `format(date, '...')` outside `packages/shared/src/lib/display`, as a warning first. Include: checkout pay page and transactions, warranty claims backend and portal, workflows work inbox and portal tasks, staff pages and timesheet PDF, dashboards formatters, eudr, inbox_ops, data_sync, integrations, payment_gateways, push_notifications, devices, api_keys, directory, currencies pages, messages public view, notification and payment emails, design system gallery copy (PLN budgets), IANA hint text, the 9 `toFixed()` sites.

---

## 6. Acceptance for the hackathon

On a tenant with the US profile: a sales quote for a Texas facility shows `$48,250.00`, "Sales tax (estimated) $0.00" with the note, "Valid until 10/18/2026", ship to `Ridgeview Collision, 1200 Industrial Blvd, Suite 4, PLANO TX 75074-2210`, phone `(214) 555-0100`, a product weight `1,240 lb` and height `27 ft 6 in`, the same on the public quote page and in the quote email, and a Letter PDF; the CRM calendar and the dashboard "this week" preset start on Sunday; the time picker and schedule grid show `3:45 PM`; a Polish tenant on the same instance is unchanged.

---

## 7. Related pending specs (extend, do not duplicate)

- `.ai/specs/2026-05-18-date-locale-settings.md`: this spec delivers its phases 3 to 5 through the profile entity instead of a settings contract; record that in its changelog.
- `.ai/specs/2026-08-10-address-contact-and-tax-fields.md`: `phone`, `taxId`, `taxIdType` on addresses are done; this spec adds the `us` layout and subdivision validation it deferred, and adds `us_ein` to the tax id type vocabulary.
- `.ai/specs/2026-09-03-extensible-locale-set.md`: the `en-US` overlay uses its registry; state how region subtags are handled (D10).
- `.ai/specs/2026-06-11-catalog-compliance-and-commercial-product-fields.md`: `tax_classification_code` stays as the Polish field; the new `tax_code` is the provider code.
- `SPEC-034` units of measure: no dimension engine here; only validation, defaults and display helpers.

---

## 8. Open questions the spec author must answer (not the owner)

1. Collapse the customers and ui address twins into one module now, or edit in parallel with a shared helper. Recommend collapsing into `packages/ui` and re-exporting from customers.
2. `is_tax_exempt` and related fields on `CustomerEntity` or on `CustomerCompanyProfile` and person profile.
3. Whether `tax-at-checkout` is a new price kind display mode or a derived presentation of `excluding-tax`.
4. Whether the profile is cached (DI cache, tenant scoped tags) and how the client hook receives it (root layout seam like i18n).
