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

**Concerns (carried over from the skeleton, now resolved — see Design decisions and Changelog):**
- Posted-only in Phase 1 (Q1) — no read of AP/AR draft/buffer state. `2026-09-06-accounts-payable.md`'s Out of scope now carries a matching cross-reference back to this document, added the same day.
- Live query, not a maintained balance table (Q2) — reversible later if real measurement shows it's needed; not built for a scale that isn't confirmed yet.
- Scoped to ZSiO only, not Bilans/P&L/Cash Flow (Q3) — those map accounts to statutory line items, a materially different and larger piece of work, and become their own future document(s).
- Ships as `ledger` Phase 2, not a new module (Q4).

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

### Alternatives considered

| Alternative | Why Rejected |
|-------------|---------------|
| Maintain a running balance on `LedgerAccount` (or a new table), updated inside `postJournalEntry` | Touches the already-reviewed posting transaction for a performance need that isn't measured yet; a live query gets the same answer with zero write-path risk (see Design decisions) |
| Restrict ZSiO/balance to leaf (analityk) accounts only, since #5663 never restricted posting to leaves | Would silently produce a wrong balance for any syntetyk account that also has direct postings — Phase 1 explicitly allows that (no leaf-only posting restriction exists yet), so the rollup must account for it |
| Bundle Bilans/P&L into this same document, since the workshop wall lists them together | Fails the scope-cohesion test (Bilans/P&L depend on ZSiO, not vice versa) — bundling would make this document depend on statutory-mapping decisions that have nothing to do with whether account arithmetic is correct |
| Include an AP/AR "bufor" toggle in Phase 1 | Real cross-module dependency this document would need AP/AR's draft-document shape to design against, and AP/AR's own draft/submitted states aren't built yet — deferred per Q1, with the cross-reference recorded in `2026-09-06-accounts-payable.md` |

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
document adds two query functions, not commands:

