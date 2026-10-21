# Financial module — Phase 1b: the Saudi Arabia country plugin

**Status:** Specification (buildable after Phase 1)
**Program:** [`2026-10-09-financial-module-program.md`](2026-10-09-financial-module-program.md)
**Depends on:** [`2026-10-09-financial-phase-1-general-ledger.md`](2026-10-09-financial-phase-1-general-ledger.md)
**Host module:** `apps/mercato/src/modules/saudi_localization` (existing)

## TLDR

This is the first Layer-3 country plugin, and it covers everything the Kingdom
requires of a financial system: **15% VAT** (plus zero-rated/exempt/out-of-scope),
**ZATCA e-invoicing** (Phase 1 QR — already built — and Phase 2 UBL 2.1 with the hash
chain, ICV/PIH sequencing, clearance vs reporting), a **VAT return** for the ZATCA
filing period, **withholding tax** on payments to non-residents, **zakat**
groundwork, **Umm al-Qura Hijri** document dates, Saudi **number/currency
formatting**, a **Saudi chart-of-accounts template**, and **compliance checks**
(VAT number, CR number).

It adds **no new compliance logic**: `saudi_localization` already ships the
byte-exact Phase-1 payload, the 15% rate, halala rounding, UBL assembly, the hash
chain and Hijri helpers, all pinned by vectors. The plugin is a **thin adapter** that
implements the `financial` Layer-2 contracts by delegating to those primitives and
registering itself in the country-plugin registry.

## Problem Statement

1. **The engine must stay jurisdiction-neutral**, but a Saudi tenant needs Saudi rules
   on every invoice, posting and report. The contract layer is the seam.
2. **Re-implementing KSA rules is the failure mode to avoid.** `saudi_localization`'s
   QR/UBL/hash are pinned to published ZATCA vectors; a second implementation will
   drift and a drifted e-invoice is a rejected e-invoice.
3. **VAT is not just a rate.** The return needs tax lines classified by category
   (`S`/`Z`/`E`/`O`), a filing period, and totals that reconcile to the ledger.
4. **The Kingdom taxes more than VAT.** Non-resident service payments carry
   withholding tax, and Saudi/GCC-owned entities file zakat — both are "parts which
   match the Saudi market" and neither exists today.

## Proposed Solution

### Plugin shape and registration

New files in the existing module (nothing moved, nothing renamed):

```
apps/mercato/src/modules/saudi_localization/
├── financial-plugin.ts          # builds + registers the FinancialCountryPlugin for 'SA'
├── lib/saudi/coa.ts             # Saudi chart-of-accounts template
├── lib/saudi/tax-codes.ts       # S/Z/E/O catalogue mapped to GL accounts
├── lib/saudi/vat-return.ts      # period return from posted tax lines
├── lib/saudi/withholding.ts     # WHT categories, rates, net-of-WHT payment math
├── lib/saudi/zakat.ts           # zakat base + filing groundwork
└── index.ts                     # + `import './financial-plugin'` (side-effect register)
```

`financial-plugin.ts` implements the registry contract and is imported for its side
effect from `index.ts`, the same bootstrap the repo's other registries use:

```ts
import { registerFinancialCountryPlugin } from '@open-mercato/core/modules/financial/lib/registries'
registerFinancialCountryPlugin({
  countryCode: 'SA',
  tax: saudiTaxEngine,
  invoice: saudiInvoiceFormat,
  numberFormat: saudiNumberFormat,
  fiscalCalendar: saudiFiscalCalendar,
  chartOfAccounts: saudiChartOfAccounts,
  compliance: saudiCompliance,
  taxReporting: saudiTaxReporting,
})
```

### Capability → existing primitive (no duplication)

| Contract | KSA capability | Delegates to |
|---|---|---|
| `TaxEngineContract` | 15% standard; 0% zero-rated; exempt; out-of-scope; halala rounding | `lib/saudi/vat.ts` (`SAUDI_STANDARD_VAT_RATE`, `roundToHalalas`, `formatSaudDecimal`) |
| `InvoiceFormatContract` | Phase 1 QR payload; Phase 2 UBL 2.1 + hash + ICV/PIH; document kinds/subtypes | `lib/zatca/qr.ts`, `lib/zatca/ubl.ts`, `lib/zatca/hash.ts`, `lib/zatca/chain.ts`, `lib/zatca/order-invoice.ts` |
| `NumberFormatContract` | Western digits, two decimals, SAR, no grouping in machine output | `formatSaudDecimal` (display uses the app locale formatters) |
| `FiscalCalendarContract` | Gregorian fiscal year; Hijri labels on documents | `lib/saudi/hijri.ts` |
| `ChartOfAccountsTemplateContract` | Saudi CoA (new) | `lib/saudi/coa.ts` |
| `ComplianceCheckContract` | VAT number (`^3\d{13}3$`), CR number, e-invoice prerequisites | `isValidSaudiVatNumber`, `vat-settings.ts` |
| `TaxReportingContract` | VAT return; WHT summary; zakat base | `lib/saudi/vat-return.ts`, `lib/saudi/withholding.ts`, `lib/saudi/zakat.ts` |

