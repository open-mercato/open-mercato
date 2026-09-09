# General Ledger — Account Balances & Trial Balance (ZSiO)

## TLDR

**Key Points:**
- Adds read-only balance and turnover reporting on top of the `ledger` module's existing schema (`JournalEntry`/`JournalEntryLine`/`LedgerAccount`) — no changes to the posting schema or `postJournalEntry`. Ships as Phase 2 of the `ledger` module (#5663), not a new module.
- Restores `getAccountBalance` (cut from #5663 Phase 1 as a stakeholder-directed scope reduction) and adds the ZSiO report (Zestawienie Obrotów i Sald / Trial Balance, art. 18 Ustawy o rachunkowości): opening balance, period and year-to-date debit/credit turnover, and closing balance per account, distinguishing syntetyk (an account with children under `parentAccountId`) from analityk (a leaf account), per the Event Storming Section 05 hot spot (HS-11 already gave us `parentAccountId` for exactly this).
- Balances are computed live from `JournalEntryLine` — no new tables, no changes to the write path.

**Scope:**
- Per-account balance as of a date (`GET /api/ledger/accounts/:id/balance`), recursively including descendant accounts for a syntetyk account that also has direct postings of its own.
- ZSiO: every `LedgerAccount` for a fiscal period, opening/period-turnover/YTD-turnover/closing, syntetyk and analityk rows, reconciled against the journal per art. 18.
- Zero-sum invariant check across all accounts as a built-in report property, not a separate mechanism — a direct consequence of #5663's own dual balance enforcement (application + database trigger).

**Concerns:**
- Posted-only in Phase 1 — no read of AP/AR draft/buffer state. `2026-09-06-accounts-payable.md`'s Out of scope carries a matching cross-reference back to this document.
- Live query, not a maintained balance table — reversible later if real measurement shows it's needed; not built for a scale that isn't confirmed yet.
- Scoped to ZSiO only, not Bilans/P&L/Cash Flow — those map accounts to statutory line items, a materially different and larger piece of work, and become their own future document(s).
- Ships as `ledger` Phase 2, not a new module.

## Overview

Accountants need to see what a chart of accounts and a journal actually
add up to — not just that individual entries balance (#5663's own
invariant), but what every account's balance is, as of any date, and
whether the books as a whole are consistent. Poland's Ustawa o
rachunkowości requires exactly this as a named, recurring artifact:
art. 18 mandates a "zestawienie obrotów i sald" (ZSiO) — one row per
general-ledger account, at minimum monthly, showing the opening
balance, this period's turnover, cumulative turnover since the start
of the fiscal year, and the closing balance, with the turnover figures
required to reconcile against the journal (dziennik).
This document adds that capability on top of #5663's already-reviewed
schema, without touching it.

Target audience: the accountant persona already established by #5663's
own User Stories (the same person who manages the chart of accounts
and reviews the journal) — this document gives them the report they'd
otherwise have to build by hand from `journal-entries` list exports.

> **Market Reference**: Odoo's Trial Balance / General Ledger report
> (`account.report` "Trial Balance") computes balances live from the
> `account.move.line` table at request time — no maintained running-
> balance table in the open-source edition, filtered by date range and
> grouped by account, with a parent/child account hierarchy rollup
> matching this document's syntetyk/analityk distinction. Adopted:
> the live-query approach and the hierarchy rollup shape. Rejected:
> Odoo's per-account "reconcile" workflow (matching debit/credit lines
> against each other for open-item accounts) — that's a bank/AP-
> reconciliation concern (Event Storming Section 04), not a trial-
> balance concern, and already out of scope here.

## Problem Statement

Three things are true today and none of them let an accountant answer
"what does this account's balance look like right now, and do the
books foot correctly":

1. `GET /api/ledger/journal-entries` (the only read surface #5663
   ships) returns individual entries, not balances — an accountant
   would have to sum `debit`/`credit` across every line, for every
   account, by hand, across however many pages of results, to get a
   single account's balance.
2. `LedgerAccount.parentAccountId` (added 2026-09-06, HS-11) is
   structural only — nothing anywhere reads it. A syntetyk account's
   balance (which must include every analityk child rolled up into
   it) cannot be produced today.
3. Art. 18's specific, named requirement — a ZSiO, at minimum monthly,
   with opening/turnover/closing per account, reconciled against the
   journal — has no artifact in this system at all, not a partial one.