- `getAccountBalance(em, { accountId, tenantId, organizationId, asOf })`
  — runs the `WITH RECURSIVE` CTE described in Design decisions,
  scoped by tenant/organization, filtered to `posted_at <= asOf`,
  returns a single signed balance (already normalized to the
  account's `normalBalance` side).
- `getTrialBalance(em, { tenantId, organizationId, periodId })` —
  resolves the named `FiscalPeriod`'s `startDate`/`endDate` and the
  fiscal year containing it (the earliest `FiscalPeriod` in that
  calendar/fiscal year — see Data Models), then calls
  `getAccountBalance` twice per `LedgerAccount` (as of `startDate - 1
  day` for opening, as of `endDate` for closing) plus a direct
  `SUM(debit)/SUM(credit)` for the period's own turnover and the
  year-to-date turnover, returning one row per account plus a
  `zeroSumCheck` field (`true` when every closing balance nets to
  zero across the whole chart, excluding no accounts in Phase 1 since
  no off-balance-sheet account concept exists yet — see Out of
  scope).

### API Routes (`api/`)

- `api/accounts/[id]/balance/route.ts` — `GET
  /api/ledger/accounts/:id/balance?asOf=<date>` (defaults to today).
  Requires `ledger.reports.view`. Exports `openApi` per
  `packages/core/AGENTS.md` → API Routes, matching every other route
  in this module.
- `api/reports/trial-balance/route.ts` — `GET
  /api/ledger/reports/trial-balance?periodId=<uuid>`. Requires
  `ledger.reports.view`. Exports `openApi`.

### Backend Pages (`backend/ledger/reports/`)

- `trial-balance/page.tsx` — a read-only `DataTable` over
  `getTrialBalance`, one row per `LedgerAccount`, syntetyk rows
  visually distinguished from analityk rows (indentation matching
  `parentAccountId` depth, following the existing hierarchical-list
  convention already used for account-type trees), a summary row
  showing the zero-sum check. A period picker (`FiscalPeriod` select)
  drives the `periodId` query param. No create/edit UI — this page has
  no mutation surface.
- `accounts/[id]/page.tsx` (existing #5663 page) gains a read-only
  "Balance" panel calling the new balance route — an additive UI
  change to an existing page, not a new page.

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

- **Query params**: `asOf?` (date, defaults to today).
- **Response 200**: `{ accountId, asOf, balance, currency: null }` —
  `currency` is explicitly `null` in Phase 1 (no multi-currency
  balance conversion; see Out of scope) rather than omitted, so a
  client can't mistake its absence for "same as the tenant's base
  currency" by accident.
- **Response 403**: caller lacks `ledger.reports.view`.
- **Response 404**: no `LedgerAccount` with that id in the caller's
  tenant/organization.

### `GET /api/ledger/reports/trial-balance`

- **Query params**: `periodId` (required, a `FiscalPeriod` id).
- **Response 200**: `{ periodId, periodStart, periodEnd, zeroSumCheck: boolean, rows: TrialBalanceRowDto[] }`
  where `TrialBalanceRowDto` is `{ accountId, accountSlug, accountName, parentAccountId, openingBalance, periodDebit, periodCredit, ytdDebit, ytdCredit, closingBalance }`.
- **Response 403**: caller lacks `ledger.reports.view`.
- **Response 404**: no `FiscalPeriod` with that id in the caller's
  tenant/organization.

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
   `ledger.reports.view`, both exporting `openApi`.
5. Add the "Balance" panel to the existing `accounts/[id]/page.tsx`.
6. Implement `backend/ledger/reports/trial-balance/page.tsx`
   (`DataTable`, period picker, indentation by hierarchy depth, summary
   row).
7. Integration tests for both routes (403 without the feature, 404 on
   a foreign-tenant id, 200 with correct figures) per root
   `AGENTS.md:164`.

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
| `api/accounts/[id]/balance/route.ts` | Create | `GET .../balance`, `openApi` export |
| `api/reports/trial-balance/route.ts` | Create | `GET .../trial-balance`, `openApi` export |
| `api/openapi.ts` | Modify | Register the two new routes' schemas |
| `backend/ledger/accounts/[id]/page.tsx` | Modify | Add read-only Balance panel |
| `backend/ledger/reports/trial-balance/page.tsx` | Create | ZSiO `DataTable` + period picker |

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
- Assert the balance route's `asOf` default (today) matches an
  explicit `asOf=<today's date>` call.

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
  query sketch above.
- Residual risk: none once the cycle guard is implemented; genuinely
  cyclic data would then surface as a bounded, visible query result
  rather than an infinite loop.

### Cascading failures & side effects

**A live `SUM()`/recursive query is slow at scale, degrading the
reports page or the balance panel.**
- Scenario: an organization has accumulated a very large
  `JournalEntryLine` volume (Section 00's own "1–999999 pozycji" hot
  spot, applied to postings rather than accounts).
- Severity: Medium, but explicitly deferred rather than pre-solved —
  see Design decisions ("Live query... a deliberate, reversible
  choice").
- Affected area: this document's two routes and the reports page only
  — `postJournalEntry` and every other write path are untouched.
- Mitigation: `(organization_id, account_id)` and `(organization_id,
  posted_at)` indexes already exist on `journal_entry_line`/
  `journal_entry` from #5663's own migration and directly serve this
  document's filters; no new index is required to ship Phase 1.
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

- **AP/AR "bufor" toggle** — deferred per Q1 (see Design decisions);
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
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| `AGENTS.md` | No direct ORM relationships between modules | Compliant | No new entities; existing FK-id columns (`accountId`, `parentAccountId`) are read, not related to across modules |
| `AGENTS.md` | Filter by tenant/organization | Compliant | Both queries filter every table by `tenant_id`/`organization_id` — see Data Models, Risks |
| `AGENTS.md` | Write operations via Command pattern | N/A | This document adds no write operations — see Architecture → Queries, which explains why these are queries, not commands |
| `packages/core/AGENTS.md` → API Routes | All API route files MUST export `openApi` | Compliant | Both new routes export `openApi`; `api/openapi.ts` updated (File Manifest) |
| `packages/core/AGENTS.md` → Declarative feature guards | `acl.ts` synced to `setup.ts` `defaultRoleFeatures` | Compliant | `ledger.reports.view` added to both (Architecture → Access Control / Module Setup) |
| `packages/ui/AGENTS.md` | Lists use `DataTable` | Compliant | `trial-balance/page.tsx` uses `DataTable`; no `CrudForm` since there is no mutation surface |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant (trivially) | No schema change at all |
| `.ai/specs/AGENTS.md` | Never leave stale endpoints, entities, or assumptions in an updated spec | Compliant | Cross-references to `2026-09-06-accounts-payable.md`'s bufor note and #5663's exact route name (`GET /api/ledger/accounts/:id/balance`) checked against those documents' current text at write time |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match architecture | Pass | No new data models; Architecture explicitly states which existing entities are read |
| Queries defined for all reads | Pass | `getAccountBalance`/`getTrialBalance` both specified; no write surface to check |
| User Stories match Implementation Plan | Pass | All three stories map to Phase 1 steps 2–6 |
| Risks cover the two real changes this document makes | Pass | Recursive-query correctness (cycle guard) and read-path performance (deferred by design) both addressed |
| API contracts match data models | Pass | `TrialBalanceRowDto` fields are all derivable from `LedgerAccount`/`JournalEntryLine` per Architecture → Queries |
| Scope cohesion | Pass | Applied the same test as the rest of this document family: ZSiO stands alone; Bilans/P&L do not stand without it (see Alternatives considered) |

### Non-Compliant Items

None found against `AGENTS.md` rules. One design risk is explicitly
flagged rather than resolved outright: recursive-CTE performance and
correctness under a very large or malformed (cyclic) account tree is
new territory for this codebase (no prior recursive-query precedent
exists to lean on) — addressed with a required cycle guard (Risks &
Impact Review) rather than assumed away.

### Verdict

**Ready for review, contingent on the four Open Questions this
document shipped with being explicitly resolved before this line was
written** — they were (see Changelog): posted-only Phase 1 scope
(Q1, with a live cross-reference added to `2026-09-06-accounts-
payable.md` the same day), live query over a maintained table (Q2),
ZSiO-only scope excluding Bilans/P&L/Cash Flow (Q3), and `ledger`
Phase 2 rather than a new module (Q4). Unlike #5663 and #5972 at their
own first-draft stage, this document has not yet been through an
independent, fresh-context review pass (the `om-spec-writing` Step 8
scope-cohesion delegation, or an external maintainer PR review) — that
should happen before this is treated as fully settled, the same
recommendation already given for #5663 itself.

## Changelog

### 2026-09-09

- Initial skeleton: TLDR plus four Open Questions (bufor toggle,
  live-query vs. maintained balance, ZSiO-only scope boundary, module
  placement) — gated per `om-spec-writing`'s Step 3 hard-stop rule.
- All four questions resolved the same day:
  - **Q1 (bufor)**: posted-only in Phase 1, kept independent of
    AP/AR's own progress; a reciprocal cross-reference note added to
    `2026-09-06-accounts-payable.md`'s Out of scope the same day,
    naming AP's own implementation as the trigger to design the toggle
    later.
  - **Q2 (live query vs. maintained balance)**: live query, decided
    explicitly against building for an unmeasured scale — same
    reasoning already applied elsewhere in this document family to
    `journal_entry_line_dimension`. Reversible later behind the same
    function signatures if real measurement says otherwise.
  - **Q3 (scope boundary)**: ZSiO only; Bilans/P&L/Cash Flow/tax
    reporting confirmed as separate future documents via the same
    scope-cohesion test (does each function without the other?)
    already used across this document family.
  - **Q4 (module placement)**: `ledger` Phase 2, not a new module —
    the default given Q2 resolved to no new maintained table.
- Wrote the full spec: Overview, Problem Statement (grounded in art.
  18 Ustawy o rachunkowości — content, minimum-monthly frequency, and
  journal-reconciliation requirement verified against a primary-source
  summary before citing it here, not assumed), Proposed Solution,
  Design Decisions (including the balance-sign formula, the recursive
  syntetyk rollup, and the explicit acknowledgment that this is the
  first recursive-CTE precedent in this codebase), Architecture, Data
  Models, API Contracts, Implementation Plan, Risks & Impact Review,
  Out of Scope, Final Compliance Report.
