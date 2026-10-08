# Tax Management — Core Framework (`tax_management`)

> **Split 2026-09-28.** This document used to also carry the
> `financial_pl` half (VAT/CIT/PIT engines, mikrorachunek podatkowy,
> `generateTaxPaymentInstruction`) staged here temporarily, the same
> reason `2026-09-11-jpk-kr-pd-financial-pl.md` (SPEC-010) was
> originally staged here before its own move. Following that same
> precedent, the `financial_pl` half has now moved permanently to
> `official-modules` as its own document:
> [`SPEC-011-2026-09-16-tax-management-financial-pl.md`](https://github.com/open-mercato/official-modules/pull/55)
> (numbered provisionally — see that document's own banner for why).
> This document now covers **only** `tax_management`, the Core
> framework module: it is a genuine `open-mercato` core module and
> lives in this repo permanently, the same way `ledger`/`accounts_payable`
> do.
>
> **Merge order** (unchanged reasoning from before the split, now
> pointing only at what this half actually needs):
> 1. GL core engine (`feat/general-ledger-core-engine`, `#6340`) —
>    `ledger.postJournalEntry`/`ledger.FiscalPeriod` don't exist
>    without it.
> 2. This document merges before, or together with, the
>    `financial_pl` half (`official-modules#55`) — that document's
>    `ITaxEngine` registrations resolve against the registry this
>    document defines (Architecture → M2).
> 3. Not a hard blocker, but related: `open-mercato#6013` (GL account
>    balances) and `open-mercato#6038` (GL bulk-read) are both
>    unmerged prerequisites for `financial_pl`'s own CIT/PIT
>    calculation and VAT reconciliation (Out of scope; VAT itself is
>    computed from `financial_pl`'s VAT register, not from GL balances,
>    decided 2026-10-08) — named here because PR #6168's review
>    asked for the dependency list to be explicit, not because this
>    document's own code depends on them.

## TLDR

Adds the "Tax Management" capability SPEC-024 §10 already scoped but
nothing has built yet: a small Core framework module (`tax_management`)
that stores tax codes, maps them to GL account **roles** (not a fixed
expense/liability pair — see Architecture, B1 fix), stores calculated
tax liabilities, and posts whatever balanced journal lines a country
plugin's `ITaxEngine` computes. Follows the exact split SPEC-024 §10
already mandates ("Tax Management is almost entirely implemented
through country plugins. The Core Engine provides only the framework
for tax handling") and the same Phase 1 discipline every sibling spec
in this family uses.

## Overview

`tax_management` is a new, small `open-mercato` core module
(`packages/core/src/modules/tax_management`, alongside `ledger`,
`accounts_payable`, `posting_rules`) that gives any country plugin a
place to register tax codes, map them to ledger accounts, and drive a
period's tax liability through calculate → post → pay without
inventing its own posting/audit/undo plumbing. Its first, and for now
only, consumer is `financial_pl` (VAT/CIT/PIT for Poland,
`official-modules#55`), but the module itself has no Poland-specific
logic — a future country plugin registers against the same
`ITaxEngine`/`ITaxReporting` tokens.

## Problem Statement

The 2026-09-05 Event Storming session (facylitator Mariusz Gil, ekspert
domenowy Mateusz Duda) named a "ścieżka podatkowa" as part of period
close, distinct from anything AP/AR/GL account balances/Posting Rules
Engine cover. Two of its six steps already have a home (JPK_KR_PD is
SPEC-010); the remaining four — calculate the tax, post it as a journal
entry, compute the payment account, produce something an accountant can
actually pay — had no home. Checked and ruled out against Posting Rules
Engine (#6015, unrelated scope: zespół 4→5 cost reclassification) and
Accounts Payable Payments (vendor-transfer-specific compliance model,
no natural "invoice" concept for a tax liability); Cash & Bank
Management (#6055) explicitly disclaims being a payment-initiation
system.

`SPEC-024-2026-02-11-financial-module.md` §10 ("Tax Management")
already answered the *architectural* version of this question: split
into "10.1 Tax Framework (Core)" (tax code registry, a calculation hook
that invokes the plugin, tax amount storage, tax account mapping, a
reporting hook) and "10.2 Tax Implementation (Plugin)" (rate
management, calculation, validation, return generation, submission —
explicitly Plugin-layer). This document is the first real design
against that already-agreed split.

## Proposed Solution

`tax_management` (new, small, `open-mercato` core module, depends on
`ledger`): a `TaxCode`/`TaxCodeAccountMapping` registry an accountant
configures once, a `TaxLiabilityRecord` that stores each period's
calculated/posted/paid state per tax code, an `ITaxEngine`/`ITaxReporting`
registry (Architecture → M2 fix; not a single DI token as originally
drafted) a plugin registers implementations against, and three commands
(`calculateTaxLiability`, `postTaxLiability`, `markTaxLiabilityPaid`)
that drive a `TaxLiabilityRecord` through its lifecycle, posting
whichever balanced journal lines the registered `ITaxEngine` returns
through `ledger.postJournalEntry` — exactly the way AP/Posting Rules
Engine already do.

### Design decisions

**One `ITaxEngine.calculate()` call returns balanced journal lines, not
a bare amount — the B1 fix.** PR #6168's review found the original
design (`TaxCodeAccountMapping { expenseAccountId, liabilityAccountId }`,
`postTaxLiability` always posting `{ debit: expenseAccountId, credit:
liabilityAccountId }`) gives wrong books for 2 of the 3 taxes this
framework's first consumer needs: VAT collected is a balance-sheet
liability, never an expense (Kieso Ch.13 p.13-8's own Sales Taxes
Payable illustration credits it straight to a payable), and PIT-4
withholding is already recognized at payroll time out of Salaries and
Wages Expense (Kieso Ch.13 pp.13-10–13-11, Illustration 13.5/13.6) —
posting it again as a new expense would double-count it. Only CIT
genuinely fits an expense/liability pair. The exact worked examples for
all three (2 lines for CIT, 3 for VAT, 0 for PIT-4) live in
`financial_pl`'s own document (`official-modules#55`) — this document
only fixes the framework *contract* that must express all three
shapes:

```
interface ITaxEngineLine {
  accountRole: string        // resolved via TaxCodeAccountMapping.accountRoles[role]
  debit?: string             // decimal string; mutually exclusive with credit
  credit?: string
}

interface ITaxEngine {
  taxCode: string
  accountRoles: string[]     // static declaration — drives the settings-page UI (UI/UX)
  calculate(input: { periodId, tenantId, organizationId }): Promise<{
    amount: string
    currencyId: string
    lines: ITaxEngineLine[]  // must balance (sum debit === sum credit); may be empty
  }>
}
```

`postTaxLiability` resolves each line's `accountRole` against
`TaxCodeAccountMapping.accountRoles[taxCode]` (same reject-if-unset
posture as before, now per-role instead of per-fixed-field), verifies
the lines balance before calling `ledger.postJournalEntry` (a named
`tax_management` error is friendlier than a raw `ledger` 500 for a
plugin bug), and calls it with **whatever set of lines** the engine
returned — one, two, three, or (Edge Cases) zero.

**One `TaxCodeAccountMapping` row per tax code, generalized to named
roles.** `PostingRulesSettings`/`FixedAssetSettings` each hold a
handful of named account *fields* because each module has a small,
fixed set of account roles. Tax Management's roles are not fixed across
tax codes — VAT needs three (`vatOutputClearing`, `vatInputClearing`,
`vatPayable`), CIT needs two (`citExpense`, `citPayable`), a future
PIT-4 needs none. `TaxCodeAccountMapping.accountRoles` is therefore a
`jsonb` map (`Record<string, uuid | null>`), keyed by the registering
`ITaxEngine`'s own declared `accountRoles`, each independently nullable
and admin-configured — same "no default, reject-if-unset" posture as
`PostingRulesSettings`/`FixedAssetSettings`, applied per-role instead of
per-module. The settings page (UI/UX) renders one account picker per
role the registered engine declares, not two fixed pickers.

**A registry, not a single DI token — the M2 fix.** The original draft
resolved `ITaxEngine` from one Awilix token, which can hold only one
registration; with several tax codes (and, per SPEC-024's own table,
potentially more per country later) that breaks the moment a second
code registers. `tax_management/di.ts` instead exposes a
`taxEngineRegistry` (`register(code, engine)` / `resolve(code)`), where
`register` on an already-claimed code throws — a real conflict, not a
silent overwrite, since two plugins both claiming `VAT` for the same
tenant is a configuration bug that should fail loudly at setup time,
not resolve to whichever registered last.

**Per-tenant `TaxCode` rows are created by `financial_pl`'s own
`setup.ts` hook, at module-install time.** `registerTaxCode` (the
command) is the write path; *when* it's called for an existing tenant
that installs `financial_pl` after this module already exists is the
gap the original draft left open. `financial_pl`'s `setup.ts` declares
`defaultRoleFeatures` the way every module does, and additionally calls
`registerTaxCode` for `VAT`/`CIT`/`PIT` from its own
`setup.ts` hook (matching the real pattern `ledger/setup.ts` already
uses, calling `seedPolishAccountGroups(ctx.em, scope)` for its own
Phase 1 seeding — verified directly against that file, not the
knowledge-base's §2 entry, which discusses a related but distinct
point, illustrative-vs-tenant-specific account numbers) — this runs
once
per tenant/organization at install time, not at process-global module
load, so a tenant that installs `financial_pl` later still gets its
`TaxCode` rows created correctly. Two plugins registering the same code
for the same tenant is the `register()` conflict above, applied at the
DI-registry level (process-global, one entry per code across all
tenants — a code is either VAT-for-Poland or it isn't, tenant-specific
data lives in the `TaxCode` row, not the registry entry).

**`tax_management` never resolves `financial_pl`; `financial_pl`
resolves `tax_management`.** Unchanged from the original draft — same
one-way dependency direction as every sibling spec.

**Relation to `sales.SalesTaxRate` (the M5 fix).** `packages/core/src/modules/sales/data/entities.ts`'s
`SalesTaxRate` (`sales_tax_rates`, unique on `organizationId, tenantId,
code`) is a **transaction-level rate config** — a percentage plus
country/region/postal/city/customer-group scoping, used to compute how
much VAT to charge on one sale. `tax_management.TaxCode` is a
**period-level remittance category** (`"VAT"`, one row per tenant) with
no rate, no transaction scoping, and no FK to `SalesTaxRate` at all —
it exists to track *that a VAT liability gets calculated and remitted
each period*, not *how much VAT applies to a given line item*.
`financial_pl`'s VAT `ITaxEngine.calculate()` is the layer that nets
output VAT against purchase input VAT to produce the period's total
(Out of scope, this document; that logic lives in `official-modules#55`).
**Decided 2026-10-08:** its input is `financial_pl`'s own VAT register
(sales invoice VAT and `PurchaseVatRecord`, the same evidence the
JPK_V7 declaration is built from), not GL balances; `open-mercato#6013`
balances are used only to reconcile the register against the VAT
accounts — the two entities describe different layers of
the same overall VAT story and were never meant to overlap. SPEC-024
§10.2's "Tax calculation on transactions" is `SalesTaxRate`'s own
existing territory in `sales`, unaffected by this document.

## Architecture

- `packages/core/src/modules/tax_management/data/entities.ts` —
  `TaxCode`, `TaxCodeAccountMapping`, `TaxLiabilityRecord` (Data Model,
  below). **Moved from `packages/tax_management/...` (the M3 fix)** —
  the original draft placed this in its own top-level workspace
  package, but `tax_management` is "a genuine `open-mercato` core
  module" (this document's own words) whose only dependency (`ledger`)
  lives at `packages/core/src/modules/ledger` (`#6340`); it belongs
  beside it, the same way `accounts_payable`/`posting_rules` do, not in
  a new publishable package.
- `packages/core/src/modules/tax_management/di.ts` — the
  `taxEngineRegistry`/`ITaxReporting` registry (Design decisions, M2)
  and the module's own commands.
- `packages/core/src/modules/tax_management/commands/`:
  - `registerTaxCode` — plugin-invoked from its own `setup.ts` at
    install time (Design decisions), upserts a `TaxCode` row (idempotent
    on `(tenantId, organizationId, code)`).
  - `calculateTaxLiability(periodId, taxCode)` — resolves the
    registered `ITaxEngine` via `taxEngineRegistry.resolve(taxCode)`,
    calls `.calculate({ periodId, tenantId, organizationId })`, stores
    the result as a new `TaxLiabilityRecord` with `status: 'calculated'`.
    Rejects with a named error if no `ITaxEngine` is registered for
    that code, or if any `accountRole` the engine declares is unset in
    `TaxCodeAccountMapping`. **The M1 fix:** also sets `status:
    'superseded'` on any prior `TaxLiabilityRecord` for the same
    `(periodId, taxCode)` that is still `'calculated'` (not
    `'posted'`/`'paid'`) — a recalculation after a correction
    supersedes the stale draft rather than leaving two live
    `'calculated'` rows a caller could post either of.
  - `postTaxLiability(taxLiabilityRecordId)` — reads the
    `TaxLiabilityRecord` and resolves each of the engine's returned
    lines' `accountRole` against `TaxCodeAccountMapping.accountRoles`,
    rejects if any role is unset, verifies the lines balance, then
    calls `commandBus.execute('ledger.postJournalEntry', { input: {
    lines: resolvedLines, ... }, ctx })` — the real two-argument
    `execute(commandId, options)` signature, matching AP's
    `postVendorInvoice → ledger.postJournalEntry` precedent. **If
    `lines` is empty** (Edge Cases — PIT-4's own case, `financial_pl`'s
    document), skips the `ledger.postJournalEntry` call entirely and
    sets `status: 'posted'` with `journalEntryId: null` directly. **The
    M1 concurrency fix:** guards the `status === 'calculated'` →
    `'posted'` transition with a row lock (`SELECT ... FOR UPDATE` on
    the `TaxLiabilityRecord`, mirroring `toggleFiscalPeriodLock`'s own
    `for update` precedent in `ledger`) inside the same transaction as
    the posting call, so two concurrent `postTaxLiability` calls on the
    same record can't both pass the status check; a partial unique
    index on `(tenant_id, organization_id, period_id, tax_code) where
    status in ('posted', 'paid')` additionally guarantees only one
    non-superseded record per period/code can ever reach `'posted'`,
    the same defense-in-depth pattern `ledger`'s own partial unique
    indexes use (`financial-module-knowledge-base.md`, PR #6340 review
    n4).
  - `markTaxLiabilityPaid(taxLiabilityRecordId, paidAt,
    paymentReference)` — sets `status: 'paid'`. Called by
    `financial_pl` once an accountant confirms the transfer went
    through (Phase 1: manual confirmation), via its own route (no ACL
    check inside this command itself — the caller's route enforces
    `requireFeatures`, the same trust boundary `ledger.postJournalEntry`
    itself uses toward its own callers).
- `packages/core/src/modules/tax_management/acl.ts` / `setup.ts` —
  `tax_management.settings.manage` (configure `TaxCodeAccountMapping`),
  `tax_management.liabilities.view` (read `TaxLiabilityRecord`
  history) — the two roles this module needs in Phase 1. (No
  `.pay`/`.export` feature here — the route that calls
  `markTaxLiabilityPaid` is `financial_pl`'s own, gated by its own
  feature, per that document's API Contracts.)

## Data Model

**`TaxCode`** — `{ id, tenantId, organizationId, code (e.g. "VAT",
"CIT", "PIT"), label, registeredBy (plugin module key), createdAt,
updatedAt, deletedAt, isActive }`. Uniqueness on `(tenantId,
organizationId, code)`. **The m6 fix**: added `updatedAt`/`deletedAt`/
`isActive` — a plugin can be disabled or a code retired while
`TaxLiabilityRecord` rows still reference it; `isActive: false` stops
`calculateTaxLiability` from accepting new records for that code
without deleting the historical ones, and `deletedAt` follows this
project's universal soft-delete convention.

**`TaxCodeAccountMapping`** — `{ id, tenantId, organizationId, taxCode,
accountRoles (jsonb, Record<string, uuid | null>), updatedAt }`.
**The B1 fix**: replaces the original `liabilityAccountId`/
`expenseAccountId` pair (Design decisions explains why that pair was
wrong for 2 of 3 taxes). Every role starts unmapped (`null`) — same
"no tax-law-derived starting figure" reasoning
`financial-module-knowledge-base.md` §2 already established for
`PostingRulesSettings`/`FixedAssetSettings`. Upserted via
`updateTaxCodeAccountMapping`, gated by `tax_management.settings.manage`.

**`TaxLiabilityRecord`** — `{ id, tenantId, organizationId, periodId
(FK-id to ledger.FiscalPeriod), taxCode, amount, currencyId (FK-id to
Currency), status ('calculated' | 'superseded' | 'posted' | 'paid'),
journalEntryId (nullable FK-id to ledger.JournalEntry, set once posted
— stays `null` for a zero-line post, Edge Cases), paymentReference
(nullable, set once paid), calculatedAt, postedAt (nullable), paidAt
(nullable), updatedAt }`. **The m2 fix**: `currency` (a bare string in
the original draft) is now `currencyId: uuid`, matching
`ledger.postJournalEntry`'s own convention (#6340 validators) instead
of a free-text field that could drift from the real `Currency` table.
**The M1 fix**: added `'superseded'` status and `updatedAt` (root
`AGENTS.md`: optimistic locking default ON — this field is what makes
that possible once implemented) and the partial unique index named in
Architecture above. No new tables in `ledger` itself — `tax_management`
owns this row the same way `accounts_payable` owns `VendorInvoice`
(control-account precedent, `financial-module-knowledge-base.md` §2).

## API Contracts

`tax_management` ships no API route in Phase 1 —
`calculateTaxLiability`/`postTaxLiability`/`markTaxLiabilityPaid` are
commands invoked by `financial_pl`'s own routes/period-close flow
(`official-modules#55`), not reachable directly over HTTP, the same
"no route, no UI" posture `#6038` documents for its own Phase 1 DI
service. Phase 2 candidate: a settings page for `TaxCodeAccountMapping`
(UI/UX, below) — a UI surface, not a new query shape.

## UI/UX

Phase 1: a settings page under `tax_management` for
`TaxCodeAccountMapping` — one row per registered `TaxCode`, with one
account picker **per role the registered `ITaxEngine` declares**
(Design decisions — not a fixed two-picker layout), matching
`PostingRulesSettings`'s own settings-page-only Phase 1 UI.
`financial_pl`'s own period-close UI (payment instruction block, "Mark
as paid" button) lives in that document now (`official-modules#55`).

## Edge Cases & Failure Scenarios

- **No `TaxCodeAccountMapping` role configured for a tax code.**
  `calculateTaxLiability`/`postTaxLiability` reject with a named error
  before computing or posting anything — same reject-if-unset posture
  as `PostingRulesSettings`/`FixedAssetSettings`.
- **`calculateTaxLiability` called twice for the same period/code (the
  M1 fix — no longer just "creates a second row").** The new call
  supersedes the prior `'calculated'` record (`status: 'superseded'`)
  before creating the new one — an accountant recalculating after a
  correction sees the new record as the only live draft, and
  `postTaxLiability` on a `'superseded'` record is rejected (not "a
  caller-side mistake this module doesn't try to prevent", the original
  draft's posture, which is exactly what M1 flagged as unsafe).
- **`postTaxLiability` called on an already-`'posted'`/`'paid'`/
  `'superseded'` record.** Rejected — a `TaxLiabilityRecord` posts
  once; a correction is a new `calculateTaxLiability` + its own
  `postTaxLiability`, matching GL core engine's own "correct via a new
  entry, never edit a posted one" invariant. Guarded against a
  concurrent double-post by the row lock + partial unique index
  (Architecture, M1).
- **`ITaxEngine.calculate()` returns an empty `lines: []`.** Valid
  (PIT-4's own case, `official-modules#55`) — `postTaxLiability` sets
  `status: 'posted'`, `journalEntryId: null`, and skips the
  `ledger.postJournalEntry` call.
- **`ITaxEngine.calculate()` returns unbalanced lines.** Rejected by
  `postTaxLiability` before calling `ledger.postJournalEntry` — a named
  `tax_management` error (a plugin bug), not a raw `ledger` 500.
- **Fiscal period locked before `postTaxLiability` runs.**
  `ledger.postJournalEntry` already enforces this — this module adds
  no new bypass and relies entirely on GL core engine's existing
  `isLocked` check.

## Risks & Impact Review

### Wrong tax posted as an expense when it isn't one

**Scenario:** A country plugin (or Phase 1's own original design, per
B1) posts VAT or an already-withheld PIT liability through a hardcoded
expense account, overstating costs and, for VAT, distorting the CIT
base computed from those costs.
**Severity:** Critical.
**Affected area:** `tax_management` posting contract, all consuming
plugins' financial statements.
**Mitigation:** `ITaxEngine.calculate()`'s contract requires named
`accountRoles` and a balanced `lines[]` rather than a bare amount
(Architecture) — the shape itself no longer permits a silent
single-expense-account assumption.
**Residual risk:** Low, contingent on the country plugin's own engine
implementation being correct (this document's contract is a guard
against a *structurally* wrong design, not a guarantee that a given
`ITaxEngine` implementation computes the right roles for its tax law —
that verification belongs to the consuming plugin's own document).

### Concurrent recalculation/posting produces a doubled liability

**Scenario:** Two near-simultaneous `calculateTaxLiability` calls for
the same period/code each create a live `'calculated'` record, or two
concurrent `postTaxLiability` calls on the same record both pass the
status check, doubling the period's tax liability in the GL.
**Severity:** Major.
**Affected area:** `tax_management` command concurrency, `ledger`
posted balances.
**Mitigation:** `'superseded'` status on recalculation (Edge Cases);
row lock on the `'calculated'` → `'posted'` transition, inside the same
transaction as the `ledger.postJournalEntry` call; a partial unique
index on `(tenant_id, organization_id, period_id, tax_code) where
status in ('posted', 'paid')` as a database-level backstop
independent of the application-layer check (Architecture).
**Residual risk:** Low — the unique index makes this safe under
concurrency even if the application-layer lock is somehow bypassed,
matching the defense-in-depth pattern `ledger`'s own partial unique
indexes already use.

### Cross-module dependency surface

**Scenario:** `financial_pl` depends on both `ledger` and
`tax_management` — two hard dependencies for one plugin, each
independently a single point of failure for `financial_pl`'s
period-close flow if either's API changes.
**Severity:** Minor.
**Affected area:** `financial_pl`'s period-close flow.
**Mitigation:** Named, versioned DI token/registry contracts
(`ITaxEngine`, `taxEngineRegistry`) rather than ad-hoc cross-package
imports — the same mitigation `#6038` already applies for `ledger`.
**Residual risk:** Low.

### No automated reconciliation in Phase 1

**Scenario:** `markTaxLiabilityPaid` is a manual, trust-the-accountant
confirmation — nothing checks that the transfer actually matches the
instruction this system generated.
**Severity:** Minor.
**Affected area:** Payment confirmation accuracy.
**Mitigation:** Cash & Bank Management's bank-statement import (#6055)
is a real future reconciliation source, not built here.
**Residual risk:** Medium until #6055 ships and a reconciliation
Phase 2 is designed; accepted for Phase 1 the same way every sibling
spec in this family defers automation.

## Alternatives considered

**Fold this into Accounts Payable Payments.** Rejected — AP-payments'
entire compliance model (VAT whitelist, MPP) is vendor-transfer-specific
and doesn't apply to a tax remittance, and its domain model has no
natural "invoice" for a tax liability.

**Fold this into Posting Rules Engine.** Rejected — confirmed by
reading that document in full (1453 lines): its scope is exclusively
zespół 4→5 cost reclassification through account 490, with zero
mention of tax payments anywhere in the text.

**A single fixed `expenseAccountId`/`liabilityAccountId` pair (the
original design).** Rejected after PR #6168's review (B1) — see Design
decisions; doesn't fit VAT or PIT-4.

## Out of scope

- **Tax calculation logic itself** (how much VAT/CIT/PIT is actually
  owed, and each tax's exact posting-line shape). `ITaxEngine.calculate`'s
  real implementation is `financial_pl` application logic
  (`official-modules#55`) — not designed in this document, which only
  defines the contract shape. **Input source, decided 2026-10-08:** the
  VAT engine reads `financial_pl`'s VAT register (the evidence the
  JPK_V7 declaration is built from) and posts only the settlement
  through this module; the CIT and PIT engines read GL account balances
  (#6013), because those taxes derive from the books. GL balances also
  feed a reconciliation of the VAT register against the VAT accounts
  (differences are reported, not corrected).
- **The mikrorachunek podatkowy payment instruction** and its checksum
  algorithm — Poland-specific, `official-modules#55`.
- **ZUS** (social security contributions) — structurally different (an
  employer-social-insurance liability, not an income/consumption tax),
  a real future `TaxCode`, not designed here.
- **Automated bank-rail payment execution.**
- **Any tax type for any country other than Poland** — this framework
  is country-agnostic by construction (SPEC-024 §10); its only concrete
  consumer today is `financial_pl` (`official-modules#55`).
- **JPK_KR_PD / JPK_V7 report generation.** Already SPEC-010 and
  existing `financial_pl` capability respectively.

## Implementation Plan

1. `tax_management`: entities (`TaxCode`, `TaxCodeAccountMapping` with
   `accountRoles` jsonb, `TaxLiabilityRecord` with `currencyId`/
   `superseded` status/`updatedAt`) + migration, under
   `packages/core/src/modules/tax_management` (M3).
2. `tax_management`: `taxEngineRegistry`/`ITaxReporting` registry (M2) +
   `registerTaxCode`, `calculateTaxLiability` (with supersede logic),
   `postTaxLiability` (with role resolution, balance check, row lock,
   empty-lines handling), `markTaxLiabilityPaid` commands.
3. `tax_management`: partial unique index on
   `(tenant_id, organization_id, period_id, tax_code) where status in
   ('posted', 'paid')`.
4. `tax_management`: ACL (`tax_management.settings.manage`,
   `tax_management.liabilities.view`) + settings page for
   `TaxCodeAccountMapping` (role-driven picker layout).
5. Integration tests: cross-module resolution (`financial_pl` →
   `tax_management` → `ledger`, once `official-modules#55` exists),
   tenant-isolation on `TaxLiabilityRecord`, concurrent-post race
   (mirroring `ledger`'s own concurrent-import test pattern, PR #6137
   review m1), empty-lines post path.
6. Record this document's findings in
   `financial-module-knowledge-base.md` §3/§1
   ([`open-mercato#6016`](https://github.com/open-mercato/open-mercato/pull/6016) —
   **the M6 citation-link fix**: this file lives on its own
   `docs/financial-module-knowledge-base` branch, not on `develop`,
   which is why `git ls-files` at this document's own head/`main`
   doesn't find it), and add the one-line forward-pointer to
   `2026-08-18-general-ledger-core-engine.md`'s Out of scope (matching
   the pointer already added for `#6038` and `#6137`).

## File Manifest

| File | Action | Notes |
|---|---|---|
| `packages/core/src/modules/tax_management/data/entities.ts` | Create | `TaxCode`, `TaxCodeAccountMapping` (`accountRoles` jsonb), `TaxLiabilityRecord` (`currencyId`, `superseded` status) |
| `packages/core/src/modules/tax_management/di.ts` | Create | `taxEngineRegistry`/`ITaxReporting` registry + command registration |
| `packages/core/src/modules/tax_management/commands/*.ts` | Create | `registerTaxCode`, `calculateTaxLiability`, `postTaxLiability`, `markTaxLiabilityPaid` |
| `packages/core/src/modules/tax_management/acl.ts` / `setup.ts` | Create | Two features, settings-page seed |
| `packages/core/src/modules/tax_management/backend/settings/page.tsx` | Create | `TaxCodeAccountMapping` settings page, role-driven pickers |
| `packages/core/src/modules/tax_management/__integration__/tax-management.spec.ts` | Create | Cross-module resolution, tenant isolation, concurrent-post race |

`financial_pl`'s own files (mikrorachunek, VAT/CIT/PIT engines,
`generateTaxPaymentInstruction`) are listed in
`official-modules#55`'s own File Manifest — not repeated here (the M3
fix also resolves this: the original draft's manifest mixed files from
both target repos in one table without saying so).

## Literature & Prior Art

**Step 1 — cross-spec consistency.** Re-checked
`financial-module-knowledge-base.md` §2 — this document reuses every
established convention rather than inventing an equivalent. Read
`2026-09-06-posting-rules-engine.md` in full (1453 lines) and confirmed
zero relation to tax payments. Read `2026-09-06-accounts-payable-payments.md`
and `2026-09-10-cash-bank-management.md` and confirmed both are
ruled-out alternatives (Alternatives considered). Read
`SPEC-024-2026-02-11-financial-module.md` §10 in full — the source of
this document's Core/Plugin split.

**Step 2 — literature grounding.**
- **Kieso, *Intermediate Accounting*, 17th Ed., Ch.13 "Current
  Liabilities and Contingencies," p.13-8** — grounds this document's
  `calculate → post → pay` shape and its `TaxLiabilityRecord`
  current-liability framing. The B1 fix's own worked examples (which
  tax posts as an expense vs. a pure balance-sheet reclass) live in
  `financial_pl`'s document (`official-modules#55`), which cites this
  same page plus pp.13-10–13-11 directly.
- **Fowler's *Analysis Patterns* / Hay's *Data Model Patterns*** —
  already confirmed near-empty for tax content
  (`financial-module-knowledge-base.md` §3): Hay's only 3 "tax" hits
  are an unrelated "Federal tax ID" example attribute; Fowler's Ch.6
  has zero occurrences.

**Step 3 — real-system comparison.** ERPNext, Odoo, and GnuCash all
model a tax liability as a normal current-liability account settled by
a normal payment — none has anything resembling a country-specific
account-role registry, because none needs to support an arbitrary
country plugin the way this Core framework does; a genuine,
explainable divergence driven by this project's own plugin
architecture, not a gap in those systems.

## Final Compliance Report

**Verdict: Not ready for implementation, pending a second maintainer
pass.** This revision resolves PR #6168's Blocker (B1, posting-shape
redesign) and all six Majors (M1 concurrency, M2 registry, M3 package
placement, M4 — resolved by the split, since the vague-ACL route now
lives entirely in `official-modules#55` and this document ships no
route at all, M5 `SalesTaxRate` relation, M6 missing sections/citation
link/dependency list) and the applicable Minors (m2 currency, m6
`TaxCode` base fields — m1/m3/m4/m5 apply to `financial_pl`'s own
document, not this one). Not independently re-verified against a real
implementation yet (none exists) — the next step is a maintainer review
of this redesign, then implementation per the plan above.

## Changelog

### 2026-09-16 — Initial draft

First draft, written after the Compliance & Audit Phase 2 work
surfaced that the earlier informal "Tax Management → Posting Rules
Engine" pairing was a mismatch. Combined `tax_management` + `financial_pl`
in one document at this stage (Design decisions, mikrorachunek
KIS-integration correction, primary-source verification passes — full
history preserved in `official-modules#55`'s own Changelog, since that
history belongs to the half that moved).

### 2026-09-18 (cont. — SPEC-010 moved to official-modules, references updated)

Banner/citation update only — SPEC-010 itself moved; this document's
own scope was unaffected at the time.

### 2026-09-28 — PR #6168 review resolved; `financial_pl` split to `official-modules`

Automated review (`om-auto-review-pr`) on PR #6168 found one Blocker,
six Majors, six Minors, a direction question, and a nit. Addressed in
this pass:

- **B1 (Blocker)**: `ITaxEngine.calculate()` now returns role-keyed
  balanced `lines[]`; `TaxCodeAccountMapping` generalized from a fixed
  expense/liability pair to a `accountRoles` map (Architecture, Data
  Model). Verified against Kieso Ch.13 p.13-8 (new citation for this
  framework document) — VAT/CIT/PIT-specific worked examples live in
  `official-modules#55`.
- **M1**: `'superseded'` status, `updatedAt`, row lock, partial unique
  index (Architecture, Edge Cases, Risks).
- **M2**: `taxEngineRegistry` replacing the single DI token; per-tenant
  `TaxCode` creation moved to `financial_pl`'s own `setup.ts` install
  hook (Design decisions).
- **M3**: module moved from `packages/tax_management/...` to
  `packages/core/src/modules/tax_management/...`.
- **M4**: resolved by the split — the vague-ACL payment-instruction
  route no longer exists in this document at all.
- **M5**: added an explicit `SalesTaxRate` vs. `TaxCode` relation
  paragraph (Design decisions).
- **M6**: added this Overview and Final Compliance Report section,
  reformatted Risks & Impact Review into the required
  Scenario/Severity/Affected area/Mitigation/Residual-risk format,
  fixed the `financial-module-knowledge-base.md` citation to link
  `open-mercato#6016` (its actual branch/PR) instead of a bare
  filename, and made the merge-order dependency list explicit (banner).
- **m2**: `TaxLiabilityRecord.currency` (string) → `currencyId` (uuid).
- **m6**: `TaxCode` gained `updatedAt`/`deletedAt`/`isActive`.
- **Nit**: trimmed research-process narration from Problem Statement
  into Literature & Prior Art, matching this pass's shorter prose.
- **`financial_pl` split**: at the user's explicit direction, following
  the SPEC-010 precedent, the entire `financial_pl` half (mikrorachunek,
  VAT/CIT/PIT engines, `generateTaxPaymentInstruction`, m1/m3/m4/m5)
  moved to `official-modules#55` as its own document. That document's
  own Changelog covers its own fixes.

### 2026-09-28 (cont. — citation fix)

Design decisions' `registerTaxCode`/`setup.ts` claim cited
`financial-module-knowledge-base.md` §2, which actually discusses a
related but distinct point. Corrected to cite the real
`ledger/setup.ts` code (`seedPolishAccountGroups(ctx.em, scope)`)
directly. Substance unchanged; citation only.

Not yet re-reviewed by a maintainer under this revision.

### 2026-10-08 — source of the VAT engine's input

- **Why.** This document (Out of scope, `SalesTaxRate` relation, merge-order
  note) said the VAT engine reads GL account balances. The JPK_V7
  declaration is built from the VAT register (sales invoice VAT and
  `PurchaseVatRecord`, with KSeF number, markings, transaction class, GTU
  codes, fixed-asset VAT and self-assessment), fields the GL does not
  carry; and the existing `financial_pl` code computes the declaration
  from register rows and operator inputs. `2026-09-06-accounts-payable.md`
  already cites the same separation in Comarch Optima (VAT register
  first, a separate "Księguj" step into the books), and
  `2026-08-18-sales-invoice-gl-posting.md` says the same for sales:
  output VAT loses its per-rate breakdown in the GL posting, so a
  JPK_V7 process must read `sales.SalesInvoiceLine` directly.
- **Decision (working, pending maintainer review).** VAT: register in,
  settlement posted through `tax_management`; CIT/PIT: GL balances in.
  GL balances (#6013) reconcile the VAT register. Three sentences edited;
  no change to the `ITaxEngine` contract, `TaxCode`, mappings,
  `TaxLiabilityRecord` or the commands.
- **Not changed here.** Which module id hosts the Poland engines
  (`financial_pl` or a GL-dependent sibling) is still open and tracked
  outside this document.

