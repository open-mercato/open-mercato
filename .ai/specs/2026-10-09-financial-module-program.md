# Financial module program (Saudi-first)

**Status:** Specification (program). Phase 1 detailed in
[`2026-10-09-financial-phase-1-general-ledger.md`](2026-10-09-financial-phase-1-general-ledger.md);
the first country plugin in
[`2026-10-09-financial-saudi-plugin.md`](2026-10-09-financial-saudi-plugin.md).
**Supersedes intent of:** [`SPEC-024-2026-02-11-financial-module.md`](SPEC-024-2026-02-11-financial-module.md)
(kept as the architectural reference; this program is the buildable re-cut of it).
**Modules:** `financial` (new, core) + `saudi_localization` (existing, app-local plugin host)

## TLDR

`SPEC-024` describes a three-layer financial module (Core Engine → localization
contracts → country plugins) but specifies **no Saudi plugin** and sequences Poland
first (`months 4-6`). This app serves Arabic with RTL, and already owns KSA
compliance in `saudi_localization` (ZATCA Phase 1 QR, 15% VAT + halala rounding,
seller VAT settings, UBL/hash/ICV Phase-2 groundwork, Umm al-Qura dates). So the
program is re-cut: build the jurisdiction-neutral engine in
`packages/core/src/modules/financial`, define the contract/registry layer, and make
**Saudi Arabia the first country plugin** — implemented inside the existing
`saudi_localization` app module, which is where its primitives already live.

Each phase is its own spec + PR. Phase 1 (General Ledger) is the foundation and is
fully specified. Nothing in the engine may import a plugin; nothing in a plugin may
reach past the contracts.

## Problem Statement

1. **No financial module exists.** Not in `packages/core/src/modules`, not in
   `apps/mercato/src/modules`, and `official-modules.json` lists `available: []`.
   Sales answers "what was invoiced"; nothing answers "what does the ledger say",
   so financial statements, VAT returns and a trial balance are impossible.
2. **`SPEC-024` is a program, not a plan.** Its four phases span twelve months,
   enumerate Poland → USA → Germany/UK plugins, and never mention the Kingdom.
   "Complete the financial module" cannot mean "implement 4,550 lines of
   architecture in one change"; it means the phased build below.
3. **The KSA capabilities already exist and must not be duplicated.**
   `saudi_localization` ships the byte-exact ZATCA Phase-1 payload, the 15% rate,
   halala rounding, UBL 2.1 assembly, the hash chain and Hijri helpers. Any
   financial engine that re-implements them will drift from the compliance contract
   that is already pinned by vectors.
4. **A country plugin needs a home that is not the core.** Jurisdiction rules are an
   installation choice. Putting "Saudi" into `packages/core` would make the OSS core
   jurisdiction-specific — the exact coupling `SPEC-024` Layer 1 forbids and the
   reason `saudi_localization` is app-local.

## Proposed Solution

### Three layers, mapped onto real repo surfaces

| SPEC-024 layer | This program |
|---|---|
| Layer 1 — Core Engine | `apps/mercato/src/modules/financial/**` — GL, AP, AR, Bank, multi-currency, reporting. Jurisdiction-neutral, no country import. |
| Layer 2 — Type contracts | `packages/core/src/modules/financial/lib/contracts/**` (types) + `financial/lib/registries.ts` (hook registries). |
| Layer 3 — Country plugins | `apps/mercato/src/modules/saudi_localization/**` implements and registers the KSA plugin. |

### Why Saudi lives in `saudi_localization` (and not a new package)

`saudi_localization` already owns every KSA-specific primitive, its ACL, its i18n
(in six locales) and its tests. The plugin is a **thin adapter**: it maps those
primitives onto the Layer-2 contracts and registers them. A separate package would
either duplicate them or import across an app/package boundary for no benefit.
Country plugins are selected per legal entity by country code, so the plugin set is
a deployment concern — the app module is the correct scope.

### Where the core engine ships (decision, 2026-10-09)

The engine is implemented **app-local** in `apps/mercato/src/modules/financial` for
now, beside the plugin it serves: `packages/core` module scaffolding depends on the
generated entity/route registries (`#generated/*`) that only the full `yarn generate`
+ package-build pipeline produces, and this is the Saudi-first installation that needs
the ledger today. The module is written jurisdiction-neutral with package-level
imports and no app coupling, so promoting it to
`packages/core/src/modules/financial` later is a relocation, not a rewrite — the
contracts, registry and rules in `lib/` move unchanged.