### Tax codes and the accounts they post to

Saudi VAT is expressed as a **tax-code catalogue** (`lib/saudi/tax-codes.ts`), each
code carrying its ZATCA category and a **GL account pair** so posting is mechanical:

| Code | Category | Rate | Sales side | Purchase side |
|---|---|---|---|---|
| `SA-VAT-S` | Standard (`S`) | 15% | output VAT payable | input VAT receivable |
| `SA-VAT-Z` | Zero-rated (`Z`) | 0% | — | — |
| `SA-VAT-E` | Exempt (`E`) | 0% | — | — |
| `SA-VAT-O` | Out of scope (`O`) | 0% | — | — |
| `SA-WHT-*` | Withholding (see below) | per category | — | WHT payable |

A journal line carries `tax_code`; the `financial` engine does not interpret it beyond
posting the amounts the plugin computed. The **category is never guessed**: a
zero-tax line is `Z`/`E` only when the source says which exemption applies (the rule
`order-invoice.ts` already documents); otherwise it is `O`, matching the existing
mapping so the ledger and the e-invoice agree.

### Saudi chart-of-accounts template

`lib/saudi/coa.ts` returns the account list `financial` seeds through
`setup.ts`/CLI for a Saudi organization: assets (cash, banks, AR, input VAT
receivable), liabilities (AP, output VAT payable, WHT payable, accruals), equity
(capital, reserves, retained earnings), revenue (domestic sales, zero-rated exports,
other income) and expenses — with the VAT/WHT accounts the tax codes reference. The
template is data, not code paths: seeding is idempotent by account `code`.

### VAT return (`lib/saudi/vat-return.ts`)

A pure function over the period's **posted** tax lines, grouped by ZATCA category:

```
buildSaudiVatReturn({ period, postedLines, taxCodes, settings })
  -> { periodId, filingPeriod, standardRated: { net, vat }, zeroRated: { net },
       exempt: { net }, outOfScope: { net }, inputVat, outputVat, netPayable,
       lineCount, generatedAt }
```

Filing period comes from `FiscalCalendarContract` (ZATCA monthly/quarterly by
turnover band, stored as tenant settings). Every figure reconciles to the GL: the
standard-rated VAT total must equal the sum of the output-VAT account movement for
the period, and the function exposes the reconciliation delta so a mismatch is
visible rather than silently rounded. The return is a **read model** — it posts
nothing; filing is a manual ZATCA-portal action today (as the invoice-preview widget
already assumes).

### Withholding tax (`lib/saudi/withholding.ts`)

Saudi WHT applies to payments to non-residents; categories carry rates (services,
royalties, rent, …). The plugin supplies the category catalogue and the
**net-of-WHT** arithmetic (gross − WHT = payable, WHT posted to `SA-WHT-*` payable),
used by the AP payment path in Phase 2. Phase 1b ships the catalogue + math + tests;
the payment command wiring lands with AP.

### Zakat (`lib/saudi/zakat.ts`)

Groundwork only, and deliberately scoped: `computeZakatBase({ equity, provisions,
fixedAssets, … })` returning the base and the applicable rate, plus the filing
period. ZATCA assesses zakat alongside the VAT/ZATCA filing; the plugin exposes the
base so a tenant can file it. Full zakat rules (additions/deductions, ownership mix)
are out of scope for Phase 1b and recorded as such below.

### ZATCA Phase 2 issuance

Phase 1b wires the existing deterministic stack into a **persistent issuance flow**:
`chain-store.ts` already supplies ICV/PIH sequencing, and `order-invoice.ts` maps a
sales order to the invoice document. The plugin adds the missing edges — invoice
kind selection (`standard` B2B clearance vs `simplified` reporting), persisting the
generated XML/hash/ICV, and a submission-status record — while **signed XAdES, CSID
onboarding and sandbox validation remain open** (unchanged from the existing module
spec). A preview path stays available for the manual Fatoora workflow.

### Dates and number format

Documents render **dual-calendar** labels (Gregorian + Hijri) through
`lib/saudi/hijri.ts`, which is display-only and pinned to `Asia/Riyadh`. Machine
values (QR, UBL, API amounts) always stay ISO-8601 / two-decimal dot, never Hijri and
never a formatted string — the invariant the QR builder already depends on.

