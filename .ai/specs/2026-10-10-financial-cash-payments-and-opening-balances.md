# Financial module — opening balances, payment methods, cash and bank, statements

**Status:** Specification (implemented in the same change)
**Program:** [`2026-10-09-financial-module-program.md`](2026-10-09-financial-module-program.md)
**Module:** `financial` (existing, app-local)
**Re-cuts:** the parts of program phases 4 (cash & bank) and 6 (statements) that make
Phase 1's ledger usable, plus the opening-balance capability the phasing never named.

## TLDR

Phase 1 ships a trustworthy double-entry book and Phase 1b makes it Saudi. Neither
answers the three questions an accountant asks on their first day: **what were we
carried in at**, **how was this paid**, and **what do the books say** — a balance
sheet and an income statement. This spec adds exactly those: opening balances as a
journal entry of their own, a payment-method register whose rows name the GL
account money lands in, a cash/bank account register, a payment command that posts
through both, and two statement read models. No new posting rule is introduced —
every write goes through the engine Phase 1 already built, which is the point.

## Problem Statement

1. **A ledger with no opening position cannot be adopted.** An entity migrating
   mid-life has balances on day one. Without a way to post them, the trial balance
   starts at zero and every statement is wrong by the carried-in amount — and
   doing it as an ordinary journal entry by hand makes "what was carried in"
   indistinguishable from "what happened since".
2. **"How was it paid" has nowhere to live.** `gl_journal_lines` records accounts,
   not tender. A cash sale and a mada sale post to different asset accounts, and
   with nothing declaring that mapping every caller re-decides it — which is how
   two screens end up posting the same till to two accounts.
3. **A till is not a GL account.** A bank account has an IBAN, a statement and a
   reconciliation; a GL account has a balance. Conflating them means a second bank
   account cannot share a GL account and a till cannot move between GL accounts
   without rewriting the ledger.
4. **Nothing reads the books.** A trial balance is a working paper, not a
   statement. "What do we own and owe" and "did we make money" are the two
   questions an owner asks, and both are arithmetic over data that already exists.
5. **A balance sheet that silently plugs its difference is worse than none.** The
   interesting output of a balance sheet is that it balances — including retained
   earnings from revenue and expense movement that no closing entry has yet swept
   to equity. A sheet that reports a plug account instead hides a posting error
   behind a number that always agrees.

## Proposed Solution

### Opening balances are a journal entry of type `opening`

`opening` joins `JOURNAL_ENTRY_TYPES` (`standard | adjusting | closing | reversing
| opening`) and the DB CHECK is widened to match. A set of balances is validated by
the same `assertJournalEntryRules` every other entry obeys — at least two lines,
single-sided, **balanced** — and posted as one entry. There is no offsetting line
and no plug account: a set that does not net to zero is a question about the
tenant's own figures, and `opening_balances_not_balanced` asks it rather than
answering it with a number nobody entered.

It is a distinct type rather than a `standard` entry with a note because the
question "what was carried in, before anything happened" has to be answerable from
the data. Posting is refused a second time (`opening_balances_already_posted`):
two opening entries double the carried-in position, and the second one is always a
mistake.

### Payment methods carry the GL account; cash accounts carry the operation

| Entity | Table | Answers | Key fields |
|---|---|---|---|
| `GlPaymentMethod` | `gl_payment_methods` | how the money was tendered, and which GL account that posts to | `code`, `name`, `kind` (`cash`/`bank_transfer`/`card`/`cheque`/`wallet`/`other`), `accountId`, `isDefault`, `requiresReference`, `sortOrder` |
| `GlCashAccount` | `gl_cash_accounts` | which till or bank account is being counted | `code`, `name`, `kind` (`cash`/`bank`), `accountId`, `currencyCode`, `bankName`, `iban`, `accountNumber`, `isDefault` |

The GL account is on the **method**, not on the payment, so a tenant configures it
once. It must be an **asset** account (`payment_account_must_be_asset`): posting
cash to a revenue account makes the trial balance disagree with the till and
nothing downstream can tell.

