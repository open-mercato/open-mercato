# Tax Management — Core Framework (`tax_management`)

> **Split 2026-09-28; references repaired 2026-11-18.** This document
> used to also carry the `financial_pl` half (VAT/CIT/PIT engines,
> mikrorachunek podatkowy, `generateTaxPaymentInstruction`) staged here
> temporarily, following the same precedent that moved the JPK_KR_PD
> spec to its own document. That half now lives in Core as its own
> document in open PR [`#7524`](https://github.com/open-mercato/open-mercato/pull/7524)
> — `.ai/specs/2026-09-16-tax-management-financial-pl.md`. The earlier
> staging in `official-modules#55` is **closed** (that repository is
> deprecated); every live reference in this document points at `#7524`,
> and only the historical Changelog entries still name `#55`.
> This document covers **only** `tax_management`, the Core framework
> module: it is a genuine `open-mercato` core module and lives in this
> repo permanently, the same way `ledger`/`accounts_payable` do.
>
> **Merge order**
> 1. GL core engine (`feat/general-ledger-core-engine`, `#6340`) —
>    `ledger.postJournalEntry`/`ledger.reverseJournalEntry` and
>    `ledger.FiscalPeriod` do not exist without it.
> 2. This document merges before, or together with, the `financial_pl`
>    half's document in `#7524` — that document's `ITaxEngine`
>    registrations resolve against the registry this document defines
>    (Architecture → *Tax engine registry*).
> 3. Not a hard blocker, but related: `open-mercato#6013` (GL account
>    balances) and `open-mercato#6038` (GL bulk-read) are both
>    unmerged prerequisites for `financial_pl`'s own CIT/PIT
>    calculation and VAT reconciliation (Out of scope; VAT itself is
>    computed from `financial_pl`'s VAT register, not from GL balances,
>    decided 2026-10-08) — named here because PR #6168's review asked
>    for the dependency list to be explicit, not because this
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
`#7524`), but the module itself has no Poland-specific
logic — a future country plugin registers against the same
`ITaxEngine` registry.

## Problem Statement

The 2026-09-05 Event Storming session (facylitator Mariusz Gil, ekspert
domenowy) named a "ścieżka podatkowa" as part of period
close, distinct from anything AP/AR/GL account balances/Posting Rules
Engine cover. Two of its six steps already have a home (JPK_KR_PD is
the JPK_KR_PD spec); the remaining four — calculate the tax, post it as a journal
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
calculated/posted/paid state per tax code, an `ITaxEngine` registry
(Architecture → *Tax engine registry*; not a single DI token as
originally drafted) a plugin registers implementations against, three
commands (`calculateTaxLiability`, `postTaxLiability`,
`markTaxLiabilityPaid`), one settings command
(`updateTaxCodeAccountMapping`), and the three typed
`tax_management.liability.*` events
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
`financial_pl`'s own document (`#7524`) — this document
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

`calculateTaxLiability` validates the returned lines and stores them as
an immutable snapshot on the `TaxLiabilityRecord`; `postTaxLiability`
resolves each snapshot line's `accountRole` against
`TaxCodeAccountMapping.accountRoles[taxCode]` (same reject-if-unset
posture as before, now per-role instead of per-fixed-field), re-verifies
the snapshot balances and totals `amount`, then calls
`ledger.postJournalEntry` (a named `tax_management` error is friendlier
than a raw `ledger` 500 for a plugin bug) with **exactly the stored
lines** — one, two, three, or (Edge Cases) zero.

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

**A registry, not a single DI token — with an explicit registration
lifecycle (the M1 fix).** The original draft resolved `ITaxEngine` from
one Awilix token, which can hold only one registration; with several tax
codes that breaks the moment a second code registers.
`tax_management/di.ts` exposes a `taxEngineRegistry`
(`register({ code, engine, owner })` / `resolve(code)`), and this
revision pins down *when and where* registration happens, because the
previous revision named the registry but not its lifecycle:

- **Storage.** The registry lives on `globalThis` under a stable key,
  never in a module-local variable. Standalone apps load a published
  package through more than one server chunk/module instance; a
  module-local map is empty in the instance that did not run the
  registrar ([`.ai/lessons/global-registries-in-publishable-packages-must-use.md`](../../.ai/lessons/global-registries-in-publishable-packages-must-use.md)).