This is not the same gap as "subsidiary ledgers" (art. 13 ust. 1 pkt
3 / art. 16), which #5663's own Out of scope already resolved belongs
to AP/AR (`VendorInvoice` etc., confirmed by `2026-09-06-accounts-
payable.md`'s control-account design). Art. 18's ZSiO is specifically
about the general-ledger accounts themselves (`LedgerAccount` rows) —
a different legal requirement, satisfied by a different mechanism, and
the one this document builds.

## Proposed Solution

Two read-only capabilities, both computed on demand from
`JournalEntryLine`, added to the existing `ledger` module:

1. **`getAccountBalance`** — an account's balance as of a given date,
   recursively including every descendant account (so a syntetyk
   account's balance is correct whether or not it also has direct
   postings of its own).
2. **ZSiO** — every `LedgerAccount` for a chosen fiscal period: opening
   balance (as of the period's start), this period's debit/credit
   turnover, year-to-date turnover since the fiscal year containing
   the period began, and the closing balance — plus the zero-sum
   check across every account as a report-level property.

Both read `JournalEntryLine` directly, filtered by
`organization_id`/`tenant_id` and `posted_at`, with no new entities and
no change to `postJournalEntry`'s transaction.

### Design decisions

**Balance sign follows `normalBalance`, always.** For a `DEBIT`-normal
account (Asset, Expense): `balance = SUM(debit) - SUM(credit)` over
the relevant `JournalEntryLine` rows. For a `CREDIT`-normal account
(Liability, Equity, Revenue): `balance = SUM(credit) - SUM(debit)`.
This is the same convention #5663 already uses to decide which side of
a `JournalEntryLine` an account normally grows on (Design decisions,
"Normal balance lives on the account type, not the account") — this
document doesn't introduce a second convention, it reads the existing
one.

**"Opening balance as of a date" is not a stored concept — it's the
same balance formula, evaluated at an earlier date.** The opening
balance for a period is `getAccountBalance(accountId, periodStartDate
- 1 day)`; the closing balance is `getAccountBalance(accountId,
periodEndDate)`. There is deliberately no separate "prior period
closing balance" table or field: it would be a second source of truth
that could drift from what the journal actually says, for a table
where — per #5663's own words — "the database quietly went out of
balance" is not a recoverable failure mode. One formula, evaluated at
two dates, is the only version of this that can't disagree with
itself.

**Syntetyk balance is a recursive rollup over `parentAccountId`, not a
separate stored aggregate.** A syntetyk account (one with children) is
not restricted from also receiving direct postings in Phase 1 — #5663
never added that restriction (the future Posting Rules Engine's own
design notes call out "reject a direct post to an account that has
children — only its analytic leaves are postable" as *its own*, not
yet built, concern). So a syntetyk account's balance must be: its own
direct `JournalEntryLine` rows, plus the same recursive rollup applied
to every descendant, summed together. Implemented as a single `WITH
RECURSIVE` CTE walking `parentAccountId` from the requested account
down to its leaves, then aggregating `JournalEntryLine` over that
whole set. **This is the first use of a recursive CTE anywhere in this
codebase** (checked: no existing module aggregates a self-referencing
tree this way) — called out explicitly here rather than left as a
silent precedent-setting choice, because the alternative (walking the
tree in application code) is either N+1 queries per level of depth or
loading the whole account table into memory, and neither scales better
than one recursive query does for a tree that Section 00's own hot
spot says could reach "1–999999 pozycji."

**`getTrialBalance` computes every account's row in one set-based pass
— it does not call `getAccountBalance` once per account.** An earlier
version of this design described the ZSiO query as calling
`getAccountBalance` twice per `LedgerAccount` (opening, closing) plus a
separate turnover sum; at the "1–999999 pozycji" chart-of-accounts
scale the same hot spot names above, that is N+1 in the number of
accounts, not just a single recursive query. Corrected: `getTrialBalance`
runs the same `WITH RECURSIVE` account-tree walk once for the whole
chart, and computes all four figures per account in that single pass
using conditional aggregation over `JournalEntryLine`
(`SUM(CASE WHEN posted_at < periodStart THEN signedAmount END)` for
opening, equivalent `CASE` expressions scoped to the period and to the
fiscal year for `periodDebit`/`periodCredit`/`ytdDebit`/`ytdCredit`,
and one scoped through `periodEnd` for closing), joined against the
recursive descendant set already computed for the tree walk. This is
one SQL statement producing every row, not one round trip per account
— see Queries.

**Live query, not a maintained balance table — a deliberate, reversible
choice, not a default.** `postJournalEntry` already validates and
persists a balanced entry with no notion of "this account's running
total"; adding one would mean every posting also writes to a second
table, in the same transaction, that this document would then own the
correctness of forever. Rejected in favor of computing `SUM()` at read
time: this matches #5663's own stated intent ("layers on later without
changing the posting schema") and avoids optimizing for a load the
system has not measured yet — the same reasoning already used
elsewhere in this document family for `journal_entry_line_dimension`
("don't build the mechanism until there's a real consumer"). If a real
measurement later shows this doesn't hold up at production data
volumes, the fix is additive (a materialized/cached balance table
behind the same `getAccountBalance` function signature) and does not
require redesigning this document's API or data model — see Risks &
Impact Review.

**Posted-only in Phase 1 — the "Bufor Toggle" hot spot is deferred, not
solved.** The Event Storming wall (Section 05) names "Bufor Toggle" as
an open hot spot for exactly this report, and separately resolves
(HS-08/09) that buffer/draft state lives in AP/AR, not `ledger`. This
document reads only `JournalEntryLine` rows belonging to a posted
`JournalEntry` — by construction, since nothing else exists in this
schema — so it has zero dependency on AP/AR/JELD and can ship as soon
as this document is approved. A future "include AP/AR drafts" toggle
is a real, designed cross-module read this document does not attempt
here; `2026-09-06-accounts-payable.md`'s Out of scope now carries a
matching note (added 2026-09-09) that AP's own implementation is the
trigger to come back and design it.

**Scoped to ZSiO — not Bilans, not P&L, not Cash Flow.** The Event
Storming wall lists these together under one "Zdarzenia" line in
Section 05, but the scope-cohesion test this document family already
applies elsewhere gives a clean answer: ZSiO works standalone (an
accountant checks it zeroes out, independent of any statement) —
Bilans/P&L do not work without ZSiO (they need account balances as
their input, mapped onto statutory line items). That mapping — which
`LedgerAccountGroup`/zespół maps to which line of the Bilans or which
P&L variant (4xx vs 5xx) — is a distinct, larger piece of work
(statutory formatting rules, not account arithmetic) and is out of
scope here, tracked as a future document.

**Turnover figures include every `JournalEntry.type` — no filtering by
`NORMAL`/`OPENING`/`CLOSING`/`REVERSAL`.** `periodDebit`/`periodCredit`/
`ytdDebit`/`ytdCredit` are raw `SUM(debit)`/`SUM(credit)` over every
posted `JournalEntryLine` in range, regardless of the parent
`JournalEntry`'s `type`. This has one visible consequence worth naming
explicitly rather than leaving it to be discovered during review: once
a year-end `CLOSING` entry is posted (#5663's own in-scope mechanism
for zeroing Revenue/Expense to Retained Earnings — that document's
Design decisions, "Fiscal period closing is a lock flag plus an entry
type"), a revenue account's period debit will include the closing
entry's own zeroing debit alongside its real credit-side turnover for
the year, and symmetrically an expense account's period credit will
include its own zeroing credit. This is not a defect: it is the same
shape every introductory accounting text shows for a post-closing
period (Kieso/Weygandt/Warfield, *Intermediate Accounting*, 17e, ch.
3, "Closing Entries" — the illustrated closing journal entry debits
every revenue account and credits every expense account for its
full-year balance, exactly this document's `JournalEntryLine` shape).
Excluding `CLOSING` (or `OPENING`) lines from the sum would also mean
the period's total turnover no longer reconciles against the journal —
the literal requirement art. 18 imposes (turnover must "zgadzać się z
zapisami dziennika"). Filtering by type would additionally be a second
code path this document doesn't otherwise need: `getAccountBalance`
already includes every posted line regardless of type, and
`getTrialBalance`'s turnover columns use the identical, unfiltered
predicate for consistency with it. The closing (and, symmetrically,
opening) *balance* is unaffected either way — a `CLOSING` entry's own
lines are exactly what bring a revenue or expense account to zero,
which is what `zeroSumCheck` and the per-row invariant in Testing
Strategy actually verify.

**The account-hierarchy and posting-side decisions above were checked
against the standard literature, not invented from scratch.**
Restricting posting to detail (leaf) accounts and deriving a summary
account's balance recursively from its components is the canonical
pattern (Fowler, *Analysis Patterns*, §6.3 "Summary Account": "We
restrict the system to posting entries only to detail accounts and not
to summary accounts... A summary account that contains summary
accounts will look for entries in its components, its components'
components, and so on, recursively"). This document does *not* adopt
that restriction itself — Phase 1 of #5663 never restricted postings
to leaves, so the rollup above deliberately also sums a syntetyk
account's own direct postings (see Alternatives considered) — but the
future Posting Rules Engine, when it does add that restriction, will
be completing this exact standard pattern, not inventing a new one.
Keeping `parentAccountId` a single-parent tree rather than a
multi-parent DAG matches both references, too: Fowler's own
multi-parent generalization (§6.15) immediately follows with a warning
that an account summing over overlapping components "is more likely to
be the product of accident than design," and Hay (*Data Model
Patterns*, ch. 7, "Summarization") is more direct still — "if a
company wanted to allow multiple roll-up paths... administering such
an arrangement would be extremely difficult." Finally, the
`normalBalance`-signed balance formula (Design decisions, "Balance
sign follows normalBalance, always") matches Hay's own Table 7.1
(Debits and Credits: Asset debit +, credit −; Liability/Equity debit
−, credit +) and Kieso's identical treatment (ch. 3, "Debits and
Credits") — the same convention, independently and consistently
stated across a 1996 data-modeling text, a 1997 analysis-patterns
text, and the current edition of the standard intermediate-accounting
textbook.

### Alternatives considered

| Alternative | Why Rejected |
|-------------|---------------|
| Maintain a running balance on `LedgerAccount` (or a new table), updated inside `postJournalEntry` | Touches the already-reviewed posting transaction for a performance need that isn't measured yet; a live query gets the same answer with zero write-path risk (see Design decisions) |
| Restrict ZSiO/balance to leaf (analityk) accounts only, since #5663 never restricted posting to leaves | Would silently produce a wrong balance for any syntetyk account that also has direct postings — Phase 1 explicitly allows that (no leaf-only posting restriction exists yet), so the rollup must account for it |
| Bundle Bilans/P&L into this same document, since the workshop wall lists them together | Fails the scope-cohesion test (Bilans/P&L depend on ZSiO, not vice versa) — bundling would make this document depend on statutory-mapping decisions that have nothing to do with whether account arithmetic is correct |
| Include an AP/AR "bufor" toggle in Phase 1 | Real cross-module dependency this document would need AP/AR's draft-document shape to design against, and AP/AR's own draft/submitted states aren't built yet — deferred to Phase 2, with the cross-reference recorded in `2026-09-06-accounts-payable.md` |

## User Stories

- **Accountant** wants to **see any account's current balance, and any
  historical account's balance as of a past date** so that they can
  answer a balance question without exporting and manually summing
  journal entries.
- **Accountant** wants to **generate a ZSiO for a fiscal period** so
  that they can confirm the books foot correctly (art. 18) before
  closing the period or handing figures to an auditor.
- **Accountant** wants to **see a syntetyk account's balance already
  including its analityk children** so that a report at the `130
  Rachunki bieżące` level reflects `130-1 mBank` and every other child
  account without manually adding them up.

## Architecture

### Access Control (`acl.ts`)

One new feature, added to the existing `ledger` feature list (not a
new module's `acl.ts`):

```typescript
{ id: 'ledger.reports.view', title: 'View account balances and ZSiO', module: 'ledger' },
```

No `.manage` counterpart — this capability has no mutation surface.
`getAccountBalance`'s HTTP route and the ZSiO route both require
`ledger.reports.view`.

### Module Setup (`setup.ts`)

```typescript
defaultRoleFeatures: {
  admin: ['ledger.*'],       // unchanged — already covers the new feature
  employee: [
    'ledger.accounts.view',
    'ledger.entries.view',
    'ledger.periods.view',
    'ledger.reports.view',   // added
  ],
},
```

No change to `seedDefaults` — this document adds no entities and
therefore nothing to seed.

### Queries (`queries/`)

Following the project's convention that reads are direct entity
queries by trusted, in-module or hard-dependency code (not commands —
commands are for writes; see root `AGENTS.md` Task Router), this
document adds two query functions, not commands. Both take the request
`em` (resolved from the Awilix container by the calling route, the
same pattern every other `ledger` query already uses — no new DI
wiring):

- `getAccountBalance(em, { accountId, tenantId, organizationId, asOf })`
  — runs the `WITH RECURSIVE` CTE described in Design decisions,
  scoped by tenant/organization, filtered to `posted_at <= asOf`,
  returns a single signed balance (already normalized to the
  account's `normalBalance` side).
- `getTrialBalance(em, { tenantId, organizationId, periodId, cursor?, limit? })`
  — resolves the named `FiscalPeriod`'s `startDate`/`endDate` and the
  fiscal year containing it (the earliest `FiscalPeriod` in that
  calendar/fiscal year — see Data Models), then runs **one** `WITH
  RECURSIVE` query over the whole chart of accounts computing
  opening/period-turnover/YTD-turnover/closing per account via
  conditional aggregation (Design decisions,
  "`getTrialBalance` computes every account's row in one set-based
  pass") — not `getAccountBalance` called per account. Two results
  come out of that same query family:
  - `zeroSumCheck` (`true` when every closing balance nets to zero
    across the *entire* chart) is a single aggregate over all accounts,
    computed independently of pagination — cheap regardless of chart
    size, and never partial.
  - `rows` (one `TrialBalanceRowDto` per account) is returned
    **keyset-paginated**, ordered by account code (`LedgerAccount.slug`),
    `limit` capped at 100 (default 100), `cursor` opaque-encoding the
    last returned account code — not `OFFSET`, so performance doesn't
    degrade on later pages. This is the concrete answer to the
    chart-of-accounts scale the "1–999999 pozycji" hot spot names: the
    zero-sum invariant is always computed over the whole chart, but no
    single response is ever asked to carry up to a million rows.

### API Routes (`api/`)

- `api/accounts/[id]/balance/route.ts` — `GET
  /api/ledger/accounts/:id/balance?asOf=<date>` (defaults to today).
  Exports `metadata` with `GET.requireAuth = true` and
  `GET.requireFeatures = ['ledger.reports.view']` (no top-level
  `export const requireAuth`), and exports `openApi` per
  `packages/core/AGENTS.md` → API Routes, matching every other route
  in this module.
- `api/reports/trial-balance/route.ts` — `GET
  /api/ledger/reports/trial-balance?periodId=<uuid>&cursor=<opaque>&limit=<n>`.
  Same `metadata`/`openApi` pattern as the balance route.

### Backend Pages (`backend/ledger/reports/`)

- `trial-balance/page.tsx` — a read-only `<DataTable entityId="ledger.trialBalanceRow" apiPath="/api/ledger/reports/trial-balance" />`,
  one row per `LedgerAccount`, syntetyk rows visually distinguished
  from analityk rows (indentation matching `parentAccountId` depth,
  following the existing hierarchical-list convention already used for
  account-type trees). `DataTable` drives `cursor`/`limit` against the
  route's keyset pagination itself (its existing convention — no
  custom pagination code in this page); a stable `entityId` keeps
  future widget injection (columns/filters) working. A summary row
  above the table, fetched separately via `apiCallOrThrow` against the
  same route (`zeroSumCheck` is returned on every page, not just the
  first — Design decisions), shows the zero-sum check via
  `<StatusBadge>` (`success` variant when `zeroSumCheck` is `true`,
  `error` when `false`) — semantic status tokens only, no hardcoded
  `text-green-*`/`text-red-*`. A period picker (`FiscalPeriod` select)
  drives the `periodId` query param. All labels (column headers, the
  period picker, the zero-sum badge text) go through `useT()`, not
  hard-coded strings — see Internationalization. No create/edit UI, no
  icon-only controls, no dialogs — this page has no mutation surface.
  Registered with a `page.meta.ts` following the existing `ledger`
  backend pages' nav/icon convention (File Manifest).
- `accounts/[id]/page.tsx` (existing #5663 page) gains a read-only
  "Balance" panel that fetches `GET .../balance` via `apiCallOrThrow`
  — an additive UI change to an existing page, not a new page. Any
  line touched on this existing page during that change is migrated to
  semantic tokens per
  the Boy Scout rule.

## Data Models

**No new entities and no migration.** Both `getAccountBalance` and
`getTrialBalance` read the existing `JournalEntry`, `JournalEntryLine`,
`LedgerAccount`, and `FiscalPeriod` entities from #5663 exactly as
they are today. The only structural assumption this document adds is
that "the fiscal year containing a `FiscalPeriod`" is determinable from
existing data — resolved as: the earliest `FiscalPeriod.startDate`
among all periods for the organization that do not have a gap before
`periodId`'s own `startDate` exceeding the organization's configured
fiscal-year length. In the common case (fiscal year == calendar year,
`FiscalPeriod` rows are consecutive calendar months with no gaps),
this reduces to "January's period for the same calendar year" — this
document does not add a `fiscalYear` field to `FiscalPeriod`, since
#5663 itself has no such field and none of Phase 1's fiscal-period
tests require one; if a future non-calendar fiscal year (per #5663's
own "6–18 m" hot spot from Section 00 of the workshop wall) makes this
ambiguous, that's a #5663-level gap to close there, not something this
read-only document should patch around.

## API Contracts

### `GET /api/ledger/accounts/:id/balance`

- **Query params**: `asOf?` (date, defaults to today). Validated with
  a zod schema (`z.object({ asOf: z.string().date().optional() })`)
  before the query runs; an unparseable `asOf` is a 400, not passed
  through to the CTE.
- **Response 200**: `{ accountId, asOf, balance, currency: null }` —
  `currency` is explicitly `null` in Phase 1 (no multi-currency
  balance conversion; see Out of scope) rather than omitted, so a
  client can't mistake its absence for "same as the tenant's base
  currency" by accident.
- **Response 400**: `asOf` fails zod validation (not a valid date).
- **Response 403**: caller lacks `ledger.reports.view`.
- **Response 404**: no `LedgerAccount` with that id in the caller's
  tenant/organization.

### `GET /api/ledger/reports/trial-balance`

- **Query params**: `periodId` (required, a `FiscalPeriod` id),
  `cursor?` (opaque, from a previous response's `nextCursor`),
  `limit?` (default 100, max 100). Validated with a zod schema
  (`z.object({ periodId: z.string().uuid(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(100) })`);
  a missing/malformed `periodId`, an out-of-range `limit`, or an
  unparseable `cursor` is a 400.
- **Response 200**: `{ periodId, periodStart, periodEnd, zeroSumCheck: boolean, rows: TrialBalanceRowDto[], nextCursor: string | null }`
  where `TrialBalanceRowDto` is `{ accountId, accountSlug, accountName, parentAccountId, openingBalance, periodDebit, periodCredit, ytdDebit, ytdCredit, closingBalance }`.
  `rows` is keyset-paginated by account code (`nextCursor: null` on the
  last page) — see Design decisions,
  "`getTrialBalance` computes every account's row in one set-based
  pass," for why pagination applies to `rows` but not to
  `zeroSumCheck`, which is always computed over the full chart in the
  same query family regardless of `cursor`/`limit`.
- **Response 400**: `periodId`, `cursor`, or `limit` fails zod
  validation.
- **Response 403**: caller lacks `ledger.reports.view`.
- **Response 404**: no `FiscalPeriod` with that id in the caller's
  tenant/organization.

## Internationalization (i18n)

No new server-rendered or hard-coded copy. `trial-balance/page.tsx` and
the "Balance" panel resolve every user-facing string through `useT()`
(client-side); no server-rendered strings are added, so
`resolveTranslations()` is not needed here. Keys are added to
`packages/core/src/modules/ledger/i18n/{en,pl}.json`, following the
existing flat, dot-namespaced key convention (e.g.
`packages/core/src/modules/customers/i18n/en.json`'s
`customers.activities.card.title` pattern), namespaced under `ledger`:

- `ledger.reports.trialBalance.title` — page title ("Zestawienie
  obrotów i sald").
- `ledger.reports.trialBalance.columns.{opening,periodDebit,
  periodCredit,ytdDebit,ytdCredit,closing}` — column headers.
- `ledger.reports.trialBalance.periodPicker.label`.
- `ledger.reports.trialBalance.zeroSumCheck.{pass,fail}` — the
  `<StatusBadge>` text.
- `ledger.reports.balancePanel.{title,asOfLabel}` — the account-page
  panel.

## Cache

No response caching in Phase 1. Both routes read directly from
`JournalEntryLine`/`LedgerAccount` on every request, matching the
live-query decision in Design decisions: an accountant checking a
balance before closing a period, or generating a ZSiO to hand to an
auditor, needs the figure to reflect the most recently posted entry,
not a value that is stale until a cache tag is invalidated. Adding a
cache here would also mean every `postJournalEntry` call invalidating
tags for every account in the posted entry's ancestor chain (to keep a
syntetyk account's cached balance correct) — write-path complexity this
document already rejected once for the maintained-balance-table
alternative (Design decisions, "Live query, not a maintained balance
table"), for the same reason: no measured need yet. If read latency at
scale becomes a real, measured problem, the fix is the same one
already named for that case — a materialized/cached balance table
behind the existing `getAccountBalance`/`getTrialBalance` signatures
(see Risks & Impact Review) — not an ad hoc response cache layered on
top of the live query.

## Implementation Plan

### Phase 1: Balance and ZSiO queries, read-only routes and page

1. Add `ledger.reports.view` to `acl.ts` and `setup.ts`'s `employee`
   list.
2. Implement `getAccountBalance` (`queries/getAccountBalance.ts`) —
   the `WITH RECURSIVE` CTE plus `normalBalance`-signed aggregation,
   scoped by tenant/organization.
3. Implement `getTrialBalance` (`queries/getTrialBalance.ts`) —
   resolves the period's fiscal-year start, calls `getAccountBalance`
   for opening/closing per account, computes period and YTD
   debit/credit turnover directly, assembles `zeroSumCheck`.
4. Implement `api/accounts/[id]/balance/route.ts` and
   `api/reports/trial-balance/route.ts`, both behind
   `ledger.reports.view`, both validating query params with zod
   (`asOf`, `periodId`; see API Contracts) before querying, both
   exporting `openApi`.
5. Add the "Balance" panel to the existing `accounts/[id]/page.tsx`.
6. Implement `backend/ledger/reports/trial-balance/page.tsx`
   (`DataTable`, period picker, indentation by hierarchy depth, summary
   row via `<StatusBadge>`).
7. Add `ledger.reports.*` keys to `i18n/en.json` and `i18n/pl.json`
   (see Internationalization).
8. Integration tests for both routes (400 on a malformed `asOf`/
   `periodId`, 403 without the feature, 404 on a foreign-tenant id, 200
   with correct figures) per root `AGENTS.md:164`.

### Phase 2 (deferred, tracked in Out of scope)

- AP/AR "bufor" toggle, once AP/AR draft/submitted states exist in a
  running system.
- Materialized/cached balance table, only if real measurement shows
  the live query doesn't hold up at production volumes.
- Bilans / P&L (4xx, 5xx) / Cash Flow / tax reporting — separate,
  larger future documents.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `acl.ts` | Modify | Add `ledger.reports.view` |
| `setup.ts` | Modify | Add `ledger.reports.view` to `employee`'s `defaultRoleFeatures` |
| `queries/getAccountBalance.ts` | Create | Recursive, `normalBalance`-signed balance-as-of-date |
| `queries/getTrialBalance.ts` | Create | Per-account opening/turnover/YTD/closing rows + zero-sum check |
| `api/accounts/[id]/balance/route.ts` | Create | `GET .../balance`, `metadata` + `openApi` export |
| `api/reports/trial-balance/route.ts` | Create | `GET .../trial-balance`, `metadata` + `openApi` export, cursor pagination |
| `api/openapi.ts` | Modify | Register the two new routes' schemas |
| `backend/ledger/accounts/[id]/page.tsx` | Modify | Add read-only Balance panel |
| `backend/ledger/reports/trial-balance/page.tsx` | Create | ZSiO `DataTable` + period picker |
| `backend/ledger/reports/trial-balance/page.meta.ts` | Create | Nav entry + icon, following existing `ledger` backend pages' convention |
| `i18n/en.json`, `i18n/pl.json` | Modify | Add `ledger.reports.*` keys (see Internationalization) |

### Testing Strategy

- Post a balanced entry to a `DEBIT`-normal account and assert
  `getAccountBalance` returns `SUM(debit) - SUM(credit)`; same for a
  `CREDIT`-normal account with the sides swapped.
- Post to a leaf account under a syntetyk parent (`130-1` under `130`)
  and assert the parent's `getAccountBalance` includes the child's
  postings; then post directly to the parent too and assert both are
  summed without double-counting.
- Assert `getAccountBalance(accountId, asOf)` for a date before any
  entry exists returns zero, and that entries posted after `asOf` are
  excluded.
- Generate a ZSiO for a period with a known set of postings and assert
  every row's `openingBalance + periodDebit - periodCredit ==
  closingBalance` for `DEBIT`-normal accounts (sides swapped for
  `CREDIT`-normal), and `zeroSumCheck === true`.
- Assert `ytdDebit`/`ytdCredit` for a period in month 3 of a fiscal
  year correctly include months 1–3, not just month 3.
- Assert both routes return 403 without `ledger.reports.view` and 404
  for an account/period belonging to a different tenant/organization.
- Assert both routes return 400 for a malformed `asOf` (not a valid
  date) or `periodId` (not a UUID) before any query runs (API
  Contracts).
- Assert the balance route's `asOf` default (today) matches an
  explicit `asOf=<today's date>` call.
- Post a year-end `CLOSING` entry that zeroes a revenue account (debit
  equal to its full-year credit balance) and assert: the account's
  `getAccountBalance` as of period end is `0`; the ZSiO row's
  `periodDebit`/`ytdDebit` for that account includes the closing
  entry's amount alongside its real turnover (Design decisions,
  "Turnover figures include every `JournalEntry.type`"); and
  `zeroSumCheck` still holds across the whole chart.
- Generate a ZSiO for a chart of accounts larger than one page
  (`limit`) and assert: `rows.length <= limit`; `nextCursor` is
  non-null until the last page and null on it; walking every page with
  `cursor` yields every account exactly once, in a stable order; and
  `zeroSumCheck` is identical and correct on every page, since it is
  computed over the full chart independently of `cursor`/`limit`
  (Design decisions).
- Assert the balance and trial-balance routes each run a bounded,
  fixed number of queries regardless of the number of `LedgerAccount`
  rows involved (one recursive CTE per call, not one per account) —
  the concrete regression test for Design decisions,
  "`getTrialBalance` computes every account's row in one set-based
  pass."

## Risks & Impact Review

### Data integrity failures

**Recursive CTE returns a wrong or incomplete set for a very deep or
cyclic `parentAccountId` chain.**
- Scenario: an account hierarchy is accidentally made cyclic (A →
  parent B → parent A) through a bug or direct database edit, or a
  chain is deep enough to hit a query planner limit.
- Severity: Low — `parentAccountId` has no active guard yet against
  re-parenting (#5663's own Design decisions leave that guard's
  trigger condition "intentionally left open" until a real reader
  exists); this document is exactly that first real reader.
- Affected area: `getAccountBalance`/`getTrialBalance` for the
  affected subtree only — no write-path impact, no ledger corruption.
- Mitigation: this document's own `WITH RECURSIVE` query needs a
  standard cycle guard (track visited ids, stop on a repeat) — flagged
  here as a required implementation detail, not left implicit in the
  query sketch above. The guard logs a warning (account id, detected
  cycle) rather than failing silently, so on-call can find and fix the
  bad `parentAccountId` edit instead of the report just quietly
  returning a truncated tree.
- Residual risk: none once the cycle guard is implemented; genuinely
  cyclic data would then surface as a bounded, visible query result
  rather than an infinite loop.

### Cascading failures & side effects

**A live recursive query is slow at scale, degrading the reports page
or the balance panel.**
- Scenario: an organization has accumulated a very large
  `JournalEntryLine` volume, or a chart of accounts large enough to
  approach the "1–999999 pozycji" scale Section 00's own hot spot
  names (`LedgerAccount` row count, distinct from posting volume).
- Severity: Medium, but explicitly deferred rather than pre-solved —
  see Design decisions ("Live query... a deliberate, reversible
  choice"). Reduced from what an earlier version of this design would
  have risked: `getTrialBalance` already runs as one set-based query
  per request rather than one round trip per account (Design
  decisions, "`getTrialBalance` computes every account's row in one
  set-based pass"), and `rows` is keyset-paginated so response size
  doesn't scale with chart size even though the `zeroSumCheck`
  aggregate still touches every account.
- Affected area: this document's two routes and the reports page only
  — `postJournalEntry` and every other write path are untouched.
- Mitigation: `(organization_id, account_id)` and `(organization_id,
  posted_at)` indexes already exist on `journal_entry_line`/
  `journal_entry` from #5663's own migration and directly serve this
  document's filters; no new index is required to ship Phase 1. Both
  routes log query duration; a duration alert threshold is an
  operational config value (not a code change) so it can be tuned
  without a follow-up spec.
- Residual risk: real production measurement may show this needs a
  materialized/cached balance table later (Phase 2) — an additive
  change behind the same function signatures, not a redesign.

### Tenant & data isolation

Both queries filter by `tenant_id`/`organization_id` on every table
they touch (`JournalEntryLine` carries its own, per #5663's Data
Models), matching the isolation boundary #5663 already established;
this document adds no new isolation surface to reason about.

### Migration & deployment

None — no schema change, purely additive routes and a query layer over
existing, already-migrated tables.

## Out of scope (tracked separately)

- **AP/AR "bufor" toggle** — deferred to Phase 2 (see Design decisions);
  `2026-09-06-accounts-payable.md`'s Out of scope carries the
  reciprocal note, added the same day.
- **Materialized/cached balance table** — only if real measurement
  shows the live query doesn't hold up; the API/query-function
  signatures in this document are designed so that change would be
  additive, not a redesign (see Design decisions, Risks).
- **Bilans, P&L (4xx/5xx), Cash Flow, tax reporting (JPK)** — separate,
  larger future documents; this document's scope-cohesion boundary is
  ZSiO only (see Design decisions, Alternatives considered).
- **Off-balance-sheet accounts** (konta pozabilansowe) — no such
  concept exists anywhere in #5663's `LedgerAccountType`/
  `LedgerAccountGroup` today; the zero-sum check in this document
  therefore covers every account unconditionally. If off-balance-sheet
  accounts are added to the chart of accounts in a future phase, this
  document's `zeroSumCheck` will need to exclude them — tracked here
  as a known future adjustment, not solved now.
- **Multi-currency balance conversion** — `getAccountBalance` sums
  base-currency `debit`/`credit` only, matching #5663's own posting
  logic ("balance validation runs only in the base-currency
  debit/credit columns"); a foreign-currency-denominated balance view
  is a Multi-Currency-spec concern, same boundary #5663 already drew
  for FX revaluation.

## Final Compliance Report — 2026-09-09

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/cache/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/ds-rules.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| `AGENTS.md` | No direct ORM relationships between modules | Compliant | No new entities; existing FK-id columns (`accountId`, `parentAccountId`) are read, not related to across modules |
| `AGENTS.md` | Filter by tenant/organization | Compliant | Both queries filter every table by `tenant_id`/`organization_id` — see Data Models, Risks |
| `AGENTS.md` | Write operations via Command pattern | N/A | This document adds no write operations — see Architecture → Queries, which explains why these are queries, not commands |
| `packages/core/AGENTS.md` → API Routes | All API route files MUST export `openApi` | Compliant | Both new routes export `openApi`; `api/openapi.ts` updated (File Manifest) |
| `packages/core/AGENTS.md` → API Routes | All user input validated with zod before business logic | Compliant | `asOf`/`periodId` both validated, 400 on failure (API Contracts) |
| `packages/core/AGENTS.md` → Declarative feature guards | `acl.ts` synced to `setup.ts` `defaultRoleFeatures` | Compliant | `ledger.reports.view` added to both (Architecture → Access Control / Module Setup) |
| `packages/core/AGENTS.md` → Encryption | PII/GDPR fields declared in `<module>/encryption.ts` | N/A | No new entities or PII-bearing fields; both queries read existing, already-reviewed #5663 columns only |
| `packages/ui/AGENTS.md` | Lists use `DataTable` with stable `entityId` | Compliant | `trial-balance/page.tsx` uses `DataTable`; no `CrudForm` since there is no mutation surface |
| `packages/ui/AGENTS.md` | HTTP via `apiCall`/`apiCallOrThrow`, never raw `fetch` | Compliant | Both new pages call the new routes through the existing `apiCall` helper, consistent with the rest of the `ledger` module's backend pages |
| `.ai/ds-rules.md` / `.ai/ui-components.md` | Semantic status tokens; `<StatusBadge>` for entity/derived status; no hardcoded Tailwind shades | Compliant | Zero-sum check rendered via `<StatusBadge>` (`success`/`error` variants) — Architecture → Backend Pages |
| root `AGENTS.md` (i18n) | User-facing strings resolved via `useT()`/`resolveTranslations()`, not hard-coded | Compliant | See Internationalization for the full key list and file paths |
| `packages/cache/AGENTS.md` | Read-heavy endpoints declare a caching strategy and TTL, tenant-scoped | N/A, justified | Explicit no-cache decision (see Cache) — correctness for accountants closing a period takes priority over an unmeasured read-latency win, consistent with the live-query decision in Design decisions |
| `packages/core/AGENTS.md` → Pagination | Large list APIs use cursor/keyset pagination, `pageSize <= 100` | Compliant | `trial-balance` `rows` are keyset-paginated by account code, `limit` capped at 100; `zeroSumCheck` is a separate full-chart aggregate, unaffected by pagination (API Contracts, Design decisions) |
| `packages/core/AGENTS.md` → Performance | Bulk/multi-row reads avoid N+1 across the result set | Compliant | `getTrialBalance` computes every account's row in one set-based query, not `getAccountBalance` called per account (Design decisions, Queries) |
| `packages/core/AGENTS.md` → API Routes | Route files export `metadata` with per-method `requireAuth`/`requireFeatures` | Compliant | Both routes' `metadata` export documented (Architecture → API Routes) |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant (trivially) | No schema change at all |
| `.ai/specs/AGENTS.md` | Never leave stale endpoints, entities, or assumptions in an updated spec | Compliant | Cross-references to `2026-09-06-accounts-payable.md`'s bufor note and #5663's exact route name (`GET /api/ledger/accounts/:id/balance`) checked against those documents' current text at write time |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match architecture | Pass | No new data models; Architecture explicitly states which existing entities are read |
| Queries defined for all reads | Pass | `getAccountBalance`/`getTrialBalance` both specified; no write surface to check |
| User Stories match Implementation Plan | Pass | All three stories map to Phase 1 steps 2–7 |
| Risks cover the two real changes this document makes | Pass | Recursive-query correctness (cycle guard) and read-path performance (deferred by design) both addressed |
| API contracts match data models | Pass | `TrialBalanceRowDto` fields are all derivable from `LedgerAccount`/`JournalEntryLine` per Architecture → Queries |
| Scope cohesion | Pass | Applied the same test as the rest of this document family: ZSiO stands alone; Bilans/P&L do not stand without it (see Alternatives considered) |
| UI/UX and i18n sections agree | Pass | Every string named in Internationalization has a corresponding UI element in Architecture → Backend Pages, and vice versa |

### Non-Compliant Items

None found against `AGENTS.md` rules. One design risk is explicitly
flagged rather than resolved outright: recursive-CTE performance and
correctness under a very large or malformed (cyclic) account tree is
new territory for this codebase (no prior recursive-query precedent
exists to lean on) — addressed with a required cycle guard (Risks &
Impact Review) rather than assumed away.

### Verdict

**Fully compliant — approved, ready for implementation.** Scope is
fixed at four boundaries, each with an explicit rationale recorded in
Design decisions: posted-only in Phase 1 (with a live cross-reference
from `2026-09-06-accounts-payable.md`), a live query rather than a
maintained balance table, ZSiO only (excluding Bilans/P&L/Cash Flow),
and `ledger` Phase 2 rather than a new module. The design has also been
cross-checked against three references the team uses (David Hay's
*Data Model Patterns*, Martin Fowler's *Analysis Patterns*, and
Kieso/Weygandt/Warfield's *Intermediate Accounting*, 17e) — see Design
decisions for what that check confirmed (the recursive summary-account
pattern, the single-parent tree, the `normalBalance` sign convention)
and the one substantive addition it produced (turnover figures include
every `JournalEntry.type`, `CLOSING` included, resolved in favor of
art. 18 journal-reconciliation over filtering by type). See the Review
entry in the Changelog for the checklist-driven review pass this
document has since been through. As with #5663 at the same stage, an
independent maintainer PR review is still recommended before this is
treated as fully settled.

## Changelog

### 2026-09-09

- Initial specification: TLDR, Overview, Problem Statement (grounded
  in art. 18 Ustawy o rachunkowości — content, minimum-monthly
  frequency, and journal-reconciliation requirement verified against a
  primary-source summary before citing it here, not assumed), Proposed
  Solution, Design Decisions (including the balance-sign formula, the
  recursive syntetyk rollup, and the explicit acknowledgment that this
  is the first recursive-CTE precedent in this codebase), Architecture,
  Data Models, API Contracts, Implementation Plan, Risks & Impact
  Review, Out of Scope, Final Compliance Report. Scope fixed at four
  boundaries, each with a recorded rationale (see Design decisions):
  posted-only in Phase 1, independent of AP/AR's own progress (a
  reciprocal cross-reference note added to
  `2026-09-06-accounts-payable.md`'s Out of scope the same day, naming
  AP's own implementation as the trigger to design an AP/AR toggle
  later); a live query rather than a maintained balance table, decided
  explicitly against building for an unmeasured scale — the same
  reasoning already applied elsewhere in this document family to
  `journal_entry_line_dimension`, reversible later behind the same
  function signatures if real measurement says otherwise; ZSiO only,
  with Bilans/P&L/Cash Flow/tax reporting confirmed as separate future
  documents via the same scope-cohesion test (does each function
  without the other?) already used across this document family; and
  `ledger` Phase 2 rather than a new module, the default given no new
  maintained table.
- Corrected a stray citation-tool artifact (`` `contentReference` ``)
  left in the Overview paragraph during drafting.
- Cross-checked the design against three references in active use at
  Commerce Weavers: David Hay's *Data Model Patterns* (ch. 7,
  "Accounting" — confirmed the `normalBalance` sign convention and the
  single-parent account-hierarchy rollup against Table 7.1 and the
  "Summarization" section's warning against multi-parent roll-ups),
  Martin Fowler's *Analysis Patterns* (§6.3 "Summary Account" —
  confirmed the recursive summary-account rollup is the canonical
  pattern, and that the canonical version restricts posting to leaf
  accounts, which this document's Phase 1 deliberately does not
  because #5663 itself doesn't yet), and Kieso/Weygandt/Warfield's
  *Intermediate Accounting*, 17e (ch. 3 — confirmed the Debit/Credit
  convention and, more substantively, that a `CLOSING` entry's own
  zeroing debit/credit is expected to appear in a nominal account's
  period turnover, not just its balance). This produced one new,
  explicit Design decision ("Turnover figures include every
  `JournalEntry.type`") plus a matching Testing Strategy assertion; no
  other section changed as a result.
- Ran a full spec-checklist review pass before finalizing (see Review
  below). The review's one substantive finding — `getTrialBalance` was
  specified as calling `getAccountBalance` once per `LedgerAccount`,
  which is N+1 at the chart-of-accounts scale this document's own
  hot-spot citation names (up to "1–999999 pozycji") — was corrected:
  `getTrialBalance` now computes every account's row in a single
  set-based query (Design decisions), and `trial-balance` `rows` are
  keyset-paginated (`cursor`/`limit`, capped at 100) while
  `zeroSumCheck` remains a separate, always-complete aggregate over the
  whole chart (API Contracts). Also added: both routes' `metadata`
  export (`requireAuth`/`requireFeatures` per method), the
  Internationalization section and its `i18n/{en,pl}.json` keys, the
  Cache section's explicit no-cache justification, zod validation for
  every query parameter (`asOf`, `periodId`, `cursor`, `limit`), the
  `<StatusBadge>` / semantic-status-token detail for the zero-sum
  check, the `apiCall`/`apiCallOrThrow` and `DataTable`
  `entityId`/`apiPath` detail for both pages, and a `page.meta.ts` File
  Manifest entry — closing the remaining gaps the checklist's API/UI,
  cache, and pagination sections call out. No other design decision
  changed.

### Review — 2026-09-09
- **Reviewer**: Agent
- **Security**: Passed — `metadata` export with per-method
  `requireAuth`/`requireFeatures` now specified for both routes; zod
  validation covers every query parameter
- **Performance**: Passed — `getTrialBalance` corrected to one
  set-based query per request instead of one `getAccountBalance` call
  per account; `rows` keyset-paginated (`limit` ≤ 100), `zeroSumCheck`
  computed once over the full chart independently of pagination
- **Cache**: Passed — explicit, justified no-cache decision (see Cache)
- **Commands**: Passed — N/A, this document adds no mutations
- **Risks**: Passed — cycle-guard logging and query-duration alerting
  added to Risks & Impact Review for operational detection
- **Verdict**: Approved