## API, ACL and events (additive)

| Method | Path | Feature |
|---|---|---|
| GET | `/api/saudi_localization/vat-return` | `saudi_localization.vat_return.view` |
| GET | `/api/saudi_localization/withholding-tax` | `saudi_localization.withholding.view` |
| GET | `/api/saudi_localization/zakat-base` | `saudi_localization.zakat.view` |
| POST | `/api/saudi_localization/zatca/issue` | `saudi_localization.einvoicing.issue` |

New features (`acl.ts`, additive): `saudi_localization.vat_return.view`,
`saudi_localization.withholding.view`, `saudi_localization.zakat.view`,
`saudi_localization.einvoicing.issue` — each `dependsOn:
saudi_localization.settings.view`. Events: `saudi_localization.zatca.invoice.issued`,
`saudi_localization.vat_return.generated`. UI: a VAT-return screen and an e-invoicing
submission list under `/backend/saudi`, reusing the existing `zatca-invoice-preview`
widget on the sales order detail.

## Tests & Verification

**Unit:** the plugin resolves for `SA` and the generic plugin resolves for anything
else (registry bootstrap test); tax-code catalogue rates and categories match the
ZATCA vocabulary (`S`/`Z`/`E`/`O`); VAT-return totals for a hand-built set of posted
lines, including a zero-tax line landing in `O` not `Z`; the reconciliation delta is
zero when the return is built from real postings and non-zero when it is not; WHT
net-of-WHT arithmetic (gross − WHT) and rounding via `roundToHalalas`; zakat-base
arithmetic on a fixed fixture; Hijri labels are display-only and machine values stay
ISO; the CoA template is idempotent by code and every tax code references an account
the template defines.

**Parity guard:** the plugin's invoice output must equal the existing
`saudi_localization` output for the same order — asserted against the module's
existing QR/UBL/hash vectors, so the adapter cannot silently change compliance
behaviour.

## Integration Coverage

`saudi_localization/__integration__/TC-SL-FIN-001-saudi-financial-plugin.spec.ts`
(self-contained; fixtures created and removed):

1. seeding the Saudi CoA for a fresh organization creates the VAT/WHT accounts once
   and is idempotent on re-run;
2. posting a taxable sale through the sales path yields a `posted` VAT line on the
   output-VAT account;
3. `GET /api/saudi_localization/vat-return` for that period returns the standard-rated
   VAT equal to the posted output-VAT movement (reconciliation delta 0);
4. issuing an invoice persists the XML/hash/ICV and moves the chain's next ICV;
5. the issued invoice's QR/UBL equals the preview endpoint's output for the same
   order (parity, end-to-end);
6. a stale `updatedAt` on issue returns 409.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Adapter drifts from the pinned ZATCA primitives | High | Compliance | The plugin delegates; a parity test compares plugin output to the module's vectors | A future refactor of `saudi_localization` must keep the parity test green |
| Sending a real e-invoice without CSID/sandbox validation | High | Compliance | Issuance persists a `pending` submission and never calls ZATCA until CSID onboarding lands; documented as open | Live submission stays disabled until sandbox validation |
| VAT-return category misclassification (untaxed line reported as zero-rated) | High | Tax filing | Category comes from the source's stated exemption, else `O`; a test pins the rule | Source data without exemption flags reports `O` by design |
| Zakat rules over-claimed | Medium | Compliance | Phase 1b ships the base only; full rules explicitly out of scope | Tenant files with its own assessment |
| New ACL ids diverge from the existing naming | Low | RBAC | Ids follow the existing `saudi_localization.*` shape and all `dependsOn` the existing settings feature | — |

## Out of Scope (recorded, not forgotten)

Signed XAdES, CSID onboarding and ZATCA sandbox validation; live clearance/reporting
submission; full zakat rules; WHT payment wiring (lands with AP, Phase 2); Hijri as a
storage or posting calendar (display-only by design); Arabic *content* beyond the six
locales the module already ships.

## Final Compliance Report

- Additive only: new files in an existing app module, a root side-effect import, new
  routes with new `/api/<moduleId>/…` prefixes, new ACL ids, new events.
- No existing route, event id, spot id, DI key or ACL id changes; the existing
  `saudi_localization` exports and behaviour are untouched.
- No new production dependency; no DB schema change for the read models (issuance
  persistence reuses `module_configs`/the chain store unless a table proves necessary,
  which would be a Phase-1b migration reviewed for drift).
- Backward compatibility: new ids are stable once shipped; nothing is deprecated.

## Changelog