- **Registration point.** A country plugin registers at **module load**
  — a top-level side effect of its module entry (the file its
  `ModuleInfo` loads), not inside a per-request DI registrar and not in
  a `setup.ts` hook. Per-request containers replay DI registrars on
  every request (`packages/shared/src/lib/di/container.ts`), so a
  registrar-based `register` would either throw on the second request
  or be skipped; `onTenantCreated`/`seedDefaults` never run on a
  process restart, so a registry filled there is empty after every
  restart.
- **Idempotency and conflict.** Registering the same `code` again from
  the **same** `owner` (the module key) is a **no-op**, so a replayed
  module load and a dev reload are safe. Registering a `code` already
  owned by a **different** module raises a named
  `TaxEngineRegistrationConflictError`; the module entry catches and
  logs it as a configuration bug instead of crashing the process. The
  registry is process-global with one engine per code across all
  tenants — a code is either this tax or it is not; tenant-specific
  data lives in `TaxCode` rows, not in the registry entry. Multi-country
  plugins therefore use country-qualified codes (`PL_VAT`, not `VAT`)
  so two countries' engines cannot collide; `#7524`'s Poland engines
  register `PL_VAT`/`PL_CIT`/`PL_PIT`.
- **Coverage.** Unit tests: replaying `register` for the same
  owner/code is a no-op; a second owner for the same code throws; two
  isolated module instances in one process see the same registry through
  `globalThis`; `resolve` on an unregistered code raises the named
  error.

`ITaxReporting` is **deferred out of Phase 1** (the previous revision
listed it without ever defining it). No `ITaxReporting` DI token,
registry or manifest file is part of Phase 1; the Phase 2 reporting
surface gets its own design when it has a consumer.

**Per-tenant `TaxCode` rows are created by `setup.ts` hooks *and* a
lazy idempotent ensure (the M2 fix).** The previous revision relied on
a module-install hook that Open Mercato does not have. `tax_management`'s
`setup.ts` now uses the two hooks that do exist —
`onTenantCreated` and `onOrganizationCreated`
(`packages/shared/src/modules/setup.ts`) — and both call the same
idempotent `ensureTaxCodes(ctx.em, scope)`, which upserts one `TaxCode`
row per registered engine for that tenant/organization (idempotent on
`(tenantId, organizationId, code)`).

Those hooks do not cover tenants or organizations that already existed
when the plugin was installed, so the same `ensureTaxCodesForScope(em,
scope)` runs **lazily and idempotently** at the start of
`calculateTaxLiability`, of `updateTaxCodeAccountMapping`, and of the
mapping `GET` route (API Contracts). Lazy creation closes both gaps —
an existing tenant that enables the plugin later, and an organization
created after `mercato init` — without a bespoke install command. Tests
cover a pre-existing tenant, a newly created organization, and a
double-invocation that must remain a single row per scope/code.

**`tax_management` never resolves `financial_pl`; `financial_pl`
resolves `tax_management`.** Unchanged from the original draft — same
one-way dependency direction as every sibling spec.

**Relation to `sales.SalesTaxRate` (the M5 fix).** `packages/core/src/modules/sales/data/entities.ts`'s
`SalesTaxRate` (`sales_tax_rates`, unique on `organizationId, tenantId,
code`) is a **transaction-level rate config** — a percentage plus
country/region/postal/city/customer-group scoping, used to compute how
much VAT to charge on one sale. `tax_management.TaxCode` is a
**period-level remittance category** (`"PL_VAT"`, one row per tenant) with
no rate, no transaction scoping, and no FK to `SalesTaxRate` at all —
it exists to track *that a VAT liability gets calculated and remitted
each period*, not *how much VAT applies to a given line item*.
`financial_pl`'s VAT `ITaxEngine.calculate()` is the layer that nets
output VAT against purchase input VAT to produce the period's total
(Out of scope, this document; that logic lives in `#7524`).
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
  `taxEngineRegistry` (Design decisions) and command registration.
  `ITaxReporting` is deferred to Phase 2 and is not declared here.
