# SPEC-011 — Tax Payment (VAT/CIT/PIT) for `financial_pl`

> **Moved from `official-modules`.** Originally opened as open-mercato/official-modules#55 by @mikoajp. `official-modules` is deprecated and being archived, and `financial_pl` will not live there: the financial work continues in Core, with KSeF coming later as a separate PR (see open-mercato/official-modules#29). Content is unchanged apart from this block and the Prerequisites section below; the `SPEC-0xx` numbers inside refer to the `official-modules` numbering (Core already uses `SPEC-010` to `SPEC-013` for unrelated, implemented specs under `.ai/specs/implemented/`). Code references to `official-modules` (for example branch `feat/financial-pl-invoice-ux`) point to that archived repository. 

## Prerequisites

`financial_pl` is not in this repository yet. Everything this document says about its current code describes the package as it stands in `official-modules`, and the `packages/financial_pl_accounting/` paths are the target layout once the packages are brought into Core. Until then, read the referenced sources at these pinned revisions:

| Reference | Source |
|-----------|--------|
| `financial_pl` code (branch `feat/financial-pl-invoice-ux`) | [`packages/financial-pl` @ `17c575c`](https://github.com/open-mercato/official-modules/tree/17c575c9eb94893c9fc3da4036f5d19dc2b9369b/packages/financial-pl) |
| SPEC-010 JPK_KR_PD (`official-modules#54`) | `2026-09-11-jpk-kr-pd-financial-pl.md` (this repository; original at [`6b5dfb9`](https://github.com/open-mercato/official-modules/blob/6b5dfb9a67f66a35e791bce2e2ef998e305d8488/.ai/specs/SPEC-010-2026-09-11-jpk-kr-pd-financial-pl.md)) |
| SPEC-011 tax engines (`official-modules#55`) | `2026-09-16-tax-management-financial-pl.md` (this repository; original at [`79aa0b9`](https://github.com/open-mercato/official-modules/blob/79aa0b9d3724affa35bdc54d4944c07defbeb716/.ai/specs/SPEC-011-2026-09-16-tax-management-financial-pl.md)) |
| SPEC-012 integration contracts, SPEC-013 `financial_pl_accounting` | `2026-10-08-financial-pl-integration-contracts.md` and `2026-10-08-financial-pl-accounting-package.md` (this repository once open-mercato#7070 is merged) |
| `tax_management` Core framework (split from this document) | `2026-09-16-tax-management.md`, `open-mercato#6168` |

Open work this document waits on:

| Phase | Waits on |
|-------|----------|
| All phases | `financial_pl` and `financial_pl_accounting` brought into Core (SPEC-013) |
| VAT engine | `vatRegisterReadService` from `financial_pl` (SPEC-012, A3) |
| All phases | General ledger (#6340) and `tax_management` (#6168), whose `ITaxEngine`/`ITaxReporting` tokens the engines register against |
| CIT and PIT engines | GL balances read service (#6013) |
| Phase 2 | Cash & Bank Management (#6055), for reconciliation against imported statements |


> **Status: split out of `open-mercato#6168`, 2026-09-28.** This
> document used to be the `financial_pl` half of
> `open-mercato/.ai/specs/2026-09-16-tax-management.md`, staged
> temporarily in `open-mercato` alongside its `tax_management` Core
> framework half for the same reason `2026-09-11-jpk-kr-pd-financial-pl.md`
> (SPEC-010) was — the two had to be designed and reviewed together.
> Following the precedent SPEC-010 itself set (`official-modules#54`),
> this half now moves here permanently; `tax_management` (the Core
> framework module: `TaxCode`/`TaxCodeAccountMapping`/`TaxLiabilityRecord`,
> the `ITaxEngine`/`ITaxReporting` DI tokens, and the
> `calculateTaxLiability`/`postTaxLiability`/`markTaxLiabilityPaid`
> commands) stays in `open-mercato` as its own document
> (`.ai/specs/2026-09-16-tax-management.md`, PR #6168) — it is core
> product infrastructure other Core modules depend on, the same reason
> `ledger`/`accounts_payable` live there and not here.
>
> **Numbered `SPEC-011` provisionally, same basis SPEC-010 used**: as of
> this split, `develop` has `SPEC-001`–`004` merged, `SPEC-005`–`009`
> are each independently claimed by other, unrelated open PRs (patient
> cases, reservations, community workflow, staff extraction, appointment
> requirements), and `010` is SPEC-010 itself — `011` is the next free
> integer, not a coordinated reservation; happy to renumber at merge
> time.
>
> **Hard dependencies, in merge order:**
> 1. `open-mercato` — GL core engine (`feat/general-ledger-core-engine`,
>    `open-mercato#6340`) — `ledger.postJournalEntry` doesn't exist
>    without it.
> 2. `open-mercato` — `tax_management` (`.ai/specs/2026-09-16-tax-management.md`,
>    `open-mercato#6168`) — this document's `ITaxEngine`/`ITaxReporting`
>    registrations resolve against its DI tokens/registry, and
>    `generateTaxPaymentInstruction` reads `TaxLiabilityRecord` it owns.
> 3. `official-modules` — nothing internal to this repo; `financial_pl`
>    itself must already exist (it does — JPK_V7/KSeF, per SPEC-010's
>    own Overview).
>
> This document follows `official-modules/.ai/specs/AGENTS.md`'s
> required structure and its own `Final Compliance Report` gate (see
> below), not `open-mercato`'s `om-spec-writing` convention the parent
> document used while staged there.

## 📝 Target layout (decided 2026-10-08)

The Polish half of Tax Management lives in a new package,
`financial_pl_accounting` (module id `financial_pl_accounting`), not in
`financial_pl`, so that `financial_pl` stays installable without a ledger
(KSeF and JPK_V7 do not need one).

- **Dependencies.** Hard `requires` on `financial_pl`, `ledger`,
  `tax_management` and `financial_statements` (package overview: SPEC-013).
  `financial_pl` declares no `requires`.
- **VAT input.** The VAT engine reads `financial_pl`'s VAT register through
  a read-only DI service, `vatRegisterReadService` (SPEC-012), not through
  its entities. It posts only the settlement through `tax_management`. The
  CIT and PIT engines read GL balances (#6013). GL balances also reconcile
  the register (SPEC-013). This matches `open-mercato#6168`.
- **Identifiers.** Command `financial_pl_accounting.tax.generate_payment_instruction`,
  routes under `/api/financial-pl-accounting/tax/`, feature
  `financial_pl_accounting.tax.pay`, files under
  `packages/financial_pl_accounting/src/modules/financial_pl_accounting/`.
- **Reading this document.** Below, "`financial_pl`" as the place where the
  engines, routes and feature live means `financial_pl_accounting`;
  "`financial_pl`" as the source of the VAT register and JPK_V7 is
  unchanged.

## 📝 TLDR

Adds the Polish side (`financial_pl_accounting`) of period-close tax remittance: VAT/CIT/PIT
`ITaxEngine` implementations registered against `tax_management`'s DI
tokens, a pure offline mikrorachunek podatkowy (tax micro-account)
checksum calculator, and a `financial_pl_accounting.tax.generate_payment_instruction`
command + route that produces the IBAN + amount + tytuł przelewu an
accountant pastes into their own banking software. Phase 1 stops at the
instruction; sending the transfer is a human action, confirmed back via
`tax_management.markTaxLiabilityPaid` (Core, cross-module command call).

## Overview

`financial_pl` (`@open-mercato/financial-pl`) already covers KSeF 2.0
e-invoicing, JPK_V7 VAT filing, and (per SPEC-010) JPK_KR_PD annual books
filing. This document adds its first *payment*-side surface: turning a
`tax_management`-calculated tax liability (VAT, CIT, or PIT-4 withholding)
into the exact bank transfer an accountant needs to execute, using
Poland's mikrorachunek podatkowy convention. Audience: the same Polish
SMEs and accountants `financial_pl` already serves, who today compute
this transfer by hand or through a separate calculator.

## 📝 Problem Statement

`tax_management` (Core, `open-mercato`) defines the framework — tax code
registry, account mapping, liability lifecycle — but deliberately treats
tax calculation logic and the payment-instruction mechanism as plugin
concerns (SPEC-024 §10.2, "Tax Implementation (Plugin)"). Three things
are genuinely Poland-specific and belong here, not in the framework:

1. **What actually gets posted for VAT, CIT, and PIT-4** — the account
   roles and journal-line shapes differ per tax (see Architecture →
   Design decisions), and only the Polish package, which reads the VAT
   register through `financial_pl` and the GL account balances, has the
   domain logic to compute them.
2. **The mikrorachunek podatkowy checksum** — a Poland-specific,
   NIP/PESEL-derived bank account number (Design decisions below).
3. **The payment instruction itself** (IBAN + amount + tytuł przelewu,
   per Ordynacja podatkowa's identification requirement) — a
   Poland-specific document format built from #1 and #2.

## 📝 Proposed Solution

`financial_pl_accounting` (declares `requires` on `financial_pl`,
`ledger`, `tax_management` and `financial_statements`, see SPEC-013):

1. Registers `ITaxEngine`/`ITaxReporting` implementations for `VAT`,
   `CIT`, and `PIT` (PIT-4 withholding) against `tax_management`'s
   registry (see that document's Architecture → M2 fix) at module
   setup.
2. `tax/microAccount.ts` — `computeMicroAccount(identifier, kind)`, a
   pure, offline, deterministic checksum function (Design decisions).
3. `commands/generateTaxPaymentInstruction.ts` — reads a
   `TaxLiabilityRecord` from `tax_management` (cross-module read,
   matching the precedent `journal_entry_line_dimension`/`sales`/
   `catalog` already establish), reads the tenant's NIP from wherever
   `financial_pl` already sources it for KSeF/JPK_V7, computes the
   mikrorachunek, returns `{ iban, amount, currency, title }`.

Nothing in Phase 1 moves money (Alternatives considered, Phasing).

## 📝 Architecture

### New components in `financial_pl`

- `packages/financial_pl_accounting/src/modules/financial_pl_accounting/tax/microAccount.ts`
  — `computeMicroAccount(identifier: string, kind: 'NIP' | 'PESEL'):
  string`. No I/O. Unit-tested against the golden-file set below.
- `packages/financial_pl_accounting/src/modules/financial_pl_accounting/tax/taxEngine.ts` —
  registers `VAT`/`CIT`/`PIT` `ITaxEngine` implementations at module
  setup (`tax_management` is among the package's `requires`). Each implementation declares its
  `accountRoles` and returns balanced `lines[]` from `calculate()` —
  see Design decisions for what each tax actually needs.
- `packages/financial_pl_accounting/src/modules/financial_pl_accounting/commands/generateTaxPaymentInstruction.ts`
  — command id **`financial_pl_accounting.tax.generate_payment_instruction`**
  (module-prefixed per root `AGENTS.md` naming). Input:
  `{ taxLiabilityRecordId }`. **Not a mutating command — no persisted
  side effect, so no Undo Contract applies** (it only reads
  `tax_management`'s `TaxLiabilityRecord` and computes a response
  shape). Rejects if the record's `status` isn't `'posted'` (paying an
  unposted or already-`paid` liability is meaningless) or if the
  tenant's NIP is missing/malformed (Edge Cases).
- `packages/financial_pl_accounting/src/modules/financial_pl_accounting/api/POST/tax/payment-instruction.ts`
  — thin route wrapper, `requireFeatures: ['financial_pl_accounting.tax.pay']`
  (see API Contracts).
- UI block in the period-close screen (UI/UX below) calling this route,
  plus a "Mark as paid" button calling `tax_management.markTaxLiabilityPaid`
  through its own thin route (`POST /api/financial-pl-accounting/tax/mark-paid`,
  same `financial_pl_accounting.tax.pay` gate) — `markTaxLiabilityPaid` itself is a
  Core command with no ACL check of its own (matching the existing
  precedent that cross-module command targets trust their caller's
  route-level `requireFeatures`, e.g. `ledger.postJournalEntry` called
  from `accounts_payable`'s `postVendorInvoice`).

### Design decisions

**Mikrorachunek podatkowy is a pure, local, deterministic calculation —
verified structure, corrected from the parent document.** The parent
document (`2026-09-16-tax-management.md`) already established, against
primary sources (podatki.gov.pl, Ordynacja podatkowa art. 61b), that
this is *not* a KIS integration — a real correction against the
original Event Storming note, unchanged here. What PR #6168's review
(m1) caught, and this pass fixes, is the **exact digit layout**: the
parent document's math (prefix 11 + type 1 + raw identifier 10-or-11 +
check 2) totals 24 or 25 characters, not the required 26.

Re-verified 2026-09-28 against two independent sources
(taxmachine.pl, generatorliczb.pl — see Literature & Prior Art) because
the first source's own numeric "worked example" turned out to be
unreliable (see below) — both agree independently on the *structural*
fix: the identifier is padded with **trailing** zeros (not leading) to
a fixed **12-digit** field before the checksum is computed. Full
26-character layout:

| Segment | Length | Content |
|---|---|---|
| Check digits | 2 | ISO 7064 MOD 97-10, computed over the 24-digit body below + `PL` + `00`, placed at the front |
| Fixed prefix | 11 | `10100071222` (NBP routing + sub-account prefix, constant) |
| Type digit | 1 | `1` = PESEL, `2` = NIP |
| Identifier | 12 | NIP (10 digits) + `00`, or PESEL (11 digits) + `0` — **trailing** zero padding |

**A caution on sourcing the checksum itself, disclosed per
`financial-spec-citation-check`:** one fetched source's "worked
example" (a specific PESEL → specific 26-digit result) did not survive
independent verification — recomputing the same standard IBAN
check-digit algorithm by hand from its own stated inputs produced a
different check-digit pair, meaning that source's example number was
very likely synthesized by the page-summarizing step rather than
quoted verbatim from the page. Because of this, the worked examples
below are **not** taken from any single scraped "example" verbatim.
Instead: the check-digit algorithm itself (ISO 7064 MOD 97-10 — move
country code + `00` to the end, treat as one integer, mod 97, subtract
remainder from 98) was implemented and validated against two
well-known, independently-checkable reference IBANs before being
trusted (`GB82 WEST 1234 5698 7654 32`, `DE89 3704 0044 0532 0130 00` —
both reproduce correctly), and only then applied to compute the
NIP/PESEL examples below.

**Golden-file worked examples** (test NIP `1000001067`, a commonly used
non-real demo NIP):

```
identifier = "1000001067" (NIP, 10 digits)
type digit = "2"
id field   = "100000106700" (12 digits: NIP + "00" trailing padding)
BBAN       = "10100071222" + "2" + "100000106700"  (24 digits)
           = "101000712222100000106700"
check      = IBAN mod-97 over BBAN + "PL00" → "80"
mikrorachunek = "80101000712222100000106700"  (26 characters)
```

A second example (`1234567890`) computes to
`53101000712222123456789000`. Both are computed, not copied from a
third party — the golden-file test set (Testing Strategy below) must
be re-verified against the government's own generator
(podatki.gov.pl) or an accountant's real mikrorachunek before this
ships, since a wrong micro-account sends money to the wrong place
(Risks & Impact Review — this remains the single highest-severity risk
in this document, unchanged from the parent).

**VAT/CIT/PIT posting shapes — the Blocker (B1) fix.** PR #6168's
review found the parent document's single hardcoded
`{ expenseAccountId: debit, liabilityAccountId: credit }` shape gives
wrong books for 2 of 3 taxes. Verified directly against Kieso,
*Intermediate Accounting* 17th Ed.:

- **CIT** genuinely fits an expense/liability pair (Ch.13 p.13-8: "a
  business must prepare an income tax return and compute the income
  taxes payable... the company should credit Income Taxes Payable and
  charge the related debit to current operations"). `financial_pl`'s
  CIT engine declares `accountRoles: ['citExpense', 'citPayable']` and
  returns two lines:
  ```
  Dr  citExpense (e.g. "870 Podatek dochodowy")        amount
      Cr  citPayable (e.g. "226 Rozrachunki z US — CIT")     amount
  ```
- **VAT is not an expense.** Ch.13 p.13-8's own Sales Taxes Payable
  illustration shows collected sales tax credited straight to a
  payable, never routed through an expense account. This project's own
  chart of accounts already carries the two working VAT accounts (`220
  VAT naliczony`, `221 VAT należny` —
  `packages/core/.../defaultChartOfAccounts.ts`). Net VAT remittance at
  period close reclassifies *both* into a distinct payable — a
  **3-line** entry a fixed 2-line expense/liability shape cannot
  express at all:
  ```
  Dr  vatOutputClearing (221, closes its credit balance)    5,000.00
      Cr  vatInputClearing (220, closes its debit balance)       2,000.00
      Cr  vatPayable (e.g. "222 Rozrachunki z US — VAT")          3,000.00
  ```
  (worked figures illustrative — real amounts come from the period's
  actual 220/221 balances, out of scope per this document's own
  boundary, below).
- **PIT-4 (employer withholding) needs *zero* incremental posting.**
  Ch.13 p.13-10–13-11 (Illustration 13.5/13.6, "Payroll Deductions")
  shows the withheld income tax credited straight to a `Withholding
  Taxes Payable` account **out of Salaries and Wages Expense at
  payroll time** — it is never a separate expense, and for PIT-4
  specifically the liability already exists in the GL by the time
  `tax_management.calculateTaxLiability` runs (it only aggregates the
  period's balance, per this document's own Out of scope boundary — GL
  balance reading, #6013). `financial_pl`'s PIT engine therefore
  declares `accountRoles: []` and `calculate()` returns `lines: []` —
  a **valid, deliberately empty** result. `tax_management.postTaxLiability`
  (Core) accepts an empty `lines[]` by setting `status: 'posted'` with
  `journalEntryId: null` directly, skipping the `ledger.postJournalEntry`
  call entirely (documented as a Core-side edge case in that document).
  For a **sole trader** (not an employer withholding PIT-4 from
  employees, but paying their own personal income tax on business
  profit), Kieso's same page is explicit that this doesn't even belong
  on the business's books at all ("income tax liabilities do not
  appear on the financial statements of proprietorships and
  partnerships") — `financial_pl`'s PIT engine for a sole-trader tenant
  likewise returns `lines: []`, and the `TaxLiabilityRecord` exists
  purely to drive the payment instruction, never a posting.

This directly fixes B1: the framework's `ITaxEngine.calculate()`
contract (Core doc) returns role-keyed `lines[]` instead of a bare
amount, so each tax's real posting shape — 2 lines for CIT, 3 for VAT,
0 for PIT-4 — is expressible, and none of them is forced through an
"expense" account that doesn't apply.

**PESEL is personal data (m3).** `computeMicroAccount(identifier,
'PESEL')` is reached only for a sole-trader tenant without a NIP-based
registration path; the PESEL itself must be read via
`findWithDecryption`/`findOneWithDecryption` (matching
`packages/shared/lib/encryption/find.ts`'s existing pattern, used
throughout this module family — e.g. `reverseJournalEntry.ts`'s
`contractorSnapshot` read) wherever `financial_pl` already stores it,
and must never appear in logs, error messages, or the audit log's
`buildLog` payload — only the resulting mikrorachunek IBAN is safe to
surface.

**Currency (m2).** `generateTaxPaymentInstruction` reads
`TaxLiabilityRecord.currencyId` (a `uuid` FK to `Currency`, per the
Core document's own m2 fix — corrected from a bare `currency: string`
field) and resolves it to the ISO code for the response's `currency`
field. Mikrorachunek transfers are PLN-only in practice (Ordynacja
podatkowa's domestic tax remittance); `generateTaxPaymentInstruction`
rejects with a named error if the resolved currency isn't `PLN` rather
than silently converting — a Phase 2 candidate if a genuine
non-PLN-denominated tax liability is ever needed, not designed here.

### Undo Contract

- `financial_pl_accounting.tax.generate_payment_instruction` — **not undoable, and
  not applicable**: it persists nothing (Architecture above).
- `financial_pl`'s own `taxEngine.ts` registrations are setup-time DI
  wiring, not a command — no undo contract applies.

## 📝 Data Model

`financial_pl` adds no new entities for this feature. `computeMicroAccount`
is a pure function; the payment instruction it returns is a response
shape (API Contracts), not a persisted row. (Matches the parent
document's own original claim here — unaffected by the split or the
other fixes.)

## 📝 API Contracts

**`POST /api/financial-pl-accounting/tax/payment-instruction`** — body
`{ taxLiabilityRecordId }`, returns `{ iban, amount, currency, title }`.
`requireFeatures: ['financial_pl_accounting.tax.pay']` (new feature — see ACL
below; the parent document's "requires whatever ACL `financial_pl`
already gates its own JPK/KSeF submission routes with" was too vague
for a route that produces a bank transfer target, per review M4).
Rejects 422 if the tenant's NIP/PESEL is missing or malformed, 409 if
the record isn't in `'posted'` status, 422 if the resolved currency
isn't PLN.

**`POST /api/financial-pl-accounting/tax/mark-paid`** — body
`{ taxLiabilityRecordId, paidAt, paymentReference }`. Same
`requireFeatures: ['financial_pl_accounting.tax.pay']` gate. Internally calls
`commandBus.execute('tax_management.markTaxLiabilityPaid', { input: {...}, ctx })`
— the two-argument signature, matching every other cross-module command
call in this family.

### ACL

- `financial_pl_accounting.tax.pay` — gates both routes above. `defaultRoleFeatures`:
  `admin`/`superadmin` only (a route that both reveals a bank target and
  confirms payment is not an `employee`-level action, matching this
  family's existing posture for anything that touches money —
  `accounts_payable_payments`' own precedent).

## UI/UX

Within `financial_pl`'s existing period-close screen (wherever
JPK_KR_PD's own trigger lives, per SPEC-010): a copyable IBAN/amount/title
block calling `POST /api/financial-pl-accounting/tax/payment-instruction`, plus a
"Mark as paid" button calling `POST /api/financial-pl-accounting/tax/mark-paid`.
Both hidden (not merely disabled) for a viewer without
`financial_pl_accounting.tax.pay`.

## 📝 Edge Cases & Failure Scenarios

- **NIP/PESEL missing or malformed.** Rejected before computing a
  mikrorachunek — a wrong micro-account number sends money to the
  wrong place, the most consequential failure mode in this document;
  no fallback or best-effort computation.
- **`generateTaxPaymentInstruction` called on a non-`'posted'` record.**
  Rejected 409 — pre-empts confusion between "not yet posted" and
  "already paid."
- **Non-PLN `TaxLiabilityRecord.currencyId`.** Rejected 422 (Design
  decisions, Currency).
- **VAT engine's net figure is negative (input VAT exceeds output
  VAT — a refund position, not a liability).** `financial_pl`'s VAT
  engine returns `lines: []` and a distinct, out-of-band signal (not
  designed in this pass — VAT refund handling is a real Phase 2
  candidate, not the same shape as a payable) rather than posting a
  negative liability through the payment-instruction path; flagged
  here as a known gap, not silently mishandled.

## 📝 Risks & Impact Review

### Payment-instruction correctness

**Scenario:** `computeMicroAccount` has a subtle padding or check-digit
bug that produces a *valid-looking* but wrong 26-character IBAN; an
accountant pastes it into their bank's transfer form and the tax
payment is sent to the wrong account.
**Severity:** Critical.
**Affected area:** `financial_pl` tax payment, real money movement.
**Mitigation:** golden-file tests built from the government's own
generator output (podatki.gov.pl) for several real NIPs, not only the
two self-computed examples in this document (Design decisions'
"Golden-file worked examples" are a starting point, not a substitute
for checking against the real generator before shipping); the
check-digit algorithm itself independently validated against two
well-known reference IBANs before use (Design decisions).
**Residual risk:** Low once golden-file tests pass against the real
generator; Medium until then — this document alone does not close the
risk, only names how to close it.

### Wrong posting shape reintroduced by a future engine change

**Scenario:** A future country plugin (or a careless change to
`financial_pl`'s own CIT/VAT/PIT engines) reintroduces a hardcoded
expense/liability pair for a tax where it doesn't apply, silently
overstating expenses again (the original B1 defect).
**Severity:** Major.
**Affected area:** `financial_pl` tax engines, downstream financial
statements (CIT base, P&L).
**Mitigation:** `ITaxEngine.calculate()`'s contract (Core document)
requires named `accountRoles` and a balanced `lines[]`, not a bare
amount — the shape itself no longer permits a silent single
expense/liability assumption; unit tests per engine assert the
specific roles/lines this document specifies (CIT: 2 lines; VAT: 3;
PIT-4: 0).
**Residual risk:** Low — the contract shape is now the guard, not just
documentation discipline.

### PESEL exposure

**Scenario:** A sole trader's PESEL is read through a plain query
(bypassing `findWithDecryption`) or ends up in an error message/log.
**Severity:** Major (personal-data exposure).
**Affected area:** `financial_pl` mikrorachunek computation.
**Mitigation:** Design decisions above names the exact helper and the
never-log rule explicitly, so implementation has no ambiguity to fill
in incorrectly.
**Residual risk:** Low, contingent on implementation actually using
`findWithDecryption` — not verifiable from this document alone until
`commands/generateTaxPaymentInstruction.ts` exists.

## Alternatives considered

**Reconcile payment via Cash & Bank Management instead of a manual
`markTaxLiabilityPaid` confirmation.** Deferred, not rejected — a real
Phase 2 candidate once `open-mercato#6055` ships, matching a bank
statement line back to a `TaxLiabilityRecord` by amount/date/reference.
Not designed here because #6055 itself is not yet reviewed. (Carried
over from the parent document — this alternative belongs to the
payment-confirmation half, which lives here now.)

## Out of scope

- **Tax calculation logic's numeric inputs** — how much VAT/CIT/PIT is
  actually owed. `ITaxEngine.calculate`'s real implementation reads the
  VAT register through `financial_pl`'s read-only DI service
  `vatRegisterReadService` (SPEC-012) for VAT, and GL account balances
  (`open-mercato#6013`) for CIT and PIT; this document defines the posting
  *shape* (Design decisions) but not the balance-reading logic itself.
- **VAT refund handling** (Edge Cases).
- **Automated bank-rail payment execution.**
- **Any tax type for any country other than Poland** — this is
  entirely `financial_pl`'s slice; `tax_management` (Core) stays
  country-agnostic (its own document).

## Phasing

**Phase 1 (this document):** `computeMicroAccount`, VAT/CIT/PIT engine
registration, `generateTaxPaymentInstruction`, manual `markTaxLiabilityPaid`
confirmation.
**Phase 2 (not designed here):** VAT refund handling; reconciliation
against Cash & Bank Management's imported statements.

## Implementation Plan

1. `computeMicroAccount` + its golden-file test set (Risks) — build and
   test this before anything else in this document depends on it.
2. `taxEngine.ts`: `VAT`/`CIT`/`PIT` `ITaxEngine` registrations against
   `tax_management`'s registry (depends on that document's M2 fix
   existing).
3. `commands/generateTaxPaymentInstruction.ts` + its route + ACL
   feature.
4. UI block in the period-close screen + "Mark as paid" route.
5. Integration tests (Testing Strategy).
6. Record this split and its findings in
   `financial-module-knowledge-base.md` §3/§1 (matching the pointer
   already added for SPEC-010's own move).

## Testing Strategy

Integration coverage (m5): `POST /api/financial-pl-accounting/tax/payment-instruction`
happy path (200, correct IBAN for a golden-file NIP), 409 (non-`posted`
record), 422 (missing NIP, non-PLN currency); `POST
/api/financial-pl-accounting/tax/mark-paid` happy path and 403 without
`financial_pl_accounting.tax.pay`; the period-close screen's "Mark as paid"
button, gated the same way. `computeMicroAccount`'s own golden-file set
(unit-level, Design decisions) is the correctness backbone underneath
all of the above.

## File Manifest

| File | Action | Notes |
|---|---|---|
| `packages/financial_pl_accounting/src/modules/financial_pl_accounting/tax/microAccount.ts` | Create | Pure mikrorachunek checksum function |
| `packages/financial_pl_accounting/src/modules/financial_pl_accounting/tax/taxEngine.ts` | Create | VAT/CIT/PIT `ITaxEngine` registration, role-keyed balanced lines |
| `packages/financial_pl_accounting/src/modules/financial_pl_accounting/commands/generateTaxPaymentInstruction.ts` | Create | `financial_pl_accounting.tax.generate_payment_instruction` |
| `packages/financial_pl_accounting/src/modules/financial_pl_accounting/api/POST/tax/payment-instruction.ts` | Create | Route + `requireFeatures` |
| `packages/financial_pl_accounting/src/modules/financial_pl_accounting/api/POST/tax/mark-paid.ts` | Create | Calls `tax_management.markTaxLiabilityPaid` |
| `packages/financial_pl_accounting/src/modules/financial_pl_accounting/acl.ts` | Create | `financial_pl_accounting.tax.pay` (the package's own ACL) |
| `packages/financial_pl_accounting/src/modules/financial_pl_accounting/__integration__/tax-payment.spec.ts` | Create | Integration coverage above |
| `packages/financial_pl_accounting/src/modules/financial_pl_accounting/tax/__tests__/microAccount.golden.test.ts` | Create | Golden-file checksum set |

## Literature & Prior Art

**Ordynacja podatkowa, art. 61b** and the Ministry of Finance's own
mikrorachunek podatkowy specification (podatki.gov.pl) — the primary
source for the identification-in-title requirement, carried over
unchanged from the parent document.

**Mikrorachunek structure, re-verified 2026-09-28** — two independent
secondary sources fetched and cross-checked against each other:
[Algorytm generowania konta podatkowego i ZUS](https://www.pakietprzedsiebiorcy.pl/blog/algorytm-generowania-konta-podatkowego-i-zus)
(structure/prefix/type-digit description) and
[Generator mikrorachunku podatkowego](https://generatorliczb.pl/generator-mikrorachunku-podatkowego)
and
[Mikrorachunek podatkowy — kompendium](https://taxmachine.pl/pity/mikrorachunek-podatkowy)
(both independently confirming trailing-zero padding to a 12-digit
identifier field). Per `financial-spec-citation-check`, one of these
fetches' own "worked example" numeric result did **not** reproduce
under independent hand-computation of the same stated algorithm and is
therefore **not** relied on for the actual check-digit values used in
this document (Design decisions) — only the structural description
(padding direction, segment lengths, total length) is taken from these
sources; the check-digit values themselves come from this document's
own from-scratch implementation of the standard, well-documented ISO
7064 MOD 97-10 algorithm, validated first against two independently
verifiable reference IBANs (`GB82 WEST...`, `DE89 3704...`).

**Kieso, *Intermediate Accounting*, 17th Ed.**
- **Ch.13 p.13-8, "Sales Taxes Payable"/"Income Taxes Payable"**
  (verified 2026-09-28, full-text search): confirms sales-tax
  collections are credited straight to a payable, never through an
  expense account, and that corporate income tax is properly an
  expense/payable pair; also confirms proprietorship/partnership
  income tax liabilities "do not appear on the financial statements"
  of the business at all. Directly grounds the VAT/CIT/PIT-for-sole-trader
  posting-shape fix (Design decisions).
- **Ch.13 p.13-10–13-11, Illustration 13.5/13.6, "Payroll Deductions"**
  (verified 2026-09-28): the worked payroll entry shows income tax
  withholding credited to `Withholding Taxes Payable` directly out of
  `Salaries and Wages Expense`, never as its own expense line — grounds
  the PIT-4 zero-incremental-posting fix (Design decisions). A new
  citation for this project's financial-module family — not
  previously used by any sibling spec.

**ERPNext, Odoo, GnuCash** — re-confirmed from the parent document:
none have an equivalent of a government-assigned, checksum-derived tax
payment account; a genuine, explainable divergence (mikrorachunek is a
Poland-specific mechanism introduced 2020), not a gap.

**Comarch ERP Optima, enova365, Symfonia (Poland-specific reference
systems), verified 2026-09-28** — checked per this project's
comparison-step convention for `financial_pl` specs (not done in the
first pass of this document; added on review). All three diverge from
this document's design the same way: none of them computes the
mikrorachunek from the taxpayer's NIP/PESEL inside the application.
Each instead stores a manually entered or one-time looked-up account
number against the tax office/company profile and reuses it when
generating payments:
- **Comarch ERP Optima** — [Deklaracje, a płatności z nimi
  związane](https://pomoc.comarch.pl/optima/pl/2026/dokumentacja/deklaracje-a-platnosci-z-nimi-zwiazane/):
  declaration-linked payments post to a Kasa/Bank preliminary-payments
  list for manual transfer; ZUS individual account numbers are
  explicitly "wprowadzić" (entered) on the office form, not derived.
- **enova365** — [Indywidualny rachunek podatkowy w
  enova365](https://erpit.pl/post/54-indywidualny-rachunek-podatkowy-w-enova365):
  the account is entered once under Narzędzia → Opcje → Firma → Urzędy
  i KRS (or per-owner for PIT) and auto-populated onto VAT/CIT payments
  from then on — not recomputed from NIP/PESEL each time.
- **Symfonia** (Start Mała Księgowość) — [Przelew podatku do
  US](https://pomoc.symfonia.pl/data/mk/Start/2024_b/data/html_mkrp0054.htm):
  "Jeżeli typy i numery rachunków urzędu nie zostały wprowadzone w jego
  opisie, to należy wpisać numer rachunku" — manual entry is the
  documented fallback; a dropdown only reuses a previously hand-entered
  number.

This is a genuine, checkable design choice, not a gap in our research:
all three market-leading Polish systems treat the mikrorachunek as
configuration data entered once, rather than a value the software
derives at generation time. This document keeps live computation
(Design decisions) because it removes a manual setup step and a class
of transcription errors, and the algorithm is public and stable since
its 2020 introduction — but this is now a disclosed, deliberate
divergence from market practice, not an oversight. ⚠ Worth a
maintainer's explicit sign-off: if the team prefers to match market
convention (store the number instead of computing it, falling back to
computation only when unset), that is a small change to the command's
data source, not a redesign.

## Final Compliance Report — 2026-09-28

### AGENTS.md Files Reviewed

- `AGENTS.md` (root, `official-modules`)
- `.ai/specs/AGENTS.md`
- `.ai/skills/spec-writing/SKILL.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Module is an external extension; MUST NOT modify core packages | Compliant | No core package touched; `tax_management` (in `open-mercato`) consumed via `requires` + DI resolution, same pattern SPEC-010 already established for `ledger` |
| root AGENTS.md | No cross-module `@ManyToOne` ORM relationships | Compliant | No new entities; `TaxLiabilityRecord` is read via a cross-module query, not an ORM relation |
| root AGENTS.md | MUST filter every query by `organization_id` | Compliant | Both new routes derive scope server-side, matching `resolveCommandScope(ctx)` precedent from SPEC-010 — real implementation must call it, not accept scope from the request body |
| root AGENTS.md | MUST validate all inputs with zod in `data/validators.ts` | Non-compliant | Schema shapes are named in prose, not written as zod literals — real `data/validators.ts` needs `taxPaymentInstructionSchema`/`taxMarkPaidSchema` before implementation |
| root AGENTS.md | MUST use `findWithDecryption`/`findOneWithDecryption` for PII | Compliant | Explicitly named for the PESEL read path (Design decisions, m3) |
| root AGENTS.md | MUST use declarative guards (`requireAuth`, `requireFeatures`) | Compliant | `financial_pl_accounting.tax.pay` named and applied to both routes (API Contracts) |
| root AGENTS.md | MUST NOT return sensitive data in error messages | Non-compliant | Not audited — real route error paths (malformed NIP, missing mapping) must be checked before implementation to confirm no PESEL/NIP fragment leaks into a 4xx body |
| root AGENTS.md naming | Command ID `<moduleId>.<feature>.<action>` | Compliant | `financial_pl_accounting.tax.generate_payment_instruction` |
| spec-writing SKILL.md | Undo Contract as detailed as Execute | Compliant (N/A) | The one command in this document is non-mutating; explicitly marked N/A with reasoning, not silently omitted |
| spec-writing SKILL.md | Module Isolation — DI usage specified | Compliant | the package's `requires` include `tax_management` and `ledger` (SPEC-013); registration mechanism named (`taxEngine.ts`, setup-time) |
| spec-writing checklist §7 | Risk Register required format | Compliant | Risks & Impact Review above uses Scenario/Severity/Affected area/Mitigation/Residual risk throughout — written fresh in this format, not carried over from the parent document's prose-style Risks section |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No new entities; API response shape matches Architecture |
| Commands defined for all mutations | Pass | The only state-changing action (`markTaxLiabilityPaid`) is a Core command called through its own route; `generate_payment_instruction` is explicitly non-mutating |
| Undo contract covers every mutating command | N/A | No mutating command originates in this document |
| Risks cover all write operations | Pass | The one write path (`mark-paid`) is covered by the "Wrong posting shape" and "PESEL exposure" risks' surrounding controls; a dedicated risk entry for double-mark-paid is intentionally left to the Core document, since `markTaxLiabilityPaid`'s own idempotency/concurrency guard lives there |

### Non-Compliant Items

- **Rule**: MUST validate all inputs with zod
  **Source**: root `AGENTS.md`
  **Gap**: Schema shapes named, not written as zod literals
  **Recommendation**: Write `taxPaymentInstructionSchema`/`taxMarkPaidSchema` in `data/validators.ts` before implementation

- **Rule**: MUST NOT return sensitive data in error messages
  **Source**: root `AGENTS.md`
  **Gap**: Not audited against this document's own error paths
  **Recommendation**: Before implementation, confirm no error path echoes a NIP/PESEL fragment or partial mikrorachunek back in a 4xx body

### Verdict

**Non-compliant — Blocked** on the two documentation gaps above before
implementation; neither is an architecture-level blocker. Architecture-level
compliance (module isolation, DI pattern, command naming, undo
contract, risk format) is Confirmed as of this report.

## Changelog

### 2026-09-16 — Initial draft (as part of the combined document)

See `.ai/specs/2026-09-16-tax-management.md`'s own Changelog for this
document's full history before the split (initial draft, mikrorachunek
KIS-integration correction and its two verification passes).

### 2026-09-28 — Split from `open-mercato#6168`, PR #6168 review findings applied

Split out per the same reasoning SPEC-010 used, at the user's explicit
request after PR #6168's automated review. Findings from that review
addressed in this document specifically:

- **B1 (Blocker)**: VAT/CIT/PIT posting-shape fix — worked examples
  above, grounded in Kieso Ch.13 pp.13-8, 13-10–13-11 (new citations).
- **M3 (package placement)**: resolved by the split itself — this
  document's files now live in `official-modules`, matching the
  banner's own `financial_pl` target from the start.
- **M4 (authorization)**: named `financial_pl.tax.pay` feature +
  `requireFeatures` on both routes, replacing the vague "whatever ACL...
  already gates" language.
- **m1 (mikrorachunek math)**: corrected digit layout (trailing-zero
  padding to 12 digits, not raw identifier), independently verified
  check-digit algorithm, golden-file worked examples.
- **m2 (currency)**: response `currency` now resolved from the Core
  document's corrected `currencyId: uuid` field, PLN-only enforced.
- **m3 (PESEL)**: explicit `findWithDecryption`/never-log requirement.
- **m5 (integration coverage)**: Testing Strategy section added,
  listing both new routes and the golden-file set.
- **Nit**: this document is written directly in
  `official-modules/.ai/specs/AGENTS.md`'s required structure from the
  start (Overview, Final Compliance Report, Risk Register format),
  rather than carrying over `om-spec-writing`'s narrative-research
  style research passages verbatim.

### 2026-09-28 (follow-up) — financial-spec-writing-process Step 3 completed

The first pass of this document's split left Step 3 (real-system
comparison) incomplete for the Poland-specific mikrorachunek design —
only ERPNext/Odoo/GnuCash had been checked, and none of those model a
country-specific tax account at all. Flagged by Mikołaj; followed up
by checking the actual Poland-specific reference systems the process
calls for (Comarch ERP Optima, enova365, Symfonia — see Literature &
Prior Art above): all three store the mikrorachunek as manually
entered configuration rather than computing it from NIP/PESEL, a real
and now-disclosed divergence from this document's live-computation
design. No other section changed.

Not yet reviewed under `official-modules`' own maintainer process. No
implementation exists yet.

### 2026-10-08 — target layout, VAT input
- The engines, mikrorachunek and payment-instruction flow move to the package `financial_pl_accounting` (Target layout section). Command, route, feature and file-path identifiers are renamed; the engines and ACL logic are unchanged.
- The VAT engine's input is the VAT register read through `vatRegisterReadService` (SPEC-012), no longer GL balances; CIT and PIT still read GL balances. Matches the 2026-10-08 change in `open-mercato#6168`.
- Dependencies: the package `requires` `financial_pl`, `ledger`, `tax_management` and `financial_statements` (SPEC-013), instead of adding `requires` to `financial_pl`.