### Registry design (mirrors the shipped hook registries)

The registry follows `registerCatalogPricingResolver`
(`packages/core/src/modules/catalog/lib/pricing.ts`) and
`registerSalesLineCalculator`/`registerSalesTotalsCalculator`
(`packages/core/src/modules/sales/lib/calculations.ts`) — the in-repo precedents for
"core asks, extension answers, with a default":

```ts
// packages/core/src/modules/financial/lib/registries.ts
export type FinancialCountryPlugin = {
  countryCode: string                         // ISO 3166-1 alpha-2, upper-case, e.g. 'SA'
  tax: TaxEngineContract
  invoice: InvoiceFormatContract
  numberFormat: NumberFormatContract
  fiscalCalendar: FiscalCalendarContract
  chartOfAccounts?: ChartOfAccountsTemplateContract
  compliance?: ComplianceCheckContract
  taxReporting?: TaxReportingContract
}

export function registerFinancialCountryPlugin(plugin: FinancialCountryPlugin, options?: { priority?: number }): void
export function resolveFinancialCountryPlugin(countryCode: string | null | undefined): FinancialCountryPlugin
export function resetFinancialCountryPlugins(): void   // tests only
```

`resolveFinancialCountryPlugin` never throws: an unknown or absent country code
returns the built-in **generic** plugin (Western digits, no e-invoicing, calendar-year
fiscal calendar, empty CoA template), so the engine runs without any plugin.
Registration is a root-module side effect (`saudi_localization/index.ts` imports it),
which is how the repo's other registries bootstrap.

### Module layout (Phase 1; later phases add siblings)

```
apps/mercato/src/modules/financial/
├── index.ts                     # metadata + features re-export
├── acl.ts                       # financial.* features
├── di.ts                        # financialService + GL services
├── setup.ts                     # default role features, default CoA seed
├── events.ts                    # createModuleEvents(...)
├── data/
│   ├── entities.ts              # GlAccount, GlJournalEntry, GlJournalLine, GlPeriod
│   └── validators.ts
├── lib/
│   ├── contracts/{tax,invoice,number-format,fiscal-calendar,coa,compliance,reporting}.ts
│   ├── registries.ts            # country-plugin registry + generic fallback
│   ├── errors.ts                # raiseFinancialError / financialMessage
│   └── glService.ts             # posting rules, period gating, trial balance
├── commands/{crud.ts,gl.ts}     # CRUD factory + post/reverse/close actions
├── api/…                        # one makeCrudRoute per entity + action routes
├── backend/…                    # pages (Phase 1: accounts, journal, periods)
├── i18n/{en,ar,de,es,ko,pl}.json
└── migrations/…
```

### Phasing

| Phase | Spec | Content | Depends on |
|---|---|---|---|
| **1** | `2026-10-09-financial-phase-1-general-ledger.md` | GL: accounts, journal entries/lines, periods, post/reverse, trial balance | — |
| **1b** | `2026-10-09-financial-saudi-plugin.md` | KSA plugin: 15% VAT, ZATCA Phase 1 QR + Phase 2 UBL/hash, Hijri, Saudi CoA, VAT return, WHT/zakat groundwork | 1 |
| **1c** | `2026-10-10-financial-cash-payments-and-opening-balances.md` | Opening balances, payment methods, cash/bank register, `payments.record`, balance sheet + income statement | 1 |
| 2 | `<date>-financial-phase-2-accounts-payable.md` | Vendors, vendor invoices, payments, three-way match | 1, 1c |
| 3 | `<date>-financial-phase-3-accounts-receivable.md` | AR invoices/credit notes, receipts, dunning, the AR view of `customers` | 1, 1c |
| 4 | `<date>-financial-phase-4-cash-and-bank.md` | Statement import, reconciliation against the 1c register | 1c |
| 5 | `<date>-financial-phase-5-multi-currency.md` | FX rates, revaluation, base-currency columns | 1 |
| 6+ | per phase | Fixed assets, budgeting, cost centres, multi-entity/consolidation, statements, payroll | as above |

Phase 2+ spec files are written when their phase starts, so each stays
implementation-accurate; this document fixes their **boundaries** now (which layer
they extend, which contracts they consume) so nothing is ambiguous in between.

## Architecture

- **Layer boundaries are import rules.** `financial/lib/contracts/**` imports only
  types. The `financial` core never imports `saudi_localization` (or any country
  module). A country plugin imports contracts plus its own module's primitives.
