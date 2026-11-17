# General Ledger — Account Balances & Trial Balance (ZSiO)

## TLDR

**Key Points:**
- Adds read-only balance and turnover reporting on top of the `ledger` module specified by #5663, with an account-parent link and explicit hierarchy and fiscal-year prerequisites. Coordinated posting and account-write enforcement is required before release. **#5663 is an unmerged spec — see Prerequisites.**
- Restores `getAccountBalance` (cut from #5663 Phase 1 as a stakeholder-directed scope reduction) and adds the ZSiO report (Zestawienie Obrotów i Sald / Trial Balance, art. 18 Ustawy o rachunkowości): opening balance, period and year-to-date debit/credit turnover, and closing balance per account, distinguishing syntetyk (an account with children under `parentAccountId`) from analityk (a leaf account), per the Event Storming Section 05 hot spot (the parent column #5663 removed on 2026-10-12 returns here as its first consumer).
- Balances use `JournalEntryLine` as their source. The parent link, a verified historical baseline, fiscal-year authority and coordinated writer guards are prerequisites; their complete migration and compatibility plan remains to be reviewed (Data Models).

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
This document proposes that capability on top of #5663. Coordinated
schema, posting and account-writer changes are prerequisites; neither
the core ledger nor those changes are implemented here.

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

## Prerequisites

**This document has a hard, undeclared-until-now dependency on #5663
(`docs/spec-072-general-ledger-core-engine`), which is itself an
unmerged, not-yet-implemented spec.** `packages/core/src/modules/
ledger/` does not exist anywhere in this repository today — not on
`develop`, not on this document's own branch. Every present-tense
claim elsewhere in this document about "the ledger module's existing
schema," "indexes already exist," or reading #5663's entities "as
they are today" describes #5663's *specification*, not running code;
read them as "as specified in #5663." None of Phase 1's nine
Implementation Plan steps can begin until #5663 is merged and
implemented — that is a prerequisite for this document, not a
concurrent or independent piece of work, whatever the Design
decisions' "zero dependency on AP/AR/JELD" language might suggest by
omission (that language is true only with respect to AP/AR/JELD —
not with respect to `ledger` itself). `2026-09-06-accounts-
payable.md`'s reciprocal cross-reference to this document (checked at
PR #5962's head, line ~1169) is real, but AP/AR is in the same
position: its own PR is also unmerged. A reader landing on this
document from `.ai/specs/README.md`'s Pending Specifications table,
where it is listed as actionable work, has no way to learn this
without reading this section.

## Problem Statement

Three things are true today and none of them let an accountant answer
"what does this account's balance look like right now, and do the
books foot correctly":

1. `GET /api/ledger/journal-entries` — #5663's only read surface over
   postings, alongside its chart-of-accounts/account-type/
   fiscal-period read routes — returns individual entries, not
   balances: an accountant would have to sum `debit`/`credit` across
   every line, for every account, by hand, across however many pages
   of results, to get a single account's balance.
2. `LedgerAccount` has no parent column today: #5663 removed the
   earlier structural `parentAccountId` on 2026-10-12 and delegates its
   return to this rollup. Until it exists, a syntetyk account's
   balance (every analityk child rolled up into it) cannot be
   produced.
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

Both read `JournalEntryLine` as the source of every `debit`/`credit`
figure, filtered by its own `organization_id`/`tenant_id` columns; the
accounting-date filter (`operation_date`) is not one of them — `operationDate`
lives on `JournalEntry`, not `JournalEntryLine` (Data Models), so
every query here joins `journal_entry_line` to `journal_entry` by
`journalEntryId` to apply the accounting date `operationDate` — the
period-membership field #5663 locks and filters on: `JournalEntryLine`
rows filtered by `(organization_id, account_id)`, joined to
`journal_entry` by primary key, filtered by `operation_date`. The
hierarchy and fiscal-year guards also require coordinated changes to
account and posting transactions before reporting can be enabled.

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
balance for a period is the internal balance at `periodStartDate - 1
day`; the closing balance is the internal balance at `periodEndDate`.
Once report-wide coverage has been verified, an account not yet effective
at the opening boundary contributes zero there, including its descendants;
the public balance route still returns 404 for that account before its
effective start. Do not turn missing historical coverage into zero.
For an effective account these internal values use the same formula as
`getAccountBalance`. There is deliberately no separate "prior period
closing balance" table or field: it would be a second source of truth
that could drift from what the journal actually says, for a table
where — per #5663's own words — "the database quietly went out of
balance" is not a recoverable failure mode. The formula is valid only
after the opening/carry-forward policy and coverage gates below pass.

**Opening and carry-forward policy is a release prerequisite, not an
inference from `JournalEntry.type`.** #5663 permits ordinary balanced
annual `OPENING` entries that carry permanent balances into a new year.
Summing all previous journal lines and then adding such a carry-forward
duplicates those balances even though every entry remains balanced. For
example, year N posts Dr cash 100 / Cr equity 100; a year N+1 carry-forward
posts the same balanced pair. Blind lifetime summation reports cash 200,
not 100, while `zeroSumCheck` still passes.

The proposed supported mode is a **continuous ledger with one verified
go-live initialization**, subject to accounting-owner and compatibility
review. A tenant/organization-scoped, historically versioned authority
must attest a complete ledger from a known go-live date, verify that this
scoped ledger contains no earlier journal activity, identify the initial
balanced opening entries there, and establish with evidence that
all later journal entries, including entries labelled `OPENING`, are
incremental movements rather than duplicated carry-forwards. Never infer
that fact from type, amount, date, balanced totals or a missing label.
Pre-go-live source-system balances may be introduced only through the
attested initialization entries; existing earlier ledger entries cannot
be silently dropped. The authority must reconcile the entire independently
evidenced source population at a defined cutoff immediately before
go-live: every mapped account, including zero and omitted accounts, must
match its initialized base-currency balance and each applicable account
currency, with signed debit/credit conventions and mapping provenance
recorded. An empty source requires evidence of emptiness. Before reports
are enabled, an independently verified, scope-bound inventory must identify
every external writer and source of record. Fence and drain all those
writers, establish a durable final source watermark and reconcile the
complete source population at that watermark against the initialized
target plus every movement after the cutoff. The fence must prevent source
writes after the watermark, including during failover and rollback; absent
proof that every writer is fenced and every accepted movement is captured,
both reports stay disabled. A continuing capture protocol is not assumed:
it needs a separate reviewed design before it can replace this fence.

Initialize once from the cutoff snapshot; transfer each accepted source
movement after that snapshot through the final watermark as a separately
identified, balanced incremental journal movement, not a second opening or
an adjustment to the already reconciled initialization. Preserve scoped
source identities and durable receipts so retries, duplicate delivery and
lost acknowledgements cannot omit or double-apply a movement. Preserve its
evidenced operation date; if any captured movement would require a target
posting before go-live, fail closed until a separately reviewed migration
policy supports it. Fence other target writes during this transfer and
reconciliation, admitting only the controlled initialization and bridge.
Reconcile signed balances per account and applicable currency at the final watermark,
and reconcile movement membership, not merely totals. Publish the
attestation and hand off write ownership only after complete transfer and
reconciliation are durable. Until then target reporting remains disabled.
Recovery, failover and rollback must preserve the source fence and operation
identity without interruption; invalidating an attestation after a fence is
released is not an alternative, because a report could race that release.
The design must prove that no inventoried source writer can accept a write
after the final watermark, including while authority or network state is
unknown. An expiring lease or best-effort invalidation alone is insufficient.
If continuous enforcement cannot be proved for a source and its failovers,
do not activate reporting for that scope. Returning ownership to the source
or lifting the fence requires a separate reviewed cutover protocol; it is
not supported by this proposal. Missing accounts, duplicate mappings, omitted
currencies, discrepancies or unverifiable source evidence invalidate the
whole scope; an entry's balance or caller assertion is not proof. No
partially reconciled account set is reportable. The authority must cover
every entry in the report's contributing history,
including reversals, late entries and corrections, and must be updated or
invalidated atomically with every relevant post under the scoped writer
protocol. A claimed classification from an arbitrary caller is not itself
proof. Preserve the original journal and its audit trail; do not silently
exclude or rewrite entries to make a report balance.

For an authorized certified scope, balances sum all certified movements
from go-live through the requested date; period and fiscal-year turnover
include every certified movement in their respective ranges, irrespective
of entry type. This initial design does **not** define statutory
presentation of imported balances or external gross turnover in a period
or fiscal year containing go-live. Trial-balance requests therefore require
both `periodStart` and the authoritative fiscal-year start to be strictly
after go-live; otherwise, subject to the error precedence in API Contracts,
return `422 { error: 'go_live_reporting_unsupported' }` with no figures. A separate
accounting-owner-approved design must reconcile external gross debits and
credits and explicitly define opening/turnover presentation before this
restriction can be lifted. No absence of earlier *internal* journal lines
proves zero earlier external activity. For supported periods the opening
date must itself be covered. Missing, stale, ambiguous, incomplete or duplicated
carry-forward history fails the entire report with `422 { error:
'accounting_policy_unavailable' }`; an unavailable authority returns
`503 { error: 'accounting_policy_authority_unavailable' }`. No figures,
totals or badge are returned. Authority, journal membership and policy
version must be read in the same report snapshot; if atomic writer and
snapshot coverage cannot be proven, reporting stays disabled.

If an organization needs annual close-and-reopen books instead, define
and independently approve that model, boundary entries, opening/turnover
semantics, migration and reconciliation with #5663 before enabling it.
This proposal is not that approval, nor is it an assertion that #5663
currently implements the authority. The supported policy, attestation,
all posting paths, late-entry handling, legacy-writer fencing, rollback,
and compatibility require a coordinated prerequisite and real-database
tests. Until then, both routes fail closed rather than present a plausible
but duplicated result.

**Every fiscal-period boundary here (`asOf`, `periodStart`,
`periodEnd`) filters on the accounting date `operationDate`, not the
recording timestamp `postedAt`.** #5663 assigns an entry to a fiscal
period by `operationDate` (the business-event date); its lock and its
`periodId` filter both key on it, while `postedAt` is the server-set
recording time (`2026-08-18-general-ledger-core-engine.md`, "the lock
check and the `periodId` filter key on `operationDate`, not
`postedAt`"). Filtering on `postedAt` here would put an entry recorded
on February 2 for a January 31 operation into February's ZSiO while
the journal has it in January — exactly the mismatch art. 18 forbids.

The inclusive whole-calendar-day rule therefore applies to
`operation_date`: "as of date D" means `operation_date < D + 1 day`
(UTC), so the internal opening balance at `periodStartDate - 1 day`
uses exactly `operation_date <
periodStartDate` — the same predicate `getTrialBalance`'s CTE uses for
opening (Queries). `postedAt` is never a fiscal-period membership
predicate; a separately specified recording-time snapshot is Phase 2
and not offered here.

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
whole set. Current-parent traversal is valid for historical dates only
under the verified immutable-hierarchy contract in Data Models; without
it the report must fail closed. A later backdated posting can change an
as-of result but cannot change its historical parent. **This is the first use of a recursive CTE anywhere in this
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
(`SUM(CASE WHEN operation_date < periodStart THEN signedAmount END)` for
opening, equivalent `CASE` expressions scoped to the period and to the
fiscal year for `periodDebit`/`periodCredit`/`ytdDebit`/`ytdCredit`,
and one scoped through `periodEnd` for closing), joined against the
recursive descendant set already computed for the tree walk. This is
one SQL statement producing every row, not one round trip per account
— see Queries.

**All six `TrialBalanceRowDto` figures roll up descendants for a
syntetyk row, the same as `getAccountBalance`.** `openingBalance`,
`periodDebit`, `periodCredit`, `ytdDebit`, `ytdCredit`, and
`closingBalance` are all joined against the same recursive descendant
set (above) — a syntetyk account's row is its own direct postings
plus every descendant's, for every one of the six columns, not just
`closingBalance`. This matches `getAccountBalance`'s own rollup
(Design decisions, "Syntetyk balance is a recursive rollup"): a
syntetyk row's turnover columns are not a separate, own-postings-only
convention some readers of art. 18's usual per-account ZSiO framing
might expect — stated explicitly here since the two readings would
produce different, both legally-plausible, figures.

**`zeroSumCheck` is a direct ledger aggregate, not a rollup of this
report's own rows.** Summing the report's per-account `closingBalance`
figures cannot produce a zero-sum check: those figures are
`normalBalance`-normalized (Design decisions, "Balance sign follows
`normalBalance`, always"), so summing them across the chart yields
`Assets + Expenses + Liabilities + Equity + Revenue` — every term
non-negative in normal operation, zero only on an empty ledger — and
separately, a syntetyk account's rollup row double-counts every
descendant's contribution on top of that (a balanced entry to a leaf
under a syntetyk parent appears in both the leaf's row and the
parent's rollup row). `zeroSumCheck` is therefore computed by a
second, independent query that never touches `TrialBalanceRowDto`,
the account hierarchy, or `normalBalance` at all: `SUM(debit) -
SUM(credit) = 0` directly over `JournalEntryLine`
(organization/tenant-scoped, `operation_date < periodEnd + 1 day` (UTC) —
every line posted through the period's end, inclusive). This is the
literal restatement of
#5663's own posting-time invariant (every entry balances, enforced by
both the application and a database trigger) summed across every
entry rather than checked per entry — not a new mechanism, and not
derived from anything this document computes for the rows
themselves. A consequence worth stating explicitly: because it never
joins `LedgerAccount` or walks `parentAccountId`, `zeroSumCheck` is
also immune to the cycle/depth risk named in Risks & Impact Review
for the recursive CTE — a malformed account tree can make a
`TrialBalanceRowDto` row wrong, but it cannot make `zeroSumCheck`
wrong. This independent aggregate is not a hierarchy-integrity check:
if scoped hierarchy validation fails, return neither it nor report rows.

**Live query, not a maintained balance table — a deliberate, reversible
choice, not a default.** `postJournalEntry` already validates and
persists a balanced entry with no notion of "this account's running
total"; adding one would mean every posting also writes to a second
table, in the same transaction, that this document would then own the
correctness of forever. Rejected in favor of computing `SUM()` at read
time: this matches #5663's own stated intent ("layers on later without
changing the posting schema") and avoids optimizing for a load the
system has not measured yet — the same reasoning already used
elsewhere in this document family for `journal_entry_line_dimensions`
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
schema — so it has no dependency on AP/AR/JELD for draft entries. It
cannot ship until the release prerequisites in this document pass.
A future "include AP/AR drafts" toggle
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

**For a fully certified scope, turnover includes every `JournalEntry.type` — no filtering by
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
underlying mechanic every introductory accounting text shows for a
post-closing period — a `CLOSING` entry's zeroing lines land in each
affected account's period turnover, the same as any other posted
line (Kieso/Weygandt/Warfield, *Intermediate Accounting*, 17e, ch. 3,
"Closing Entries," Illustration 3.38 — with one caveat corrected on
independent re-verification: see this document's own Literature &
Prior Art section below for what Kieso's illustration actually shows).
Excluding `CLOSING` (or `OPENING`) lines from the sum would also mean
the period's total turnover no longer reconciles against the journal —
the literal requirement art. 18 imposes (turnover must "zgadzać się z
zapisami dziennika"). Filtering by type would additionally be a second
code path this document doesn't otherwise need: `getAccountBalance`
already includes every posted line regardless of type, and
`getTrialBalance`'s turnover columns use the identical, unfiltered
predicate for consistency with it. A `CLOSING` entry's own lines can
bring a revenue or expense account to zero; an incremental opening can
change a balance. The policy gate below decides whether all contributing
entries form a supported continuous ledger before calculating either.
This statement is conditional on the whole-history policy gate above:
if any entry is unverified or duplicates a carry-forward, neither route
returns figures. Balanced journal totals alone cannot certify that policy.

**Turnover reconciling against the journal (art. 18) is definitional,
but it must be summed over a non-overlapping population — the root
rows, not every row.** Art. 18 requires the ZSiO's turnover to
"zgadzać się z zapisami dziennika", and `periodDebit`/`periodCredit`
already *are* `SUM(debit)`/`SUM(credit)` taken directly from
`JournalEntryLine` — the exact rows that constitute the dziennik — for
the same period and scope. There is no separately computed "journal
total" to add a `journalTotal`/`journalReconciles` field to. The
hierarchy is the subtlety: because all six `TrialBalanceRowDto`
figures roll up descendants (above), summing `periodDebit`/
`periodCredit` across *every* row double-counts — for a balanced
posting Dr `130-1` 100 / Cr `201` 100 with `130-1` under the syntetyk
`130`, the debit rows are `130 = 100` and `130-1 = 100`, summing to
200 while the journal debit is 100. Direct postings to a syntetyk
parent are explicitly supported (Fowler's named variant, above), so
filtering to leaves is also wrong. The non-overlapping, complete
population is the **root rows** — rows whose `parentAccountId` is
`null` — which cover every posting exactly once for a well-formed,
acyclic chart where every non-root account resolves to a root. A
malformed or cyclic `parentAccountId` chain is an integrity failure.
Validate the entire scoped chart and journal membership in the report's
consistent read, then fail the whole report without rows or totals if
invalid; a bounded recursive walk alone cannot establish root coverage.
A regression test,
computed independently in the test rather than derived from the
report's own rows, asserts that the sum of `periodDebit`/
`periodCredit` over the root rows collected across every page equals a
direct `SUM(JournalEntryLine.debit)`/`SUM(JournalEntryLine.credit)`
over the same organization/tenant/date scope, and includes the
parent-plus-child counterexample where the all-rows sum differs (see
Testing Strategy).

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

**Balance in the account's currency (added 2026-10-26). ⚠ NEEDS HUMAN CONFIRMATION (decided by the team, not yet reviewed by a maintainer).**
Required by Multi-Currency, "Revaluation of foreign-currency ledger accounts
(bank, cash)", decision R4 (`2026-09-17-multi-currency.md`), which reads both
balances from `getAccountBalance`.
- *Rule. ⚠ NEEDS HUMAN CONFIRMATION (decided by the team, not yet reviewed by a maintainer).* For an account whose `LedgerAccount.currencyId` is set,
  `getAccountBalance` also returns `balanceInAccountCurrency`: the signed sum of
  `amountCurrency` over the same lines and the same `asOf` boundary as
  `balance`, debit side positive (a line with `debit > 0` adds its
  `amountCurrency`, a line with `credit > 0` subtracts it). A line with
  `amountCurrency = 0` (an exchange-difference or valuation line) changes
  `balance` and leaves `balanceInAccountCurrency` unchanged. For an account
  without a `currencyId` nothing changes: `balanceInAccountCurrency` and
  `currency` are `null`. An explicitly configured base-currency `currencyId`
  is still a configured currency and follows the same leaf/subtree rule;
  only absence of the ID yields the null result by that rule.
- *Sign convention. ⚠ NEEDS HUMAN CONFIRMATION (decided by the team, not yet reviewed by a maintainer).* `balance` stays normalized to the account's
  `normalBalance` (the decision above); `balanceInAccountCurrency` is debit
  side positive, as Multi-Currency R4 specifies, whatever the
  `normalBalance`. The two figures in one response therefore follow
  different sign conventions for a `CREDIT`-normal account; a caller that
  needs both debit side positive (Multi-Currency R3) negates `balance` for a
  `CREDIT`-normal account.
- *Parent and child. ⚠ NEEDS HUMAN CONFIRMATION (decided by the team, not yet reviewed by a maintainer).* The rollup sums a syntetyk account's subtree
  (the `WITH RECURSIVE` walk above), and amounts in different currencies
  cannot be added. `balanceInAccountCurrency` is returned only when the
  account has a `currencyId` and either is a leaf or every account in its
  subtree has the same `currencyId`; otherwise it is `null` (and so is
  `currency`), while `balance` is returned as before. For an as-of
  balance, determine leaf status and currency eligibility using only
  accounts effective on `asOf`; a future-effective child must not change
  a past result. The analogous opening and closing classifications use
  their respective boundary dates. Freeze `currencyId` from effective
  start, including for an empty account, or provide verified dated values;
  #5663's post-first-line freeze alone does not prove this. This
  account-currency behavior remains Phase 2 pending human approval.
- *Why the sum is well defined.* The GL core engine rejects a line on an
  account with a `currencyId` unless the line carries that currency
  (`postJournalEntry`, 422 `lineCurrencyDiffersFromAccount`) and freezes the
  account's currency once it has posted lines (#5663, #6340), so every line
  summed here is in the account's currency.

### Alternatives considered

| Alternative | Why Rejected |
|-------------|---------------|
| Maintain a running balance on `LedgerAccount` (or a new table), updated inside `postJournalEntry` | Adds a second financial aggregate for an unmeasured performance need; live queries still require the separately specified posting guards and their write-path review |
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

## Literature & Prior Art

Per the project's financial-spec-writing-process, this section
consolidates and independently re-verifies the accounting/data-modeling
citations already used piecemeal in Design decisions and the
2026-09-09 Changelog entry, and adds the real-system comparison this
document didn't yet have (the Overview's own "Market Reference"
callout compares only against Odoo). All book citations were
re-checked against full extracted text — not chapter titles or this
document's own earlier paraphrase alone; see
`financial-module-knowledge-base.md` §3 for the verification method.

**The syntetyk/analityk recursive rollup is Fowler's own canonical
Summary Account pattern — confirmed, and one detail worth adding on
independent re-reading.** Fowler, *Analysis Patterns*, §6.3 "Summary
Account," pp.101-102: "We restrict the system to posting entries only
to detail accounts and not to summary accounts... A summary account
that contains summary accounts will look for entries in its
components, its components' components, and so on, recursively." This
document's Design decisions already note it does *not* adopt Fowler's
leaf-only-posting restriction, since #5663 never added one. Worth
citing alongside it: the same section's Figure 6.6 explicitly names
the alternative this document actually implements — "providing two
mappings from account to entry: one to show which entries are posted
at that level, and another to add together the entries on
sub-accounts" — a syntetyk account that both receives direct postings
and rolls up its descendants is itself a named Fowler variant, not
merely "the restriction Fowler describes, deliberately not applied
here."

**The single-parent-hierarchy-over-DAG choice is confirmed against
both books' own explicit warnings.** Fowler §6.15 "Booking Entries to
Multiple Accounts," pp.127-128 (Figure 6.32 generalizes Figure 6.5's
hierarchy into a directed acyclic graph): an account structure
allowing multiple summary parents risks double-counting overlapping
components, and "defining this kind of account is more likely to be
the product of accident than design." Hay, *Data Model Patterns*,
ch.7 "Accounting," the "Summarization" section, p.154: "this is a
hierarchical way of grouping ACCOUNTS, and it does not allow an
account to be in more than one higher-level account. If a company
wanted to allow for multiple roll-up paths, changing the model would
be easy... Administering such an arrangement, however, would be
extremely difficult." Both quotes verified verbatim against full-text
extraction — `parentAccountId`'s single-parent tree is the position
both books independently recommend, not merely a position neither
book argues against.

**The `normalBalance` sign convention matches Hay's Table 7.1 and
Kieso's Illustration 3.1 exactly — confirmed, no correction needed.**
Hay, ch.7, Table 7.1 "Debits and Credits," p.122: Asset debit
+/credit −; Liability and Equity debit −/credit +. Kieso, ch.3
"Debits and Credits," Illustration 3.1, p.3-5: the identical
Asset/Expense debit-increase, Liability/Equity/Revenue credit-increase
convention. Both re-checked against full text and match this
document's formula exactly.

**Correction, found on independent re-verification: Kieso's
illustrated closing entries do not debit revenue directly against
crediting expense in one entry, as Design decisions previously
stated.** Design decisions ("Turnover figures include every
`JournalEntry.type`") cited Kieso ch.3, "Closing Entries," as showing
"the illustrated closing journal entry debits every revenue account
and credits every expense account for its full-year balance, exactly
this document's `JournalEntryLine` shape." Re-checked against the
actual illustration (Illustration 3.38, pp.3-32–3-33): Kieso's example
routes both sides through a temporary **Income Summary** account
across three separate journal entries — (1) debit Service Revenue,
credit Income Summary; (2) debit Income Summary, credit each Expense
account; (3) close Income Summary's net balance to Retained Earnings —
not a single entry with Revenue debited directly against Expense
credited. The fact this document's own turnover design decision
actually needs is unaffected: a `CLOSING` entry's zeroing lines still
land in each affected account's period turnover regardless of which
account is on the entry's other leg. But "exactly this document's
`JournalEntryLine` shape" overstated the match — #5663's own single
`CLOSING` `JournalEntry` design
(`2026-08-18-general-ledger-core-engine.md`, Design decisions,
"Fiscal period closing is a lock flag plus an entry type") has no
Income Summary account at all. It is a simpler, more direct mechanism
than Kieso's own textbook illustration, not an implementation of the
same illustrated shape. Corrected in Design decisions above.

**Real-system comparison.**

- **ERPNext** (`frappe/erpnext`'s `financial_statements.py`, and
  `docs.frappe.io` Accounting Reports, verified 2026-09-15): the Trial
  Balance is computed live — `set_gl_entries_by_account()` queries
  `tabGL Entry` directly at report-generation time, with no maintained
  running-balance or balance-snapshot table — matching this document's
  own "Live query, not a maintained balance table" design decision
  exactly, not merely a similar choice made independently. Its columns
  are Opening Debit/Credit, period Debit/Credit, and Closing
  Debit/Credit — one fewer distinct figure group than this document's
  opening/period/YTD/closing, since ERPNext gets a year-to-date figure
  by widening the date filter rather than a separate column — and it
  shows group (parent/syntetyk-equivalent) account rollup totals by
  default, confirmed via a live feature request asking to suppress
  them (`frappe/erpnext#27131`) — the same syntetyk/analityk shape
  this document implements. A documented ERPNext bug
  (`frappe/erpnext#41453`, Frappe 14/ERPNext 14) reported income/expense
  accounts showing non-zero Trial Balance opening balances — getting
  nominal-account zeroing wrong is a real, recorded failure mode in a
  mature open-source ERP, not a hypothetical risk this document
  invented by calling out its own `CLOSING`-entry-turnover interaction
  explicitly.
- **Comarch ERP Optima** (`pomoc.comarch.pl`, "Zestawienie Obrotów i
  Sald" documentation, verified 2026-09-15) — the closest real-system
  match found to this document's exact shape and name. Eleven columns
  — BO Dt/Ct (opening), Obroty Dt/Ct (period turnover), Obroty n.
  Dt/Ct (cumulative turnover "od początku okresu obrachunkowego," i.e.
  YTD), Saldo Dt/Ct plus Per Saldo (closing/net) — a one-to-one match
  to this document's six `TrialBalanceRowDto` figures
  (opening/periodDebit/periodCredit/ytdDebit/ytdCredit/closing).
  Syntetyk/analityk shown as an expandable tree, with rollup stated
  explicitly: "obroty i salda na koncie syntetycznym wynikają
  wyłącznie z odfiltrowanych kont analitycznych" ("a synthetic
  account's turnover and balance derive *exclusively* from its
  [filtered] analytic accounts") — worth flagging as a genuine
  divergence, not just a confirmation: Optima's own wording implies
  synthetic accounts do not receive direct postings of their own in
  its model, which is exactly the Fowler-canonical leaf-only-posting
  restriction this document's Phase 1 explicitly does *not* enforce
  (Design decisions, "Syntetyk balance is a recursive rollup... not
  restricted from also receiving direct postings"). The period filter
  is a free date range ("Obroty za okres," Od–Do), matching this
  document's own `periodStart`/`periodEnd` shape rather than a fixed
  monthly grid.
- **enova365** (`enova.pl` blog, "Zestawienia obrotów i sald — dobre
  praktyki dla księgowych," verified 2026-09-15) — confirms the same
  four-figure-group shape (opening/period/cumulative-YTD/closing) at
  the synthetic-account level, and describes "automated verification"
  (built-in accuracy checks) as a named product feature — the same
  role this document's `zeroSumCheck` plays. The article doesn't
  detail analytic-account rollup mechanics or state whether synthetic
  accounts can also receive direct postings, so unlike Comarch this is
  recorded as a partial match, not a confirmed divergence.

Together, ERPNext and Comarch Optima confirm the two structural
choices this document made independently of either: a live query over
posted entries (ERPNext, exactly) and a four-figure-group
syntetyk/analityk report shape (Comarch, almost figure-for-figure).
Comarch also surfaces the one live-system product decision this
document deliberately diverges from — restricting postings to
analytic accounts — already recorded and justified in Design decisions
on other grounds (Phase 1 not adding a restriction #5663 itself
doesn't have yet), not newly discovered here, but now backed by a
concrete real-system precedent for the road not taken.

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

The report adds no seed data; the hierarchy baseline and fiscal authority
may require scoped setup. No `seedDefaults` assumption is final until
those prerequisites are reviewed.

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
  scoped by tenant/organization, filtered to `operation_date < asOf +
  1 day` (UTC — Design decisions, "Every fiscal-period boundary here
  filters on the accounting date"), returns a single signed balance
  (already normalized to the account's `normalBalance` side). Its
  coverage/authority checks, whole-scope integrity validation and balance
  query also share the same scoped repeatable-read, read-only transaction
  and database snapshot described for `getTrialBalance` below. Since
  2026-10-26 it also returns `balanceInAccountCurrency` and `currency` for
  an account with a `currencyId` (Design decisions, "Balance in the
  account's currency"; ⚠ NEEDS HUMAN CONFIRMATION (decided by the team, not
  yet reviewed by a maintainer)); for any other account both are `null`.
- `getTrialBalance(em, { tenantId, organizationId, periodId, page?, pageSize? })`
  — resolves the named `FiscalPeriod`'s `startDate`/`endDate` and the
  uniquely configured fiscal year containing the whole period (Data
  Models), then runs **one** `WITH
  RECURSIVE` query over the whole chart of accounts computing
  opening/period-turnover/YTD-turnover/closing per account via
  conditional aggregation (Design decisions,
  "`getTrialBalance` computes every account's row in one set-based
  pass") — not `getAccountBalance` called per account. Coverage and
  authority checks, whole-scope integrity validation, period and fiscal
  lookup, row/count aggregation and `zeroSumCheck` must run inside one
  tenant/organization-scoped PostgreSQL `REPEATABLE READ READ ONLY`
  transaction on the same connection and snapshot. No rows or totals may
  be sent before every check succeeds. The authorities must be stored and
  versioned in that same transactionally consistent database, or provide
  a separately proven coherent snapshot contract; otherwise fail closed.
  This per-request snapshot does not solve cross-page consistency, which
  remains an independent release gate. Two results come out of this call
  from two separate statements in that same snapshot:
  - `rows` (one `TrialBalanceRowDto` per account) — the per-account
    CTE result above, returned **page/pageSize-paginated**, ordered by
    the account number and ID (`LedgerAccount.number`, `id`), `pageSize` capped at 100
    (default 100) — offset-based, matching `DataTable`'s actual
    pagination contract (`page`/`pageSize`/`total`/`totalPages`; the
    component has no cursor/keyset mode). This is the concrete answer
    to the chart-of-accounts scale the "1–999999 pozycji" hot spot
    names: no single response is ever asked to carry up to a million
    rows.
  - `zeroSumCheck` — **not** derived from `rows` or from the account
    hierarchy at all (Design decisions, "`zeroSumCheck` is a direct
    ledger aggregate"): a second, independent query, `SUM(debit) -
    SUM(credit) = 0` directly over `JournalEntryLine`
    (organization/tenant-scoped, `operation_date < periodEnd + 1 day`
    (UTC)), with no join to `LedgerAccount` and no recursion. Computed once per
    request, unaffected by `page`/`pageSize`, and cheaper than the
    per-account CTE, not just independent of it.

Before either report starts its repeatable-read transaction, acquire a
conservative trusted UTC-day bound on that connection. The bound must be
durably established before the transaction's first snapshot, not sampled
after it: a paused old snapshot must never use tomorrow's later clock
reading. The clock authority serializes an observed database UTC instant
against a durable non-decreasing watermark, fails closed on regression or
unavailability across processes and restarts, commits that observation,
then starts the read-only transaction and obtains its snapshot. The first
snapshot statement also checks the authority has not regressed below the
bound. All report dates must be at or before that pre-snapshot day; a
conservative rejection around midnight may be retried with a new bound.
The post-commit verifier and all writers use the same authority and
durable watermark. If this ordering or monotonicity cannot be proven,
return 503 without figures. No wall-clock read taken after snapshot
acquisition can widen the bound. This contract needs a concrete database
implementation, availability budget and adversarial concurrency tests
before release; it is not established by `REPEATABLE READ` alone.

### API Routes (`api/`)

- `api/accounts/[id]/balance/route.ts` — `GET
  /api/ledger/accounts/:id/balance?asOf=<date>` (defaults to today).
  Exports `metadata` with `GET.requireAuth = true` and
  `GET.requireFeatures = ['ledger.reports.view']` (no top-level
  `export const requireAuth`), and exports `openApi` per
  `packages/core/AGENTS.md` → API Routes, matching every other route
  in this module.
- `api/reports/trial-balance/route.ts` — `GET
  /api/ledger/reports/trial-balance?periodId=<uuid>&page=<n>&pageSize=<n>`.
  Same `metadata`/`openApi` pattern as the balance route.

### Backend Pages (`backend/ledger/reports/`)

- `trial-balance/page.tsx` — a read-only page whose **page component,
  not `DataTable`, owns fetching and pagination state**.
  `packages/ui/src/backend/DataTable.tsx` requires `columns` and `data`
  and accepts a controlled `pagination` object
  (`page`/`pageSize`/`total`/`totalPages`) with an `onPageChange`
  callback; it has no `apiPath` prop and performs no request of its
  own, so this page must drive the load. The page holds `periodId`,
  `page`, `pageSize`, the response `rows`, `total`, `totalPages` and
  `zeroSumCheck` in state, and loads
  `GET /api/ledger/reports/trial-balance?periodId=<id>&page=<n>&pageSize=<n>`
  through `apiCallOrThrow` from
  `@open-mercato/ui/backend/utils/apiCall` — not a second request and
  not a shared-component extension. It renders `LoadingMessage` /
  `ErrorMessage` from `@open-mercato/ui/backend/detail` while the load
  is pending or fails, and the table's own empty state when `rows` is
  empty. Each load carries a monotonically increasing request identity
  bound to period, page and page size. Invalidate the prior identity and
  clear figures, totals and badge immediately on a parameter change or
  current-request error; only the latest still-mounted request may update
  success, error or loading state. Cancellation may reduce work but is not
  the correctness guard: a late response must be ignored even if the
  transport cannot cancel it. `onPageChange` (and the period picker, a `FiscalPeriod`
  select) updates the corresponding state and reloads. The response is
  passed straight into `<DataTable entityId="ledger.trialBalanceRow"
  columns={columns} data={rows} pagination={{ page, pageSize, total,
  totalPages, onPageChange }} />`, capped at `pageSize ≤ 100` per root
  `AGENTS.md` → UI & HTTP, and a stable `entityId` keeps future widget
  injection (columns/filters) working. One row per `LedgerAccount`,
  sorted by account number — syntetyk and analityk rows appear in that
  same flat order, with no indentation by hierarchy depth in Phase 1:
  `DataTable` has no tree/indentation support to build on today
  (checked directly; no such "existing hierarchical-list convention"
  exists), so visually distinguishing syntetyk rows by depth is
  deferred (see Out of scope) rather than assumed free. The summary
  `<StatusBadge>` (`success` variant when `zeroSumCheck` is `true`,
  `error` when `false`) is rendered by the page from that same
  response — every response carries `zeroSumCheck` (API Contracts) —
  with no independent summary request. All labels (column headers, the
  period picker, the zero-sum badge text) go through `useT()`, not
  hard-coded strings — see Internationalization. No create/edit UI, no
  icon-only controls, no dialogs — this page has no mutation surface.
  Registered with a `page.meta.ts` following the existing `ledger`
  backend pages' nav/icon convention (File Manifest).
- `accounts/[id]/page.tsx` (existing #5663 page) gains a read-only
  "Balance" panel that fetches `GET .../balance` via `apiCallOrThrow`
  — an additive UI change to an existing page, not a new page. A new
  account's default-day or explicitly selected balance date can be before
  `effectiveStart`: after rechecking authorized scoped account detail and
  verified coverage for that date, show a localized "available from" state
  with that date and no figures. Do not infer existence or coverage from a
  generic 404; if detail, authorization or coverage cannot be confirmed,
  show the applicable generic missing/forbidden/unavailable state. On a
  concurrent delete or changed authorization, clear the panel and show
  the ordinary missing/forbidden state. Earlier chosen dates and future
  dates follow the API's coverage and future-date errors. Any
  line touched on this existing page during that change is migrated to
  semantic tokens per
  the Boy Scout rule.

## Data Models

**Report-side schema: `LedgerAccount.parentAccountId` returns with this feature.** The separate fiscal-year authority may require its own schema and migration, which are not yet designed. #5663 removed the earlier structural `parentAccountId` on 2026-10-12 and delegated its return to this account-balances rollup — the first consumer that aggregates over it (`2026-08-18-general-ledger-core-engine.md`, revised "`LedgerAccount` has no parent column"). This document owns the additive column:

- nullable UUID `parentAccountId` FK to `ledger_accounts.id` (`ON DELETE RESTRICT`), `NULL` for a root, always in the child's tenant and organization. Never silently detach children when deleting a parent;
- the parent column and `(organization_id, parent_account_id)` index do not establish historical ancestry. A scoped, externally evidenced and accounting-owner-attested baseline must establish a complete, acyclic chart and coverage date before reports are enabled. Existing rows defaulting to `NULL` are not evidence that they were historical roots. Unknown or unsupported history fails closed; never rewrite journal lines to invent it;
- baseline evidence must establish that every relevant edge, root, effective start and historical signing/currency attribute remained unchanged over the entire claimed covered interval through the atomic activation point, not merely describe the tree at activation. An empty subtree moved during that interval is not exempt. Retain the evidence and a scope-bound, versioned attestation; if any interval, writer or attribute cannot be verified, exclude that history and return the coverage error rather than infer it from the current chart;
- Phase 1 deliberately freezes every parent edge and root assignment from that baseline, including empty accounts. New accounts may select a same-scope eligible parent at creation, but ordinary creation must not add a root or edge to an already observable accounting day. The post-commit observation protocol below chooses an immutable effective start strictly after an observed post-commit UTC day and no earlier than its parent's effective start. Posting before that start is rejected. There is no ordinary historical import or backdated create; any future evidenced correction/re-attestation protocol requires a separate design and remains disabled. The **proposal day** is the trusted UTC day observed before starting its first reservation transaction; posting on that day is prohibited. A verifier can publish after a later midnight, in which case a posting on the publication/response day is allowed if that day is on or after `effectiveStart`; this is not a promise of a one-day delay after the response. Reject later reparent, clear-parent, parent deletion and any undo/restore path that would alter a frozen edge. Preserve historical accounts and ancestors for all covered reports; do not hard-delete a node or omit an archived ancestor from rollups or root rows, even if that ancestor has no direct postings. Freeze account type and normal-balance attributes used for historical figures, or fail closed until their historical values are available. Future reparenting needs effective-dated ancestry and separately specified transfers across report boundaries;
- a new account's parent must already exist and be effective for its entire covered lifetime. Historical account reads before that account's effective start return 404; trial-balance rows exclude accounts not effective by the requested period end. All covered journal lines must resolve to effective same-scope accounts and ancestors; an orphan, cycle, missing coverage or historical attribute makes the whole report fail closed, never a partial total. Display names and numbers are current report-snapshot metadata, not a claim of historical labels;
- both reports require verified coverage for every date contributing to the requested figure, including the opening-balance date before a trial period. A date outside coverage returns `422 { error: 'hierarchy_history_unavailable' }`; an unavailable authority or detected corrupt covered chart returns 503 with no figures. Trial periods or fiscal years containing go-live are unsupported as described in the opening policy; the public as-of route also rejects dates outside coverage;
- the entity, validators, account commands and API must enforce same-scope parents, acyclicity and exact eligible type identity before activation. Every chart activation, create, attempted reparent/clear/delete/restore/undo and other hierarchy mutation takes the same exclusive transaction-scoped PostgreSQL advisory lock keyed by trusted tenant and organization before checking frozen state and ancestry. All posting paths, including imports, retries and undo/redo, take a compatible shared lock before validating account coverage and hold it through commit or rollback. Specify one global order with fiscal-period and account locks across every writer; fail closed when the lock or coverage authority is unavailable. This is a coordinated #5663 posting/account compatibility change, not a read-only addition;
- add an accounting-date `effectiveStart` field backed by a scoped persisted date, returned in account create/list/detail and undo snapshots. A new account may omit it; after the first commit the default is the later of the next observed database UTC day and the selected parent's effective start. An explicit value must meet the same lower bound; otherwise reject the pending create without publishing an edge. Omission is a wire bridge, not proof that the changed posting behavior is compatible. Parent eligibility requires an existing, active, non-deleted same-tenant/organization account with the exact same `accountTypeId`, effective no later than the child. Different type IDs are ineligible even when their nullable `accountGroupId` values match or are both null. Reject missing or foreign parents without revealing foreign records; a same-scope inactive/deleted or different-type parent is ineligible. Preserve this predicate under concurrent delete/type change. The effective start is immutable after creation: an update may omit it or repeat the stored value, but a different value or an undo that would change it fails. Stage the nullable storage, attested baseline backfill and validation before any NOT NULL constraint; unknown legacy dates remain unverified and reporting fails closed. A dual-version deployment must fence/drain legacy writers before activation as below, and the compatibility bridge and generated API/OpenAPI contracts must be reviewed with #5663 before enforcement;
- post-commit observation protocol: after the operation-identity lock and then the exclusive scoped hierarchy lock, the first transaction reserves a durable operation identity and pending proposal in the same database transaction; it does not publish the edge or permit posting. After that commit is known, a recoverable verifier obtains the non-regressing trusted UTC-day observation described in Queries, then in a second transaction rechecks parent eligibility, locks and identity, chooses or validates `effectiveStart` strictly after that observed day, and atomically publishes the edge and records a retained success outcome. Invalid dates or newly ineligible parents atomically record a retained rejection without publishing. Either terminal transition clears only its own pending marker in the same transaction; another operation's marker remains. A response is sent only after the terminal outcome is known. An uncertain commit acknowledgement is not evidence that a marker remains: query the durable primary for that operation's terminal or pending state; if the outcome cannot be established, return 503 and keep recovery/reporting fail-closed until it can. Reports return `503 { error: 'hierarchy_verification_pending' }` for an authorized existing resource while any scoped marker remains. A report snapshot taken before the proposal commits uses a day bound established before that snapshot, which cannot exceed the later verifier observation; it cannot successfully request the new edge's strictly later effective day. A snapshot after proposal commit sees either pending and fails closed, or a terminal result. This proof depends on the clock and snapshot ordering in Queries, and requires real concurrency and recovery tests before release;
- reserve a tenant/organization- and actor-scoped operation ID with a canonical digest of all semantically relevant submitted inputs, including the distinction between omitted and explicit effective date. Resolve an omitted date once after the first commit and retain that result; retries must not recalculate it. Authenticate and reauthorize every reservation, replay and status lookup. Same ID and digest replay the retained pending, success or rejection outcome; reuse with a different digest returns 409 without side effects. Preserve terminal outcomes at least as long as the existing create/retry guarantee; no automatic expiry may weaken an existing lifetime guarantee. Verifier leases require fencing so a recovered worker cannot publish after a terminal decision. A client without a stable retry identity cannot safely resolve a lost response by inventing a new one: the existing #5663 create contract requires a concrete compatible bridge or an explicitly authorized alternative before activation. Until then, disable the new writer protocol and reports for that scope rather than claim old-client replay safety;
- first-reservation recovery: every reservation, same-ID retry and status resolution takes the same transaction-scoped operation-identity lock before reading or inserting, backed by a real unique constraint on the full scoped ID. A retry blocks behind an in-flight original transaction; a bounded wait returns 503 with outcome unknown, never a new ID or assumed abort. After acquiring the lock, read the durable primary using a fresh read-committed snapshot: a committed row yields its pending/terminal outcome and digest check; no row means no reservation committed as of that serialized check, so retry may reserve the same ID. A status response reporting no committed row must not assert that an earlier request still in transit can never start; a later same-ID original and retry remain serialized by the same lock and unique constraint. If primary transaction resolution or lock acquisition cannot be established, preserve outcome-unknown and retry the same ID. Hash collisions in advisory lock keys may only add contention; the full scoped ID and database uniqueness decide identity. A primary read that sees no committed marker does not require a fictitious scope gate: reports on snapshots before the eventual first commit are safe because their pre-snapshot day bound cannot exceed the later verifier observation, and the eventual effective start is strictly later. Once committed, the pending marker gates snapshots until its own terminal transition. Test this proof; do not enable if primary ordering, failover durability or the non-regressing clock cannot be established;
- existing archived baseline ancestors remain traversable and appear as root rows where needed even without direct postings. New children cannot attach to deleted or inactive parents. Deletion of a parent with children is rejected; restoring an existing child while its parent is inactive/deleted is rejected without consuming the undo token until the parent is restored. Re-read the parent under the hierarchy lock to serialize concurrent deletion, restore and creation;
- baseline validation applies the same exact-type predicate to every retained edge; an attested legacy chart that violates it remains unsupported until an independently reviewed correction. A shared account type's group or normal-balance change must not reinterpret any covered account, including empty descendants;
- cutover must fence every legacy or unmanaged writer at the database boundary, drain in-flight transactions, acquire the exclusive scope lock, revalidate the full attested interval and current state, and publish the verified baseline, coverage and enforcement generation atomically in the same transaction. A process-level feature flag alone is insufficient. New and legacy readers fail closed until publication; if any writer cannot be fenced or evidence revalidated, abort activation and keep reports disabled. Rollback must retain the fence until a documented compatible state is restored; never reopen legacy writers while reports rely on frozen history;
- coordinated writers acquire locks in this order: complete any clock-watermark transaction before taking business locks; then operation-identity lock when applicable, scope hierarchy lock (shared for postings, exclusive for topology or activation), scoped fiscal-period lock required by #5663, account-type rows in deterministic ID order, then account rows in deterministic ID order. Period-boundary/lock and shared account-type writers must participate in the same order whenever they can affect these invariants. Do not enable until every import, reversal, retry, administrative, delete/restore and undo path, including independently deployed writers, demonstrably follows the protocol; no external call or backoff holds a database transaction open;
- reads and ordering use the account business key `number` (formerly `slug`); `description` is the display name;
- the parent column is additive, but the coverage and immutability guards change write behavior. Review staged migration, compatibility and mixed-version writer enforcement before activation.

Both `getAccountBalance` and `getTrialBalance` read the existing
`JournalEntry`, `JournalEntryLine`, `LedgerAccount`, and `FiscalPeriod`
entities from #5663, as specified there. `FiscalPeriod` alone supplies
no fiscal-year boundary: neither a January 1 default nor a gap between
periods establishes the organization's accounting year.

**Fiscal-year authority is a release prerequisite.** Before the trial
balance is enabled, #5663 or a separately reviewed prerequisite must
provide authoritative, tenant- and organization-scoped fiscal-year
intervals with inclusive start and end dates. Intervals must be valid,
non-overlapping within a scope, and support irregular and non-calendar
years. Every reportable period must be wholly contained in exactly one
such interval. Boundary changes and period creation/update must enforce
that invariant under concurrent writes; changes affecting posted or
locked periods require a separately reviewed, audited correction
workflow. Existing organizations require an explicitly attested baseline;
do not infer historical boundaries from current period gaps or dates.

Resolve the period and its unique covering year in the same scoped
consistent read as the report. `ytdDebit`/`ytdCredit` sum from that
year's start through `periodEnd` inclusive. If the authority is absent,
unavailable, ambiguous, invalid, or does not wholly cover the period,
fail the entire report without rows or totals: return `422
{ error: 'fiscal_year_unavailable' }` for missing or invalid setup and
`503 { error: 'fiscal_year_authority_unavailable' }` for an unavailable
authority. Never silently substitute a calendar year. These conditions
are release gates, not evidence that #5663 already implements the
authority; coordinate its schema, migration, API and compatibility
review before implementation.

The authority prerequisite must inventory every existing period writer,
including #5663's generated periods, imports, commands, API and undo paths.
It must specify attested migration and reconciliation of existing periods,
staged deployment and mixed-version writer behavior. #5663 currently
accepts non-overlapping periods without this containment rule; rejecting
previously accepted writes is a compatibility change, not a consequence
of merely adding a table. Follow the repository's deprecation and bridge
protocol or obtain an explicitly authorized alternative before enforcement.
Until compatible enforcement covers every writer, trial-balance remains
disabled for the affected scope.

## API Contracts

### `GET /api/ledger/accounts/:id/balance`

- **Query params**: `asOf?` (date, defaults to the trusted pre-snapshot
  UTC day). Validated with
  a zod schema (`z.object({ asOf: z.string().date().optional() })`)
  before the query runs; an unparseable `asOf` is a 400, not passed
  through to the CTE.
- **Response 200**: `{ accountId, asOf, balance, currency,
  balanceInAccountCurrency }`. `balance` is the base-currency balance,
  normalized to `normalBalance`, as before. `currency` and
  `balanceInAccountCurrency` (added 2026-10-26, ⚠ NEEDS HUMAN CONFIRMATION (decided by the team, not yet reviewed by a maintainer)) are the account's
  `currencyId` and its balance in that currency, debit side positive, when
  the account has a `currencyId` and is a leaf or has a single-currency
  subtree (Design decisions, "Balance in the account's currency"); otherwise
  both are explicitly `null` rather than omitted, so a client can't mistake
  their absence for "same as the tenant's base currency" by accident.
- **Response 400**: `asOf` fails zod validation (not a valid date).
- **Response 403**: caller lacks `ledger.reports.view`.
- **Response 404**: no `LedgerAccount` with that id in the caller's
  tenant/organization or the account was not yet effective at `asOf`.
- **Response 422**: requested history is outside verified hierarchy
  coverage (`{ error: 'hierarchy_history_unavailable' }`); return no figures.
- **Response 422**: accounting-policy coverage is missing, ambiguous or
  invalid (`{ error: 'accounting_policy_unavailable' }`); return no figures.
- **Response 422**: `asOf` is after the trusted pre-snapshot day
  (`{ error: 'report_future_date_unsupported' }`).
- **Response 429**: a per-user or per-organization report rate or
  concurrency budget is exhausted (`Retry-After` in seconds; Risks &
  Impact Review, "Availability controls").
- **Response 503**: hierarchy authority is unavailable or the scoped
  hierarchy is invalid (`hierarchy_authority_unavailable` or
  `report_hierarchy_invalid`), a pending hierarchy verification blocks
  reporting (`hierarchy_verification_pending`), accounting-policy authority
  is unavailable (`accounting_policy_authority_unavailable`), or the enforced query deadline expired
  (`{ error: 'report_timeout' }`), or shared admission control is
  unavailable (`{ error: 'report_admission_unavailable' }`). No report
  query is admitted without a valid shared decision; no failure is
  retried server-side.

After authentication, feature authorization, syntax validation, shared
admission and trusted-clock acquisition, take the snapshot and resolve the
account in the trusted scope first (404 if absent or foreign). For an
existing account, check pending verification (503), future date (422),
hierarchy coverage (422), effective start (404), then accounting-policy
coverage (422 if invalid or 503 if its authority is unavailable). Scope
integrity or authority failures return 503 without figures. A provisional account is
not a published account; its operation status is available only through
the independently authorized scoped status lookup. This order avoids
leaking foreign existence and resolves overlapping failure conditions.

### `GET /api/ledger/reports/trial-balance`

- **Query params**: `periodId` (required, a `FiscalPeriod` id),
  `page?` (default 1), `pageSize?` (default 100, max 100) —
  `DataTable`'s own pagination shape, not cursor/keyset. Validated
  with a zod schema (`z.object({ periodId: z.string().uuid(), page:
  z.coerce.number().int().min(1).default(1), pageSize:
  z.coerce.number().int().min(1).max(100).default(100) })`); a
  missing/malformed `periodId` or an out-of-range `page`/`pageSize` is
  a 400.
- **Response 200**: `{ periodId, periodStart, periodEnd, zeroSumCheck: boolean, rows: TrialBalanceRowDto[], page: number, pageSize: number, total: number, totalPages: number }`
  where `TrialBalanceRowDto` is `{ accountId, accountNumber, description, parentAccountId, openingBalance, periodDebit, periodCredit, ytdDebit, ytdCredit, closingBalance }` (`number` and `description` are #5663's account business key and display name).
  `rows` is paginated by account number via `page`/`pageSize` — see
  Design decisions, "`getTrialBalance` computes every account's row
  in one set-based pass," for why pagination applies to `rows` but
  not to `zeroSumCheck`, which is a separate query computed over the
  full chart on every request regardless of `page`/`pageSize`.
- **Response 400**: `periodId`, `page`, or `pageSize` fails zod
  validation.
- **Response 403**: caller lacks `ledger.reports.view`.
- **Response 404**: no `FiscalPeriod` with that id in the caller's
  tenant/organization.
- **Response 422**: fiscal-year setup is missing, ambiguous, invalid, or
  does not wholly cover the period (`{ error: 'fiscal_year_unavailable' }`).
- **Response 422**: requested history is outside verified hierarchy
  coverage (`{ error: 'hierarchy_history_unavailable' }`); return no rows or totals.
- **Response 422**: accounting-policy coverage is missing, ambiguous or
  invalid (`{ error: 'accounting_policy_unavailable' }`); return no rows or totals.
- **Response 422**: the period or its fiscal year begins on or before
  go-live (`{ error: 'go_live_reporting_unsupported' }`); return no rows or totals.
- **Response 422**: the period end is after the trusted pre-snapshot day
  (`{ error: 'report_future_date_unsupported' }`); return no rows or totals.
- **Response 429**: a per-user or per-organization report rate or
  concurrency budget is exhausted (`Retry-After` in seconds; Risks &
  Impact Review, "Availability controls").
- **Response 503**: fiscal-year or hierarchy authority is unavailable,
  or the scoped hierarchy is invalid (`fiscal_year_authority_unavailable`,
  `hierarchy_authority_unavailable` or `report_hierarchy_invalid`), or
  a hierarchy verification is pending (`hierarchy_verification_pending`),
  accounting-policy authority is unavailable (`accounting_policy_authority_unavailable`); the enforced
  query deadline expired
  (`{ error: 'report_timeout' }`), or shared admission control is
  unavailable (`{ error: 'report_admission_unavailable' }`). No report
  query is admitted without a valid shared decision; no failure is
  retried server-side.

After authentication, feature authorization, syntax validation, shared
admission and trusted-clock acquisition, take the snapshot and resolve
the period in the trusted scope (404 if absent or foreign). For an
existing period, check pending verification (503), future end date (422),
hierarchy coverage (422), accounting-policy coverage (422 or 503), then fiscal-year authority/containment
(422 for invalid setup or 503 for unavailable authority), then the go-live
period and fiscal-year restriction (422). Finally validate
the complete scoped hierarchy and journal membership; any corruption or
authority failure is 503 with no rows, totals or badge. Rate-limit or
clock-service failures may occur before scoped lookup and return their
documented 429/503 responses.

Account create/update/delete/restore and undo APIs must return a scoped
`409 { error: 'hierarchy_frozen' }` for an edge-changing operation after
activation, `409 { error: 'account_effective_start_immutable' }` for a
different effective start on update or undo, `422 { error:
'account_effective_date_invalid' }` for an invalid new effective start,
`404 { error: 'parent_not_found' }` for a missing or foreign-scope parent,
`422 { error: 'parent_ineligible' }` for a same-scope inactive/deleted
or different-type parent, `409 { error: 'parent_inactive' }` when a
restore's retained parent is inactive/deleted, and
`503 { error: 'hierarchy_authority_unavailable' }`
when the guard cannot be checked. The account UI uses localized errors,
keeps unsaved inputs where possible, and never displays a successful save
for a rejected operation. Account create/list/detail responses expose the
effective start, and the UI explains the first permitted posting date.
Exact compatibility with #5663's existing API
and undo contracts remains a reviewed rollout prerequisite. For update or
delete, after authentication, scoped lookup and input validation, check
the supplied optimistic-lock version under the same row lock first: a
stale version returns #5663's existing `OptimisticLockConflictBody` 409.
Only a current-version operation proceeds to the hierarchy guard and can
return `hierarchy_frozen` 409. Undo keeps its existing audit-token and
scope checks first; a rejected frozen undo must not consume its token.

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
- `ledger.reports.trialBalance.errors.fiscalYearUnavailable` — the
  configuration error for a 422; the page clears prior figures and
  directs the user to an authorized accounting administrator. Authority
  outages use the existing localized unavailable state without stale rows.
- `ledger.reports.errors.hierarchyHistoryUnavailable` — shared localized
  explanation for reports outside verified hierarchy coverage; clear prior
  results and direct the user to an authorized accounting administrator.
- `ledger.reports.errors.{futureDateUnsupported,hierarchyVerificationPending}`
  — localized future-date and temporary verification states, without stale figures.
- `ledger.reports.errors.accountingPolicyUnavailable` — localized
  incomplete/unsupported policy state, directing an authorized user to
  an accounting administrator; authority outages use the unavailable state.
- `ledger.reports.trialBalance.errors.goLiveReportingUnsupported` — localized
  explanation that this period or fiscal year includes pre-go-live reporting,
  directing the user to an accounting administrator without retaining figures.
- `ledger.reports.balancePanel.availableFrom` — localized pre-effective
  state with the verified first available accounting date.
- `ledger.accounts.errors.{hierarchyFrozen,accountEffectiveStartImmutable,
  accountEffectiveDateInvalid,parentNotFound,parentIneligible,parentInactive,
  hierarchyAuthorityUnavailable}` — account write and undo failure states.
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

0. Coordinate the fiscal-year authority and its migration, scope and
   concurrent-write rules with #5663; coordinate the opening-policy
   authority and all posting-writer guarantees as separate prerequisites.
   Keep both reports disabled until their applicable gates are implemented
   and verified.
1. Add `ledger.reports.view` to `acl.ts` and `setup.ts`'s `employee`
   list, then run `yarn mercato auth sync-role-acls` so existing
   tenants receive the new grant (`packages/core/AGENTS.md` → ACL
   Grant Sync) — this document is Phase 2 of an already-shipped
   module, so tenants initialized under Phase 1 would not otherwise
   get it.
2. Add the additive `LedgerAccount.parentAccountId` column, index and
   write-time validation (entity, validator, migration, account
   commands/API), plus the attested baseline and posting guards in Data
   Models. Do not activate reporting until all writer and migration gates
   are verified.
3. Implement `getAccountBalance` (`queries/getAccountBalance.ts`) —
   the `WITH RECURSIVE` CTE plus `normalBalance`-signed aggregation,
   scoped by tenant/organization.
4. Implement `getTrialBalance` (`queries/getTrialBalance.ts`) — one
   `WITH RECURSIVE` set-based query over the whole chart of accounts
   computing opening/period-turnover/YTD-turnover/closing per account
   (Design decisions, "`getTrialBalance` computes every account's row
   in one set-based pass") — never `getAccountBalance` called per
   account — plus a second, independent aggregate query directly
   over `JournalEntryLine` for `zeroSumCheck` (Design decisions,
   "`zeroSumCheck` is a direct ledger aggregate").
5. Implement `api/accounts/[id]/balance/route.ts` and
   `api/reports/trial-balance/route.ts`, both behind
   `ledger.reports.view`, both validating query params with zod
   (`asOf`, `periodId`; see API Contracts) before querying, both
   exporting `openApi`; enforce both shared rate budgets, leased
   concurrency admission and the query deadline described under
   Availability controls. Provide and register a generic shared semaphore
   through DI, and document the shared Redis prerequisite for these routes.
6. Add the "Balance" panel to the existing `accounts/[id]/page.tsx`.
7. Implement `backend/ledger/reports/trial-balance/page.tsx`
   (page-owned `apiCallOrThrow` loading plus `periodId`/`page`/`pageSize`
   state, loading/error/empty states, a flat `DataTable` sorted by
   account number with the response's `rows` and pagination, the period
   picker, and the `<StatusBadge>` summary rendered from the same
   response — no hierarchy-depth indentation in Phase 1).
8. Add `ledger.reports.*` keys to `i18n/en.json` and `i18n/pl.json`
   (see Internationalization).
9. Integration tests for both routes (400 on a malformed `asOf`/
   `periodId`, 403 without the feature, 404 on a foreign-tenant id, 200
   with correct figures) per root `AGENTS.md:164`.

### Phase 2 (deferred, tracked in Out of scope)

- AP/AR "bufor" toggle, once AP/AR draft/submitted states exist in a
  running system.
- Materialized/cached balance table, only if real measurement shows
  the live query doesn't hold up at production volumes.
- Bilans / P&L (4xx, 5xx) / Cash Flow / tax reporting — separate,
  larger future documents.
- Balance in the account's currency (designed 2026-10-26, Design
  decisions, "Balance in the account's currency"; ⚠ NEEDS HUMAN
  CONFIRMATION (decided by the team, not yet reviewed by a maintainer)):
  needed by Multi-Currency R4 before its Phase 2 (revaluation of
  foreign-currency ledger accounts) can be implemented.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `acl.ts` | Modify | Add `ledger.reports.view` |
| `setup.ts` | Modify | Add `ledger.reports.view` to `employee`'s `defaultRoleFeatures` |
| `data/entities.ts` | Modify | Add nullable `parentAccountId`, staged `effectiveStart` date and the `(organization_id, parent_account_id)` index |
| `data/validators.ts` | Modify | Validate optional `parentAccountId` and `effectiveStart`, same-scope eligibility and immutable update behavior |
| `migrations/MigrationXXXXXXXXXXXXXX.ts` | Modify/Create | Add parent and effective-start storage and index; coordinate verified baseline and restrictive deletion |
| `commands/ledgerAccounts.ts` | Modify | Validate parent at creation and enforce frozen edges in every mutation and undo path |
| `commands/journalEntries.ts` | Modify | Coordinate posting paths with scoped coverage and hierarchy locks; reconcile exact path with #5663 |
| `api/accounts/route.ts` | Modify | Accept and return `parentAccountId` in the account CRUD fields |
| `queries/getAccountBalance.ts` | Create | Recursive, `normalBalance`-signed balance as of an `operationDate` |
| `queries/getTrialBalance.ts` | Create | Per-account opening/turnover/YTD/closing rows + zero-sum check |
| `api/accounts/[id]/balance/route.ts` | Create | `GET .../balance`, `metadata` + `openApi` export |
| `api/reports/trial-balance/route.ts` | Create | `GET .../trial-balance`, `metadata` + `openApi` export, `page`/`pageSize` pagination |
| `api/openapi.ts` | Modify | Register the two new routes' schemas |
| `packages/shared/src/lib/concurrency/` and DI registration | Create/Modify | Generic shared leased semaphore, coordinator wiring and tests; no ledger-specific shared helper |
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
- Assert `getAccountBalance(accountId, asOf)` for a covered date on or
  after the account's effective start but before any entry returns zero,
  and that entries posted after `asOf` are excluded.
- Balance in the account's currency (Design decisions, "Balance in the
  account's currency"; ⚠ NEEDS HUMAN CONFIRMATION (decided by the team, not yet reviewed by a maintainer)):
  - a foreign-currency account (`currencyId` EUR): debit EUR 100 and credit
    EUR 30 return `balanceInAccountCurrency = 70` and `currency` = EUR, and
    `balance` is the base-currency figure as before;
  - a leaf explicitly denominated in the organization's base currency
    returns that currency and its signed amount; an account with no
    `currencyId` returns both currency fields as null;
  - an account with `amountCurrency = 0` lines (an exchange-difference line
    of 50 base units) changes `balance` by 50 and leaves
    `balanceInAccountCurrency` unchanged;
  - an overdrawn account (credits in the account's currency exceed the
    debits) returns a negative `balanceInAccountCurrency`;
  - a parent and child with the same `currencyId` return the summed
    currency balance on the parent; a parent whose subtree mixes currencies
    returns `balanceInAccountCurrency: null` and `currency: null`, while its
    `balance` is still returned;
  - lines after `asOf` are excluded from `balanceInAccountCurrency` exactly
    as from `balance`.
- Generate a ZSiO for a period with a known set of postings and assert
  every row's `openingBalance + periodDebit - periodCredit ==
  closingBalance` for `DEBIT`-normal accounts (sides swapped for
  `CREDIT`-normal), and `zeroSumCheck === true`.
- Assert `zeroSumCheck` is computed as `SUM(JournalEntryLine.debit) -
  SUM(JournalEntryLine.credit)` directly (organization/tenant-scoped,
  `operation_date < periodEnd + 1 day` (UTC)) and is independent of `rows`
  — a ZSiO
  requested with `pageSize=1` returns the same `zeroSumCheck` value as
  one requested with `pageSize=100` (Design decisions, "`zeroSumCheck`
  is a direct ledger aggregate").
- Post a balanced entry to a leaf account under a syntetyk parent
  that also has a direct posting of its own (mirroring the
  syntetyk-rollup test above) and assert `zeroSumCheck` remains
  `true` — the parent row's double-counted rollup figure must not
  leak into `zeroSumCheck` (Design decisions, "`zeroSumCheck` is a
  direct ledger aggregate").
- Assert the **root rows'** `periodDebit`/`periodCredit` totals for a
  period — every row whose `parentAccountId` is `null`, collected
  across all pages — match a direct `SUM(JournalEntryLine.debit)`/
  `SUM(JournalEntryLine.credit)` over the same
  organization/tenant/date scope, computed independently in the test
  (Design decisions, "Turnover reconciling against the journal
  (art. 18) is definitional") — the regression guard for this
  document's art. 18 journal-reconciliation claim.
- Add the parent-plus-child counterexample to that reconciliation
  test: post Dr `130-1` 100 / Cr `201` 100 with `130-1` under the
  syntetyk `130`, then assert the **root-row** sum still equals the
  journal debit/credit (100/100) while summing `periodDebit` across
  every returned row yields 200 — pinning the reconciliation
  population to the roots rather than all rows (Design decisions,
  "Turnover reconciling against the journal").
- Assert `ytdDebit`/`ytdCredit` for a period in month 3 of a fiscal
  year correctly include months 1–3, not just month 3 — specifically,
  with 24 consecutive monthly `FiscalPeriod` rows spanning two
  calendar years and no gaps anywhere, a March-of-year-2 request
  includes exactly that year's January–March, not the prior year's
  periods too. Configure both years explicitly; no gap heuristic is used.
- Fiscal-year admission: cover a non-calendar year, an irregular-length
  year, a period spanning January 1 inside one year, missing/overlapping
  year records, a period crossing a year boundary, wrong tenant or
  organization, and an unavailable authority. Invalid setup returns 422;
  authority failure returns 503; neither returns any report figures.
  Exercise concurrent period/year-boundary changes with real transactions.
- Opening-policy coverage: post Dr cash 100 / Cr equity 100 in year N,
  then another balanced Dr cash 100 / Cr equity 100 labelled `OPENING`
  as a duplicated year N+1 carry-forward. Even though `zeroSumCheck` would
  be true, assert both routes return `accounting_policy_unavailable` and
  no figures. Under an independently certified continuous ledger, a
  separately evidenced incremental `OPENING` of 20 is included as an
  ordinary movement and cash closes at 120, not filtered by type. Place
  this fixture in a fiscal year starting strictly after go-live. Reconcile
  independently evidenced source cash and equity of 100 each against
  balanced initialization of 90 each: both routes must fail with
  `accounting_policy_unavailable`, despite the balanced journal. Test
  missing accounts and currencies, duplicate mapping, unverifiable evidence,
  empty-source evidence and source writes racing the cutoff, initialization
  and final watermark. For cutoff cash/equity 100 and a later balanced
  source movement of 20, assert initialization is 100 and the uniquely
  identified transferred movement is 20 exactly once; final source and
  target each reconcile to 120. Attempt an old writer after handoff and
  across failover and rollback while a report and target writer race: the
  source write must always be rejected, including while attestation invalidation
  or recovery is delayed. Assert an uncertain or unprovable continuous source
  fence prevents activation, and a rollback cannot release it. Cover
  incomplete writer inventory, missing or unverifiable
  watermark, dropped and duplicated movements, lost acknowledgement,
  concurrent retries and interrupted recovery. No partial results are allowed.
  For a July go-live in a January-start fiscal year, let external cash have
  gross debits 100 and credits 40 and initialize its net 60. With earlier
  error-precedence checks satisfied, assert the trial route returns
  `go_live_reporting_unsupported`, not YTD 60/0; likewise reject a period
  beginning on go-live. In a later fiscal year starting after go-live,
  verify certified initialization contributes to opening balances while
  its entries are excluded from that later year's turnover. Cover a
  genuinely evidenced zero source, missing or pre-go-live coverage,
  reversals, corrections, backdated entries, foreign scope, stale or
  ambiguous certification and authority outage. Race a post or policy
  invalidation against the report snapshot and verify the classification
  and journal write commit together or neither does. Assert the UI clears
  figures and badge for the go-live error and cannot restore them from an
  older delayed success.
- Numeric boundary fixture: use a certified go-live before 2025-06-30 and
  configure 2025-07-01 through 2026-06-30 as
  one fiscal year and 2025-12-15 through 2026-01-14 as a period. For one
  account, post balanced entries with debits 10 on June 30, 20 on July 1,
  30 and credit 7 on January 14, and 40 on January 15; also post credit 5
  on July 2. The report's YTD is debit 50 and credit 12; its period is
  debit 30 and credit 7. The June 30 and January 15 entries are excluded
  from YTD for this report. Include corresponding offsetting lines so
  each journal entry balances, and repeat boundary assertions for an
  explicitly configured irregular-length year.
- UI race: delay an old successful response, then select a new period or
  receive the current request's 422/503 before releasing it. Assert the
  stale 200 cannot restore rows, totals or badge; also verify a stale error
  cannot replace a newer success and an unmounted page cannot update state.
- Assert both routes return 403 without `ledger.reports.view` and 404
  for an account/period belonging to a different tenant/organization.
- Assert both routes return 400 for a malformed `asOf` (not a valid
  date) or `periodId` (not a UUID) before any query runs (API
  Contracts).
- Assert the balance route's `asOf` default (today) matches an
  explicit `asOf=<today's date>` call.
- Late-entry month-boundary regression: post an entry with
  `operationDate` January 31 and `postedAt` February 2. Assert January's
  period and YTD turnover include it; February's period turnover excludes
  it while February's opening balance, YTD turnover and closing balance
  include it. Add a separate entry on a permanent balance-sheet account,
  operated December 31
  and posted January 2 (with no offsetting close): it belongs to
  December turnover and January opening/closing, but not January period
  or YTD turnover when January begins an explicitly configured fiscal
  year. Match #5663's journal membership
  (Design decisions, "Every fiscal-period boundary here...").
- Hierarchy baseline and immutability: verify attested coverage rather
  than treating default-NULL parents as evidence. Reject reparenting an
  empty as well as a posted subtree after activation, including through
  delete/restore/undo and direct writer paths. With independent database
  transactions race activation or parent assignment against a posting
  and opposing parent edits; verify lock order, rollback, acyclicity and
  no post before an account's verified effective start. Attempt a late
  post for an earlier unlocked date after a rejected move and assert the
  original parent receives it; a locked period still rejects it. Cover
  archived accounts, root deletion, wrong scope, unknown pre-baseline
  history, frozen normal-balance attributes and migration/rollback without
  rewriting journal lines. Verify account effective-start boundaries,
  including a child created after the queried date and a period spanning
  its creation; no pre-start post may appear.
- Attempt an ordinary June create with a January effective start under an
  attested parent, both as an empty child and a root; reject without
  changing January rows, leaf classification or currency result. Test an
  omitted date, future-effective parent, UTC-midnight commit race,
  proposal-day posting refusal, unchanged-value update, forbidden effective
  start update, foreign/wrong-type parent, stale parent change/delete and
  current-version frozen change. Preserve the optimistic-lock 409 body and
  rejected undo token; verify mixed old/new client behavior and UI messages.
- Post-commit verification race: pause a create after its last pre-commit
  check, cross UTC midnight, run a same-day report before its commit, then
  commit and verify. The earlier report must exclude the future-effective
  node, subsequent snapshots must fail while the marker is pending, and
  the published start must be later than the post-commit observed day.
  Repeat with a verifier paused across another midnight, multiple pending
  creates, clock regression, lost response, worker crash/restart and
  idempotent retry. No pending path may admit posting or partial figures.
- Snapshot-day race: bind a report's trusted day immediately before a
  repeatable-read snapshot at 23:59:58, then pause it. In another session,
  commit and verify a new edge effective the next day; after midnight,
  resume the old report requesting that next day. It must reject the
  future date under its original bound, not use the old snapshot with a
  newer day. Repeat with a snapshot taken while a marker is pending, clock
  regression/restart, and a verifier crossing midnight.
- Recovery identity: race identical and differing payloads on one scoped
  operation ID; assert one outcome and 409 for digest mismatch. Inject
  lost acknowledgements after both terminal-success and terminal-rejection
  commits, aborts before commit, verifier lease takeover and multiple
  simultaneous pending IDs. Query the durable outcome on retry, clear only
  the operation's own marker, and fail closed when the outcome is unknown.
  Cover old clients without stable IDs under the reviewed compatibility
  bridge before enabling the protocol.
- First-reservation uncertainty: pause an original before and after taking
  its operation lock, lose the initial commit acknowledgement, and race
  same-ID retries and scoped status reads against both eventual commit and
  confirmed rollback. In-flight lock timeout is unknown, not an abort;
  after serialized rollback a same-ID reservation can proceed. Cover a
  late original still in transit, different-digest conflict, primary
  failover and independent reports before/after the marker commits.
- Proposal-day semantics: observe day D before reservation, let a verifier
  observe D then publish on D+1, and assert a D posting is rejected while
  a D+1 posting after publication succeeds when `effectiveStart` is D+1.
  Test the UI and API using the actual returned effective start, not a
  claim that publication day is always blocked.
- Parent eligibility: reject a new child under a soft-deleted or inactive
  parent, including a concurrent delete race; reject restoring a child
  under such a parent without consuming undo. For an attested archived
  unposted ancestor with an existing effective descendant, retain that
  ancestor in traversal and root rows. Distinct type IDs are rejected even
  with the same or null group; verify same type, foreign scope and shared
  type/group mutations separately.
- Balance panel: on a newly created account, default-today and selected
  pre-effective dates show the localized available-from state only after
  authorized account/coverage verification. Test missing, foreign,
  deleted-after-detail and authorization-revoked cases without leaking
  existence; future and out-of-coverage dates retain their distinct errors.
- First-period opening: an account effective January 15 appears on the
  January 31 trial report with internal opening zero at December 31,
  while the public balance route returns 404 for that account on the same
  covered December date. Cover an effective child and an out-of-coverage
  opening separately; the latter returns 422, not zero.
- Cutover and snapshot races: exercise a January A→B move of an empty
  child before March activation with a claimed January baseline; reject
  the unverifiable interval, including a late January post. Race legacy
  and current writers, activation, rollback, account-type changes and
  period locks across separate transactions; prove drain/fencing and the
  clock → hierarchy → period → type → account lock order, including
  #5663's type-before-account writers. A zero-row chart succeeds with
  zero totals only when whole-scope membership and the independent
  journal aggregate are also valid and zero; orphan lines fail closed.
  Pause after integrity validation while another
  transaction creates an effective account and posts; rows, totals and
  authority checks must remain from one snapshot or the response fails.
  Test missing/foreign resources alongside pending verification, future
  dates, missing coverage and fiscal setup to verify both routes' error
  precedence; also test write errors and localized UI states.
- Phase 2 currency classification: a EUR parent and an April-effective
  USD child must leave a January as-of result classified as a EUR leaf;
  on and after April the mixed subtree is ineligible for a single
  account-currency sum. Verify opening and closing boundary classifications
  and immutable or historically versioned currency assignments.
- Availability: exceed user and organization concurrency caps and rate
  budgets across both routes and two instances; assert `429` and usable
  `Retry-After`, no query for rejected requests, sustained load and
  alternating routes cannot bypass limits, and another tenant progresses.
  Cover window reset, burst boundaries, coordinator outage/missing shared
  configuration (`503`) for each budget and semaphore, missing DI or
  constructor failure with no report query, crash/abort slot release and a slow query
  returning `503` and releasing its connection and admission slot.
- Post a year-end `CLOSING` entry that zeroes a revenue account (debit
  equal to its full-year credit balance) and assert: the account's
  `getAccountBalance` as of period end is `0`; the ZSiO row's
  `periodDebit`/`ytdDebit` for that account includes the closing
  entry's amount alongside its real turnover (Design decisions,
  "Turnover figures include every `JournalEntry.type`"); and
  `zeroSumCheck` still holds across the whole chart.
- Generate a ZSiO for a chart of accounts larger than one page
  (`pageSize`) and assert: `rows.length <= pageSize`; `total`/
  `totalPages` are correct; walking every page via `page` yields every
  account exactly once, in a stable order; and `zeroSumCheck` is
  identical and correct on every page, since it is a separate query
  computed over the full chart independently of `page`/`pageSize`
  (Design decisions).
- Assert the balance and trial-balance routes each run a bounded,
  fixed number of queries regardless of the number of `LedgerAccount`
  rows involved (one recursive CTE per call, not one per account) —
  the concrete regression test for Design decisions,
  "`getTrialBalance` computes every account's row in one set-based
  pass."
- Integration (UI), self-contained Playwright scenarios required with
  the eventual implementation (not shipped in this design-only PR):
  - trial-balance page — changing the fiscal period reloads the report
    and resets `page` to 1; paging advances via `page`/`pageSize` while
    keeping the period; account number, opening/period/YTD/closing
    figures and the zero-sum `<StatusBadge>` all render from the same
    response; loading, error and empty states show; a user without
    `ledger.reports.view` gets the forbidden state.
  - account page Balance panel — the as-of date control refetches
    `GET /api/ledger/accounts/:id/balance` and renders the base and
    (when present) account-currency figures with the panel's
    loading/error states.

## Risks & Impact Review

### Data integrity failures

**Annual opening entries can duplicate prior balances.** A balanced
carry-forward can leave the journal's debit/credit aggregate at zero while
doubling a permanent account's reported balance. Severity is high: the
report can look internally reconciled and still be financially wrong.
The proposed mitigation is the whole-scope accounting-policy authority
and fail-closed behavior above, not a heuristic or exclusion by entry
type. Residual risk remains until its evidence, writer enforcement,
migration, concurrent invalidation and accounting-owner approval are
independently verified against #5663.

**Recursive CTE returns a wrong or incomplete set for a very deep or
cyclic `parentAccountId` chain.**
- Scenario: an account hierarchy is accidentally made cyclic (A →
  parent B → parent A) through a bug or direct database edit, or a
  chain is deep enough to hit a query planner limit.
- Severity: High — a missing or duplicated subtree can misstate financial
  figures, including roots not reachable by a bounded recursive walk.
- Affected area: both reports and account/posting write paths.
- Mitigation: validate the complete scoped chart, coverage and journal
  membership in the report's consistent read; use a bounded cycle guard
  and fail the entire response with `report_hierarchy_invalid` rather
  than returning partial rows or totals. Log scoped diagnostics for repair.
- Residual risk: the validator, lock ordering, migration and all writer
  coverage are prerequisites and remain unimplemented; direct or legacy
  writers must not bypass them during rollout.

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
  set-based pass"), and `rows` is paginated via `page`/`pageSize` so
  response size doesn't scale with chart size; `zeroSumCheck` no longer touches the
  account hierarchy or `rows` at all (Design decisions, "`zeroSumCheck`
  is a direct ledger aggregate") — a flat aggregate over
  `JournalEntryLine`, cheaper than the per-account CTE, not just
  independent of it.
- Affected area: both routes and the reports page; coordinated hierarchy
  and coverage enforcement also affects posting and account write paths.
- Mitigation: `(organization_id, account_id)` on `journal_entry_lines`
  and `(organization_id, operation_date)` on `journal_entries`
  (`journal_entries_operation_date_idx`) are specified in #5663's own
  migration (Prerequisites) — two different tables, not one: the
  access path is `journal_entry_line` filtered by
  `(organization_id, account_id)`, joined to `journal_entry` by
  primary key, then filtered by `operation_date` (Proposed Solution).
  Both indexes directly serve that path once #5663 ships; the only new
  index this document needs is `(organization_id,
  parent_account_id)` for the parent rollup (Data Models). Both routes
  log query duration; a duration alert threshold is an operational
  config value (not a code change) so it can be tuned without a
  follow-up spec, and both are bounded by the availability controls
  below.
- Residual risk: real production measurement may show this needs a
  materialized/cached balance table later (Phase 2) — an additive
  change behind the same function signatures, not a redesign.

### Availability controls

**A report query must not let one tenant monopolize shared database
capacity (security review, 2026-11-16).** Phase 1 keeps the live query
(Design decisions, "Live query..."), so both routes enforce:

- **Shared rate budgets** across both routes: fixed 60-second windows,
  default 30 requests per authenticated user per organization and 120 per
  organization, configurable by operators. Maximum burst is the full
  window allowance; adjacent windows can admit two bursts back-to-back.
  Keys include trusted tenant and organization IDs; user keys also include
  the authenticated user ID. Both routes count against both budgets before
  a report query runs. Exhaustion returns `429` and integer `Retry-After`
  seconds until the exhausted window resets (at least 1).
- **Per-user and per-organization concurrency caps** shared by both routes
  (defaults: 2 per user, 8 per organization; configurable) also return
  `429` with `Retry-After` when exhausted. Shared atomic admission spans
  instances. Bounded leases outlive the query deadline, are released in
  `finally` or expire after a crashed worker, and use owner tokens so an
  expired lease cannot release a successor's slot. The lease must remain
  valid throughout database execution: enforce the server-side statement
  timeout below its expiry with a safety margin, renew while needed, and
  cancel execution before expiry if renewal cannot be confirmed. Reject
  before the query.
- Use DI-provided `RateLimiterService` with `requireShared`, backed by a
  shared Redis deployment; call `checkRateLimit` with `failClosed: true`
  and the `report_admission_unavailable` unavailable message, or check
  `degraded` before `allowed` and return the same 503. Missing DI,
  constructor errors and coordinator failures also return that 503 without
  running a report query. Per-process memory
  cannot enforce this contract. Supply a DI-managed shared semaphore for
  concurrency (the existing rate limiter is not a semaphore), without raw
  Redis access from ledger. These two report routes require a healthy shared
  coordinator even on one instance: an unavailable or missing coordinator
  fails closed with `503 { error: 'report_admission_unavailable' }`. This
  is not a prerequisite for unrelated ledger operations.
- **An enforced query deadline** (a server-side statement timeout,
  default 5 s) that aborts the query and returns `503` with
  `{ error: 'report_timeout' }`; above the supported live-query budget
  the request fails with that response rather than falling back to an
  unbounded scan or a stale cache.
- **Documented budget** in both routes' `openApi` and their API
  Contracts (`429`/`503`), with the UI rendering the error state via
  `ErrorMessage` instead of a spinner.
- **Load/timeout coverage**: the two-instance, two-route sustained-rate,
  concurrency, tenant-isolation, coordinator-failure and deadline tests
  specified in Testing Strategy are required with the implementation.

A fresh security review is required after this revision; the finding
was raised by the security scan on the carried head and is inherited
here.

### Tenant & data isolation

Both queries filter by `tenant_id`/`organization_id` on every table
they touch (`JournalEntryLine` carries its own, per #5663's Data
Models). The fiscal-year authority is an additional isolation surface:
scope its records, lookup, migration, attestation and all writer checks
to the same trusted tenant and organization; fail closed across scopes.

### Migration & deployment

Add the parent column with restrictive deletion and its index, then
establish and verify the scoped historical baseline and coverage before
enabling reports. Default `NULL` is not a historical backfill. Coordinate
hierarchy/posting guards and fiscal-year authority with #5663; frozen
hierarchy and fiscal-year containment can reject previously valid writes.
The prerequisites need staged compatibility, mixed-version writer
enforcement, attestation and rollback plans before activation. No blanket
additive-only claim covers those behavioral changes. The pending-create
bridge, scope-wide temporary report outage, future-date restriction and
first-posting-day delay must be explicitly reviewed for compatibility with
existing #5663 clients and operational requirements before rollout.

## Out of scope (tracked separately)

- **AP/AR "bufor" toggle** — deferred to Phase 2 (see Design decisions);
  `2026-09-06-accounts-payable.md`'s Out of scope carries the
  reciprocal note, added the same day.
- **Fiscal-year authority** — the source and migration are coordinated
  prerequisites, not implemented by this design. Until they are ready,
  trial-balance requests fail closed rather than return estimated YTD.
- **Visual indentation of syntetyk/analityk rows by hierarchy depth in
  the ZSiO table** — `DataTable` has no tree/indentation rendering
  today (Architecture → Backend Pages); Phase 1 ships a flat table
  sorted by account number instead. Adding depth-based indentation is a
  `packages/ui` `DataTable` extension, scoped as its own future piece
  of work once a real need for it is confirmed.
- **Materialized/cached balance table** — only if real measurement
  shows the live query doesn't hold up; the API/query-function
  signatures in this document are designed so that change would be
  additive, not a redesign (see Design decisions, Risks).
- **Bilans, P&L (4xx/5xx), Cash Flow, tax reporting (JPK)** — separate,
  larger future documents; this document's scope-cohesion boundary is
  ZSiO only (see Design decisions, Alternatives considered). **Update
  (2026-09-17):** a first draft of the Bilans/RZiS half now exists as
  its own document, `2026-09-17-annual-financial-statements.md` — a
  small new Core module (`financial_statements`) that consumes this
  document's own `getTrialBalance` directly, plus a `financial_pl`
  implementation owning the actual Załącznik-nr-1 line templates,
  per-account statement-line mapping, and the RZiS variant-parity check
  — following the Core-framework-plus-country-plugin split SPEC-024 §11
  already mandates (the same split already applied to Tax Management,
  §10). Tax reporting (JPK) and Cash Flow remain separate, still-future
  documents. Not yet reviewed.
- **Off-balance-sheet accounts** (konta pozabilansowe) — no such
  concept exists anywhere in #5663's `LedgerAccountType`/
  `LedgerAccountGroup` today; the zero-sum check in this document
  therefore covers every account unconditionally. If off-balance-sheet
  accounts are added to the chart of accounts in a future phase, this
  document's `zeroSumCheck` will need to exclude them — tracked here
  as a known future adjustment, not solved now.
- **Multi-currency balance conversion** — `getAccountBalance`'s `balance` sums
  base-currency `debit`/`credit` only, matching #5663's own posting
  logic ("balance validation runs only in the base-currency
  debit/credit columns"); a foreign-currency-denominated balance view
  is a Multi-Currency-spec concern, same boundary #5663 already drew
  for FX revaluation. Since 2026-10-23 every ledger line carries its own
  currency and `amountCurrency`, and a bank account is its own ledger account
  with an optional `currencyId`. The balance in the account's currency (the
  signed `amountCurrency` of its lines, debit side positive) next to the
  base-currency balance, with `currency` carrying that currency, is designed
  since 2026-10-26 in Design decisions, "Balance in the account's currency"
  (⚠ NEEDS HUMAN CONFIRMATION (decided by the team, not yet reviewed by a
  maintainer); required by Multi-Currency R4); what stays out of scope is
  converting balances between currencies. Cash & Bank needs it, because the controller requires the
  balance in the account's currency to agree with the bank statement. Phase 1
  is unchanged. The lots Cash & Bank keeps for a foreign-currency account (its own table, FIFO) never replace this balance: the balance in the account's currency from the ledger is the figure that must equal the sum of the remaining lots and the bank statement, and the valuation of `fx_revaluation` reads it.

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
| `AGENTS.md` | No direct ORM relationships between modules | Pending | Parent link is a same-module FK; the separate fiscal-year authority design must also preserve module boundaries |
| `AGENTS.md` | Filter by tenant/organization | Pending | Reports and both authority prerequisites require verified same-scope reads and writers |
| `AGENTS.md` | Write operations via Command pattern | Pending | Account and posting guards need coordinated command and non-command writer coverage |
| `packages/core/AGENTS.md` → API Routes | All API route files MUST export `openApi` | Compliant | Both new routes export `openApi`; `api/openapi.ts` updated (File Manifest) |
| `packages/core/AGENTS.md` → API Routes | All user input validated with zod before business logic | Compliant | `asOf`/`periodId` both validated, 400 on failure (API Contracts) |
| `packages/core/AGENTS.md` → Declarative feature guards | `acl.ts` synced to `setup.ts` `defaultRoleFeatures`, plus `sync-role-acls` for already-provisioned tenants | Compliant | `ledger.reports.view` added to both (Architecture → Access Control / Module Setup); `yarn mercato auth sync-role-acls` added as Implementation Plan step 1 so existing tenants receive it too |
| `packages/core/AGENTS.md` → Encryption | PII/GDPR fields declared in `<module>/encryption.ts` | Pending | Review the fiscal-year authority's eventual data model and attestation fields; existing report queries read #5663 columns |
| `packages/ui/AGENTS.md` | Lists use `DataTable` with stable `entityId` | Compliant | `trial-balance/page.tsx` is read-only and uses `DataTable`; hierarchy writes remain on existing account surfaces |
| `packages/ui/AGENTS.md` | HTTP via `apiCall`/`apiCallOrThrow`, never raw `fetch` | Compliant | Both new pages call the new routes through the existing `apiCall` helper, consistent with the rest of the `ledger` module's backend pages |
| `.ai/ds-rules.md` / `.ai/ui-components.md` | Semantic status tokens; `<StatusBadge>` for entity/derived status; no hardcoded Tailwind shades | Compliant | Zero-sum check rendered via `<StatusBadge>` (`success`/`error` variants) — Architecture → Backend Pages |
| root `AGENTS.md` (i18n) | User-facing strings resolved via `useT()`/`resolveTranslations()`, not hard-coded | Compliant | See Internationalization for the full key list and file paths |
| — (no rule source; engineering judgment) | Read-heavy endpoints should declare a caching strategy | N/A, justified | `packages/cache/AGENTS.md` documents strategy selection but states no rule requiring one per endpoint — this row's prior citation was invented. The judgment stands on its own: explicit no-cache decision (see Cache), correctness for accountants closing a period taking priority over an unmeasured read-latency win |
| root `AGENTS.md` → UI & HTTP | Keep `pageSize` at or below 100 | Compliant | `trial-balance` `rows` are paginated via `DataTable`'s own `page`/`pageSize` contract, capped at 100 (API Contracts, Architecture → Backend Pages). Cursor/keyset pagination is not a rule anywhere in this codebase — this row previously cited a `packages/core/AGENTS.md` → Pagination section that does not exist |
| — (no rule source; engineering judgment) | Bulk/multi-row reads should avoid N+1 across the result set | N/A, justified | `packages/core/AGENTS.md` has no Performance section — this row's prior citation was invented. The judgment stands on its own: `getTrialBalance` computes every account's row in one set-based query, not `getAccountBalance` called per account (Design decisions, Queries) |
| `packages/core/AGENTS.md` → API Routes | Route files export `metadata` with per-method `requireAuth`/`requireFeatures` | Compliant | Both routes' `metadata` export documented (Architecture → API Routes) |
| `BACKWARD_COMPATIBILITY.md` | Stable contracts and database schema | Pending | Hierarchy, fiscal-year and opening-policy writer guards need reviewed compatibility and rollout before enforcement |
| `.ai/specs/AGENTS.md` | Never leave stale endpoints, entities, or assumptions in an updated spec | Compliant | Cross-references to `2026-09-06-accounts-payable.md`'s bufor note and #5663's exact route name (`GET /api/ledger/accounts/:id/balance`) checked against those documents' current text at write time |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match architecture | Pending | Parent storage is proposed; fiscal-year and opening-policy authorities and their migrations remain prerequisites |
| Queries defined for all reads | Pass | Both report queries are specified; hierarchy-changing account commands and undo paths validate under the same scoped transaction lock |
| User Stories match Implementation Plan | Pass | All three stories map to Phase 1 steps 2–7 |
| Risks cover the changes this document makes | Pending | Fiscal-year authority is gated; historical hierarchy, opening-entry semantics and multi-page consistency still require resolution |
| API contracts match data models | Pending | YTD and balances require unimplemented scoped fiscal-year and opening-policy authorities; reporting fails closed until they are available |
| Scope cohesion | Pass | Applied the same test as the rest of this document family: ZSiO stands alone; Bilans/P&L do not stand without it (see Alternatives considered) |
| UI/UX and i18n sections agree | Pass | Every string named in Internationalization has a corresponding UI element in Architecture → Backend Pages, and vice versa |

### Non-Compliant Items

Fiscal-year writer compatibility and migration are not yet specified.
Historical hierarchy semantics, annual opening-entry treatment and
cross-page consistency remain unresolved. The prior checklist cannot be
treated as a compliance approval until these issues are resolved and
independently reviewed.

### Verdict

**Blocked — not ready for implementation.** Resolve the fiscal-year
authority and compatibility prerequisite, historical hierarchy,
opening-entry policy and multi-page report consistency; reconcile the
result with #5663 and obtain fresh independent and security review.
The existing accounting references and earlier checklist do not resolve
these issues or authorize release.

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
  `journal_entry_line_dimensions`, reversible later behind the same
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

### 2026-09-14 — PR #6013 review response (pkarw, om-auto-review-pr)

Addressed the full CHANGES REQUESTED review: 2 blockers, 4 majors, 6
minors, plus a merge conflict against develop in `.ai/specs/README.md`.

- **Blocker — `zeroSumCheck` could not be `true` on correctly
  balanced data** (summing `normalBalance`-normalized rollup rows
  double-counts syntetyk descendants and never nets to zero). Fixed:
  `zeroSumCheck` is now a second, independent query — a flat
  `SUM(debit) - SUM(credit) = 0` directly over `JournalEntryLine`,
  never touching `TrialBalanceRowDto`, the account hierarchy, or
  `normalBalance` (Design decisions, "`zeroSumCheck` is a direct
  ledger aggregate"). Cheaper than before, and immune to the
  recursive-CTE cycle risk by construction. New regression tests pin
  the exact double-counting scenario the review named.
- **Blocker — Implementation Plan step 3 still specified the N+1
  `getTrialBalance` design** the Design decisions/Changelog already
  recorded as corrected. Fixed: step 3 now matches the single
  set-based `WITH RECURSIVE` pass plus the separate `zeroSumCheck`
  aggregate.
- **Major — art. 18 journal-reconciliation had no contract or test.**
  Resolved as definitional rather than a new field: `periodDebit`/
  `periodCredit` are already `SUM(debit)`/`SUM(credit)` over
  `JournalEntryLine` — the dziennik itself — so there is no separate
  "journal total" to reconcile against. Added a regression test
  guarding against future divergence instead.
- **Major — the fiscal-year resolution algorithm was wrong for the
  ordinary consecutive-months case and depended on a configuration
  value that doesn't exist.** Replaced with: fiscal year = calendar
  year of `periodStart`; non-calendar fiscal years are now an
  explicit Phase 1 limitation (Out of scope) pending a `fiscalYear`
  field on #5663's `FiscalPeriod`. **Superseded:** the calendar-year
  default was subsequently replaced by the fail-closed authority
  prerequisite in the 2026-11-17 local correction.
- **Major — the undeclared hard dependency on #5663 (unmerged,
  `packages/core/src/modules/ledger/` doesn't exist yet).** Added a
  Prerequisites section stating this explicitly and softened
  present-tense claims about #5663's schema to "as specified in
  #5663"; noted AP's own PR (#5962) is likewise unmerged.
- **Major — the `DataTable` cursor-pagination and hierarchy-
  indentation claims didn't match the real component** (checked
  against `packages/ui/src/backend/DataTable.tsx`: offset-based
  `page`/`pageSize` only, no tree/indentation support at all).
  Switched `trial-balance` to `page`/`pageSize` throughout (Queries,
  API Contracts, Architecture); Phase 1 now ships a flat,
  code-sorted table with no depth indentation, tracked as a future
  `DataTable` extension (Out of scope) instead of an invented
  existing convention.
- **Minor — three Final Compliance Report rows cited AGENTS.md
  sections that don't exist** (`packages/core/AGENTS.md` has no
  Pagination or Performance section; `packages/cache/AGENTS.md`
  states no read-heavy-endpoint TTL rule). Corrected the pagination
  row's citation to the real source (root `AGENTS.md` → UI & HTTP,
  `pageSize ≤ 100`) and marked the other two as engineering
  judgment with no rule source, rather than inventing one.
- **Minor — `postedAt` lives on `JournalEntry`, not
  `JournalEntryLine`**, so every query here needs an explicit join;
  the Risks index mitigation also named one table where two are
  involved. Both fixed, and the inaccurate "only read surface #5663
  ships" claim in Problem Statement corrected.
- **Minor — "opening balance" had two definitions that only agree if
  `posted_at` is date-only, but it's a timestamp.** Pinned one
  convention: every date boundary (`asOf`/`periodStart`/`periodEnd`)
  is an inclusive whole calendar day in UTC, `posted_at < D + 1 day`
  — reconciles `getAccountBalance`'s `asOf` semantics with
  `getTrialBalance`'s own `posted_at < periodStart` CTE predicate
  exactly.
- **Minor — whether ZSiO turnover columns roll up descendants was
  never stated.** Added an explicit decision: all six
  `TrialBalanceRowDto` figures roll up, matching `getAccountBalance`.
- **Minor — the ACL grant sync step was missing from the
  Implementation Plan** despite the compliance matrix claiming it.
  Added `yarn mercato auth sync-role-acls` as part of step 1.
- **Minor — keyset pagination bounded payload, not query cost, and
  the summary row double-fetched `zeroSumCheck`.** Superseded by the
  `zeroSumCheck` fix above (now a cheap, independent aggregate
  regardless of pagination scheme) and by having the page read
  `zeroSumCheck` from the `DataTable` response it already has instead
  of a second `apiCallOrThrow` call.

No design decision from the original submission was reversed — the
four scope boundaries, the live-query decision, the recursive-rollup
approach, and the literature grounding all stand; every change above
either corrects a genuine internal contradiction the self-review
missed, or fills in a contract/test the review found missing. The
`.ai/specs/README.md` merge conflict (this document's Pending row vs.
develop's own new row in the same spot) is resolved separately by
rebasing on develop and keeping both rows.

Not yet re-reviewed by `om-auto-review-pr`.

### 2026-09-15 (financial-spec-writing-process applied for the first time)

- Merged `upstream/develop` (166 commits) first; one shared-file
  overlap in `.ai/specs/README.md` (this document's own Pending row vs.
  develop's own new, unrelated row in the same spot) resolved cleanly
  by git itself — no manual conflict markers, both rows kept; commit
  `319694a20`.
- Cross-checked against `financial-module-knowledge-base.md` §2
  (control-account/subsidiary ledger — not applicable, this document
  does no control-account modeling; account-number-illustrative-only —
  already compliant, "130 Rachunki bieżące" etc. are explicitly
  illustrative; per-command event documentation — not applicable, this
  document adds no write commands) — already compliant on all
  applicable points; no changes needed.
- Added this document's first "Literature & Prior Art" section,
  consolidating and independently re-verifying the citations already
  scattered through Design decisions and the 2026-09-09 Changelog
  entry: Fowler §6.3 "Summary Account" (confirmed, plus a newly-added
  citation to the same section's Figure 6.6 — the named Fowler variant
  that actually matches this document's choice to allow direct
  postings to syntetyk accounts, not just "the restriction we didn't
  adopt"), Fowler §6.15 and Hay's "Summarization" section (both
  confirmed verbatim for the single-parent-over-DAG warning), Hay
  Table 7.1 and Kieso Illustration 3.1 (both confirmed for the
  `normalBalance` sign convention), and one genuine correction: Kieso's
  illustrated closing entries (Illustration 3.38) route revenue and
  expense through a temporary Income Summary account across three
  entries, not one entry debiting revenue directly against crediting
  expense as Design decisions previously stated — fixed there, with
  the full explanation in the new section.
- Added a real-system comparison (this document previously had only
  the Overview's own Odoo "Market Reference" callout): ERPNext (live
  query confirmed directly from `financial_statements.py` source —
  exactly this document's own "no maintained balance table" choice;
  group/syntetyk rollup shown by default; a documented real bug,
  `frappe/erpnext#41453`, getting nominal-account opening-balance
  zeroing wrong), Comarch ERP Optima (the closest real-system match
  found anywhere in this document family — its eleven-column ZSiO is a
  one-to-one match to this document's six `TrialBalanceRowDto`
  figures, but its own documentation implies synthetic accounts don't
  take direct postings, a genuine, recorded divergence from this
  document's Phase 1 choice), and enova365 (confirms the same
  four-figure-group shape and a `zeroSumCheck`-equivalent feature, but
  recorded as a partial match — its public documentation doesn't cover
  analytic-account rollup mechanics in enough detail to confirm or
  rule out the same divergence Comarch shows).
- No structural changes to Architecture/Data Models/API Contracts from
  this pass — Steps 1-3 of `financial-spec-writing-process` only; Step
  4 (structure) was already satisfied by the existing document.

### 2026-10-23 — balance in the account's currency named as a later phase

- #5663 now gives every ledger line its own currency, rate and
  `amountCurrency`. Phase 1 stays base-currency only and `currency: null`
  stays. The Out of scope bullet on multi-currency balances names the balance
  in the account's currency for accounts that have a `currencyId` as the
  follow-up, with Cash & Bank as its consumer. Not yet reviewed by a
  maintainer. (Designed 2026-10-26, see the next entry.)

### 2026-10-26 — balance in the account's currency designed (Multi-Currency R4)

- New Design decision "Balance in the account's currency": for an account with
  a `currencyId`, `getAccountBalance` also returns `balanceInAccountCurrency`
  (signed sum of `amountCurrency`, debit side positive) and `currency`; for any
  other account both are `null`. A parent returns it only when it is a leaf or
  its whole subtree has the same `currencyId`. ⚠ NEEDS HUMAN CONFIRMATION (decided by the team, not yet reviewed by a maintainer).
- Queries, API Contracts (`GET /api/ledger/accounts/:id/balance`), Phase 2 list,
  Testing Strategy and the Out of scope bullet on multi-currency balances
  updated accordingly.
- Cross-reference: `2026-09-17-multi-currency.md`, "Revaluation of
  foreign-currency ledger accounts (bank, cash)", decision R4, which reads both
  balances from this function.


### 2026-11-16 — PR #6013 re-review response (carry-forward, `om-auto-fix-pr`)

Addressed the 2026-11-09 CHANGES REQUESTED re-review on the carried-forward branch:

- **Blocker — merge conflict against `main`** — resolved on the carry branch, retaining both `.ai/specs/README.md` index contributions (this document's row plus the newer rows merged from `main`).
- **Major — journal reconciliation double-counted descendants** — the art. 18 reconciliation population is now the **root rows** (`parentAccountId = null`, collected across every page) under a validated acyclic, complete tree instead of every row; direct parent postings are supported, so leaves-only is not a valid population. The regression test now asserts the root-row sum against an independent `JournalEntryLine` aggregate and adds the parent-plus-child counterexample (`130-1` under `130`; all-rows debit 200 vs journal 100).
- **Major — `DataTable` does not own route fetching or pagination** — Backend Pages now specifies a page-owned `apiCallOrThrow` load with `periodId`/`page`/`pageSize` state, loading/error/empty states, and a controlled `pagination` object; the page keeps the response, passes `columns`/`data`/`pagination` to `DataTable`, and renders `zeroSumCheck` from that same response. No `apiPath` prop, no shared-component extension, no extra summary request.
- **Minor — implementation step and test parameters contradicted the revised scope** — step 6 now specifies the flat, code-sorted table (no hierarchy-depth indentation) and the zero-sum pagination regression uses `pageSize=1`/`pageSize=100`, matching the route's validated `pageSize`.

The account-currency design remains explicitly ⚠ NEEDS HUMAN CONFIRMATION and is not part of Phase 1.


### 2026-11-16b — PR #9722 re-review response (pkarw, `om-auto-fix-pr` carry)

Addressed the 2026-11-16 CHANGES REQUESTED review on the carried head:

- **Critical — align the hierarchy schema with current #5663** — #5663 removed `LedgerAccount.parentAccountId` on 2026-10-12 and renamed `slug` to `number` (`description` is the display name). Data Models now owns the nullable `parentAccountId` column and reads/ordering use `number`/`description`. The original no-backfill assumption is superseded by the verified-baseline prerequisite below.
- **High — use the accounting date for fiscal-period reporting** — every `asOf`/`periodStart`/`periodEnd` predicate (and the independent `zeroSumCheck` aggregate) now filters on `operation_date`, matching #5663's lock/`periodId` semantics; `postedAt` is recording time only. Added a late-entry regression across a month/year boundary.
- **Medium (inherited security) — bound report work before broad access** — added the Availability controls: per-user/per-organization concurrency caps (`429`), an enforced query deadline (`503 { error: 'report_timeout' }`), documented budget, and load/timeout coverage. A fresh security review is requested after this revision.
- **Medium — plan integration coverage for both UI paths** — Testing Strategy now requires self-contained Playwright scenarios for the trial-balance page (period change resets page, pagination, figures/badge from the same response, loading/error/empty, feature gating) and the account balance panel; they ship with the eventual implementation, not this design-only PR.

The account-currency design remains explicitly ⚠ NEEDS HUMAN CONFIRMATION and is not part of Phase 1.


### 2026-11-17 - PR #9722 re-review response

- Serialize all hierarchy-changing writes and undo paths with a scoped transaction lock before ancestor validation; require an opposing-reparent two-connection regression.
- Define shared per-user and per-organization report rate windows and bursts, shared concurrency admission, fail-closed behavior and cross-instance sustained-load coverage. A fresh security review remains required.
- Correct the late-entry assertions for February opening/YTD/closing and add a distinct December/January fixture.
- The unrelated base lesson-count CI failure remains blocked on the separate correction in #9735; this design-only change does not claim CI has passed.

### 2026-11-17 — fiscal-year review correction (local draft)

- Replace unconditional calendar-year YTD with a scoped, authoritative
  fiscal-year prerequisite and explicit fail-closed API behavior. Cover
  non-calendar, irregular, ambiguous, missing, and cross-year cases.
- Historical hierarchy, opening-entry semantics, and cross-page report
  consistency remain unresolved release blockers; this partial correction
  is not an implementation approval or a request for re-review.

### 2026-11-17 — historical hierarchy proposal (local draft)

- Propose a verified baseline and immutable parent edges, including empty
  accounts, to avoid retroactively moving postings when a hierarchy changes.
  This narrows Phase 1 behavior and requires coordinated posting guards,
  migration and compatibility review; it is not implemented or approved.
- Opening-entry semantics, cross-page consistency and the detailed
  hierarchy writer/lock rollout remain release blockers.

### 2026-11-17 — opening-policy proposal (local draft)

- Propose an explicitly attested continuous-ledger policy and fail both
  reports closed for unknown or duplicated carry-forward history. This
  does not approve the policy or design an annual close-and-reopen model.
- Policy authority, writer enforcement, migration and accounting-owner
  review remain prerequisites; cross-page consistency remains unresolved.

### 2026-11-17 — opening-policy evidence correction (local draft)

- Require independently evidenced, complete source reconciliation and
  cutover coverage; a balanced initialization does not prove correctness.
- Reject trial balances for the go-live fiscal year pending an approved
  presentation and gross-turnover design. No accounting approval is implied.
- Require a verified source-writer fence, final watermark, idempotent
  catch-up and reconciled ownership handoff before enabling either report.
