# Tax Management — Core Framework (`tax_management`) + Poland Implementation (`financial_pl`)

> **⚠ Temporary location.** Like `2026-09-11-jpk-kr-pd-financial-pl.md`
> (SPEC-010) before it, half of this document (the `financial_pl`
> section) describes a **`financial_pl`** feature — a Poland-specific
> plugin that lives in `official-modules`, not in this repo. It is
> staged here temporarily because the accompanying Core framework piece
> (`tax_management`) has to be designed and reviewed alongside it, the
> same reason SPEC-010 gives for its own temporary location. The
> `tax_management` half is a genuine `open-mercato` core module and
> will merge into this repo normally; the `financial_pl` half moves to
> `official-modules` once written there for real.
>
> **Update (2026-09-18):** SPEC-010 has completed that move — it now
> lives at `.ai/specs/SPEC-010-2026-09-11-jpk-kr-pd-financial-pl.md` in
> `official-modules#54`, not at the path named above. This document's
> own `financial_pl` half hasn't made the equivalent move yet; the
> staging reasoning above is unchanged for it.

## TLDR

Adds the "Tax Management" capability SPEC-024 §10 already scoped but
nothing has built yet: a small Core framework module (`tax_management`)
that stores tax codes, maps them to GL accounts, stores calculated tax
liabilities, and posts them to the ledger — plus a `financial_pl`
implementation that plugs into that framework for Poland's three
period-close taxes (VAT, CIT, PIT) and produces the payment instruction
(mikrorachunek podatkowy IBAN + amount + tytuł przelewu) an accountant
needs to actually pay them. Follows the exact split SPEC-024 §10
already mandates ("Tax Management is almost entirely implemented
through country plugins. The Core Engine provides only the framework
for tax handling") and the same Phase 1 discipline every sibling spec
in this family uses: Phase 1 computes the instruction, a human executes
the actual transfer; automated bank-rail payment is explicitly
deferred, not designed here.

## Problem Statement

The 2026-09-05 Event Storming session (facylitator Mariusz Gil, ekspert
domenowy Mateusz Duda) named a "ścieżka podatkowa" as part of period
close, distinct from anything AP/AR/GL account balances/Posting Rules
Engine cover:

> "Zamknięto okres sprawozdawczy → Wyliczono podatek → Naliczono podatek
> (operacja księgowa) → Wygenerowano raport podatkowy (JPK) → Wysłano
> deklaracje skarbowe → Pobrano mikrorachunek (KIS) → opłacono
> podatek(-i)."

Two of those six steps already have a home: "Wygenerowano raport
podatkowy (JPK)" is JPK_KR_PD, already speced as SPEC-010 (now
`official-modules#54`'s `.ai/specs/SPEC-010-2026-09-11-jpk-kr-pd-financial-pl.md`,
depends on #6038). The
remaining four — calculate the tax, post it as a journal entry,
compute the payment account, produce something an accountant can
actually pay — have no home. An earlier informal 6-topic list paired
this need with "Posting Rules Engine" (#6015); reading that document in
full during the Compliance & Audit Phase 2 work (2026-09-16) confirmed
that pairing was a mismatch — Posting Rules Engine's entire scope is
zespół 4→5 cost reclassification through account 490, unrelated to tax
liabilities or payments. Accounts Payable Payments
(`accounts_payable_payments`) was also checked and ruled out: its
compliance model (VAT whitelist / biała lista, MPP split-payment
checks) is specific to B2B vendor transfers and doesn't apply to a
government tax remittance, and its whole domain model
(`VendorInvoice`, `VendorPaymentBatch`) has no natural home for "pay
the tax office" that isn't a vendor invoice. Cash & Bank Management
(#6055) explicitly disclaims being a payment-initiation system at all.

Separately, `SPEC-024-2026-02-11-financial-module.md` §10 ("Tax
Management") already answered the *architectural* version of this
question, before any of these modules existed:

> "This module is HEAVILY plugin-dependent as tax rules vary
> dramatically by country. ⚠ Tax Management is almost entirely
> implemented through country plugins. The Core Engine provides only
> the framework for tax handling."

split into "10.1 Tax Framework (Core)" (tax code registry, a
calculation hook that invokes the plugin, tax amount storage, tax
account mapping, a reporting hook) and "10.2 Tax Implementation
(Plugin)" (tax rate management, calculation, validation, return
generation, submission to the tax authority — explicitly Plugin-layer).
This document is the first real design against that already-agreed
split, not a new architectural decision.

## Proposed Solution

Two things ship together, on two different targets:

1. **`tax_management`** (new, small, `open-mercato` core module,
   depends on `ledger`): a `TaxCode`/`TaxCodeAccountMapping` registry
   an accountant configures once, a `TaxLiabilityRecord` that stores
   each period's calculated/posted/paid state per tax code, two DI
   token interfaces (`ITaxEngine`, `ITaxReporting`) a plugin registers
   an implementation against, and three commands
   (`calculateTaxLiability`, `postTaxLiability`,
   `markTaxLiabilityPaid`) that drive a `TaxLiabilityRecord` through
   its lifecycle, posting through `ledger.postJournalEntry` exactly the
   way AP/Posting Rules Engine already do.
2. **`financial_pl`** (Poland plugin, `official-modules`, depends on
   `tax_management` the same way it already declares `requires:
   ['ledger']` for #6038): registers an `ITaxEngine`/`ITaxReporting`
   implementation for VAT, CIT, and PIT; adds a pure, offline,
   NIP-based mikrorachunek podatkowy calculator (Design decisions,
   below — this is **not** an external integration, a real
   architecture correction against what the Event Storming notes
   assumed); and a Phase 1 `generateTaxPaymentInstruction` command that
   produces the IBAN + amount + tytuł przelewu an accountant pastes
   into their own banking software. Nothing in Phase 1 moves money —
   see Design decisions and Phasing.

### Design decisions

**Mikrorachunek podatkowy is a pure, local, deterministic calculation —
not a KIS integration.** The Event Storming notes say the account
number is "pobierany z integracji KIS (Krajowa Informacja Skarbowa)."
Checked directly against the government's own mikrorachunek page
(podatki.gov.pl) and an independent source publishing the full
algorithm (2026-09-16, WebSearch/WebFetch): the number is a 26-character
IBAN-format checksum — fixed prefix `10100071222`, a source-type digit
(`1` for PESEL, `2` for NIP), the identifier itself, and a 2-digit
check number computed via the standard IBAN mod-97 algorithm (append
the numeric-converted country code, move it to the end with two
trailing zeros, divide by 97, subtract the remainder from 98). This is
fully offline-computable from a NIP already stored elsewhere in this
system (Setup: "Zdefiniowano dane firmowe do faktur (NIP)",
2026-09-05 Event Storming) — no network call, no external API, no
documented public endpoint exists for it. Checked a second, independent
pass (2026-09-16, three more sources) specifically to stress-test this
before committing to it: an independent algorithm writeup (26 digits,
ISO/IEC 7064 mod-97-10 checksum, "no mention of KIS or pre-registration
requirements") confirms the same local computation a second way, and a
direct check of what KIS (Krajowa Informacja Skarbowa) actually *is*
found it is a taxpayer telephone helpline and individual tax-ruling
service ("Zadaniem Krajowej Informacji Skarbowej jest udzielanie
telefonicznych odpowiedzi na pytania związane z problemami
podatkowymi") with no technical or API role at all — "KIS ... does not
issue such accounts or provide technical/API services." The most
likely origin of the Event Storming note: KIS's own site
(kis.gov.pl) published the public announcement of mikrorachunek's
launch ("Mikrorachunek podatkowy od 1 stycznia — możesz go sprawdzić
już od dziś"), which plausibly reads, secondhand in a workshop
whiteboard note, as "KIS provides the number" rather than "KIS
announced the number exists." This is a real correction to the source
recording, not a design choice: it removes an entire component (a KIS
client, its error handling, its retry policy) this document would
otherwise have had to design, and it is reported here per
`financial-spec-citation-check` rather than silently designed around.

**Payment is a Phase 1 instruction, not a Phase 1 transfer.** Every
sibling spec in this family splits "data model + manual/explicit
trigger" (Phase 1) from "automation" (Phase 2) — Fixed Assets'
depreciation trigger, GL core engine's deferred year-end-close
generator (`financial-module-knowledge-base.md` §2). This document
follows the same split for the one genuinely new piece of infrastructure
it would otherwise need to invent: actually sending money. Neither
`accounts_payable_payments` (vendor-scoped compliance) nor
`cash_bank_management` (explicitly not a payment-initiation system,
per its own Overview) offers a reusable "send a transfer" primitive
this document could call, and building one from scratch — a genuine
bank-rail integration — is out of proportion to what Phase 1 actually
needs. Phase 1 stops at producing the payment instruction (mikrorachunek
IBAN, amount, tytuł przelewu = tax code + period, per Ordynacja
podatkowa's identification requirements) and lets the accountant paste
it into their own bank's transfer form, then confirms payment with
`markTaxLiabilityPaid` — a manual command today, a candidate for
reconciliation against Cash & Bank Management's imported bank
statements later (Alternatives considered).

**One `TaxCodeAccountMapping` row per tax code, not one settings
row.** `PostingRulesSettings`/`FixedAssetSettings` each hold a handful
of named account fields because each module has a small, fixed set of
account roles. Tax Management's account roles are one per tax code
(VAT payable, CIT payable, PIT payable — and, per SPEC-024's own table,
potentially more per country later), an open-ended set SPEC-024 itself
calls a "registry," so this document mirrors that: a `TaxCode` row per
code (registered by whichever plugin implements it, matching SPEC-024
10.1's "Tax code registry — store tax codes from plugins") and a
`TaxCodeAccountMapping` row per code, each independently nullable and
admin-configured — same "no default, reject-if-unset" posture as
`PostingRulesSettings`/`FixedAssetSettings`, applied per-row instead of
per-module.

**`tax_management` never resolves `financial_pl`; `financial_pl`
resolves `tax_management`.** Same one-way dependency direction as
every sibling spec (`packages/core/AGENTS.md`). `tax_management`
defines `ITaxEngine`/`ITaxReporting` as DI tokens and calls whichever
implementation is registered against them — it has no idea `financial_pl`
exists. `financial_pl` declares `requires: ['tax_management']` (the
same declared-dependency pattern it already uses for `requires:
['ledger']`, per SPEC-010) and registers its VAT/CIT/PIT
implementation at module setup.

## Architecture

### `tax_management` (new core module)

- `packages/tax_management/src/modules/tax_management/data/entities.ts`
  — `TaxCode`, `TaxCodeAccountMapping`, `TaxLiabilityRecord` (Data
  Model, below).
- `packages/tax_management/src/modules/tax_management/di.ts` —
  registers the `ITaxEngine`/`ITaxReporting` DI tokens (unresolved
  until a plugin registers against them) and the module's own commands.
- `packages/tax_management/src/modules/tax_management/commands/`:
  - `registerTaxCode` — plugin-invoked at setup, upserts a `TaxCode`
    row (idempotent on `(tenantId, organizationId, code)`).
  - `calculateTaxLiability(periodId, taxCode)` — resolves the
    registered `ITaxEngine` for `taxCode`, calls
    `.calculate({ periodId, tenantId, organizationId })`, stores the
    result as a new `TaxLiabilityRecord` with `status: 'calculated'`.
    Rejects with a named error if no `ITaxEngine` is registered for
    that code, or if `TaxCodeAccountMapping` for it is unset (same
    reject-if-unset posture as `PostingRulesSettings`).
  - `postTaxLiability(taxLiabilityRecordId)` — reads the
    `TaxLiabilityRecord` and its `TaxCodeAccountMapping`, calls
    `commandBus.execute('ledger.postJournalEntry', { input: { lines: [
    { accountId: taxExpenseAccountId, debit: amount }, { accountId:
    mapping.liabilityAccountId, credit: amount } ], ... }, ctx })` —
    the real two-argument `execute(commandId, options)` signature,
    matching AP's `postVendorInvoice → ledger.postJournalEntry`
    precedent. Sets `status: 'posted'`, stores the returned
    `journalEntryId`.
  - `markTaxLiabilityPaid(taxLiabilityRecordId, paidAt,
    paymentReference)` — sets `status: 'paid'`. Called by `financial_pl`
    once an accountant confirms the transfer went through (Phase 1:
    manual confirmation; see Design decisions).
- `packages/tax_management/src/modules/tax_management/acl.ts` /
  `setup.ts` — `tax_management.settings.manage` (configure
  `TaxCodeAccountMapping`) and `tax_management.liabilities.view`
  (read `TaxLiabilityRecord` history) — the only two roles this module
  needs in Phase 1; no `.export`/`.pay` feature, since payment
  itself is `financial_pl`'s command, not this module's.

### `financial_pl` (Poland plugin)

- `packages/financial_pl/src/modules/financial_pl/tax/microAccount.ts`
  — `computeMicroAccount(identifier: string, kind: 'NIP' | 'PESEL'):
  string`, a pure function implementing the algorithm in Design
  decisions. No I/O, unit-testable with the published worked examples
  from the primary sources checked.
- `packages/financial_pl/src/modules/financial_pl/tax/taxEngine.ts` —
  registers `ITaxEngine`/`ITaxReporting` implementations for `VAT`,
  `CIT`, `PIT` against `tax_management`'s DI tokens at module setup
  (`requires: ['tax_management']`, alongside the existing `requires:
  ['ledger']`).
- `packages/financial_pl/src/modules/financial_pl/commands/
  generateTaxPaymentInstruction.ts` — input: `taxLiabilityRecordId`.
  Reads the record from `tax_management` (a direct cross-module query,
  matching the precedent `journal_entry_line_dimension` and `sales`/
  `catalog` already establish for hard-dependency reads — Writes
  exclusively through commands, same split every sibling spec in this
  family already follows), reads the tenant's NIP from wherever
  `financial_pl` already sources it for KSeF/JPK_V7 (not duplicated
  here), computes the mikrorachunek via `computeMicroAccount`, and
  returns `{ iban, amount, currency, title }` where `title` follows
  Ordynacja podatkowa's identification convention (tax code + period,
  e.g. "VAT za 09/2026"). Does not call `markTaxLiabilityPaid` itself —
  that's a separate, explicit confirmation step (Design decisions).

## Data Model

**`TaxCode`** — `{ id, tenantId, organizationId, code (e.g. "VAT",
"CIT", "PIT"), label, registeredBy (plugin module key), createdAt }`.
Uniqueness on `(tenantId, organizationId, code)`.

**`TaxCodeAccountMapping`** — `{ id, tenantId, organizationId,
taxCode, liabilityAccountId (nullable FK-id to ledger.LedgerAccount, no
default), expenseAccountId (nullable FK-id to ledger.LedgerAccount, no
default), updatedAt }`. Both start `null` — no tax-law-derived starting
figure exists once account numbering is entirely the tenant's own
choice (same reasoning `PostingRulesSettings`/`FixedAssetSettings`
already established, cited in `financial-module-knowledge-base.md` §2,
"Account numbers are illustrative, never literal"). Upserted via
`updateTaxCodeAccountMapping`, gated by `tax_management.settings.manage`.

**`TaxLiabilityRecord`** — `{ id, tenantId, organizationId, periodId
(FK-id to ledger.FiscalPeriod), taxCode, amount, currency, status
('calculated' | 'posted' | 'paid'), journalEntryId (nullable FK-id to
ledger.JournalEntry, set once posted), paymentReference (nullable,
set once paid), calculatedAt, postedAt (nullable), paidAt (nullable) }`.
No new tables in `ledger` itself — `tax_management` owns this row the
same way `accounts_payable` owns `VendorInvoice` rather than `ledger`
growing an invoice concept (control-account precedent,
`financial-module-knowledge-base.md` §2).

`financial_pl` adds no new entities of its own for this feature —
`computeMicroAccount` is a pure function, and the payment instruction
it returns is a response shape (API Contracts, below), not a persisted
row.

## API Contracts

**`tax_management`** ships no API route in Phase 1 — `calculateTaxLiability`/
`postTaxLiability`/`markTaxLiabilityPaid` are commands invoked by
`financial_pl`'s own period-close flow, not reachable directly over
HTTP, the same "no route, no UI" posture #6038 documents for its own
Phase 1 DI service (this document's own Phase 2 candidate, see
Phasing, would be a settings page for `TaxCodeAccountMapping` — a UI
surface, not a new query shape).

**`financial_pl`**: `POST /api/financial-pl/tax/payment-instruction` —
body `{ taxLiabilityRecordId }`, returns `{ iban, amount, currency,
title }` (Architecture, above). Requires whatever ACL `financial_pl`
already gates its own JPK/KSeF submission routes with — not a new
feature this document invents.

## UI/UX

Phase 1: a settings page under `tax_management` for
`TaxCodeAccountMapping` (one row per registered `TaxCode`, two account
pickers each) — the only UI this module needs to be usable, matching
`PostingRulesSettings`'s own settings-page-only Phase 1 UI. Within
`financial_pl`'s existing period-close screen (wherever JPK_KR_PD's own
trigger lives, per SPEC-010), add the tax payment instruction as a
copyable IBAN/amount/title block plus a "Mark as paid" button calling
`markTaxLiabilityPaid`.

## Edge Cases & Failure Scenarios

- **No `TaxCodeAccountMapping` configured for a tax code.**
  `calculateTaxLiability` rejects with a named error before computing
  anything — same reject-if-unset posture as `PostingRulesSettings`/
  `FixedAssetSettings`, not a silent skip or a guessed account.
- **`calculateTaxLiability` called twice for the same period/code.**
  Creates a second `TaxLiabilityRecord` rather than overwriting — an
  accountant recalculating after a correction should see both, and
  `postTaxLiability` on a superseded record is a caller-side mistake
  this module doesn't try to prevent (matching the "no default scope
  to fall back to" posture used elsewhere in this family — the caller
  is responsible for picking the right record).
- **`postTaxLiability` called on an already-`posted` record.**
  Rejected — a `TaxLiabilityRecord` posts once; a correction is a new
  `calculateTaxLiability` + its own `postTaxLiability`, matching GL
  core engine's own "correct via a new entry, never edit a posted one"
  invariant.
- **NIP missing or malformed when `generateTaxPaymentInstruction` runs.**
  Rejected before computing a mikrorachunek — a wrong micro-account
  number sends money to the wrong place, the most consequential
  failure mode in this entire document; no fallback or best-effort
  computation is offered.
- **Fiscal period locked before `postTaxLiability` runs.**
  `ledger.postJournalEntry` already enforces this (Risks — this module
  adds no new bypass and relies entirely on GL core engine's existing
  `isLocked` check).

## Risks & Impact Review

**Payment-instruction correctness is the one risk that matters more
than any other in this document.** `computeMicroAccount` must be
tested against the primary sources' own worked examples before this
ships, not just unit-tested against itself — a subtly wrong checksum
computes a *valid-looking* but wrong IBAN, and a tax payment sent to
the wrong account is not a bug this project can quietly patch later.
Recommend a golden-file test set built directly from the government
generator's own output for several real NIPs, not synthetic data.

**Cross-module dependency surface.** `financial_pl` now depends on
both `ledger` (#6038's pattern) and `tax_management` (this document) —
two hard dependencies for one plugin, each independently a single
point of failure for `financial_pl`'s period-close flow if either's
API changes. Mitigated the same way #6038 mitigates it for `ledger`:
a named, versioned DI token contract, not ad-hoc cross-package imports.

**No automated reconciliation in Phase 1.** `markTaxLiabilityPaid` is
a manual, trust-the-accountant confirmation — nothing checks that the
transfer the accountant made actually matches the instruction this
system generated. Cash & Bank Management's bank-statement import
(#6055) is a real future reconciliation source (Alternatives
considered), not built here.

## Alternatives considered

**Fold this into Accounts Payable Payments.** Rejected — see Problem
Statement: AP-payments' entire compliance model (VAT whitelist, MPP)
is vendor-transfer-specific and doesn't apply to a tax remittance, and
its domain model has no natural "invoice" for a tax liability.

**Fold this into Posting Rules Engine.** Rejected — confirmed by
reading that document in full (1453 lines): its scope is exclusively
zespół 4→5 cost reclassification through account 490, with zero
mention of tax payments or KIS anywhere in the text.

**Build automated bank-rail payment in Phase 1.** Rejected — no
existing module in this project offers a reusable payment-initiation
primitive outside AP-payments' vendor-scoped one, and building a real
bank integration from scratch is disproportionate to what period-close
tax payment actually needs on day one; every sibling spec in this
family defers automation to Phase 2 the same way (Design decisions).

**Reconcile payment via Cash & Bank Management instead of a manual
`markTaxLiabilityPaid` command.** Deferred, not rejected — a real
Phase 2 candidate once #6055 ships, matching a bank statement line
back to a `TaxLiabilityRecord` by amount/date/reference. Not designed
here because #6055 itself is not yet reviewed.

## Out of scope

- **Tax calculation logic itself** (how much VAT/CIT/PIT is actually
  owed). `ITaxEngine.calculate`'s real implementation is `financial_pl`
  application logic reading GL account balances (#6013) and whatever
  `financial_pl` already computes for JPK_V7 — not designed in this
  document, which only defines the contract shape.
- **ZUS** (social security contributions). Named in the Event Storming
  notes alongside VAT/CIT/PIT but structurally different (an
  employer-social-insurance liability, not an income/consumption tax)
  — a real future `TaxCode`, not designed here.
- **Automated bank-rail payment execution.** See Design decisions,
  Alternatives considered.
- **Any tax type for any country other than Poland.** The
  `tax_management` Core framework is country-agnostic by construction
  (SPEC-024 §10); this document's only concrete implementation is
  `financial_pl`'s three Polish taxes.
- **JPK_KR_PD / JPK_V7 report generation.** Already SPEC-010 and
  existing `financial_pl` capability respectively — this document only
  adds the calculate/post/pay path, not the reporting path.

## Implementation Plan

1. `tax_management`: entities (`TaxCode`, `TaxCodeAccountMapping`,
   `TaxLiabilityRecord`) + migration.
2. `tax_management`: DI tokens (`ITaxEngine`, `ITaxReporting`) +
   `registerTaxCode`, `calculateTaxLiability`, `postTaxLiability`,
   `markTaxLiabilityPaid` commands.
3. `tax_management`: ACL (`tax_management.settings.manage`,
   `tax_management.liabilities.view`) + settings page for
   `TaxCodeAccountMapping`.
4. `financial_pl`: `computeMicroAccount` + its golden-file test set
   (Risks) — build and test this before anything else in `financial_pl`
   depends on it.
5. `financial_pl`: `ITaxEngine`/`ITaxReporting` registration for VAT/
   CIT/PIT against `tax_management`'s tokens.
6. `financial_pl`: `generateTaxPaymentInstruction` command + API route
   + UI block in the period-close screen.
7. Integration tests: cross-module resolution (`financial_pl` →
   `tax_management` → `ledger`), tenant-isolation on
   `TaxLiabilityRecord`, and the `computeMicroAccount` golden-file set.
8. Record this document's findings in
   `financial-module-knowledge-base.md` §3/§1, and add the one-line
   forward-pointer to `2026-08-18-general-ledger-core-engine.md`'s Out
   of scope (matching the pointer already added for #6038 and #6137).

## File Manifest

| File | Action | Notes |
|---|---|---|
| `packages/tax_management/src/modules/tax_management/data/entities.ts` | Create | `TaxCode`, `TaxCodeAccountMapping`, `TaxLiabilityRecord` |
| `packages/tax_management/src/modules/tax_management/di.ts` | Create | `ITaxEngine`/`ITaxReporting` tokens + command registration |
| `packages/tax_management/src/modules/tax_management/commands/*.ts` | Create | `registerTaxCode`, `calculateTaxLiability`, `postTaxLiability`, `markTaxLiabilityPaid` |
| `packages/tax_management/src/modules/tax_management/acl.ts` / `setup.ts` | Create | Two features, settings-page seed |
| `packages/financial_pl/src/modules/financial_pl/tax/microAccount.ts` | Create | Pure mikrorachunek checksum function |
| `packages/financial_pl/src/modules/financial_pl/tax/taxEngine.ts` | Create | VAT/CIT/PIT `ITaxEngine`/`ITaxReporting` registration |
| `packages/financial_pl/src/modules/financial_pl/commands/generateTaxPaymentInstruction.ts` | Create | Payment instruction command + route |
| `__integration__/tax-management.spec.ts` | Create | Cross-module resolution, tenant isolation, `computeMicroAccount` golden files |

## Literature & Prior Art

**Step 1 — cross-spec consistency.** Re-checked
`financial-module-knowledge-base.md` §2 (control account/subsidiary
ledger, three tagging mechanisms, event-driven posting, module
dependency direction, Phase 1/Phase 2 discipline, `commandBus`
signature, account-numbers-are-illustrative, per-command event
documentation) — this document reuses every one of them rather than
inventing an equivalent. Read `2026-09-06-posting-rules-engine.md` in
full (1453 lines, 2026-09-16) and confirmed zero relation to tax
payments (Problem Statement). Read `2026-09-06-accounts-payable-payments.md`
(Overview/Problem Statement, 2026-09-16 — carried over from the
Compliance & Audit research pass) and confirmed its compliance model is
vendor-specific. Read `2026-09-10-cash-bank-management.md` (Overview,
same pass) and confirmed its explicit "not a payment-initiation system"
disclaimer. Read `SPEC-024-2026-02-11-financial-module.md` §10 in full
(2026-09-16) — the source of this document's Core/Plugin split.

**Step 2 — literature grounding.**
- **Kieso, *Intermediate Accounting*, 17th Ed., Ch.13 "Current
  Liabilities and Contingencies," p.13-8** (verified 2026-09-16, full
  text search): "Sales Taxes Payable" and "Income Taxes Payable" are
  both discussed as current liabilities computed from a return/formula
  and periodically remitted to a governmental authority — "a business
  must prepare an income tax return and compute the income taxes
  payable resulting from the operations of the current period"; "most
  corporations must make periodic tax payments... in an authorized
  bank depository." Directly grounds this document's
  `calculate → post → pay` shape and its `TaxLiabilityRecord` current-
  liability framing. A new citation, not reused from a prior spec (AP
  already cites Ch.13 p.13-4 for GR/IR timing — a different page and a
  different claim).
- **Fowler's *Analysis Patterns* / Hay's *Data Model Patterns*** —
  already confirmed near-empty for tax content
  (`financial-module-knowledge-base.md` §3, 2026-09-11 entry: Hay's
  only 3 "tax" hits are an unrelated "Federal tax ID" example
  attribute; Fowler's Ch.6 has zero occurrences). Not re-searched this
  pass — recorded there so a future pass doesn't repeat it.
- **Ordynacja podatkowa, art. 61b** and the Ministry of Finance's own
  mikrorachunek podatkowy specification (podatki.gov.pl, verified
  2026-09-16) — the actual primary source for the checksum algorithm
  and the identification-in-title requirement, ahead of any secondary
  explainer (same "Tier 1, ahead of any English textbook" posture this
  knowledge base already applies to Ustawa o rachunkowości).

**Step 3 — real-system comparison.** ERPNext, Odoo, and GnuCash have
no equivalent of a government-assigned, checksum-derived tax payment
account — a genuine, explainable divergence, not a gap: mikrorachunek
podatkowy is a Poland-specific administrative mechanism (introduced
2020), so no general-purpose or US/EU-generic accounting system would
have it. Odoo's own generic pattern (pay taxes as a normal vendor-style
payment against a liability account, per its own community
documentation) is consistent with this document's `TaxLiabilityRecord`
current-liability shape even without the Poland-specific payment
target. Comarch Optima's, enova365's, and Symfonia's specific
mikrorachunek handling was searched for (2026-09-16) but not
confirmed from public documentation — recorded as **Unverified**,
per `financial-spec-citation-check`, rather than assumed from their
general Polish-market positioning.

## Changelog

### 2026-09-16 — Initial draft

First draft, written after the Compliance & Audit Phase 2 work
surfaced that the earlier informal "Tax Management → Posting Rules
Engine" pairing was a mismatch. Two corrections made during drafting,
both reported to the user before finalizing rather than silently
applied:

1. **Placement**: found `SPEC-024-2026-02-11-financial-module.md` §10
   already mandates a Core-framework-plus-country-plugin split for Tax
   Management — this document follows that split (`tax_management` +
   `financial_pl`) rather than the single standalone module first
   proposed.
2. **Mikrorachunek mechanism**: the Event Storming source names a "KIS
   integration"; primary-source research (podatki.gov.pl + an
   independent algorithm writeup) found this is a pure, offline,
   NIP-derived checksum with no external integration and no documented
   connection to KIS at all. Corrected throughout this document
   (Design decisions, Architecture, Risks). Re-verified a second time,
   at the user's explicit request, with three more independent sources
   before committing to the correction: confirmed the checksum
   algorithm a second way (ISO/IEC 7064 mod-97-10, ["no mention of KIS
   or pre-registration requirements"]) and confirmed directly what KIS
   itself actually is (a taxpayer telephone helpline + individual
   tax-ruling service, no technical/API role) — also identified the
   likely origin of the original note: KIS's own site published the
   public announcement of mikrorachunek's 2020 launch, plausibly
   misread secondhand as "KIS provides the number."

Not yet reviewed. No implementation exists yet.

### 2026-09-18 (cont. — SPEC-010 moved to official-modules, references updated)

- **Update, not a scope or design change.** SPEC-010
  (`2026-09-11-jpk-kr-pd-financial-pl.md`), cited above as this
  document's own precedent for temporary staging and as the source of
  the JPK_KR_PD spec and the `requires: [...]` declared-dependency
  pattern, has moved to `official-modules#54` following a maintainer-
  review round and a code-verified compliance pass against that repo's
  own AGENTS.md/spec-writing rules. Updated the banner and the JPK_KR_PD
  citation to point at the new location; left the shorter "per SPEC-010"
  references to its content (the `requires: ['ledger']` pattern, the
  period-close trigger, JPK_KR_PD being already speced) unchanged, since
  those describe what SPEC-010 says, not where it lives. This
  document's own `financial_pl` half has not moved and its Phase 1/
  Phase 2 scope and open questions are unaffected.