A cash account is deliberately not the GL account — it references one by id. A
second bank account can then share a GL account, and a till can be re-pointed
without touching a posted line.

`isDefault` is a product convention, not a data invariant: the writing command
clears the flag on the others in the same transaction rather than a partial unique
index failing a write.

**Seeding.** `setup.ts` seeds six methods (Cash — the default, Bank transfer,
Mada, Credit card, Cheque, STC Pay) and a Cash account, by `code`, resolving each
to the chart account of the matching `accountType`. Seeding is **skipped, not
failed**, when the chart of accounts has not been seeded yet, so a tenant is never
left with methods pointing at nothing.

### A payment is two lines

`financial.payments.record` takes a direction, a method, an optional cash account,
a counterparty account and an amount, and posts:

- **in** — debit where the money landed, credit what it came from;
- **out** — the reverse.

`buildPaymentLines` (pure, tested) refuses a non-positive amount
(`payment_amount_not_positive`) and identical accounts
(`payment_accounts_identical`). A refund is therefore a payment in the other
direction, not a negative receipt — the ledger reads as what happened. A method
declaring `requiresReference` refuses a payment without one
(`payment_reference_required`), because that reference is what makes a cheque
traceable to a bank statement.

### Statements are read models with an honest balance check

`lib/statements.ts` is pure. Balances net each account **by its normal balance**
(assets and expenses `debit − credit`; liabilities, equity and revenue the
reverse), and only accounts with a non-zero balance are reported.

The balance sheet carries **`netIncome` for everything up to `asOf`** and folds it
into equity, so it balances on a ledger that has traded without any closing entry
having been run. `balanced` reports the equality of the two totals; when it is
false the numbers are still returned. It never throws and never plugs.

The income statement reports revenue and expenses for a range with
`netIncome = totalRevenue − totalExpenses`; a loss is a negative figure.

Both read **only** `status: 'posted'` lines — a draft is a proposal, and a
statement built on drafts changes when somebody edits a form.

### Engine seam

`financialLedgerService` gains `loadAccountMovements(scope, range)`, returning
per-account movements at scale 4 with the account's class and normal balance. It
follows `loadPostedTaxLines`: the engine owns the query, a consumer receives a
plain read model, and nothing outside the module imports the ledger's entities.

## API Contracts

| Method | Path | Feature |
|---|---|---|
| GET/POST | `/api/financial/payment-methods` | `financial.payments.view` / `financial.payments.manage` |
| GET/PUT/DELETE | `/api/financial/payment-methods?id=` | same |
| GET/POST | `/api/financial/cash-accounts` | same |
| GET/PUT/DELETE | `/api/financial/cash-accounts?id=` | same |
| GET | `/api/financial/opening-balances` | `financial.read` |
| POST | `/api/financial/opening-balances` | `financial.post` |
| GET/POST | `/api/financial/payments` | `financial.payments.view` / `financial.payments.manage` |
| GET | `/api/financial/statements/balance-sheet?asOf=` | `financial.read` |
| GET | `/api/financial/statements/income-statement?from=&to=` | `financial.read` |

List filters are **column names** (`snake_case`) — the defect
`.ai/lessons/crud-filter-keys-must-be-column-names.md` records. Every mutating
endpoint carries the standard 409 body on a stale `updatedAt`.

## Access Control (`acl.ts`, additive)

```
financial.payments.view     View payment methods, cash accounts and payments   dependsOn: financial.read
financial.payments.manage   Manage payment methods, cash accounts and record payments  dependsOn: financial.payments.view
```

Opening balances and payments post entries, so they are gated by the existing
`financial.post` — the grant that already means "may put a line in the ledger".
`setup.ts` grants `payments.view` to `employee` and everything to `admin`.

## Events (`events.ts`, additive)

`financial.payment_method.created|updated|deleted`,
`financial.cash_account.created|updated|deleted` (CRUD, emitted by the side-effect
emitter), plus two lifecycle events: `financial.opening_balances.posted` (carries
the entry id and the total, so a consumer can tell a freshly opened ledger from a
trading one) and `financial.payment.recorded` (direction, amount, method code and
the entry that was posted).