- `packages/core/src/modules/tax_management/events.ts` — typed
  lifecycle events through `createModuleEvents`:
  `tax_management.liability.calculated`,
  `tax_management.liability.posted`,
  `tax_management.liability.paid` (the m3 fix). Each is emitted **after
  the command's transaction commits**, from the command wrapper, so a
  subscriber never observes a rollback; the Phase 2 bank-statement
  reconciliation subscribes to `posted`/`paid`. Because posting composes
  the ledger transaction (m1, below), `ledger` delegates
  `ledger.journal_entry.posted` to its composing caller, so this module
  emits `tax_management.liability.posted` after commit and does not
  double-emit the ledger event.
- `packages/core/src/modules/tax_management/commands/`:
  - `registerTaxCode` — the plugin-facing write path; upserts a
    `TaxCode` row (idempotent on `(tenantId, organizationId, code)`).
  - `ensureTaxCodes(em, scope)` / `ensureTaxCodesForScope(...)` — the
    idempotent upsert used by `setup.ts`'s `onTenantCreated` /
    `onOrganizationCreated` hooks and lazily by the commands and the
    mapping route (Design decisions, M2).
  - `calculateTaxLiability(periodId, taxCode, { correctsRecordId? })` —
    serializes per `(tenantId, organizationId, periodId, taxCode)` with
    a transaction-scoped advisory lock (the m2 fix), ensures the scope's
    `TaxCode` rows exist, resolves the registered `ITaxEngine` via
    `taxEngineRegistry.resolve(taxCode)`, then calls
    `.calculate({ periodId, tenantId, organizationId })`. It validates
    the returned lines: each declares exactly one of `debit`/`credit`,
    the debit and credit totals are equal, and the debit total equals
    `amount`. It then stores an **immutable snapshot** of those lines on
    the new `TaxLiabilityRecord` (the M3 fix) with
    `status: 'calculated'` and, when supplied, `correctsRecordId`
    (which must name an existing `'posted'`/`'paid'` record of the same
    period and code), and sets `status: 'superseded'` on any prior
    `TaxLiabilityRecord` for the same `(periodId, taxCode)` still in
    `'calculated'`. A partial unique index on
    `(tenant_id, organization_id, period_id, tax_code) where status =
    'calculated'` is the database backstop for the single-live-draft
    invariant; the advisory lock makes the two-contender case
    deterministic instead of racing the index. Emits `calculated` after
    commit.
  - `updateTaxCodeAccountMapping(input)` — the write path behind the
    settings `PUT` (API Contracts): rejects an `accountRoles` key the
    registered engine does not declare, verifies every account id
    belongs to the caller's tenant and organization, applies the
    `updatedAt` optimistic-lock check (root `AGENTS.md`, default ON) and
    upserts the row.
  - `postTaxLiability(taxLiabilityRecordId)` — locks the record
    (`SELECT ... FOR UPDATE`), requires `status === 'calculated'`, and
    resolves the **stored snapshot's** `accountRole`s against
    `TaxCodeAccountMapping.accountRoles`; it never re-runs the engine
    (the M3 fix). It re-verifies the snapshot balances and that its
    debit total still equals the stored `amount`. **Correction flow (the
    M4 fix):** when the record carries `correctsRecordId`, the same
    transaction first calls `ledger.reverseJournalEntry` for the
    original record's `journalEntryId`, moves the original to
    `status: 'reversed'` (allowed from `'posted'` *and* `'paid'`; its
    `paidAt`/`paymentReference` are preserved as history) — the partial
    unique index covers only `('posted', 'paid')`, so `'reversed'` frees
    the slot — and then posts the new record's lines. A zero-line
    original has no `journalEntryId`; it is moved to `'reversed'`
    without a reversal call. Everything
    (reverse, status changes, post) runs in **one** transaction, so a
    failed post rolls the reversal back; a retry after a crash is safe
    because the original is only reversed once and the new record must
    still be `'calculated'`.
  - **Ledger call contract (the m1 fix).** `postTaxLiability` calls
    `commandBus.execute('ledger.postJournalEntry', { input: { lines:
    resolvedLines, operationDate: <fiscal period end date>, description:
    `Tax settlement ${taxCode} ${periodLabel}`, referenceType:
    'tax_management.tax_liability', referenceId: record.id },
    ctx: { ...ctx, transactionalEm } })`. Passing `transactionalEm`
    makes `ledger` join this transaction instead of committing on its
    own; because the transaction is composed here, `ledger` does not
    emit its own `journal_entry.posted`, so `postTaxLiability` emits
    `tax_management.liability.posted` after commit. **If `lines` is
    empty** (Edge Cases — PIT-4's own case), it skips the ledger call
    and sets `status: 'posted'` with `journalEntryId: null`.
  - `markTaxLiabilityPaid(taxLiabilityRecordId, paidAt,
    paymentReference)` — sets `status: 'paid'`, rejects a `'reversed'`
    or `'superseded'` record, and keeps the `updatedAt` optimistic lock.
    Called by `financial_pl`'s own route, which enforces
    `requireFeatures` at the trust boundary (the same posture
    `ledger.postJournalEntry` takes toward its callers).
- `packages/core/src/modules/tax_management/api/tax-code-mappings/route.ts`
  — `GET` (registered engines, their declared roles, the current
  mapping) and `PUT` (upsert) for the settings page, both guarded by
  `requireFeatures: ['tax_management.settings.manage']` and scoped to
  the caller's tenant/organization (`GET` also runs the lazy
  `ensureTaxCodesForScope`). **The M5 fix:** the previous revision
  shipped a settings page with no route behind it.
