# Annual Financial Statements — Bilans & RZiS (`financial_statements` Core + `financial_pl`)

> **Temporary location.** Like `2026-09-16-tax-management.md`, this document
> lives in the main `open-mercato/open-mercato` repo's `.ai/specs/` for
> review purposes even though its `financial_pl`-side half belongs in the
> separate `official-modules` repo, mirroring `2026-09-11-jpk-kr-pd-financial-pl.md`
> (SPEC-010)'s own note.
>
> **Update (2026-09-18):** SPEC-010 has since completed exactly the move
> described above — it no longer lives in this repo at all; it's now
> `.ai/specs/SPEC-010-2026-09-11-jpk-kr-pd-financial-pl.md` in
> `official-modules#54`. This document's own `financial_pl` half hasn't made
> that move yet — the staging reasoning above still applies to it until it
> does.

## TLDR

Two annual statutory outputs — Bilans (balance sheet) and RZiS (rachunek
zysków i strat / income statement) — generated from the fiscal year's
trial balance (`getTrialBalance`, #6013), per SPEC-024 §11's own
Core-reporting-engine + country-plugin split (the same architecture already
applied to Tax Management, §10). **Bilans and RZiS read that trial balance
on two different bases, not one** (see Design decisions #0, added in
maintainer review): Bilans reads post-`CLOSING` **closing balances**
(correct — balance-sheet accounts are permanent and are exactly what
`CLOSING` is supposed to leave in their final, carried-forward state), but
RZiS cannot: zespół 4-7 (revenue/expense) accounts are precisely the
accounts `CLOSING` zeroes out, so their post-closing closing balance is
always `0` by construction, regardless of the year's actual result. RZiS is
instead built from the fiscal year's **turnover with the `CLOSING` entry's
own zeroing lines subtracted back out** — the pre-closing economic
activity, not the post-closing balance. A small Core module,
`financial_statements`, ships only the generic report shape
(`ReportFormat`/`ReportSection`/`ReportLine`) and the aggregation functions
reading #6013's trial balance — no report builder, scheduler, drill-down,
or cache (those stay Out of scope, Phase 2+, the same discipline GL core
engine already applied to its own closing-entry generator). `financial_pl`
owns everything Poland-specific: the actual Bilans/RZiS line templates
(Załącznik nr 1 do Ustawy o rachunkowości), a tenant-configured
account→line mapping (`StatementLineMapping`, per Wn/Ma side — accounts are
tenant-customized, never hardcoded, per the knowledge base's own §2
convention), a single input field for the board resolution's (uchwała)
profit-distribution outcome, and a same-net-result check between RZiS's two
variants (porównawczy/by-nature, zespół 4; kalkulacyjny/by-function, zespół
5) — literature-grounded via Kieso's own IAS 1 nature-vs-function
discussion, and already structurally guaranteed in this project by Posting
Rules Engine's zespół 4→5 mirroring through account 490. Statement
generation is gated on `posting_rules.lockFiscalPeriod` (not a bare
`CLOSING`-entry check) — that command already refuses to lock a period with
unreclassified zespół-4→5 entries, which is exactly the reconciliation
precondition a statutory statement needs, so this document reuses it
instead of inventing a second one.

> **Maintainer-review correction (2026-09-21).** An automated specification
> review (`om-auto-review-pr`) on this PR's `37225917652` head correctly
> identified that the original draft computed RZiS from the same post-
> `CLOSING` **closing balance** basis as Bilans, which forces both RZiS
> variants to report exactly `0` revenue and `0` expense for every fiscal
> year, regardless of actual results — verified directly against
> `2026-09-09-general-ledger-account-balances.md`'s own explicit design
> ("Turnover figures include every `JournalEntry.type`... once a year-end
> `CLOSING` entry is posted... a revenue account's period debit will
> include the closing entry's own zeroing debit"). This revision fixes
> that basis (Design decisions #0) and resolves six further findings from
> the same review — account-mapping double-counting, missing derived-total
> arithmetic, reconciliation-before-lock, `ClosingResolution` revisioning,
> the export contract, and API/versioning completeness — each addressed in
> the relevant section below and logged in Changelog.

## Problem Statement

The Event Storming brief's own domain-events list for reporting (Sekcja 6,
"Raportowanie, Zamknięcie Miesiąca i Podatki") names three required
outputs: "Wygenerowano ZSiO," "Wygenerowano Bilans," "Wygenerowano P&L."
The first shipped as `2026-09-09-general-ledger-account-balances.md`
(#6013). The other two were deliberately deferred by every sibling
document that touched the topic, each time with an explicit forward
pointer rather than a speculative design:

- GL core engine (#5663), Out of scope → "Balance calculation": *"ZSiO/
  Balance now ship as `2026-09-09-general-ledger-account-balances.md`
  (#6013), this engine's own Phase 2"* — silent on Bilans/P&L themselves.
- GL account balances (#6013), Out of scope: *"Bilans, P&L (4xx/5xx), Cash
  Flow, tax reporting (JPK) — separate, larger future documents; this
  document's scope-cohesion boundary is ZSiO only."*
- Posting Rules Engine (#6015): builds the zespół 4→5 mirror (account 490)
  that keeps both P&L variants reconcilable, but explicitly declines to
  own the report itself — *"the report itself is a reporting-layer
  concern, a different owner."*

This document is that owner. It is also where a real client's Event
Storming session added a requirement none of the above anticipated:
**mapping synthetic (not analytic) accounts to statement line items,
separately per debit/credit side**, and a hard **consistency check that
RZiS's two variants (4xx by-nature vs. 5xx by-function) produce the same
net result** — both of which need a design, not just a forward pointer,
because #6013's own trial balance rows are per-account, flat, and
statement-format-agnostic (Data Models, `TrialBalanceRowDto`).

A second, narrower requirement folds in here rather than opening its own
document: the **board resolution (uchwała zarządu) on profit distribution**
is explicitly *not* a workflow this system runs — per the source
recording, *"Uchwały zarządu (podział zysku itd.) — zawsze załączane jako
PDF, nie generowane przez system"* — it is captured as a single input
field (the resolved allocation) that feeds the equity roll-forward,
exactly the way Kieso's own Retained Earnings Statement (Illustration
4.19) treats a board-level dividend/appropriation decision as external
data flowing into the statement, not a system-computed step.

## Proposed Solution

SPEC-024 §11 ("Financial Statements") mandates the same shape already
used for Tax Management (§10): a thin Core engine plus a country plugin
behind a format interface (`IFinancialStatementFormat`). Two modules:

1. **`financial_statements`** (Core, this repo) — the generic report
   shape only: `ReportFormat`/`ReportSection`/`ReportLine` types (adapted
   from SPEC-024's own sketch — see Design decisions #1 for the one
   correction needed), and two aggregation functions instead of one (see
   Design decisions #0): `buildBalanceSheetData(fiscalPeriodId,
   lineMappings)`, which reads #6013's `getTrialBalance` `closingBalance`
   column and buckets it per mapping (correct for Bilans, whose accounts
   are permanent), and `buildIncomeStatementData(fiscalPeriodId,
   lineMappings)`, which reads the same `getTrialBalance` rows' `ytdDebit`/
   `ytdCredit` turnover but subtracts the fiscal year's `CLOSING` entry's
   own lines back out per account first (correct for RZiS, whose zespół
   4-7 accounts `CLOSING` deliberately zeroes — see Design decisions #0
   for why a shared function silently produces `0` for both variants
   otherwise). A third, shared helper, `computeDerivedTotals(sections)`
   (Design decisions #1b), walks a rendered `ReportFormat`'s
   template-owned `sign` coefficients to produce subtotal/total
   `ReportLine`s — none of the three functions do any formatting or I/O
   beyond the reads they need. No report builder UI, no scheduler, no
   drill-down, no cache — SPEC-024 §11.1 lists these as Core, but nothing
   here needs them yet with a single plugin consumer; deferred the same
   way GL core engine deferred its own closing-entry generator (Out of
   scope).
2. **`financial_pl`** (Poland plugin, `official-modules`) — everything
   statute-specific: the actual Bilans and RZiS (both variants) line
   templates per Załącznik nr 1 do Ustawy o rachunkowości (now carrying
   each line's `sign` coefficient, Design decisions #1b), a
   `StatementLineMapping` settings entity (tenant-configured, nullable,
   reject-if-unset — the `PostingRulesSettings`/`TaxCodeAccountMapping`
   pattern — and validated as a complete, non-overlapping cover of every
   posted-to account, Design decisions #2), the `ClosingResolution` input
   capturing the uchwała's profit-distribution outcome and the specific
   `CLOSING` entry it was computed against (Design decisions #5b), and
   `generateAnnualStatements` — the command that requires the fiscal
   year's last `FiscalPeriod` to be locked via `posting_rules.
   lockFiscalPeriod` (Design decisions #5, reusing that command's own
   zespół-4→5 reconciliation gate rather than re-specifying one), applies
   the mapping through both aggregation functions, runs the two-variant
   parity check, and renders both statements.

### Design decisions

0. **RZiS is built from pre-closing turnover, not post-closing closing
   balance — Bilans and RZiS need two different aggregation bases, not
   one shared function.** (Added in maintainer review, replacing the
   original draft's single `buildStatementData` reading `closingBalance`
   for both statements.) `2026-09-09-general-ledger-account-balances.md`
   (#6013) is explicit that `TrialBalanceRowDto`'s turnover columns
   (`periodDebit`/`periodCredit`/`ytdDebit`/`ytdCredit`) include *every*
   `JournalEntry.type`, closing entries included: *"once a year-end
   `CLOSING` entry is posted... a revenue account's period debit will
   include the closing entry's own zeroing debit alongside its real
   credit-side turnover for the year, and symmetrically an expense
   account's period credit will include its own zeroing credit."* That
   design is correct and deliberate for #6013's own ZSiO purpose (art. 18
   requires turnover to reconcile against the journal in full). But it
   means `closingBalance` — the figure the original draft bucketed for
   *both* statements — is definitionally `0` for every zespół 4-7 account
   once `CLOSING` has run: that is what a closing entry does. Worked
   example: revenue account posts a real `100` credit turnover for the
   year; `CLOSING` posts a further `100` debit to zero it; `closingBalance`
   is `0`. An expense account posts a real `60` debit turnover; `CLOSING`
   posts a further `60` credit; `closingBalance` is `0`. A RZiS built from
   `closingBalance` reports `0` revenue and `0` expense — passing the
   variant-parity check trivially (`0 == 0`) while the real result was a
   `40` profit. **Fix:** Bilans (permanent accounts — assets, liabilities,
   equity — which `CLOSING` does not zero) keeps reading `closingBalance`,
   via `buildBalanceSheetData`. RZiS reads `ytdDebit`/`ytdCredit` for the
   fiscal year's last `FiscalPeriod`, then subtracts the specific `CLOSING`
   `JournalEntry`'s own lines for that account (fetched by
   `referenceType`/`id` — a single, cheap, one-entry read the command
   already has to do for Design decisions #5's precondition, not a new
   #6013 query capability) — `buildIncomeStatementData`. Continuing the
   example: `ytdCredit` for the revenue account is `200` (`100` real +
   `100` closing); subtracting the `CLOSING` entry's own `100` credit
   leaves the real `100`. Symmetrically for the expense account's
   `ytdDebit`. Net result `100 − 60 = 40`, correctly nonzero, and the
   parity check between porównawczy/kalkulacyjny now validates something
   real rather than two zeroes agreeing. This keeps #6013 completely
   unmodified (its own turnover semantics stay correct for ZSiO) — the
   correction lives entirely inside `financial_statements`/`financial_pl`,
   which already read `JournalEntryLine` data cross-module (Architecture).
   A loss-making year (revenue `60`, expense `100`, net `−40`) and a
   profitable year both need a test fixture exercising this subtraction
   (Testing Strategy).

1. **`ReportLine.formula` (SPEC-024's own sketch) is corrected from an
   account-number-range string to a mapping-table reference.** SPEC-024
   §2.4 sketches `ReportLine.formula: string`, with an example like
   `"SUM(1000:1999)"` — a raw numeric account range. That can't work
   here: the knowledge base's own §2 convention ("Account numbers are
   illustrative, never literal") and Default Chart of Accounts (#6137)
   both establish that `LedgerAccount` rows are entirely tenant-created
   and tenant-renumbered after import — there is no fixed "1000:1999"
   range to sum in any tenant's real chart. Real-system comparison
   confirms this isn't a shortcut this project is uniquely missing:
   ERPNext derives only a coarse `report_type` (Balance Sheet vs. Profit
   and Loss) from `root_type`, and Odoo's Account Type similarly fixes
   only Balance-Sheet-vs-P&L-vs-Off-Balance-Sheet placement — neither
   stores a fine-grained statutory-line formula on the account itself;
   both push the actual country-specific statutory line structure into a
   localization layer (Odoo's docs: account type config exists partly to
   "generate country-specific legal and financial reports," implying the
   detailed mapping is a localization-module concern, not a core-account
   field). `ReportLine` keeps `code`/`name`/`style` from SPEC-024's
   sketch but replaces `formula: string` with a reference resolved
   against `financial_pl`'s own `StatementLineMapping` rows (per-account,
   per Wn/Ma side), not a parsed formula language.

1b. **`ReportLine` needs a template-owned `sign` coefficient and an
    `isTotal` flag — derived subtotals/net result are not optional
    polish, RZiS has no meaning without them.** (Added in maintainer
    review — the original draft defined only leaf line buckets, with no
    way to express "Przychody netto ze sprzedaży minus Koszty
    sprzedanych produktów" or a section subtotal.) Each `ReportLine` in
    `bilansTemplate.ts`/`rzisTemplate.ts` carries `sign: 1 | -1`, fixed by
    the statutory template (e.g., a RZiS kalkulacyjny cost line is always
    `-1`), never by the tenant mapping — sign is a property of *which
    statutory line this is*, not of which accounts a tenant assigned to
    it. A separate, small set of `isTotal: true` lines (section subtotals
    — "A. Przychody netto ze sprzedaży," and the final "Zysk (strata)
    netto") carry no direct account mapping at all; their `amount` is
    computed by `computeDerivedTotals`, a pure function in
    `financial_statements` that sums the signed amounts of the leaf lines
    contained in each section (per the template's own section
    structure), in one pass, after `buildBalanceSheetData`/
    `buildIncomeStatementData` have populated every leaf line. This is a
    small, fixed set of additions/subtractions over a known template
    shape — not a formula language or report builder (Simplest solution
    stays unchanged: no such engine is introduced). `generateAnnualStatements`
    reads the final RZiS net-result total line as the authoritative net
    result for `ClosingResolution`'s sum-validation (Data Model) and for
    the variant-parity check (Design decisions #3), replacing the
    original draft's unspecified "aggregation."

2. **Account-to-line mapping is a tenant-configured settings entity, not
   a derived function — and must be validated as a complete,
   non-overlapping cover, not just "every posted account has some row."**
   Also corrects a related SPEC-024-era assumption. GL core engine's own
   "Alternatives considered" earlier rejected storing `reportType`
   (Balance Sheet vs. P&L) directly on `LedgerAccountType`, deriving it
   in code instead (`mapAccountTypeToStatement`) — reasonable when the
   only granularity needed was "which of two statements," fixed by
   accounting rules regardless of tenant. That reasoning doesn't extend
   to *which specific Bilans/RZiS line* a synthetic account maps to: two
   tenants can legitimately classify the same zespół differently at the
   line level, and — critically — a single synthetic account with a
   debit balance might belong on a different Bilans line than the same
   account with a credit balance (e.g., a rozrachunki/settlement account
   that's sometimes a receivable, sometimes a payable), which is exactly
   why the Event Storming brief calls for "osobno per stronę Wn/Ma." A
   deterministic code function can't express that; a per-account,
   per-side settings row can. `StatementLineMapping` is nullable with no
   default and rejects statement generation if any account posted-to in
   the period is unmapped — the same reject-if-unset discipline as
   `PostingRulesSettings`/`TaxCodeAccountMapping`.

   **Correction from maintainer review — "every posted account is
   mapped" is not sufficient; mapped accounts must also form an
   antichain.** #6013's own Design decisions state *"all six
   `TrialBalanceRowDto` figures roll up descendants for a syntetyk row,
   the same as `getAccountBalance`"* — a parent (syntetyk) account's
   `closingBalance`/turnover already includes every descendant's
   contribution. If both a parent account and one of its own children are
   independently mapped (each satisfying "posted-to accounts are
   mapped"), the child's amount is counted twice: once via the parent's
   rolled-up figure, once via its own row. `buildBalanceSheetData`/
   `buildIncomeStatementData` therefore validate, at generation time, that
   the mapped accounts for each `(side, statementCode)` form an
   **antichain over `parentAccountId`** — no mapped account may be the
   ancestor of another mapped account for the same side/statement — and
   that this antichain **covers** every account posted-to in the period
   (each such account is itself mapped, or has a mapped ancestor). This
   also resolves the review's Wn/Ma-derivation concern: because
   `closingBalance`/`ytdDebit`/`ytdCredit` are already `normalBalance`-
   normalized per #6013's own "Balance sign follows `normalBalance`,
   always" rule, `financial_statements` derives the account's actual
   presentation side from `LedgerAccount.normalBalance` plus the sign of
   the normalized figure (a `DEBIT`-normal account with a positive
   normalized balance posts as a debit-side amount; a negative normalized
   balance — a contrary balance — posts as the credit-side amount
   instead), never from the raw numeric sign alone. Coverage is checked
   by walking the full, unpaginated chart via #6013's `rows`
   pagination (`page`/`pageSize`, capped at 100 per call) to completion —
   `generateAnnualStatements` must page through every `totalPages`, not
   read only the first page, exactly the "exhaustive, consistent
   traversal" the review asked for.
3. **RZiS variant parity is a validation, not new posting logic.**
   Posting Rules Engine already keeps zespół 4 (by-nature) and zespół 5
   (by-function) reconcilable through account 490's running balance
   (Invariant 2: "490's credit balance always equals the sum of
   reclassified zespół 4 costs to date"). This document doesn't need to
   re-derive that guarantee — it needs to *check* it at generation time:
   `generateAnnualStatements` computes both RZiS variants independently
   from the trial balance and asserts identical net result before
   returning either; a mismatch is a generation-time error naming the
   discrepancy (likely an unreconciled 490 balance — an unresolved
   Posting Rules Engine reconciliation gap), not a silently-produced,
   inconsistent pair of statements. Literature-grounded: Kieso's IFRS
   Insights (Ch. 4, "Expense Classifications," citing IAS 1) walks
   through the identical nature-of-expense/function-of-expense split and
   shows both methods arriving at the same net income by construction
   (Telaris Co. example, $205,000 either way) — the same invariant,
   independently confirmed in the accounting literature, not a
   Poland-specific idiosyncrasy.
4. **The board resolution (uchwała) is one input field, not a
   workflow.** Confirmed directly by the source recording: uchwała
   documents are "zawsze załączane jako PDF, nie generowane przez
   system." `ClosingResolution` stores only the resolved allocation
   (e.g., `{ retainedEarnings: number, dividends: number,
   supplementaryCapital: number }` summing to the period's net result)
   plus an optional attachment reference to the PDF — no approval
   states, no generation logic. This is exactly how Kieso's own
   Retained Earnings Statement (Illustration 4.19) treats the
   dividend/appropriation split: external, board-decided data that the
   statement rolls forward, not something the statement itself computes.
5. **Statement generation requires the fiscal year's last `FiscalPeriod`
   to be locked via `posting_rules.lockFiscalPeriod` — not a bare
   `CLOSING`-entry existence check.** GL core engine's `CLOSING` entry
   type exists in Phase 1 (posted manually or by script; the automated
   generator is deferred), and `ledger.lockFiscalPeriod`/
   `unlockFiscalPeriod` already toggle `FiscalPeriod.isLocked`. The
   original draft's precondition ("a `CLOSING` entry exists") is
   necessary but not sufficient: it says nothing about whether that
   year's zespół 4→5 reclassifications (Posting Rules Engine) are
   actually reconciled yet. **Correction from maintainer review:**
   `2026-09-06-posting-rules-engine.md` already built exactly this gate
   — `posting_rules.lockFiscalPeriod` "rejects when
   `findUnreclassifiedEntries` is non-empty, and... successfully
   delegates to `ledger.lockFiscalPeriod` when empty." Requiring
   generation to check `FiscalPeriod.isLocked` (locked, by construction,
   only through that command) reuses this existing reconciliation gate
   instead of re-specifying one, per this project's own reuse
   discipline. `generateAnnualStatements` reads the trial balance *as
   of* the `CLOSING` entry dated within that locked period — it does not
   compute or post the closing entry itself, does not call
   `lockFiscalPeriod` itself (locking is a separate, deliberate
   accountant action, same posture as Posting Rules Engine's own
   Testing Strategy), and does not require the (still out-of-scope)
   automated closing-entry generator. If the period isn't locked, or is
   locked but no `CLOSING` entry is dated within it, generation fails
   with a precondition error naming which is missing, rather than
   silently reporting pre-closing (still-live zespół 4-7) balances as
   final. **Reopen/correction** goes through the same existing
   primitives, no new machinery: `ledger.unlockFiscalPeriod`, a
   `REVERSAL` of the original `CLOSING` entry plus corrected postings, a
   fresh `posting_rules.lockFiscalPeriod` (re-checking reconciliation
   from scratch), a new `CLOSING` entry, then `generateAnnualStatements`
   re-run — see Design decisions #5b for what this does to an existing
   `ClosingResolution`.

5b. **`ClosingResolution` is tied to the specific `CLOSING` entry it was
    computed against, and a reopen supersedes rather than silently
    orphans it.** (Added in maintainer review — the original draft made
    `ClosingResolution` unique per `fiscalPeriodId` and immutable, with no
    link to *which* closing revision produced the net result it
    validated against; Design decisions #5's reopen flow can legitimately
    produce a second, different net result for the same
    `fiscalPeriodId`, which the original shape couldn't represent without
    either rejecting a legitimate correction as a duplicate or silently
    validating stale data.) `ClosingResolution` gains `closingEntryId`
    (FK-id → the specific `CLOSING` `JournalEntry`) and the uniqueness
    constraint moves from `(tenantId, organizationId, fiscalPeriodId)` to
    `(tenantId, organizationId, fiscalPeriodId, closingEntryId)`. Each
    reopen (Design decisions #5) produces a new `CLOSING` entry with a
    new id, so a post-correction `recordClosingResolution` call is a new
    row, not a conflicting duplicate — while the original row remains, for
    audit, correctly tied to the `CLOSING` entry it was actually computed
    against (never edited or deleted; GL's own "always reversal, never
    edit/delete" posture extended to this settings-adjacent record).
    `generateAnnualStatements`'s response and the statements page
    (UI/UX) surface the *current* `CLOSING` entry's `ClosingResolution`
    (if any) and flag, rather than silently ignore, a fiscal period whose
    latest `CLOSING` entry has no matching resolution yet (a prior
    resolution tied to a now-superseded `CLOSING` entry is stale, not
    reusable).

6. **Export needs its own statement-compatible adapter — #6038's
   `GET /api/ledger/audit/export` is not reusable as-is.** (Added in
   maintainer review — the original draft's UI/UX said only "reusing
   #6038's export machinery," which the review correctly flagged as
   under-specified.) #6038's export endpoint takes `format`/`periodId`
   and serializes rows "pulled from Phase 1's
   `iterateJournalEntries`/`iterateJournalEntryLines`/`listAccounts`/
   `listAccountGroups`" — raw audit rows, not a rendered `ReportFormat`
   document with `financial_pl`'s statutory sections/lines/subtotals.
   `financial_pl` adds its own `exportStatementDocument(reportFormat,
   format)` in `lib/exportStatementAdapter.ts`, reusing #6038's
   underlying per-format *serialization utilities* (CSV/XLSX/PDF cell/row
   writers) rather than its audit-specific query, so PDF/XLSX output
   renders the same section/line/subtotal structure the UI shows on
   screen — not a second, independently-drifting representation of the
   numbers. Requires the same `financial_pl.statements.manage` scope as
   generation; no separate export permission for Phase 1.
7. **`StatementLineMapping` rows carry an optimistic-lock `version`,
   the same as every other multi-editor settings table in this
   project.** (Added in maintainer review — the original draft's mapping
   settings grid had no described conflict handling for two accountants
   editing mappings concurrently.) `PUT /statement-line-mapping/:id`
   requires the caller's last-read `version` and rejects with `409
   MAPPING_VERSION_CONFLICT` (naming the current version) on mismatch,
   the same pattern `PostingRulesSettings`/`TaxCodeAccountMapping` already
   use for their own settings rows.

## Architecture

### `financial_statements` (Core, this repo)

- `packages/modules/financial_statements/data/types.ts` — `ReportFormat`,
  `ReportSection`, `ReportLine` (`{ code, name, style, sign: 1 | -1,
  isTotal?: boolean, amount }`, per Design decisions #1/#1b), `Disclosure`
  (unused in Phase 1; kept for shape-compatibility with SPEC-024 §2.4 so
  a future country plugin's Notes-to-Statements section has somewhere to
  land).
- `packages/modules/financial_statements/lib/buildBalanceSheetData.ts` —
  `buildBalanceSheetData(fiscalPeriodId, lineMappings: { accountId, side:
  'debit' | 'credit', lineCode }[])`. Calls #6013's `getTrialBalance`
  internally (direct in-process read — GL/GL-balances are both upstream
  of this module, consistent with the established one-way dependency
  direction), paginates through every `totalPages` (Design decisions #2),
  validates the mapping is an antichain that covers every posted-to
  account, derives each row's actual debit/credit presentation side from
  `normalBalance` plus the normalized-balance sign (Design decisions #2),
  buckets each row's `closingBalance` into `lineCode` per its mapped
  side, and returns `{ lineCode, amount }[]`. Pure aggregation, no
  formatting, no I/O beyond the read.
- `packages/modules/financial_statements/lib/buildIncomeStatementData.ts`
  — same signature and mapping-validation/pagination behavior as
  `buildBalanceSheetData`, but reads `ytdDebit`/`ytdCredit` for the
  fiscal year's last `FiscalPeriod` and subtracts the fiscal year's
  `CLOSING` `JournalEntry`'s own per-account lines (a single, cheap read
  by `referenceType`/`id`, not a new #6013 query) before bucketing
  (Design decisions #0). This is the RZiS-only aggregation function; it
  must never be used for Bilans lines.
- `packages/modules/financial_statements/lib/computeDerivedTotals.ts` —
  `computeDerivedTotals(sections: ReportSection[]): ReportSection[]`. Pure
  function; sums each section's leaf `ReportLine.amount * sign` into that
  section's `isTotal` line(s), per the template's own structure (Design
  decisions #1b). No trial-balance read of its own — runs after
  `buildBalanceSheetData`/`buildIncomeStatementData` have populated leaf
  amounts.
- `index.ts` — `requires: ['ledger']`, no ACL of its own (this module
  exposes no route or command; `financial_pl` is the only caller).

### `financial_pl` (Poland plugin, `official-modules`)

- `data/entities.ts` — `StatementLineMapping` (tenant settings,
  nullable/no-default, `version` optimistic lock, per Design decisions
  #2/#7), `ClosingResolution` (per fiscal period **and** `closingEntryId`,
  per Design decisions #4/#5b).
- `lib/bilansTemplate.ts` / `lib/rzisTemplate.ts` — the fixed Załącznik
  nr 1 line structures (section codes/names/order/`sign`/`isTotal`, per
  Design decisions #1b), independent of any tenant's actual chart.
- `lib/exportStatementAdapter.ts` — `exportStatementDocument(reportFormat,
  format)` (Design decisions #6), reusing #6038's per-format
  serialization utilities against a rendered `ReportFormat` rather than
  #6038's own audit-row query.
- `commands/generateAnnualStatements.ts` — input `{ fiscalPeriodId }`;
  preconditions: the fiscal year's last `FiscalPeriod` is locked via
  `posting_rules.lockFiscalPeriod` and a `CLOSING` entry is dated within
  it (Design decisions #5), every account posted-to in the period is
  covered by a valid, non-overlapping `StatementLineMapping` antichain
  for the side(s) it was posted on (Design decisions #2). Calls
  `buildBalanceSheetData` (Bilans mapping) and `buildIncomeStatementData`
  (each RZiS variant's mapping) — never the other function for the wrong
  statement (Design decisions #0) — then `computeDerivedTotals` on each
  rendered set of sections, runs the variant-parity check against the
  derived net-result totals (Design decisions #3), and returns the two
  rendered `ReportFormat` documents plus the `zeroSumCheck`-style
  pass/fail already familiar from #6013. Also resolves and returns the
  current `CLOSING` entry's `ClosingResolution`, if one exists (Design
  decisions #5b).
- `commands/recordClosingResolution.ts` — input `{ fiscalPeriodId,
  retainedEarnings, dividends, supplementaryCapital, attachmentRef? }`;
  resolves the fiscal period's current `CLOSING` entry, validates the
  three amounts sum to its `computeDerivedTotals`-derived RZiS net result,
  and writes `ClosingResolution` keyed to that `closingEntryId` (Design
  decisions #5b) — `409` if a resolution already exists for that specific
  `closingEntryId` (a genuinely new `CLOSING` entry, from a reopen, is a
  new key, not a conflict).
- `commands/updateStatementLineMapping.ts` — input `{ id, ...fields,
  version }` (Design decisions #7); `409
  MAPPING_VERSION_CONFLICT` on stale `version`.
- `api/statements/route.ts` — `GET` (list generated statements) and
  `POST /generate` (invoke `generateAnnualStatements`), behind
  `financial_pl.statements.manage`.
- `api/statement-line-mapping/route.ts` — `GET` (list current mappings,
  paginated, grouped by zespół for the settings UI) and `PUT /:id`
  (invoke `updateStatementLineMapping`), behind
  `financial_pl.statements.manage`.
- `backend/financial-pl/statements/page.tsx` — read-only Bilans/RZiS
  view (rendered from the returned `ReportFormat`), a `StatementLineMapping`
  admin page (surfacing `409` version conflicts as "someone else edited
  this row, reload"), and the `ClosingResolution` entry form — export via
  `lib/exportStatementAdapter.ts` (Design decisions #6) rather than
  #6038's raw audit exporter.

## Data Model

### `StatementLineMapping` (`financial_pl`)

`{ id, tenantId, organizationId, accountId (FK LedgerAccount), side
('debit'|'credit'), statementCode ('bilans'|'rzis_porownawczy'|
'rzis_kalkulacyjny'), lineCode (string, matches the target template's
line codes), version (integer, optimistic lock, Design decisions #7),
createdAt, updatedAt }`. Nullable/no-default: an account posted-to in a
period with no matching row, or covered by no ancestor's row, for the
side it was posted on blocks `generateAnnualStatements` for that period
(Design decisions #2) — validated as a complete, non-overlapping
antichain per `(side, statementCode)`, not merely "a row exists per
account." Unique on `(tenantId, organizationId, accountId, side,
statementCode)`.

### `ClosingResolution` (`financial_pl`)

`{ id, tenantId, organizationId, fiscalPeriodId (FK FiscalPeriod),
closingEntryId (FK-id → ledger.JournalEntry, the specific `CLOSING` entry
this resolution was computed against — Design decisions #5b),
retainedEarnings (decimal), dividends (decimal), supplementaryCapital
(decimal), attachmentRef (string, nullable — a document/file reference,
not a workflow state), recordedBy, recordedAt }`.
`retainedEarnings + dividends + supplementaryCapital` must equal the
`closingEntryId` `CLOSING` entry's `computeDerivedTotals`-derived RZiS net
result at write time (validated in the command, not a DB constraint,
since it needs the full aggregation to check). Unique on `(tenantId,
organizationId, fiscalPeriodId, closingEntryId)` — no longer unique on
`fiscalPeriodId` alone (Design decisions #5b): a reopen produces a new
`closingEntryId`, and its own resolution is a new row, not a rejected
duplicate.

## API Contracts

### `POST /api/financial-pl/statements/generate`

- **Body**: `{ fiscalPeriodId: string }`.
- **Response 200**: `{ fiscalPeriodId, closingEntryId, bilans: ReportFormat, rzisPorownawczy: ReportFormat, rzisKalkulacyjny: ReportFormat, netResultParity: { porownawczy: number, kalkulacyjny: number, matches: boolean }, closingResolution: ClosingResolution | null }`.
- **Response 409**: the fiscal year's last `FiscalPeriod` is not locked
  via `posting_rules.lockFiscalPeriod`, no `CLOSING` `JournalEntry` is
  dated within it (Design decisions #5), or one or more posted-to
  accounts are not covered by a valid `StatementLineMapping` antichain
  for the side they were posted on (body names the missing/overlapping
  account/side pairs, Design decisions #2).
- **Response 422**: `netResultParity.matches` is `false` — generation
  still returns both variants (for debugging) but flags the mismatch
  rather than silently succeeding.
- **Response 403**: caller lacks `financial_pl.statements.manage`.

### `GET /api/financial-pl/statement-line-mapping`

- **Query**: `page?`, `pageSize?` (mirrors #6013's `getTrialBalance`
  pagination contract, Design decisions #2).
- **Response 200**: `{ rows: StatementLineMapping[], page, pageSize, total, totalPages }`.
- **Response 403**: caller lacks `financial_pl.statements.manage`.

### `PUT /api/financial-pl/statement-line-mapping/:id`

- **Body**: `{ lineCode, version }` (Design decisions #7).
- **Response 200**: the updated `StatementLineMapping`.
- **Response 409 `MAPPING_VERSION_CONFLICT`**: `version` doesn't match
  the current row (body names the current `version`).
- **Response 403**: caller lacks `financial_pl.statements.manage`.

### `POST /api/financial-pl/statements/closing-resolution`

- **Body**: `{ fiscalPeriodId, retainedEarnings, dividends,
  supplementaryCapital, attachmentRef? }`.
- **Response 200**: the created `ClosingResolution` (`closingEntryId`
  resolved server-side from the period's current `CLOSING` entry, Design
  decisions #5b).
- **Response 400**: the three amounts don't sum to the current
  `CLOSING` entry's derived RZiS net result.
- **Response 403**: caller lacks `financial_pl.statements.manage`.
- **Response 409**: a `ClosingResolution` already exists for this
  `(fiscalPeriodId, closingEntryId)` pair (immutable once recorded for
  that specific closing revision — a correction after a reopen targets a
  new `closingEntryId` and is a new record, not an edit, consistent with
  `TaxLiabilityRecord`'s own "posts once; a correction is a new record"
  precedent, Design decisions #5b).

## UI/UX

- `backend/financial-pl/statements/page.tsx` — a fiscal-period picker, a
  "Generate" action (calls `/generate`), and, once generated, two
  read-only report views (Bilans, RZiS — with a toggle between
  porównawczy/kalkulacyjny) rendered from `ReportFormat`'s sections/lines
  (subtotal/total lines rendered distinctly, per `isTotal`, Design
  decisions #1b), plus "Export PDF"/"Export Excel" buttons wired to
  `lib/exportStatementAdapter.ts` (Design decisions #6, not #6038's raw
  audit exporter directly). A visible banner if `netResultParity.matches`
  is `false`, and a separate banner if the current `CLOSING` entry has no
  `ClosingResolution` yet (Design decisions #5b) versus one carried over
  from a now-superseded closing revision.
- `backend/financial-pl/statement-line-mapping/page.tsx` — a settings
  table: one row per `(account, side, statement)`, editable, grouped by
  zespół for discoverability (reusing the flat, sorted-by-code
  presentation #6013 already established for its own trial-balance
  table — no new tree/indentation UI), with each row's `version` held for
  its `PUT` call and a "someone else edited this row, reload" message on
  `409 MAPPING_VERSION_CONFLICT` (Design decisions #7). The table
  visually flags any two mapped rows that violate the antichain
  requirement (Design decisions #2) before the accountant even attempts
  generation.
- Closing-resolution entry: a small form on the same statements page
  (three amount fields that must sum to the displayed net result, plus
  an optional attachment upload) rather than a separate page — it's a
  single record per `(fiscalPeriodId, closingEntryId)` pair, not a list
  (Design decisions #5b).

## Edge Cases & Failure Scenarios

- **Account posted-to but never mapped, or mapped by both a synthetic
  account and one of its own descendants.** `generateAnnualStatements`
  returns 409 naming every `(accountId, side)` pair that is uncovered
  *or* double-covered by the antichain (Design decisions #2), rather
  than silently omitting the amount or silently double-counting it (a
  Bilans/RZiS that doesn't balance because of a silently-dropped or
  silently-doubled account is worse than a blocked generation).
- **RZiS variants disagree.** 422, both variants still returned for
  debugging, banner shown in UI — see Design decisions #3. The likely
  root cause (an unreconciled Posting Rules Engine account-490 residual)
  is named in the error body as a diagnostic hint, not auto-fixed here.
- **`CLOSING` entry missing, or the fiscal year's last `FiscalPeriod`
  isn't locked via `posting_rules.lockFiscalPeriod`.** 409 — generating
  statements against a still-open, or locked-but-unreconciled, period
  would report balances or a net result that can still change (Design
  decisions #5).
- **`ClosingResolution` amounts don't sum to the derived net result.**
  400 at write time — this is the one place a manual-entry error is easy
  to make (typo in one of three fields) and easy to catch mechanically.
- **Reopen + correction + regenerate.** `CLOSING` entries are never
  edited (GL core engine: "always reversal, never edit"); a correction
  is `ledger.unlockFiscalPeriod` → `REVERSAL` of the original `CLOSING`
  + corrected postings → `posting_rules.lockFiscalPeriod` (re-checking
  reconciliation) → a new `CLOSING` entry → `generateAnnualStatements`
  re-run against the new trial balance (Design decisions #5). The prior
  `ClosingResolution`, keyed to the superseded `closingEntryId`, is left
  in place for audit; a new one is recorded against the new entry
  (Design decisions #5b) — the statements page flags the fiscal period
  as awaiting a fresh resolution until it is.
- **Two accountants edit `StatementLineMapping` concurrently.** The
  second `PUT` fails `409 MAPPING_VERSION_CONFLICT` (Design decisions
  #7); the UI reloads the current row rather than overwriting it.
- **Export requested for an unmapped/mid-correction period.** Rejected
  with the same 409 `generateAnnualStatements` would give — export never
  runs against a `ReportFormat` this document couldn't itself produce
  (Design decisions #6).

## Risks & Impact Review

- **Mapping completeness drift.** A tenant importing Default Chart of
  Accounts (#6137) gets zero `StatementLineMapping` rows by default —
  the mapping is a deliberate, separate configuration step (Design
  decisions #2), so a tenant's first `generateAnnualStatements` call
  after initial setup will predictably 409 until mapping is done.
  Mitigation: the UI's mapping page groups by zespół and could ship a
  suggested-mapping seed derived from Default CoA's own 42 accounts as a
  starting point (not designed here — a `financial_pl`-side follow-up,
  not blocking this document).
- **Variant-parity false negatives from unrelated Posting Rules Engine
  gaps.** Because parity depends on account 490's reconciliation being
  current, a slow `reconcileCostRing` sweep (Posting Rules Engine's own
  "eventual, not immediate" invariant) now blocks *locking* the fiscal
  period via `posting_rules.lockFiscalPeriod` (Design decisions #5)
  before it ever reaches statement generation — a earlier, clearer
  failure point than the original draft's plain 422-at-generation-time,
  though the operator still has to wait for the sweep to catch up before
  the period can be locked at all right after heavy period-end activity.
  Acceptable for Phase 1.
- **Payment/legal accuracy of the rendered statements is not validated
  by tests alone.** Like Tax Management's payment-instruction risk, a
  wrong line-template or mapping produces a statutory filing a human
  must ultimately sign off on; Testing Strategy below covers structural
  correctness (parity, mapping completeness, RZiS-basis arithmetic) but
  not accountant sign-off, which stays a manual review gate outside this
  system.
- **This document's initial draft computed RZiS from the wrong basis**
  (post-`CLOSING` closing balance, always `0` for revenue/expense
  accounts — Design decisions #0) **and under-specified account-mapping
  completeness, derived totals, reconciliation timing, `ClosingResolution`
  revisioning, export, and mapping-edit concurrency** — all caught by an
  automated specification review before implementation started (see the
  banner note under TLDR and Changelog). Named here for the same reason
  this project already records other caught-before-implementation
  mistakes in Risks sections elsewhere (e.g., Tax Management's "two prior
  false starts"): a mistake caught in review and fixed in the same
  document is a process working correctly, not something to omit from
  the record.

## Alternatives considered

- **Derive the account→line mapping from `LedgerAccountType`/zespół
  alone, no per-account settings** — rejected; see Design decisions #2
  (Wn/Ma-side-dependent classification and tenant-specific renumbering
  both defeat a purely derived mapping).
- **Model the uchwała as a workflow (draft → board-approved → posted)**
  — rejected; the source recording is explicit that the resolution is
  always an external PDF, never system-generated (Design decisions #4).
- **Fold this into GL account balances (#6013) as a Phase 3** — rejected
  by #6013 itself (its Out of scope names Bilans/P&L as "separate, larger
  future documents"); reusing #6013's `getTrialBalance` as a dependency
  is the right relationship, not merging scopes.
- **Skip the Core `financial_statements` module, put everything in
  `financial_pl`** — considered (and initially proposed) but rejected
  for the same reason Tax Management didn't stay single-module: SPEC-024
  §11 already mandates the Core-engine/plugin split, and the generic
  `ReportFormat` shape has a real, if small, country-independent
  substance (see Design decisions #1). Confirmed against ERPNext/Odoo
  precedent that even simple systems put *some* structure at the
  framework level (`root_type`→`report_type`) and leave only the
  fine-grained mapping to a localization layer.

## Out of scope

- **Cash Flow Statement, Statement of Changes in Equity, Notes to
  Statements** — SPEC-024 §11.2 lists all three alongside Balance Sheet/
  P&L, and #6013's own Out of scope already named Cash Flow as a
  "separate, larger future document"; none is required by the Event
  Storming brief's Sekcja 6 list ("Wygenerowano Bilans," "Wygenerowano
  P&L" only) — future documents, not solved here.
- **Report builder, scheduler, drill-down engine, report caching**
  (SPEC-024 §11.1, Core, High/Medium priority) — deferred; see Proposed
  Solution and Design decisions #1. `financial_statements` ships only
  the data shape and the aggregation functions a Phase 2 builder/scheduler
  would eventually call.
- **Automated `CLOSING`-entry generation** — already Out of scope in GL
  core engine (#5663); this document consumes an already-posted
  `CLOSING` entry, doesn't produce one (Design decisions #5).
- **A suggested/seeded `StatementLineMapping` derived from Default Chart
  of Accounts (#6137)** — named as a mitigation above, not designed here;
  a `financial_pl`-side follow-up once real mapping usage patterns exist.
- **Multi-currency statement presentation** — Bilans/RZiS are base-
  currency only in Phase 1, the same boundary #6013 already drew for its
  own balance/trial-balance figures; foreign-currency presentation is a
  Multi-Currency-spec concern (the next document in this series).
- **A second country's statement format** — nothing here is designed
  against a real second plugin; `financial_statements`'s shape is kept
  intentionally minimal rather than speculatively generalized (see
  Alternatives considered).

## Migration & Backward Compatibility

No existing API, event, entity, or dependency changes — `financial_statements`
and `financial_pl` are both new modules, and #6013/#6015/#6046's own
signatures are read-only dependencies, untouched by this document.
Deployment order: `financial_statements` (Core) ships first (it has no UI
and no ACL of its own), then `financial_pl`'s entities/migration, then its
commands/API/UI, matching the File Manifest's own ordering. For an
existing tenant: `StatementLineMapping` starts empty (Risks & Impact
Review, "Mapping completeness drift") — the first `generateAnnualStatements`
call after this ships predictably 409s until mapping is configured; this
is the intended reject-if-unset behavior (Design decisions #2), not a
migration bug to work around. `ClosingResolution`'s `closingEntryId`
column (Design decisions #5b) has no historical data to backfill — no
`CLOSING` entry has been posted by any tenant before Phase 1 GL core
engine shipped, so there is no pre-existing `ClosingResolution` row this
schema could conflict with. Rollback is a plain migration-down plus
removing the two commands' routes; no other module reads
`StatementLineMapping`/`ClosingResolution`, so rollback has no
cross-module fallout.

## Implementation Plan

1. `financial_statements` (Core): `data/types.ts` (`ReportFormat`/
   `ReportSection`/`ReportLine` with `sign`/`isTotal`/`ReportLine`/
   `Disclosure`), `lib/buildBalanceSheetData.ts`,
   `lib/buildIncomeStatementData.ts`, `lib/computeDerivedTotals.ts`,
   `index.ts` (`requires: ['ledger']`).
2. `financial_pl`: `data/entities.ts` + migration (`StatementLineMapping`
   with `version`, `ClosingResolution` with `closingEntryId` and the
   revised unique constraint).
3. `financial_pl`: `lib/bilansTemplate.ts`, `lib/rzisTemplate.ts` (both
   variants, each line's `sign`/`isTotal` set) — the fixed Załącznik nr 1
   line structures.
4. `financial_pl`: `commands/generateAnnualStatements.ts` (antichain
   validation, `posting_rules.lockFiscalPeriod`-gated precondition,
   `CLOSING`-entry lookup and subtraction for RZiS),
   `commands/recordClosingResolution.ts`,
   `commands/updateStatementLineMapping.ts` (optimistic lock).
5. `financial_pl`: `lib/exportStatementAdapter.ts` (Design decisions #6).
6. `financial_pl`: `acl.ts` (`financial_pl.statements.manage`),
   `api/statements/route.ts`, `api/statement-line-mapping/route.ts`.
7. `financial_pl`: `backend/financial-pl/statements/page.tsx`,
   `backend/financial-pl/statement-line-mapping/page.tsx` (version-conflict
   handling, antichain-violation display).
8. Testing Strategy (below) implemented and passing.
9. Manual QA + `yarn generate` + typecheck + full walkthrough (mirrors
   every sibling spec's Phase-1 closing step).

### Testing Strategy

- **RZiS basis, profitable year** (Design decisions #0): revenue account
  posts `100` real credit turnover across the year; `CLOSING` posts a
  further `100` debit. Assert `buildIncomeStatementData` reports `100`,
  not `0`; assert `buildBalanceSheetData`'s `closingBalance` for the same
  account is `0` (correctly zeroed for Bilans purposes). Symmetric
  expense-account assertion (`60` real debit, `60` closing credit → `60`
  reported, not `0`). Assert net result `40`.
- **RZiS basis, loss-making year**: revenue `60`, expense `100`; assert
  net result `−40` and that both RZiS variants agree on the loss, not
  just on a zero.
- **Mapping antichain violation**: map both a synthetic parent account and
  one of its own children for the same `(side, statementCode)`. Assert
  `generateAnnualStatements` 409s naming the double-covered account,
  rather than silently doubling its amount.
- **Mapping coverage gap across a paginated chart**: a chart of accounts
  exceeding #6013's 100-row page size, with the unmapped account on page
  two. Assert generation still 409s on it (exhaustive traversal, Design
  decisions #2), not just on page-one accounts.
- **Wn/Ma derivation for a contrary-balance account**: a `DEBIT`-normal
  account with a negative normalized balance (a contrary/credit balance).
  Assert it's bucketed on the credit-side line, not the debit-side line a
  naive numeric-sign read would pick.
- Variant-parity pass/fail (existing case, kept): including a
  deliberately-unreconciled-490 fixture — but now asserted at
  `posting_rules.lockFiscalPeriod` time (Design decisions #5), with a
  second assertion that `generateAnnualStatements` itself still 422s if a
  parity mismatch somehow reaches it despite a locked period.
- **Reopen/correction round-trip** (Design decisions #5/#5b):
  `unlockFiscalPeriod` → `REVERSAL` + corrected postings →
  `lockFiscalPeriod` → new `CLOSING` → regenerate → assert the new
  `ClosingResolution` is a new row keyed to the new `closingEntryId`, and
  the original row is untouched.
- **`ClosingResolution` sum validation** against the derived net-result
  total (not a hand-summed figure) — existing case, kept.
- **Concurrent mapping edit**: two `PUT` calls against the same row's
  stale `version`; assert the second gets `409
  MAPPING_VERSION_CONFLICT` naming the current version.
- **Export fidelity**: assert `exportStatementDocument`'s PDF/XLSX output
  reproduces the same section/line/subtotal amounts the API response
  shows, for both Bilans and each RZiS variant.
- Precondition on missing `CLOSING` entry, or an unlocked fiscal year —
  existing case, kept, split into its two distinct 409 reasons (Design
  decisions #5).

## File Manifest

| File | Change | Purpose |
|---|---|---|
| `packages/modules/financial_statements/data/types.ts` | Create | `ReportFormat`/`ReportSection`/`ReportLine` (`sign`/`isTotal`)/`Disclosure` |
| `packages/modules/financial_statements/lib/buildBalanceSheetData.ts` | Create | Closing-balance → line-bucketed aggregation (Bilans) |
| `packages/modules/financial_statements/lib/buildIncomeStatementData.ts` | Create | Pre-closing-turnover → line-bucketed aggregation (RZiS) |
| `packages/modules/financial_statements/lib/computeDerivedTotals.ts` | Create | Signed subtotal/net-result derivation |
| `packages/modules/financial_statements/index.ts` | Create | Module manifest, `requires: ['ledger']` |
| `financial_pl/data/entities.ts` | Modify | `StatementLineMapping` (+`version`), `ClosingResolution` (+`closingEntryId`) |
| `financial_pl/lib/bilansTemplate.ts` / `rzisTemplate.ts` | Create | Załącznik nr 1 line templates (`sign`/`isTotal`) |
| `financial_pl/lib/exportStatementAdapter.ts` | Create | Statement-compatible PDF/XLSX export |
| `financial_pl/commands/generateAnnualStatements.ts` | Create | Generation + antichain validation + variant-parity check |
| `financial_pl/commands/recordClosingResolution.ts` | Create | Uchwała-outcome input, keyed to `closingEntryId` |
| `financial_pl/commands/updateStatementLineMapping.ts` | Create | Optimistic-lock mapping edit |
| `financial_pl/acl.ts` | Modify | `financial_pl.statements.manage` |
| `financial_pl/api/statements/route.ts` | Create | `POST /generate`, `POST /closing-resolution` |
| `financial_pl/api/statement-line-mapping/route.ts` | Create | `GET` list, `PUT /:id` |
| `financial_pl/backend/financial-pl/statements/page.tsx` | Create | Report view + export |
| `financial_pl/backend/financial-pl/statement-line-mapping/page.tsx` | Create | Mapping settings UI, version-conflict handling |

## Literature & Prior Art

**Step 1 — Cross-spec consistency.** Reconciled against: GL core engine
(#5663 — `CLOSING` entry type, "always reversal never edit," the
rejected `reportType`-on-account-type alternative), GL account balances
(#6013 — `getTrialBalance`/`TrialBalanceRowDto` shape, its own Bilans/P&L
Out-of-scope forward pointer, base-currency-only boundary), Posting
Rules Engine (#6015 — account 490 invariant, "the report itself is a
reporting-layer concern, a different owner"), Default Chart of Accounts
(#6137 — accounts fully tenant-editable post-import, no fixed numbering
to key a formula against), Tax Management (`2026-09-16-tax-management.md`
— the Core-engine/plugin split precedent this document reuses, and
`TaxLiabilityRecord`'s "posts once, correction is a new record" pattern
reused for `ClosingResolution`), and the knowledge base's §2 conventions
(control-account/subsidiary-ledger boundary — not directly implicated
here but checked; "account numbers are illustrative, never literal").

**Step 2 — Literature grounding (Kieso, *Intermediate Accounting*, 17th
Ed.).**
- **Confirmed** — Ch. 5, "Classification in the Balance Sheet" (pp.
  5-5–5-6, Illustration 5.1): the general classified format (Current
  assets / Long-term investments / PP&E / Intangibles / Other assets vs.
  Current liabilities / Long-term debt / Owners' equity). Mismatch noted
  alongside the confirmation: this is a *flexible* classification
  convention under U.S. GAAP, whereas Poland's Bilans follows a legally
  fixed line-item schema (Załącznik nr 1 do Ustawy o rachunkowości) —
  the general classified-statement *concept* transfers, the specific
  line structure does not, which is exactly why `financial_pl` owns the
  template rather than `financial_statements` deriving one generically.
- **Confirmed** — Ch. 4, "Income Statement and Related Information,"
  IFRS Insights § "Expense Classifications" (pp. 4-44–4-46, citing IAS
  1): companies present expenses either by nature or by function; both
  approaches must arrive at the same net income by construction. Worked
  example (Telaris Co.) shows identical net income ($205,000) under
  both the nature-of-expense and function-of-expense presentations.
  Directly grounds Design decisions #3 — RZiS's porównawczy/kalkulacyjny
  split is the same internationally-recognized nature-vs-function
  distinction under IAS 1, not a Polish-specific quirk, and the
  same-net-result requirement is a textbook invariant of that
  distinction, not an extra check this project invented.
- **Confirmed** — Ch. 4, "Retained Earnings Statement" (Illustration
  4.19): net income increases retained earnings; dividends and
  appropriations (board-level decisions) decrease it; the reconciliation
  is presented as beginning balance + net income − distributions =
  ending balance. Grounds Design decisions #4 — `ClosingResolution`'s
  three-way split (retained earnings / dividends / supplementary
  capital) is the same structure Kieso presents, with the board's
  decision treated as external input data, not a computed statement
  line.
- **Fowler, *Analysis Patterns*, §6.12 "Balance Sheet and Income
  Statement"** (p. 123-124) — Confirmed but limited: distinguishes
  balance-sheet accounts (persist a balance across periods) from
  income-statement accounts (reset to zero at period end) as a general
  conceptual pattern. Confirms *why* `CLOSING` needs to zero zespoły 4-7
  specifically, but doesn't address statement-document generation,
  line-item mapping, or multi-jurisdiction formats — this document's
  actual design problem is unaddressed in Fowler, consistent with the
  knowledge base's existing finding that Fowler's accounting coverage is
  thin relative to this project's real requirements.
- **Hay, *Data Model Patterns*** — no hits for "balance sheet," "income
  statement," or "financial statement" beyond incidental mentions;
  consistent with the knowledge base's existing recorded finding that
  Hay has no income-tax/financial-reporting content. Recorded as an
  explicit absence, not a gap in this research.

**Step 3 — Real-system comparison.**
- **ERPNext** (`frappe/erpnext`, `chart_of_accounts.py`, `develop`
  branch, read via the live GitHub source): `report_type` ("Balance
  Sheet" or "Profit and Loss") is derived once from `root_type` (Asset/
  Liability/Equity → Balance Sheet; else → Profit and Loss) and stored
  on the Account at creation. Confirms the coarse two-statement split is
  commonly a simple, fixed function of a small type enum — but confirms
  by *absence* that ERPNext doesn't attempt a fine-grained statutory-
  line mapping at the framework level either; that's left to
  country-specific reporting configuration on top.
- **Odoo** (documentation, v19): Account Type fixes Balance-Sheet-vs-
  Profit&Loss-vs-Off-Balance-Sheet placement; the documentation
  explicitly ties correct Account Type configuration to the ability to
  "generate country-specific legal and financial reports," and account
  groups handle presentation hierarchy separately from statement
  placement. Same pattern as ERPNext: a small, fixed, country-agnostic
  classification at the core, real statutory structure pushed to a
  localization layer — independent confirmation of this document's
  Core/plugin boundary (Design decisions #1, #2).
- **Comarch Optima / Symfonia / enova365** — Unverified. No public
  technical documentation describes their internal account-to-statement-
  line mapping mechanism; consistent with the knowledge base's existing
  practice of marking these Unverified rather than assumed, for the same
  reason (closed-source, accountant-facing products with no published
  data-model docs).
- **GnuCash** — not separately checked; its double-entry model doesn't
  natively distinguish by-nature/by-function P&L variants (no Polish-
  style zespół 4/5 split exists in its account hierarchy), so it isn't a
  directly comparable precedent for the variant-parity requirement
  specifically.

## Changelog

### 2026-09-17 — Initial draft

- Opened as PR (see issue #6061's Specs and PRs table for the number)
  after the full five-step `financial-spec-writing-process`: cross-spec
  read of #5663, #6013, #6015, #6137, and `2026-09-16-tax-management.md`;
  literature grounding in Kieso (three Confirmed citations) plus Fowler
  (Confirmed-but-limited) and an explicit Hay absence; real-system
  comparison against ERPNext (primary source, GitHub) and Odoo
  (documentation), with Polish ERPs and GnuCash marked Unverified/not
  comparable rather than assumed.
- Followed SPEC-024 §11's own Core-engine + country-plugin mandate,
  matching the precedent already set for Tax Management (§10) — decided
  explicitly with the user rather than assumed, given the two prior
  false starts on Tax Management's own scope.
- Corrected two SPEC-024-era assumptions against this project's own
  later-established conventions: `ReportLine.formula` as an account-
  number-range string (replaced with a `StatementLineMapping` table
  reference — accounts are tenant-customized, never literal) and an
  implicit assumption that statement-line placement could be derived
  the same way GL core engine's simpler `reportType` question was
  (replaced with a tenant-configured, per-Wn/Ma-side settings entity,
  once the debit/credit-dependent classification requirement surfaced).

### 2026-09-18 (cont. — SPEC-010 moved to official-modules, banner note updated)

- **Update, not a scope or design change.** `2026-09-11-jpk-kr-pd-financial-pl.md`
  (SPEC-010), which this document's own "Temporary location" banner
  points to as precedent, has moved: it now lives at
  `.ai/specs/SPEC-010-2026-09-11-jpk-kr-pd-financial-pl.md` in
  `official-modules#54`, following a maintainer-review round and a
  code-verified compliance pass against that repo's own AGENTS.md/
  spec-writing rules. Added a dated note to this document's banner
  pointing at the new location. This document's own `financial_pl`
  half has not made the equivalent move yet and its temporary-location
  reasoning is unchanged.

### 2026-09-21 — Maintainer-review correction round

An automated specification review (`om-auto-review-pr`, PR head
`37225917652f7e5bb514f8b7062213708bd23ad2`) requested changes; every
finding was independently re-verified against the cited sibling specs
and #6013/#6015's actual design text (not accepted on the review's word
alone) before being addressed here:

- **Blocker, Confirmed** — RZiS computed from post-`CLOSING` closing
  balance reports `0` revenue/expense for every fiscal year by
  construction. Fixed: split the single `buildStatementData` into
  `buildBalanceSheetData` (closing balance, for Bilans) and
  `buildIncomeStatementData` (YTD turnover minus the `CLOSING` entry's
  own lines, for RZiS) — Design decisions #0.
- **Major, Confirmed** — account-mapping double-counting, since #6013's
  own rollup rows already include descendant contributions. Fixed:
  mapped accounts must form a validated antichain over `parentAccountId`
  that covers every posted-to account, checked across the full paginated
  chart — Design decisions #2.
- **Major, Confirmed** — no derived totals/subtotals; `ReportLine.formula`
  had been removed with no replacement. Fixed: template-owned `sign`
  coefficients plus `computeDerivedTotals` — Design decisions #1b.
- **Major, Confirmed** — no reconciliation-before-lock, no reopen
  recovery. Fixed: reuse `posting_rules.lockFiscalPeriod`'s existing
  zespół-4→5 reconciliation gate as the generation precondition instead
  of a bare `CLOSING`-entry check, and define reopen via the existing
  `unlockFiscalPeriod`/`REVERSAL`/re-lock primitives — Design decisions
  #5.
- **Major, Confirmed** — `ClosingResolution` had no link to which closing
  revision it validated against. Fixed: `closingEntryId` FK plus a
  revised unique constraint — Design decisions #5b.
- **Major, Confirmed** — #6038's raw audit-row exporter can't render a
  `ReportFormat` document. Fixed: a dedicated
  `exportStatementAdapter.ts` reusing #6038's per-format serialization
  utilities, not its query — Design decisions #6.
- **Minor, Confirmed** — no `StatementLineMapping` concurrency control, no
  standalone Migration & Backward Compatibility or Testing Strategy
  section despite the document referencing "Testing Strategy below"
  three times with no such section existing. Fixed: optimistic-lock
  `version` (Design decisions #7) and both missing sections added.

No scope change: still base-currency-only, still no report builder/
scheduler/Cash-Flow-Statement, still a single-plugin Core/plugin split.
Re-requesting review against this revision.