- **2026-10-20 (worker registration)** — the country-plugin registry is a
  `globalThis` singleton (`Symbol.for`). The worker/CLI bootstrap compiles the
  module registry and the command loaders as separate bundles, so a module-scoped
  map left the posting command in the worker with no registered plugin and
  event-driven postings silently lost every `tax_code`. `TC-FINANCIAL-003` now
  pins `SA-VAT-S` on the posted revenue and output-VAT lines; `TC-SL-FIN-001`
  asserts the return as a movement from a baseline so its fixed far-future period
  survives re-runs (postings are append-only and the period is unique).
- **2026-10-09** — Phase-1b spec created: KSA country plugin as a thin adapter over
  `saudi_localization` (15% VAT, ZATCA Phase 1/2 issuance, VAT return, WHT, zakat
  groundwork, Hijri, Saudi CoA, compliance checks); capability-to-primitive mapping
  and parity guard fixed.
- **2026-10-10 (Layer 2 + the plugin adapter)** — Phase 1b landed, less the
  issuance flow (below). The engine gained its contract surface and registry:
  `financial/lib/contracts/{tax,invoice,number-format,fiscal-calendar,coa,compliance,reporting}.ts`
  (types only), `financial/lib/registries.ts` (`registerFinancialCountryPlugin` /
  `resolveFinancialCountryPlugin` / `resetFinancialCountryPlugins`, with the
  **generic** `ZZ` fallback so an unknown or absent country code still runs the
  ledger), and `financial/lib/money.ts` — decimal-string half-up rounding and exact
  summation, because the halala rule has to apply to the decimal the caller wrote
  and a float round is one halala short. The adapter is
  `saudi_localization/financial-plugin.ts`, registered for its side effect from
  `index.ts`; it adds no arithmetic: `lib/saudi/tax-engine.ts`,
  `number-format.ts`, `fiscal-calendar.ts`, `e-invoicing.ts`, `compliance.ts` and
  the `vat-return.ts`/`coa.ts`/`tax-codes.ts`/`withholding.ts`/`zakat.ts` modules
  all delegate to the primitives already pinned by the module's own vectors.
  **Nine new files under `lib/saudi/`, one route group per capability.**
  Two decisions worth recording. The **taxable base is a revenue or expense line
  only** — a sale posts a receivable, a revenue line and a VAT line, and counting
  the receivable as base reported 2 150.00 of sales on a 1 000.00 invoice; the
  classifier now returns `settlement` for anything carrying the code that is
  neither a base account nor the code's own VAT account, and the VAT-return suite
  pins it. And **`standardRated.tax` is the posted output VAT, not the rate's
  implication**: filing the implied figure makes the return agree with itself by
  construction and hides the very posting `reconciliationDelta` exists to expose.
- **2026-10-10 (reporting surface)** — `GET /api/saudi_localization/vat-return`,
  `/withholding-tax` and `/zakat-base` (`saudi_localization.vat_return.view` /
  `.withholding.view` / `.zakat.view`, all `dependsOn`
  `saudi_localization.settings.view`), plus the read model they share:
  `financial/lib/ledgerQuery.ts` exposes `financialLedgerService` from DI, so the
  plugin reads the ledger without importing its entities. A return is built for
  the filing period the jurisdiction's calendar resolves — never period 1 by
  default, which would report a January return every time somebody opened the
  screen in July. `saudiVatSettings` gained `filingFrequency` (optional, defaults
  to `quarterly`), which is what the return's period defaults to.
- **2026-10-10 (screen + dictionary)** — `/backend/saudi/vat-return` (period
  picker; the four ZATCA category buckets with their bases and tax; output/input/
  net; the reconciliation delta called out as a warning when it is non-zero) and
  its `page.meta.ts`. Arabic plus the five mirrors; `yarn i18n:check-sync` green.

### Still open in this phase (recorded, not silently dropped)

- **The ZATCA Phase 2 issuance flow now persists locally.** `POST /api/saudi_localization/zatca/issue`,
  the `saudi_einvoice_submissions` record (exact XML/hash/ICV/PIH) and
  `/backend/saudi/submissions` ship. Issuance is **idempotent per sales order**:
  a retry returns the existing submission with `reused: true` rather than
  claiming a second ICV. Nothing signs or transmits — the response carries
  `signed: false` and `submittedToZatca: false`, and the row stays `pending`.
  The integration spec `TC-SL-FIN-001` now covers cases 1–5 (the stale-`updatedAt`
  case is replaced by the idempotent-retry assertion, because issuance is a
  create-once transition rather than an editable record).
- **Signed XAdES, CSID onboarding and sandbox validation** remain the gate before
  any live clearance claim.
- **WHT payment wiring** is implemented in AP (Phase 2).