- `packages/core/src/modules/tax_management/acl.ts` / `setup.ts` —
  `tax_management.settings.manage` (configure `TaxCodeAccountMapping`)
  plus the two setup hooks above. A liability-history feature
  (`tax_management.liabilities.view`) moves to Phase 2 with the route
  that would guard it, instead of shipping a feature that guards
  nothing (the M5 fix). No `.pay`/`.export` feature: the route that
  calls `markTaxLiabilityPaid` is `financial_pl`'s own, gated by its own
  feature.

## Data Model

**`TaxCode`** — `{ id, tenantId, organizationId, code (country-qualified,
e.g. "PL_VAT", "PL_CIT"), label, registeredBy (plugin module key), createdAt,
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
Currency), lines (jsonb, immutable `ITaxEngineLine[]` snapshot —
the M3 fix), correctsRecordId (nullable FK-id, set on a correction —
the M4 fix), status ('calculated' | 'superseded' | 'posted' | 'paid' |
'reversed'), journalEntryId (nullable FK-id to ledger.JournalEntry, set
once posted — stays `null` for a zero-line post, Edge Cases),
paymentReference (nullable, set once paid), calculatedAt, postedAt
(nullable), paidAt (nullable), updatedAt }`.

**The m2 fix**: `currency` (a bare string in the original draft) is now
`currencyId: uuid`, matching `ledger.postJournalEntry`'s own convention
(#6340 validators) instead of a free-text field that could drift from
the real `Currency` table.

**The M1/M4 fixes**: `'superseded'` and `'reversed'` statuses plus
`updatedAt` (root `AGENTS.md`: optimistic locking default ON — this
field is what makes that possible once implemented), and three partial
indexes:

1. `(tenant_id, organization_id, period_id, tax_code) where status in
   ('posted', 'paid')` — at most one live posted liability per
   period/code; `'reversed'` is excluded, which is what makes the
   reverse-and-repost correction flow legal.
2. `(tenant_id, organization_id, period_id, tax_code) where status =
   'calculated'` — the single-live-draft backstop (m2).
3. `(tenant_id, organization_id, corrects_record_id) where
   corrects_record_id is not null` — a given record can be corrected
   once, so a retried correction cannot reverse it twice.

`lines` is written once at `calculateTaxLiability` and never updated —
`postTaxLiability` posts exactly that snapshot, so a change to the
underlying registers after the accountant reviewed the draft cannot
change what is posted (the M3 fix). No new tables in `ledger` itself —
`tax_management` owns this row the same way `accounts_payable` owns
`VendorInvoice` (control-account precedent,
`financial-module-knowledge-base.md` §2).

## API Contracts

Phase 1 ships exactly one route pair, the settings surface for
`TaxCodeAccountMapping` (the M5 fix — the previous revision shipped the
page with no API behind it):

| Route | Features | Behavior |
|---|---|---|
| `GET /api/tax-management/tax-code-mappings` | `tax_management.settings.manage` | Returns the registered engines (code, label, declared `accountRoles`) and the current mapping for the caller's tenant/organization; runs the lazy `ensureTaxCodesForScope` first. |
| `PUT /api/tax-management/tax-code-mappings` | `tax_management.settings.manage` | Validates and upserts `accountRoles` for one `taxCode` through `updateTaxCodeAccountMapping`: unknown role → 422, account outside the caller's organization → 403, stale `updatedAt` → 409 (optimistic lock header, the standard `CrudForm`/`withScopedApiRequestHeaders` path). |

`calculateTaxLiability`/`postTaxLiability`/`markTaxLiabilityPaid` stay
commands invoked by `financial_pl`'s own routes/period-close flow
(`#7524`), not reachable directly over HTTP. A liability-history read
route (and its `tax_management.liabilities.view` feature) is Phase 2 and
ships with that route, not before it.

## UI/UX

Phase 1: a settings page under `tax_management` for
`TaxCodeAccountMapping` — one row per registered `TaxCode`, with one
account picker **per role the registered `ITaxEngine` declares**
(Design decisions — not a fixed two-picker layout), matching
`PostingRulesSettings`'s own settings-page-only Phase 1 UI. The page
reads and writes through the `GET`/`PUT` route pair (API Contracts) and
surfaces a stale-edit 409 as the standard conflict bar rather than
silently overwriting another admin's mapping.
`financial_pl`'s own period-close UI (payment instruction block, "Mark
as paid" button) lives in that document now (`#7524`).

## Edge Cases & Failure Scenarios

- **No `TaxCodeAccountMapping` role configured for a tax code.**
  `calculateTaxLiability`/`postTaxLiability` reject with a named error
  before computing or posting anything — same reject-if-unset posture
  as `PostingRulesSettings`/`FixedAssetSettings`.
- **`calculateTaxLiability` called twice for the same period/code.**
  The call holds a transaction-scoped advisory lock keyed by
  `(tenantId, organizationId, periodId, taxCode)`, so two concurrent
  calculations run one after the other; the second supersedes the draft
  the first created (`status: 'superseded'`) and inserts its own. The
  partial unique index on `status = 'calculated'` is the database
  backstop. `postTaxLiability` on a `'superseded'` record is rejected
  (the m2 fix — the previous revision's index covered only
  posted/paid, so it did not actually enforce the single-live-draft
  claim).
- **`postTaxLiability` called on an already-`'posted'`/`'paid'`/
  `'superseded'`/`'reversed'` record.** Rejected — a
  `TaxLiabilityRecord` posts once. Corrections use the flow below.
- **Correction of a posted or paid period (the M4 fix).** A correction
  is a new `calculateTaxLiability` whose record carries
  `correctsRecordId` pointing at the original, followed by
  `postTaxLiability` on the new record. In one transaction the command
  reverses the original journal entry through
  `ledger.reverseJournalEntry`, moves the original to
  `status: 'reversed'` (from `'posted'` or `'paid'`; `paidAt` and
  `paymentReference` stay on the row as history), and posts the new
  record's lines. If the post fails, the whole transaction rolls back
  and the original stays posted — retrying is safe because the original
  can be reversed only once (the `corrects_record_id` partial unique
  index blocks a second correction of the same record). This replaces
  the previous revision's "second post" flow, which the posted/paid
  unique index rejected and which, without the index, would have booked
  the full liability twice.
- **`ITaxEngine.calculate()` returns an empty `lines: []`.** Valid
  (PIT-4's own case, `#7524`) — `postTaxLiability` sets
  `status: 'posted'`, `journalEntryId: null`, and skips the
  `ledger.postJournalEntry` call.
- **`ITaxEngine.calculate()` returns unbalanced lines, or a debit total
  that differs from `amount`.** Rejected at `calculateTaxLiability`
  (before the record exists) and re-checked at `postTaxLiability`
  against the stored snapshot — a named `tax_management` error (a
  plugin bug), not a raw `ledger` 500. The snapshot is the only thing
  posted, so a later engine change cannot alter a reviewed draft.
- **`TaxCode` rows missing for the scope.** `ensureTaxCodesForScope`
  creates them lazily from the registry and is idempotent — covers an
  existing tenant that installs the plugin later, and an organization
  created after the tenant (the M2 fix).
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
**Mitigation:** `'superseded'` status on recalculation plus a
transaction-scoped advisory lock on
`(tenantId, organizationId, periodId, taxCode)`; a partial unique index
on `status = 'calculated'` as the single-live-draft backstop; a row
lock on the `'calculated'` → `'posted'` transition inside the same
transaction as the `ledger.postJournalEntry` call; and a partial unique
index on `status in ('posted', 'paid')` as the second backstop
(Architecture). The earlier revision named `'superseded'` alone here,
which — with an index covering only posted/paid — did not actually
prevent two concurrent live drafts.
**Residual risk:** Low — both unique indexes hold even if an
application-layer lock is bypassed, matching the defense-in-depth
pattern `ledger`'s own partial unique indexes already use.

### A post books a different figure than the accountant reviewed

**Scenario:** `postTaxLiability` re-derives the liability from live
registers instead of the calculation the accountant approved, so source
data changing between calculate and post silently changes the posted
entry.
**Severity:** Critical.
**Affected area:** `tax_management` posting path, GL balances.
**Mitigation:** the M3 fix stores an immutable `lines` snapshot on
`TaxLiabilityRecord` at calculation time and posts exactly that
snapshot; the post re-validates the snapshot's balance and its total
against the stored `amount` and refuses on mismatch.
**Residual risk:** Low — the engine is never invoked again after
calculation.

### Cross-module dependency surface

**Scenario:** the Poland engines depend on both `ledger` and
`tax_management` — two hard dependencies for one plugin, each
independently a single point of failure for the period-close flow if
either's API changes. (Target layout from 2026-10-08: these engines live
in the separate package `financial_pl_accounting` with a hard `requires`
on `ledger` and `tax_management`; `financial_pl` itself keeps no
dependency on either.)
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
  (`#7524`) — not designed in this document, which only
  defines the contract shape. **Input source, decided 2026-10-08:** the
  VAT engine reads `financial_pl`'s VAT register (the evidence the
  JPK_V7 declaration is built from) through a read-only DI service that
  `financial_pl` exposes, never through its entities, and posts only the settlement
  through this module; the CIT and PIT engines read GL account balances
  (#6013), because those taxes derive from the books. GL balances also
  feed a reconciliation of the VAT register against the VAT accounts
  (differences are reported, not corrected).
- **The mikrorachunek podatkowy payment instruction** and its checksum
  algorithm — Poland-specific, `#7524`.
- **ZUS** (social security contributions) — structurally different (an
  employer-social-insurance liability, not an income/consumption tax),
  a real future `TaxCode`, not designed here.
- **Automated bank-rail payment execution.**
- **Any tax type for any country other than Poland** — this framework
  is country-agnostic by construction (SPEC-024 §10); its only concrete
  consumer today is `financial_pl` (`#7524`).
- **JPK_KR_PD / JPK_V7 report generation.** Already the JPK_KR_PD spec and
  existing `financial_pl` capability respectively.

## Implementation Plan

1. `tax_management`: entities (`TaxCode`, `TaxCodeAccountMapping` with
   `accountRoles` jsonb, `TaxLiabilityRecord` with `currencyId`, the
   `lines` snapshot, `correctsRecordId`, `superseded`/`reversed`
   statuses and `updatedAt`) + migration and the three partial unique
   indexes, under `packages/core/src/modules/tax_management` (M3).
2. `tax_management`: `taxEngineRegistry` with its `globalThis` storage
   and owner-aware idempotent registration (M1); `events.ts`
   (`createModuleEvents` for `tax_management.liability.*`, m3);
   `ensureTaxCodes`, `registerTaxCode`,
   `updateTaxCodeAccountMapping`, `calculateTaxLiability` (advisory
   lock, supersede, snapshot), `postTaxLiability` (snapshot, reversal
   correction, `transactionalEm`, empty-lines handling),
   `markTaxLiabilityPaid`.
3. `tax_management`: `setup.ts` — `onTenantCreated` +
   `onOrganizationCreated` hooks calling `ensureTaxCodes` (M2).
4. `tax_management`: ACL (`tax_management.settings.manage`) +
   `api/tax-code-mappings/route.ts` (`GET`/`PUT`, M5) + settings page
   for `TaxCodeAccountMapping` (role-driven picker layout, stale-edit
   409).
5. Integration tests: cross-module resolution (`financial_pl` →
   `tax_management` → `ledger`, once `#7524` exists), tenant isolation
   on `TaxLiabilityRecord`, two-contender recalculation and
   concurrent-post races (mirroring `ledger`'s own concurrent-import
   test pattern, PR #6137 review m1), empty-lines post path, the
   reverse-and-repost correction (including an already-paid original),
   registry replay/conflict, pre-existing-tenant and
   later-organization `TaxCode` creation, settings `GET`/`PUT` and its
   stale-edit 409.
6. Event tests: `calculated`/`posted`/`paid` emitted only after
   commit, never on rollback.
7. Record this document's findings in
   `financial-module-knowledge-base.md` §3/§1
   ([`open-mercato#6016`](https://github.com/open-mercato/open-mercato/pull/6016) —
   this file lives on its own `docs/financial-module-knowledge-base`
   branch, not on `main`, which is why `git ls-files` at this document's
   head does not find it), and add the one-line forward-pointer to
   `2026-08-18-general-ledger-core-engine.md`'s Out of scope (matching
   the pointer already added for `#6038` and `#6137`).

## File Manifest

| File | Action | Notes |
|---|---|---|
| `packages/core/src/modules/tax_management/data/entities.ts` | Create | `TaxCode`, `TaxCodeAccountMapping` (`accountRoles` jsonb), `TaxLiabilityRecord` (`currencyId`, `lines`, `correctsRecordId`, `superseded`/`reversed`) |
| `packages/core/src/modules/tax_management/di.ts` | Create | `taxEngineRegistry` (`globalThis`, owner-aware) + command registration |
| `packages/core/src/modules/tax_management/events.ts` | Create | `tax_management.liability.calculated`/`posted`/`paid` via `createModuleEvents` |
| `packages/core/src/modules/tax_management/commands/*.ts` | Create | `ensureTaxCodes`, `registerTaxCode`, `updateTaxCodeAccountMapping`, `calculateTaxLiability`, `postTaxLiability`, `markTaxLiabilityPaid` |
| `packages/core/src/modules/tax_management/acl.ts` / `setup.ts` | Create | `tax_management.settings.manage`, tenant/organization setup hooks |
| `packages/core/src/modules/tax_management/api/tax-code-mappings/route.ts` | Create | `GET`/`PUT` mapping route, `requireFeatures`, optimistic lock |
| `packages/core/src/modules/tax_management/backend/settings/page.tsx` | Create | `TaxCodeAccountMapping` settings page, role-driven pickers, 409 conflict bar |
| `packages/core/src/modules/tax_management/__integration__/tax-management.spec.ts` | Create | Cross-module resolution, tenant isolation, recalculation/post races, correction flow, settings route |

`financial_pl`'s own files (mikrorachunek, VAT/CIT/PIT engines,
`generateTaxPaymentInstruction`) are listed in
`#7524`'s own File Manifest — not repeated here (the M3
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
  `financial_pl`'s document (`#7524`), which cites this
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

**Verdict: design-complete for review; implementation-facing defects
resolved.** The 2026-11-05 maintainer review found five Majors and four
Minors still open after the 2026-09-28 revision. This 2026-11-18
revision addresses every one of them, and the earlier Blocker/Majors
stay resolved:

- **M1 (registry lifecycle)** — registration point, `globalThis`
  storage, same-owner idempotent re-registration, different-owner
  conflict error, and replay/isolated-instance/conflict tests are all
  specified; `ITaxReporting` is explicitly deferred to Phase 2.
- **M2 (nonexistent install hook)** — `onTenantCreated` and
  `onOrganizationCreated` (both present in
  `packages/shared/src/modules/setup.ts`) plus a lazy idempotent
  `ensureTaxCodesForScope` cover existing tenants and later
  organizations, with planned coverage for each.
- **M3 (unpersisted calculation)** — an immutable `lines` snapshot is
  stored at calculation and is the only thing posted; the post
  re-validates it against the stored `amount`.
- **M4 (correction flow)** — reverse-and-repost in one transaction,
  a `'reversed'` terminal state excluded from the posted/paid index, a
  `correctsRecordId` unique index against double-correction, and
  already-paid originals explicitly allowed.
- **M5 (Phase 1 settings/API contradiction)** — the `GET`/`PUT`
  mapping route, `updateTaxCodeAccountMapping`, feature guards,
  account-ownership checks, optimistic locking and route/page
  integration coverage are all specified; the unused
  `liabilities.view` feature moved to Phase 2 with its route.
- **m1 (ledger transaction)** — `transactionalEm`, after-commit event
  ownership, operation date, description and reference fields are
  explicit.
- **m2 (concurrent recalculation)** — advisory lock plus a
  `status = 'calculated'` partial unique index, with a two-contender
  test; the Risks mitigation is corrected to match.
- **m3 (events)** — `tax_management.liability.calculated|posted|paid`
  declared in `events.ts` and emitted after commit.
- **m4 (stale references)** — live references point at `#7524`'s
  `.ai/specs/2026-09-16-tax-management-financial-pl.md`; only the
  historical Changelog names the closed `official-modules#55`.
- **Nit** — research narration stays in Literature & Prior Art; the
  trailing blank line is gone.

Not independently verified against a real implementation — none exists
until `#6340` (ledger) and this module land. The next step is a
maintainer re-review of this revision, then implementation per the
plan above.

## Changelog

### 2026-11-18 — second maintainer pass (PR #6168 review, 2026-11-05)

Addressed the five Majors and four Minors left open by the 2026-11-05
re-review; no scope change, this document still covers `tax_management`
only.

- **M1**: registration lifecycle specified (module-load registration,
  `globalThis` storage per the registry lesson, same-owner idempotent
  re-registration, different-owner conflict error, replay/isolated-
  instance tests); `ITaxReporting` explicitly deferred out of Phase 1.
- **M2**: per-tenant `TaxCode` rows now come from `onTenantCreated` /
  `onOrganizationCreated` **and** a lazy idempotent
  `ensureTaxCodesForScope` for pre-existing tenants and later
  organizations; coverage added.
- **M3**: `TaxLiabilityRecord.lines` stores an immutable calculation
  snapshot; `postTaxLiability` posts that snapshot and re-validates it
  against `amount` instead of re-running the engine.
- **M4**: correction is reverse-and-repost in one transaction, with a
  `'reversed'` terminal status excluded from the posted/paid index and
  a `correctsRecordId` uniqueness guard; already-paid originals
  included.
- **M5**: the Phase 1 settings page now has its `GET`/`PUT`
  `tax-code-mappings` route, `updateTaxCodeAccountMapping` command,
  feature guards, account-ownership checks and optimistic locking; the
  unused `liabilities.view` feature moved to Phase 2.
- **m1**: `ledger.postJournalEntry` is called with `transactionalEm`,
  named operation date/description/reference fields; the
  `liability.posted` event is emitted after commit.
- **m2**: recalculation is serialized by a transaction-scoped advisory
  lock plus a `status = 'calculated'` partial unique index; Risks
  mitigation corrected.
- **m3**: `tax_management.liability.calculated|posted|paid` declared in
  `events.ts` and in the manifest.
- **m4**: every live reference moved from the closed
  `official-modules#55` to `#7524`'s
  `.ai/specs/2026-09-16-tax-management-financial-pl.md`; the banner and
  merge order updated. Historical entries below keep the old links.
- **Nit**: removed the trailing blank line at EOF.

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
- **Host module (decided 2026-10-08).** The
  Poland engines, the mikrorachunek and the payment-instruction commands
  move to a GL-dependent sibling package, `financial_pl_accounting`
  with a hard `requires` on `financial_pl`, `ledger`,
  `tax_management` and `financial_statements`. `financial_pl` stays
  installable without a ledger and keeps JPK_V7 and KSeF. This replaces
  the earlier "still open" note. Mentions of "`financial_pl`" in the
  sections above, as the place where the engines and the `.pay`-style
  feature live, read as this package; the payment feature becomes
  `financial_pl_accounting.tax.pay`. Nothing in the `ITaxEngine`
  contract changes.