- **No direct ORM relations across modules.** Financial entities reference other
  modules by id only (`customer_id`, `sales_order_id`), never by ORM relation — the
  rule `wms` and `sales` already follow.
- **Tenant scoping.** Every entity carries `tenant_id` + `organization_id`; list and
  detail APIs filter by organization and never leak across tenants.
- **Optimistic locking is on.** Every user-editable entity has `updated_at`, returns
  `updatedAt`, and every mutating command enforces the command-level lock
  (`enforceCommandOptimisticLock`), including the action endpoints.
- **Immutable posted ledger.** A posted entry is never edited; corrections are
  reversing entries. Enforced in the command layer, not the UI.
- **Jurisdiction as data.** `country_code` on entities selects the plugin; money is
  never held in binary floats.

## Data Models

Phase 1 defines `gl_account`, `gl_journal_entry`, `gl_journal_line`, `gl_period`
(full DDL and zod validators in the Phase-1 spec). Later phases add `ap_*`, `ar_*`,
`bank_*`, `fx_*` tables. All follow repo conventions: UUID PKs, snake_case,
`tenant_id`/`organization_id`, `created_at`/`updated_at`, optimistic locking through
`updated_at`, and explicit FKs within the module only.

## API Contracts

- CRUD through `makeCrudRoute` (`/api/financial/accounts`, `/api/financial/journal-entries`,
  `/api/financial/periods`, …) with OpenAPI docs and `financial.*` feature guards.
- State transitions are separate action routes with command-level optimistic locks
  (`/api/financial/journal-entries/post`, `/reverse`; `/api/financial/periods/close`).
- Every mutating endpoint returns the standard 409 body on a stale `updatedAt`.
- No endpoint exposes another tenant's rows; scope always comes from the auth context.

## Integration Coverage

Per `.ai/qa/AGENTS.md`, **each phase ships its own integration tests in the same
change**, self-contained (fixtures created and deleted by the spec):

- **Phase 1:** account CRUD; a balanced entry posts and appears in the trial balance;
  an unbalanced entry is rejected; a posted entry cannot be edited; reversing an entry
  produces the mirror entry; posting into a closed period is refused; a stale
  `updatedAt` on post/reverse/close returns 409.
- **Phase 1b:** a sales order yields a ZATCA-ready tax invoice through the plugin; the
  VAT return totals match the posted tax lines; QR/UBL/hash parity with the existing
  `saudi_localization` vectors.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Plugin registry bootstraps inconsistently (module load order) | High | Core + plugin | Registry with a safe generic fallback; a bootstrap test asserts KSA resolves after `saudi_localization` registers | A plugin never imported silently yields generic behaviour; the phase integration test covers it |
| Duplicating KSA compliance instead of reusing `saudi_localization` | High | Compliance | The plugin is an adapter over the existing pinned primitives; no new QR/UBL/hash code | — |
| Money math drifting from ZATCA halala arithmetic | High | GL + tax | Decimal columns + integer-minor-unit helpers from `saudi_localization/lib/saudi/vat.ts`; property tests | — |
| Engine becoming jurisdiction-aware by accident | Medium | Architecture | Contract-only imports + a guard that `financial` core has no country import | Reviewed per PR |
| Phase sprawl (a twelve-month spec attempted at once) | Medium | Delivery | One phase per spec per PR; each phase independently shippable | Later phases may be re-cut as reality lands |

## Final Compliance Report

- New module path `@open-mercato/core/modules/financial` — **additive**; no existing
  contract surface changes. `saudi_localization` gains a new file plus a root import
  (additive; its existing exports are untouched).
- No change to existing API routes, event ids, widget spot ids, DI keys or ACL ids.
- No new production dependency is required for Phase 1.
- Migrations are additive (new tables only).

## Changelog

- **2026-10-09** — Program spec created: `financial` three-layer re-cut of SPEC-024
  with Saudi Arabia as the first country plugin; phasing fixed; Phase 1 (GL) and the
  KSA plugin split into companion specs.
- **2026-10-10** — Phase status. **Phase 1 is complete** except for applying the
  migration (`yarn db:migrate`, approval required): the four entities, the pure
  ledger rules, CRUD + action commands, the nine API routes, 18 backend pages, the
  six-locale dictionary and the declared events all ship.
  **Phase 1b is implemented except the ZATCA Phase 2 issuance flow** — see the
  companion spec's "Still open in this phase" for what remains and why nothing in the
  product claims clearance. Phase 2 (AP) is unblocked: it needs `saudi_localization`'s
  withholding catalogue and net-of-WHT arithmetic, both of which now exist.