## Data Models

Additive only: two new tables (`gl_payment_methods`, `gl_cash_accounts`), both with
`tenant_id`/`organization_id`, `created_at`/`updated_at` (so OSS optimistic
locking works), `deleted_at` for archive, and a partial unique index on
`(organization_id, tenant_id, code)`. One CHECK-constraint change: `entry_type`
gains `opening`.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| A balance sheet that plugs its difference hides a posting error | High | Reporting | Retained earnings are computed from revenue/expense movement; `balanced` is reported, never enforced by a plug; `netIncome` travels in the payload | A genuinely unbalanced ledger reports `balanced: false` and the operator investigates |
| Opening balances posted twice double the carried-in position | High | Ledger integrity | `opening_balances_already_posted` refusal inside the posting transaction | Undoing requires reversing the entry, as any posted entry does |
| A payment posts through the wrong account | High | Money | The account lives on the method, is validated as an asset (`payment_account_must_be_asset`), and the cash account's account wins when one is given | A tenant that misconfigures a method posts consistently to the wrong account — visible in the trial balance |
| Two rows claim to be the default method | Low | UX | The writing command clears the others inside its transaction | A concurrent create can leave two; the flag is presentational, not a rule |
| Seeding runs before the chart of accounts | Medium | Setup | Seeding resolves accounts by `accountType` and skips when none exists rather than pointing at nothing | A tenant that seeds the chart later re-runs `seedDefaults` to get the methods |

## Out of Scope (recorded, not forgotten)

Bank statement import and reconciliation, multi-currency revaluation, AP/AR
documents, fixed assets, budgeting, cost centres, consolidation and payroll. The
cash/bank register here is the anchor those phases attach to; `paymentMethodCode`
on a cash account is a **code, not a relation**, so nothing cascades when a method
is archived.

## Final Compliance Report

- Additive: two tables, new routes under the existing `/api/financial/…` prefix,
  new ACL ids, new event ids, new screens. No existing route, event id, spot id,
  DI key or ACL id changes.
- `BACKWARD_COMPATIBILITY.md`: the new ids are stable once shipped; nothing is
  deprecated. `JOURNAL_ENTRY_TYPES` gains a value — additive for a reader, and the
  widened CHECK accepts every previously valid row.
- No new production dependency.
- The migration is reviewed for drift; its `down` drops both new tables (the
  generator emitted only the CHECK revert, which was corrected by hand).

## Changelog

- **2026-10-10** — Spec created and implemented in the same change: opening
  balances as an `opening` journal entry, the payment-method and cash-account
  registers with their seeding, `financial.payments.record`, and the balance-sheet
  and income-statement read models. Integration coverage ships as
  `__integration__/TC-FINANCIAL-002-cash-payments-and-opening-balances.spec.ts`
  (chart-seed idempotency, a non-asset payment account refused, a duplicate method
  code refused, unbalanced opening balances refused, the balance sheet balancing on
  a freshly opened ledger, and a reversed statement range as a 400). The reported
  defect that a payment method's GL account is where money "lands" — and that a
  partial unique index declared with `options: { unique: true }` is not unique — is
  recorded in
  `.ai/lessons/partial-unique-indexes-need-the-expression-form.md`.
- **2026-10-10 (contra accounts)** — A section total now nets the **presented**
  sides (assets and expenses `debit − credit`, the rest the inverse) instead of
  summing each account's own-normal-side balance. The two agree only while every
  account in a section is normal on the same side, and one contra account broke it:
  1 000 of cash against 250 of accumulated depreciation — an asset that is
  credit-normal — totalled 1 250 and reported `balanced: false` on a ledger that was
  perfectly correct, turning the sheet's single real signal into a false alarm. The
  row presentation was already right (the contra row shows as a credit); it was the
  total that double-counted it. Pinned by two new cases: a contra account that
  offsets its section and leaves the sheet balanced, and a contra-revenue account
  that reduces `netIncome`.
