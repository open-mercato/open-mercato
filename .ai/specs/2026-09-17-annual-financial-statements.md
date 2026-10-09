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
>
> **Update (2026-09-28):** `2026-09-16-tax-management.md` has now also
> completed that same move, after its own PR #6168 review — its
> `financial_pl` half is now
> `.ai/specs/SPEC-011-2026-09-16-tax-management-financial-pl.md` in
> `official-modules#55`; `2026-09-16-tax-management.md` itself now covers
> only the Core `tax_management` framework. Two of the three siblings this
> document names have completed the split; this document's own
> `financial_pl` half still hasn't.

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
convention), a disclosure-only input for the board resolution's (uchwała) outcome
(profit distribution, or loss coverage when the year ended in a loss;
Design decisions #4), and a same-net-result check between RZiS's two
variants (porównawczy/by-nature, zespół 4; kalkulacyjny/by-function, zespół
5) — literature-grounded via Kieso's own IAS 1 nature-vs-function
discussion, and already structurally guaranteed in this project by Posting
Rules Engine's zespół 4→5 mirroring through account 490. Phase 1 supports **calendar fiscal years only** (Design decisions #5a).
Every account's own balance is attributed to a Bilans/RZiS line **per leaf
account and per Wn/Ma side**, so a settlement account with a debit child and
a credit child reports both gross amounts, not their difference (Design
decisions #2). Two integrity checks run before any statement is returned —
Aktywa razem = Pasywa razem, and Bilans "Zysk (strata) netto" = RZiS net
result (Design decisions #3b) — and each line carries a prior-year
comparative amount (Design decisions #8). Statement
generation requires the last `FiscalPeriod` to be locked and a `CLOSING`
entry dated inside it. Locking through `posting_rules.lockFiscalPeriod` is
the intended path, because that command refuses to lock a period with
unreclassified zespół-4→5 entries; `ledger.lockFiscalPeriod` can still be
called directly and skips that guard, so the two-variant parity check is
the backstop (Design decisions #5).

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

> **Second-round review (2026-10-09).** A second specification review of
> this PR (`@adeptofvoltron`, at `c7ac9ffcb`) found seven further major
> gaps and two minor ones. The most consequential: the first round's
> "mapped accounts form an antichain" rule read a parent's rolled-up *net*
> figure, which loses one side of a settlement account (Design decisions
> #2, rewritten); fiscal-year identity and the trial balance's
> calendar-YTD basis were never reconciled (#5a, new); nothing proved the
> Bilans balances or that its net result equals RZiS's (#3b, new); the
> statutory prior-year column was missing (#8, new); the mapping had no
> create/delete path (#7, rewritten); and `ClosingResolution` was recorded
> but never consumed, with no loss case (#4, rewritten). Items that need an
> accountant's decision are marked **⚠ NEEDS HUMAN CONFIRMATION** where
> they occur. Changelog: 2026-10-09.

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
document: the **board resolution (uchwała zarządu) on profit distribution
or loss coverage** is explicitly *not* a workflow this system runs — per the source
recording, *"Uchwały zarządu (podział zysku itd.) — zawsze załączane jako
PDF, nie generowane przez system"* — it is captured as a single disclosure
record (the resolved allocation). In Phase 1 it feeds **no amount** in
either statement: a year-N resolution is adopted together with approval of
the year-N statements, so it cannot change year-N figures, and the
Statement of Changes in Equity that would roll it forward is out of scope
(Design decisions #4). Kieso's Retained Earnings Statement (Illustration
4.19) treats a board-level dividend/appropriation decision the same way:
external data the statement reports, not a system-computed step.

## Proposed Solution

SPEC-024 §11 ("Financial Statements") mandates the same shape already
used for Tax Management (§10): a thin Core engine plus a country plugin
behind a format interface (`IFinancialStatementFormat`). Two modules:

1. **`financial_statements`** (Core, this repo) — the generic report
   shape only: `ReportFormat`/`ReportSection`/`ReportLine` types (adapted
   from SPEC-024's own sketch — see Design decisions #1 for the one
   correction needed), and two aggregation functions instead of one (see
   Design decisions #0): `buildBalanceSheetData(em, { tenantId, organizationId,
   fiscalPeriodId, lineMappings })`, which reads #6013's `getTrialBalance` `closingBalance`
   column and buckets it per mapping (correct for Bilans, whose accounts
   are permanent), and `buildIncomeStatementData(em, { tenantId, organizationId,
   fiscalPeriodId, lineMappings })`, which reads the same `getTrialBalance` rows' `ytdDebit`/
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
   pattern — and validated as a complete cover of every account that carries a
   balance, per leaf account and side, Design decisions #2), the `ClosingResolution` disclosure record
   capturing the uchwała's outcome (profit distribution or loss coverage)
   and the specific `CLOSING` entry it was computed against (Design
   decisions #4, #5b), and
   `generateAnnualStatements` — the command that requires the fiscal
   year's last `FiscalPeriod` to be locked and a `CLOSING` entry dated in
   it (Design decisions #5: locking through `posting_rules.
   lockFiscalPeriod` is the intended path, with the parity check as
   backstop), reads both through `ledgerBulkReadService` (#6038), applies
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
   once `CLOSING` has run: that is what a closing entry does, by posting
   to the **contrary side** of the account's `normalBalance` for exactly
   its accumulated amount. Worked example: a (credit-normal) revenue
   account posts real turnover of `100` credit for the year (`ytdCredit
   = 100`, `ytdDebit = 0`); `CLOSING` zeroes it by **debiting** it `100`
   (`ytdDebit` becomes `100`); `closingBalance = ytdCredit − ytdDebit =
   100 − 100 = 0`. A (debit-normal) expense account posts real turnover
   of `60` debit (`ytdDebit = 60`); `CLOSING` zeroes it by **crediting**
   it `60` (`ytdCredit` becomes `60`); `closingBalance = ytdDebit −
   ytdCredit = 60 − 60 = 0`. A RZiS built from `closingBalance` reports
   `0` revenue and `0` expense for both accounts — passing the
   variant-parity check trivially (`0 == 0`) while the real result was a
   `40` profit. **Fix:** Bilans (permanent accounts — assets, liabilities,
   equity — which `CLOSING` does not zero) keeps reading `closingBalance`,
   via `buildBalanceSheetData`. RZiS reads `ytdDebit`/`ytdCredit` for the
   fiscal year's last `FiscalPeriod`, then subtracts the specific `CLOSING`
   `JournalEntry`'s own lines for that account, on whichever side they
   landed — always the side *contrary* to the account's `normalBalance`,
   never the normal side, since that is definitionally where a closing
   entry posts (fetched by `referenceType`/`id` — a single, cheap,
   one-entry read the command already has to do for Design decisions
   #5's precondition, not a new #6013 query capability) —
   `buildIncomeStatementData`. Continuing the example: the revenue
   account's `ytdDebit` (`100`, entirely `CLOSING`'s contribution — a
   credit-normal account is never legitimately debited by real revenue
   postings) drops to `0`; `ytdCredit` (`100`, real) is untouched; net
   `100 − 0 = 100`. Symmetrically, the expense account's `ytdCredit`
   (`60`, entirely `CLOSING`'s contribution) drops to `0`; `ytdDebit`
   (`60`, real) is untouched; net `60 − 0 = 60`. RZiS net result
   `100 − 60 = 40`, correctly nonzero, and the parity check between
   porównawczy/kalkulacyjny now validates something real rather than two
   zeroes agreeing. This keeps #6013 completely unmodified (its own
   turnover semantics stay correct for ZSiO) — the correction lives
   entirely inside `financial_statements`/`financial_pl`, which already
   read `JournalEntryLine` data cross-module (Architecture). A
   loss-making year (revenue `60`, expense `100`, net `−40`) and a
   profitable year both need a test fixture exercising this subtraction
   (Testing Strategy) — as does the reopen case (Design decisions #5),
   where a superseded `CLOSING` entry and its `REVERSAL` are exact
   mirror-image postings (Kieso, *Intermediate Accounting*, 17e, Ch. 3,
   "Reversing Entries—An Optional Step," p. 3-35 — the section
   introducing Appendix 3B, not the appendix's own worked pages: *"A
   reversing entry is the exact opposite of the adjusting entry made in
   the previous period"*) that net to zero in
   the raw `ytdDebit`/`ytdCredit` sums regardless of which side each
   lands on, leaving exactly the new `CLOSING` entry's own contribution
   to subtract — proven algebraically and asserted as a test case in
   Testing Strategy, not merely claimed.

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
   a derived function — and it is applied per leaf account and per Wn/Ma
   side, with every account's own balance counted exactly once.**
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

   **Correction, second-round review (2026-10-09) — attribution is per leaf
   account and per side, not per mapped node.** The first correction round
   required mapped accounts to form an antichain over `parentAccountId`
   and read each mapped node's rolled-up figure. That rule is wrong in two
   ways. (1) #6013's rows roll descendants up (*"all six
   `TrialBalanceRowDto` figures roll up descendants for a syntetyk row"*),
   so a syntetyk account's figure is the **net** of its children: with
   `200-A` at `600` debit and `200-B` at `50` credit, the syntetyk `200`
   row shows `550` debit and the `50` credit — a payable — disappears into
   a receivable. Polish practice (and the Event Storming brief's "osobno
   per stronę Wn/Ma") presents `600` należności and `50` zobowiązania.
   (2) An antichain forbids the legitimate setup "syntetyk `200` maps to
   należności, but child `200-B` maps to zobowiązania". The rule is
   replaced by the following, applied identically by
   `buildBalanceSheetData` and `buildIncomeStatementData`:

   1. **Traverse the whole trial balance.** Page through every
      `totalPages` of #6013's `getTrialBalance` (`page`/`pageSize`, capped
      at 100 per call), not only the first page.
   2. **Own figure per account.** Work in a single signed space, `Dr − Cr`
      (a `CREDIT`-normal account's normalized figure is negated back using
      its `normalBalance`; Bilans uses `closingBalance`, RZiS uses the
      `CLOSING`-adjusted `ytdDebit − ytdCredit`, Design decisions #0). A
      leaf account's own figure is its figure as is. A syntetyk account
      with children has own figure = its rolled-up figure minus the sum of
      its direct children's rolled-up figures — that is, only what was
      posted directly to the syntetyk account, normally `0`. **⚠ NEEDS
      HUMAN CONFIRMATION:** this relies on #6013's roll-up being exactly
      additive (a syntetyk row equals its own postings plus its direct
      children's rolled-up rows). If #6013 defines the roll-up differently,
      this step changes; confirm against #6013 before implementation.
   3. **Side from the sign of the own figure.** `> 0` is debit-side
      (Wn), `< 0` is credit-side (Ma), `= 0` is skipped (no mapping
      needed). This also settles the Wn/Ma derivation: the side comes from
      the signed own figure, never from the raw numeric sign of a
      normalized column.
   4. **Attribute to the nearest mapped ancestor-or-self** for that
      `(statementCode, side)`: the account's own mapping row if it has one
      for that side, otherwise the closest ancestor's. A mapped child
      overrides its mapped parent for its own figure; a mapped parent and a
      mapped child are both legal. The antichain constraint is dropped.
   5. **Coverage.** If no mapped ancestor-or-self exists for an account
      that has a non-zero own figure, generation fails with `409
      MAPPING_INCOMPLETE` naming every uncovered `(accountId, side,
      statementCode)` — never silently dropped.
   6. **No double count.** Each account's own figure lands on exactly one
      side of exactly one line, and own figures partition the total, so a
      parent and its child can never both contribute the same amount.

   Worked settlement example: syntetyk `200` is mapped Wn → "Należności z
   tytułu dostaw i usług", Ma → "Zobowiązania z tytułu dostaw i usług";
   `200-A` has `600` debit, `200-B` has `50` credit, `200` itself has no
   direct postings. Rolled-up `200` shows `550` debit, but its own figure
   is `550 − (600 − 50) = 0`; `200-A`'s `600` debit inherits the Wn
   mapping, `200-B`'s `50` credit inherits the Ma mapping. Result: należności
   `600`, zobowiązania `50` (Aktywa and Pasywa both `100` larger than the
   net-based reading, which is the correct gross presentation), not one
   `550` receivable.
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
3b. **Two integrity checks run before any statement is returned: the Bilans
   balances, and its net result equals RZiS's.** (Added in second-round
   review, 2026-10-09 — the first draft checked only RZiS-variant parity,
   which says nothing about whether the Bilans itself is arithmetically
   sound.) After `computeDerivedTotals`, `generateAnnualStatements`
   asserts:

   1. **Aktywa razem = Pasywa razem.** Failure is `422
      BALANCE_SHEET_UNBALANCED` with `{ aktywa, pasywa, difference }`. With
      full coverage (Design decisions #2) the usual causes are a balance
      mapped to the wrong side's section, or a mis-signed template line.
      An incomplete `CLOSING` is caught earlier: a zespół 4-7 account that
      still carries a balance has no Bilans mapping and fails coverage
      with `409`.
   2. **Bilans "Zysk (strata) netto" = RZiS net result.** Failure is `422
      NET_RESULT_MISMATCH` with both figures. The Bilans figure is the
      mapped result-account balance (e.g. account 860 after `CLOSING`),
      the RZiS figure is the derived total line, so the check proves
      `CLOSING` transferred exactly the year's result.

   Both checks also run on the prior-year column when it is available
   (Design decisions #8) and report `scope: 'previous_year'` on failure.
   As with the parity check, a 422 still returns the statements for
   debugging.

   **Golden year (also the regression fixture, Testing Strategy).** Opening
   entry Dr `130` bank `1000` / Cr `801` capital `1000`; sale on credit Dr
   `200-A` `600` / Cr revenue `600`; advance from another customer Dr
   `130` `50` / Cr `200-B` `50`; services bought Dr `402` `350` / Cr
   `130` `350`; `CLOSING` Dr revenue `600` / Cr `860` `600`, and Dr `860`
   `350` / Cr `402` `350`. Closing balances: `130` Dr `700`, `200-A` Dr
   `600`, `200-B` Cr `50`, `801` Cr `1000`, `860` Cr `250`. Bilans Aktywa
   `700 + 600 = 1300`, Pasywa `1000 + 250 + 50 = 1300`; RZiS revenue
   `600`, costs `350`, net result `250` = the Bilans "Zysk (strata) netto".

4. **The board resolution (uchwała) is a disclosure record, not a
   workflow, and nothing in this module consumes it for an amount.**
   Confirmed directly by the source recording: uchwała documents are
   "zawsze załączane jako PDF, nie generowane przez system."
   `ClosingResolution` stores the resolved allocation plus an optional
   attachment reference to the PDF — no approval states, no generation
   logic. (Second-round review: the first draft recorded the resolution
   and then never said what read it.) The definition is now explicit:

   - **Disclosure-only in Phase 1.** The year-N resolution is adopted
     *after* year N's books are closed, so it cannot change year-N
     amounts: year N's Bilans keeps showing the result on the result
     account, and the distribution appears in year N+1's books (outside
     this document). `generateAnnualStatements` returns the current
     `ClosingResolution` next to the statements and the UI renders it as a
     note; **no amount on any `ReportLine` is derived from it**, and
     this module posts nothing, so there is no way to apply it twice.
   - **Statement of changes in equity is out of scope** (Out of scope), so
     there is no consumer that would roll the allocation forward today;
     when that statement is specified, it reads `ClosingResolution` and is
     the first real consumer. This mirrors Kieso's Retained Earnings
     Statement (Illustration 4.19), where the dividend/appropriation split
     is external, board-decided data the statement rolls forward, not
     something the statement computes.
   - **Two shapes, chosen by the sign of the net result.** Profit:
     `retainedEarnings`, `dividends`, `supplementaryCapital`, each `≥ 0`,
     summing to the profit. Loss: `lossCoveredFromCapital` and
     `lossCarriedForward`, each `≥ 0`, summing to the absolute loss. The
     server derives the shape from `netResult`; the wrong shape is `400
     RESOLUTION_SHAPE_MISMATCH`, and a zero result needs no resolution
     (`400 NOTHING_TO_RESOLVE`). **⚠ NEEDS HUMAN CONFIRMATION:** the loss
     categories (covered from reserve/supplementary capital versus carried
     forward as "strata z lat ubiegłych") are the usual Polish options but
     need an accountant's confirmation, as does whether a dedicated
     "pokrycie ze zysków lat przyszłych" bucket is required.
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
   generation to check `FiscalPeriod.isLocked` reuses that gate where it
   was used, but it does **not** guarantee it: Posting Rules Engine's own
   invariant 4 states that locking through `ledger.lockFiscalPeriod`
   directly bypasses the reconciliation guard by design, so a locked period
   is not proof that zespół 4→5 was reconciled (corrected 2026-10-08; this
   paragraph earlier said "locked, by construction, only through that
   command"). The preconditions are therefore: period locked, a `CLOSING`
   entry dated within it, and the existing two-variant net-result parity
   check as the backstop for a period locked without the guard.
   Accounting-domain confirmation that the parity check is enough is still
   needed. State is read through `ledgerBulkReadService.getFiscalPeriod`
   and `findClosingEntries` (#6038), not through the entities or HTTP.
   `generateAnnualStatements` reads the trial balance *as
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

5a. **Fiscal-year identity: Phase 1 supports calendar fiscal years only, and
    the command resolves the year explicitly.** (Added in second-round
    review, 2026-10-09 — the first draft said "the fiscal year's last
    `FiscalPeriod`" without defining a fiscal year, while #6013's
    `ytdDebit`/`ytdCredit` are calendar-year-to-date.) Definitions:

    - **Fiscal year** = the calendar year of a period's `startDate`.
      `generateAnnualStatements` accepts any `fiscalPeriodId` of the year
      and normalizes to the year's **last period** = the one containing
      Dec 31; that id is returned and is the one `ClosingResolution`
      stores.
    - **Guard.** The year's periods (all `FiscalPeriod` rows whose
      `startDate` falls in that calendar year) must tile Jan 1 – Dec 31
      without gaps or overlaps. Otherwise `409 FISCAL_YEAR_NOT_CALENDAR`
      naming the offending period. This is why #6013's calendar-YTD
      columns are sufficient: for a calendar year, the last period's YTD
      *is* the fiscal year's turnover.
    - **Non-calendar fiscal years** (e.g. Jul–Jun) are out of scope
      (Out of scope): they would need either a fiscal-year-aware YTD in
      #6013 or a per-period summation here.
    - **⚠ NEEDS HUMAN CONFIRMATION:** enumerating a year's periods needs a
      `ledgerBulkReadService.listFiscalPeriods({ from, to })` method;
      #6038 currently exposes only `getFiscalPeriod` by id. This document
      assumes that method is added to #6038 (same posture as the
      `getFiscalPeriod`/`findClosingEntries` additions of 2026-10-08).

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
   numbers. Requires the same `financial_pl_accounting.statements.manage` scope as
   generation; no separate export permission for Phase 1.
7. **`StatementLineMapping` is a full create/read/update/delete settings
   entity, with the project's canonical `updatedAt`-based optimistic lock
   on update — not a bespoke `version` column.** (Second-round review: the
   first draft exposed only `GET` and `PUT`, yet the mapping starts empty
   and 409s generation until it is filled, so there was no way to create
   or remove a row.)

   *Concurrency.* Root `AGENTS.md`'s "Always" section makes optimistic
   locking default ON via each entity's `updated_at`, with `CrudForm`
   deriving the conflict header from `initialValues.updatedAt` and
   rendering `409`s through `surfaceRecordConflict`. `StatementLineMapping`
   therefore carries no `version` column. (History: the 2026-09-21 first
   pass invented a `version` int on the claim that `PostingRulesSettings`/
   `TaxCodeAccountMapping` use one; `financial-spec-citation-check` found
   both entities are `{ …, updatedAt }` only — right precedent, wrong
   field — and it was corrected.)

   *Create/update/delete.* The route is `makeCrudRoute` with all four
   methods, each backed by a command so validation and undo live in one
   place (`commands/statementLineMappings.ts`:
   `createStatementLineMapping`, `updateStatementLineMapping`,
   `deleteStatementLineMapping`). The earlier "no cross-row validation, so
   no command" argument held only for editing a `lineCode`; create and
   delete do need validation:

   - `accountId` must resolve **live** — exists, not soft-deleted, same
     `tenantId`/`organizationId` as the caller — through the ledger's
     account read surface (`ledgerBulkReadService.listAccounts`, #6038),
     never trusted from the body (`financial-command-implementation-
     checklist` §2).
   - `side` and `statementCode` are checked against their enums, and
     `lineCode` must exist in the target template (`bilansTemplate.ts` /
     `rzisTemplate.ts`) for that `statementCode` and must be a leaf line
     (an `isTotal` line takes no mapping).
   - A live row with the same `(tenantId, organizationId, accountId, side,
     statementCode)` is `409 MAPPING_DUPLICATE`.
   - `accountId`, `side` and `statementCode` are immutable on update
     (`PUT` changes only `lineCode`); moving a mapping is delete + create.
   - Delete is a **soft delete** (`deletedAt`); the unique constraint is a
     partial unique index over live rows, so a deleted mapping can be
     re-created. Deleting a row that past statements used has no effect on
     them — statements are generated on demand, not stored — so there is
     nothing to block.

   Each command logs through the command bus (audit/undo), consistent with
   the GL commands. `GET` is `makeCrudRoute`'s stock `list`.

8. **Prior-year comparatives are part of the statement, not an add-on.**
   (Added in second-round review, 2026-10-09 — Załącznik nr 1 requires the
   preceding year's amount beside each current amount; the first draft
   returned a single year.) `ReportLine` gains `previousAmount: number |
   null`. The same aggregation functions (Design decisions #2), run with
   the **same** `StatementLineMapping` rows, are evaluated a second time
   for the prior fiscal year: Bilans against the prior year's last period
   `closingBalance`, RZiS against the prior year's last-period turnover
   with *its own* `CLOSING` entry subtracted (Design decisions #0).
   `computeDerivedTotals` totals `previousAmount` independently with the
   same `sign` coefficients, and the Design decisions #3b checks run on
   it too. The response carries `comparative`:

   - `{ available: true }` when a prior year exists and is closed.
   - First year of operation (no prior fiscal period): every
     `previousAmount` is `null` and `comparative: { available: false,
     reason: 'first_year' }` — this is not an error.
   - Prior year exists but its last period is unlocked or has no `CLOSING`
     entry: `previousAmount` is `null` and `comparative: { available:
     false, reason: 'prior_year_not_closed' }` plus a warning in the UI.
     **⚠ NEEDS HUMAN CONFIRMATION:** warn-and-continue versus block
     generation; a statutory filing without a comparative is usually
     wrong, so an accountant may prefer a hard `409`.
   - A prior year that exists and is closed but fails the calendar guard
     or mapping coverage is `409` (same codes, `scope: 'previous_year'`),
     because a silently missing column would be worse than a stop.
   - Mapping is **not versioned**: the prior-year column is restated on the
     *current* mapping, which is the usual comparative-restatement
     behavior; a mapping change that alters last year's line totals is
     visible and expected.

## Architecture

### `financial_statements` (Core, this repo)

- `packages/core/src/modules/financial_statements/data/types.ts` — `ReportFormat`,
  `ReportSection`, `ReportLine` (`{ code, name, style, sign: 1 | -1,
  isTotal?: boolean, amount, previousAmount: number | null }`, per Design
  decisions #1/#1b/#8), `Disclosure` (unused in Phase 1; kept for
  shape-compatibility with SPEC-024 §2.4 so a future country plugin's
  Notes-to-Statements section has somewhere to land).
- `packages/core/src/modules/financial_statements/lib/buildBalanceSheetData.ts` —
  `buildBalanceSheetData(em, { tenantId, organizationId, fiscalPeriodId,
  lineMappings: { accountId, side: 'debit' | 'credit', lineCode }[] })`.
  `tenantId`/`organizationId` are the caller's resolved scope (the
  command passes the selected organization, not the user's home org) and
  are forwarded to every read. Calls #6013's `getTrialBalance` internally
  (direct in-process read — GL/GL-balances are both upstream of this
  module, consistent with the established one-way dependency direction),
  pages through every `totalPages`, computes each account's own `Dr − Cr`
  figure from its `closingBalance` (leaf as is; syntetyk with children
  minus its direct children's rolled-up figures), takes the side from the
  sign, attributes the amount to the nearest mapped ancestor-or-self for
  that side, fails with the uncovered `(accountId, side)` list when none
  exists (all per Design decisions #2), and returns `{ lineCode, amount }[]`.
  Pure aggregation, no formatting, no I/O beyond the read.
- `packages/core/src/modules/financial_statements/lib/buildIncomeStatementData.ts`
  — `buildIncomeStatementData(em, { tenantId, organizationId,
  fiscalPeriodId, lineMappings })`: same signature, pagination,
  per-leaf/per-side attribution and coverage behavior as
  `buildBalanceSheetData`, but the per-account figure is the fiscal year's
  last-`FiscalPeriod` `ytdDebit − ytdCredit` after subtracting the fiscal
  year's `CLOSING` `JournalEntry`'s own per-account lines (a single, cheap
  read by `referenceType`/`id`, not a new #6013 query), Design decisions
  #0. This is the RZiS-only aggregation function; it must never be used
  for Bilans lines.
- `packages/core/src/modules/financial_statements/lib/computeDerivedTotals.ts` —
  `computeDerivedTotals(sections: ReportSection[]): ReportSection[]`. Pure
  function; sums each section's leaf `ReportLine.amount * sign` (and, independently,
  `previousAmount * sign` where non-null) into that
  section's `isTotal` line(s), per the template's own structure (Design
  decisions #1b). No trial-balance read of its own — runs after
  `buildBalanceSheetData`/`buildIncomeStatementData` have populated leaf
  amounts.
- `index.ts` — `requires: ['ledger']`, no ACL of its own (this module
  exposes no route or command; `financial_pl` is the only caller).

### `financial_pl_accounting` (Poland plugin, `official-modules`; target package, see the 2026-10-08 changelog entry)

- `data/entities.ts` — `StatementLineMapping` (tenant settings,
  nullable/no-default, per Design decisions #2; concurrent-edit
  protection via its own `updated_at` column, per Design decisions #7 —
  no extra `version` field), `ClosingResolution` (per fiscal period
  **and** `closingEntryId`, per Design decisions #4/#5b).
- `lib/bilansTemplate.ts` / `lib/rzisTemplate.ts` — the fixed Załącznik
  nr 1 line structures (section codes/names/order/`sign`/`isTotal`, per
  Design decisions #1b), independent of any tenant's actual chart.
- `lib/exportStatementAdapter.ts` — `exportStatementDocument(reportFormat,
  format)` (Design decisions #6), reusing #6038's per-format
  serialization utilities against a rendered `ReportFormat` rather than
  #6038's own audit-row query.
- `commands/generateAnnualStatements.ts` — input `{ fiscalPeriodId }`
  (any period of the year; normalized to the year's last period, Design
  decisions #5a); `tenantId`/`organizationId` come from the request's
  resolved organization scope, never the body. Preconditions: the year is
  a calendar year (Design decisions #5a), its last `FiscalPeriod` is locked
  (`posting_rules.lockFiscalPeriod` is the intended path, Design decisions
  #5), a `CLOSING` entry is dated within it, and every account with a
  non-zero own figure is covered per leaf and side (Design decisions #2).
  Calls `buildBalanceSheetData` (Bilans mapping) and
  `buildIncomeStatementData` (each RZiS variant's mapping) for the year
  and, when a closed prior year exists, again for it (Design decisions #8)
  — never the other function for the wrong statement (Design decisions #0)
  — then `computeDerivedTotals` on each rendered set of sections, then the
  checks in order: variant parity (Design decisions #3), Aktywa = Pasywa
  and Bilans net result = RZiS net result (Design decisions #3b). Returns
  the three rendered `ReportFormat` documents, the `comparative` status,
  the check results, and the current `CLOSING` entry's `ClosingResolution`
  if one exists (disclosure only, Design decisions #4/#5b).
- `commands/recordClosingResolution.ts` — input `{ fiscalPeriodId,
  attachmentRef? }` plus the shape-specific amounts (profit:
  `retainedEarnings`, `dividends`, `supplementaryCapital`; loss:
  `lossCoveredFromCapital`, `lossCarriedForward`, Design decisions #4);
  resolves the year's current `CLOSING` entry and its `computeDerivedTotals`-
  derived RZiS net result, validates the shape matches the result's sign and
  the amounts sum to its absolute value, and writes `ClosingResolution`
  keyed to that `closingEntryId` with the `netResult` it was validated
  against (Design decisions #5b) — `409` if a resolution already exists for
  that specific `closingEntryId` (a genuinely new `CLOSING` entry, from a
  reopen, is a new key, not a conflict). Records a disclosure only; it
  posts nothing.
- `commands/statementLineMappings.ts` — `createStatementLineMapping`,
  `updateStatementLineMapping`, `deleteStatementLineMapping` (soft delete),
  with the live-account, enum, template-line and duplicate validation of
  Design decisions #7.
- `api/statements/route.ts` — `POST /generate` (invoke
  `generateAnnualStatements`) and `POST /closing-resolution` (invoke
  `recordClosingResolution`). There is no `GET` list: statements are
  generated on demand and not stored (Design decisions #7), so there is no
  generated-statement entity to list. Both writes are custom routes, not
  `makeCrudRoute` (each wraps cross-entity validation — lock/coverage
  state, or the resolution-sum check — not plain field persistence), so
  per `packages/core/AGENTS.md` → API Routes both **must** wire the
  mutation guard registry before running: collect
  `getAllMutationGuardInstances()` (+ `bridgeLegacyGuard`), call
  `runMutationGuards(...)` mapped to the closest registry operation
  (`update` — both are state-changing actions on existing fiscal-period
  state, not creation of a free-standing resource), and return
  `guardResult.errorBody`/`errorStatus` when blocked. Metadata:
  `requireAuth: true`, `requireFeatures:
  ['financial_pl_accounting.statements.manage']`; both export `openApi`.
- `api/statement-line-mapping/route.ts` — `GET` (list), `POST` (create),
  `PUT /:id` (update `lineCode`) and `DELETE /:id` (soft delete) via
  `makeCrudRoute`, each mutation backed by its command in
  `commands/statementLineMappings.ts` (Design decisions #7). `indexer`
  omitted — these rows are tenant settings, never surfaced through
  global/query-engine search, same justification #6013 and Posting Rules
  Engine's own settings entities use. `update` gets the CRUD factory's
  default-ON `updatedAt`-based optimistic lock (Design decisions #7); list
  results are grouped by zespół client-side for the settings UI. Same
  metadata/`openApi` requirements as above.
- `backend/financial-pl-accounting/statements/page.tsx` — read-only Bilans/RZiS
  view (rendered from the returned `ReportFormat`), a `StatementLineMapping`
  admin page (create, edit and delete; `CrudForm`'s stock conflict bar on a `409`, "someone else
  edited this row, reload" — no bespoke conflict code), and the
  `ClosingResolution` entry form — export via
  `lib/exportStatementAdapter.ts` (Design decisions #6) rather than
  #6038's raw audit exporter.

## Data Model

### `StatementLineMapping` (`financial_pl_accounting`)

`{ id, tenantId, organizationId, accountId (FK-id → ledger.LedgerAccount),
side ('debit'|'credit'), statementCode ('bilans'|'rzis_porownawczy'|
'rzis_kalkulacyjny'), lineCode (string, a leaf line code of the target
template), createdAt, updatedAt, deletedAt (nullable) }`. `updatedAt` is
this row's concurrent-edit protection (Design decisions #7 — the
project's default-ON optimistic lock, not a bespoke `version` field).
Nullable/no-default: a mapping may exist for any account, but generation
needs, for every account with a non-zero own figure on a given side, a row
on that account or on its nearest mapped ancestor (Design decisions #2).
Mapping both a parent and its child is legal — the child overrides the
parent for its own figure — so no overlap check exists. Uniqueness is a
**partial unique index** on `(tenantId, organizationId, accountId, side,
statementCode) WHERE deletedAt IS NULL`, so a soft-deleted mapping can be
re-created.

### `ClosingResolution` (`financial_pl_accounting`)

`{ id, tenantId, organizationId, fiscalPeriodId (FK-id → FiscalPeriod, the
fiscal year's last period, Design decisions #5a), closingEntryId (FK-id →
ledger.JournalEntry, the specific `CLOSING` entry this resolution was
computed against — Design decisions #5b), netResult (decimal, signed — the
RZiS net result it was validated against, so a later view can show what the
resolution answered), resolutionKind ('profit_distribution' |
'loss_coverage'), retainedEarnings, dividends, supplementaryCapital
(decimals, set for `profit_distribution`, otherwise null),
lossCoveredFromCapital, lossCarriedForward (decimals, set for
`loss_coverage`, otherwise null), attachmentRef (string, nullable — a
document/file reference, not a workflow state), recordedBy, recordedAt }`.
For a profit, the three profit amounts are each `≥ 0` and sum to
`netResult`; for a loss, the two loss amounts are each `≥ 0` and sum to
`−netResult` (validated in the command, not a DB constraint, since it needs
the full aggregation to check; Design decisions #4). The record is a
disclosure: no amount in any statement is derived from it. Unique on
`(tenantId, organizationId, fiscalPeriodId, closingEntryId)` — no longer
unique on `fiscalPeriodId` alone (Design decisions #5b): a reopen produces
a new `closingEntryId`, and its own resolution is a new row, not a rejected
duplicate.

## API Contracts

(Canonical-mechanism note, added in this compliance pass —
`packages/core/AGENTS.md` → API Routes: every route below exports
`openApi`, every route's metadata is `requireAuth: true,
requireFeatures: ['financial_pl_accounting.statements.manage']`. `generate` and
`closing-resolution` are custom write routes wired through the
mutation guard registry — Architecture, `api/statements/route.ts` —
because each carries cross-entity validation `makeCrudRoute` doesn't
express; `statement-line-mapping`'s four methods are `makeCrudRoute`
handlers backed by commands, Design decisions #7. Tenant and organization
scope are always resolved from the request (`resolveOrganizationScopeForRequest`,
selected organization), never accepted from the body.)

### `POST /api/financial-pl-accounting/statements/generate`

- **Body**: `{ fiscalPeriodId: string }` — any period of the fiscal year;
  the response's `fiscalPeriodId` is the year's last period (Design
  decisions #5a).
- **Response 200**: `{ fiscalYear, fiscalPeriodId, closingEntryId, bilans:
  ReportFormat, rzisPorownawczy: ReportFormat, rzisKalkulacyjny:
  ReportFormat, comparative: { available: true } | { available: false,
  reason: 'first_year' | 'prior_year_not_closed' }, integrity: {
  balanceSheet: { aktywa, pasywa, balanced }, netResult: { bilans, rzis,
  matches } }, netResultParity: { porownawczy: number, kalkulacyjny:
  number, matches: boolean }, closingResolution: ClosingResolution | null
  }`. Every `ReportLine` carries `amount` and `previousAmount` (`null`
  when `comparative.available` is `false`).
- **Response 409** (statements are not produced; body carries a `code`):
  `PERIOD_NOT_LOCKED` or `CLOSING_ENTRY_MISSING` (Design decisions #5),
  `FISCAL_YEAR_NOT_CALENDAR` (Design decisions #5a),
  `MAPPING_INCOMPLETE` with `uncovered: [{ accountId, side, statementCode
  }]` (Design decisions #2), or the mutation guard registry blocks the
  call (`guardResult.errorBody`/`errorStatus`). A closed prior year that
  fails the calendar guard or coverage returns the same codes with `scope:
  'previous_year'` (Design decisions #8).
- **Response 422** (statements are still returned for debugging, flagged):
  `NET_RESULT_PARITY_MISMATCH` (Design decisions #3),
  `BALANCE_SHEET_UNBALANCED`, `NET_RESULT_MISMATCH` (Design decisions #3b);
  each failing check names its figures, and `scope: 'previous_year'` when
  it failed on the comparative column.
- **Response 403**: caller lacks `financial_pl_accounting.statements.manage`.

### `GET /api/financial-pl-accounting/statement-line-mapping`

- **Query**: `page?`, `pageSize?` (≤ 100; mirrors #6013's `getTrialBalance`
  pagination contract and `makeCrudRoute`'s stock list-query shape),
  `statementCode?`, `accountId?`.
- **Response 200**: `{ rows: StatementLineMapping[], page, pageSize, total, totalPages }` (live rows only).
- **Response 403**: caller lacks `financial_pl_accounting.statements.manage`.

### `POST /api/financial-pl-accounting/statement-line-mapping`

- **Body**: `{ accountId, side, statementCode, lineCode }`.
- **Response 201**: the created `StatementLineMapping`.
- **Response 400**: invalid enum; `lineCode` not a leaf line of
  `statementCode`'s template; `accountId` not found, soft-deleted, or in
  another tenant/organization (Design decisions #7).
- **Response 409**: `MAPPING_DUPLICATE` — a live row exists for
  `(accountId, side, statementCode)`.
- **Response 403**: caller lacks `financial_pl_accounting.statements.manage`.

### `PUT /api/financial-pl-accounting/statement-line-mapping/:id`

- **Body**: `{ lineCode }` only (`accountId`, `side`, `statementCode` are
  immutable), plus the caller's optimistic-lock header derived from the
  row's `updatedAt` (`CrudForm`'s stock behavior — Design decisions #7, no
  `version` field in the body).
- **Response 200**: the updated `StatementLineMapping`.
- **Response 400**: `lineCode` not a leaf line of the row's `statementCode`.
- **Response 404**: no live row with that id in the caller's scope.
- **Response 409**: `updatedAt` doesn't match the current row —
  `makeCrudRoute`'s standard optimistic-lock conflict body (current
  record echoed back), surfaced by `surfaceRecordConflict`; no
  bespoke `MAPPING_VERSION_CONFLICT` code.
- **Response 403**: caller lacks `financial_pl_accounting.statements.manage`.

### `DELETE /api/financial-pl-accounting/statement-line-mapping/:id`

- **Response 200**: `{ ok: true }` — soft delete (`deletedAt` set).
- **Response 404**: no live row with that id in the caller's scope.
- **Response 403**: caller lacks `financial_pl_accounting.statements.manage`.

### `POST /api/financial-pl-accounting/statements/closing-resolution`

- **Body**: `{ fiscalPeriodId, attachmentRef? }` plus, for a profit,
  `{ retainedEarnings, dividends, supplementaryCapital }` or, for a loss,
  `{ lossCoveredFromCapital, lossCarriedForward }` (Design decisions #4).
- **Response 200**: the created `ClosingResolution` (`closingEntryId`,
  `netResult` and `resolutionKind` resolved server-side from the year's
  current `CLOSING` entry, Design decisions #5b).
- **Response 400**: `RESOLUTION_SHAPE_MISMATCH` (profit fields sent for a
  loss or vice versa), `NOTHING_TO_RESOLVE` (net result is zero), or the
  amounts don't sum to the absolute net result.
- **Response 403**: caller lacks `financial_pl_accounting.statements.manage`.
- **Response 409**: a `ClosingResolution` already exists for this
  `(fiscalPeriodId, closingEntryId)` pair (immutable once recorded for
  that specific closing revision — a correction after a reopen targets a
  new `closingEntryId` and is a new record, not an edit, consistent with
  `TaxLiabilityRecord`'s own "a `TaxLiabilityRecord` posts once; a
  correction is a new" record precedent
  [`.ai/specs/2026-09-16-tax-management.md`, PR #6168], Design decisions
  #5b), or the mutation guard registry blocks the call
  (`guardResult.errorBody`/`errorStatus`, Architecture →
  `api/statements/route.ts`).

## Internationalization (i18n)

(Added — the original draft named no i18n keys at all, an om-spec-writing
checklist §5 requirement.) `financial_pl`'s own UI strings (the
statements page's labels, the mapping settings page's column headers,
error banners, the `409`/`422` user-facing messages) go through this project's standard `useT()` (client)/
`resolveTranslations()` (server) mechanism, keyed under a
`financial_pl_accounting.statements.*` namespace — never hard-coded Polish/English
strings in components. `bilansTemplate.ts`/`rzisTemplate.ts`'s actual
statutory line *names* ("Aktywa trwałe," "Przychody netto ze sprzedaży,"
etc.) are Poland-specific legal text, not translatable UI copy — they
render as-is regardless of the viewer's locale, the same way a US GAAP
line item wouldn't be translated for a Polish plugin (this mirrors Tax
Management's own treatment of statutory Polish tax-form field names).
Only the *chrome* around those fixed statutory lines (page titles,
button labels, validation messages) is a translation key.

## UI/UX

(Canonical-mechanism note, added in this compliance pass —
`packages/ui/AGENTS.md`: "`<CrudForm>` for backend writes; `<DataTable>`
for lists." Both surfaces below follow that split; every mutating call
not made through `CrudForm` goes through `useGuardedMutation(...)
.runMutation(...)` wrapping `apiCall()`, per root `AGENTS.md` → UI &
HTTP, surfacing the route's `409`/`422`/`400` bodies as the inline
banners/messages described here.)

- `backend/financial-pl-accounting/statements/page.tsx` — a fiscal-period picker, a
  "Generate" action (`useGuardedMutation` wrapping `apiCall('/generate')`
  — no list/detail entity of its own, so not a `CrudForm` case), and,
  once generated, two read-only report views (Bilans, RZiS — with a
  toggle between porównawczy/kalkulacyjny) rendered from `ReportFormat`'s
  sections/lines (subtotal/total lines rendered distinctly, per
  `isTotal`, Design decisions #1b), plus "Export PDF"/"Export Excel"
  buttons wired to `lib/exportStatementAdapter.ts` (Design decisions #6,
  not #6038's raw audit exporter directly). A prior-year column beside each amount when `comparative.available` (a
  muted note with the reason otherwise; Design decisions #8), a visible
  banner if `netResultParity.matches` is `false` or an integrity check
  fails (Design decisions #3b), and a separate banner if the
  current `CLOSING` entry has no `ClosingResolution` yet (Design
  decisions #5b) versus one carried over from a now-superseded closing
  revision. The `ClosingResolution` entry form embedded here (below) is
  the page's one `CrudForm` usage.
- `backend/financial-pl-accounting/statement-line-mapping/page.tsx` — a `DataTable`
  listing one row per `(account, side, statement)`, grouped by zespół
  for discoverability (reusing the flat, sorted-by-code presentation
  #6013 already established for its own trial-balance `DataTable` — its
  own Design Logic notes `DataTable` has no tree/indentation rendering
  today, so neither this table nor #6013's attempts one). Each row's
  edit action opens a `CrudForm` dialog for the single `lineCode` field;
  `CrudForm` auto-derives its optimistic-lock header from the row's
  `updatedAt` and renders the framework's own conflict bar — "someone
  else edited this row, reload" — on a `409` (Design decisions #7; no
  hand-written version-conflict UI). A coverage panel lists every
  account with a non-zero balance whose `(account, side)` has no mapped row
  or mapped ancestor (Design decisions #2), so gaps are visible before the
  accountant attempts generation. The page also offers Create (`CrudForm`)
  and Delete (confirm dialog, soft delete) for mapping rows (Design
  decisions #7).
- Closing-resolution entry: a small form on the same statements page
  (for a profit, three amount fields that must sum to the displayed profit;
  for a loss, two that must sum to the loss — the form shows the shape
  matching the sign of the net result, and renders a recorded resolution as
  a disclosure note, Design decisions #4 — plus an optional attachment
  upload) rather than a separate page — it's a
  single record per `(fiscalPeriodId, closingEntryId)` pair, not a list
  (Design decisions #5b).

## Edge Cases & Failure Scenarios

- **Account with a balance but no mapping for the side it sits on.**
  `generateAnnualStatements` returns `409 MAPPING_INCOMPLETE` naming every
  uncovered `(accountId, side, statementCode)` (Design decisions #2), rather
  than silently omitting the amount (a Bilans/RZiS that doesn't balance
  because of a silently-dropped account is worse than a blocked
  generation).
- **Settlement account with both a debit and a credit child.** Reported
  gross: the debit child's amount on the Wn line, the credit child's on the
  Ma line (Design decisions #2, worked example), never the net.
- **Parent mapped Wn → należności, child mapped Ma → zobowiązania.** Legal:
  the child's own figure follows the child's mapping; the parent's own
  figure (usually zero) follows the parent's.
- **Non-calendar fiscal year, or periods with a gap/overlap.** `409
  FISCAL_YEAR_NOT_CALENDAR` (Design decisions #5a).
- **First fiscal year / prior year not yet closed.** `previousAmount` is
  `null` and the reason is returned in `comparative` (Design decisions #8);
  an unclosed prior year is a UI warning, with the block-vs-warn choice
  pending confirmation.
- **Aktywa ≠ Pasywa, or Bilans net result ≠ RZiS net result.** `422`, both
  figures in the body, statements still returned (Design decisions #3b).
- **Loss-making year.** The resolution takes the loss shape (Design
  decisions #4); a profit-shaped payload is `400 RESOLUTION_SHAPE_MISMATCH`.
- **A mapping row is deleted or its account is renamed/soft-deleted after
  statements were generated.** Nothing stored changes; the next generation
  reflects the current mapping, and a now-uncovered balance returns `409`.
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
  to make (a typo in one of the amount fields) and easy to catch mechanically.
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
  second `PUT` fails `makeCrudRoute`'s standard `updatedAt`-mismatch
  `409` (Design decisions #7); `CrudForm`'s conflict bar reloads the
  current row rather than overwriting it.
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
  banner note under TLDR and Changelog). **The maintainer-review round's
  own fix for mapping-edit concurrency then turned out to have a second,
  self-caught problem**: it invented a DIY `version` column instead of
  this project's canonical `updatedAt`-based optimistic lock, on a
  citation that didn't actually check out under
  `financial-spec-citation-check` — caught and corrected during this
  document's own `om-spec-writing` Compliance Gate pass, not by a
  further external review (Design decisions #7, Changelog "2026-09-21
  (cont.)"). Named here for the same reason this project already records
  other caught-before-implementation mistakes in Risks sections
  elsewhere (e.g., Tax Management's "two prior false starts"): a mistake
  caught in review — including a review catching its own prior review's
  mistake — and fixed in the same document is a process working
  correctly, not something to omit from the record.

- **The second review round re-opened four modelling decisions.** It found
  that the antichain rule reported net instead of gross for settlement
  accounts, that fiscal-year identity and calendar-YTD were never
  reconciled, that no check proved Aktywa = Pasywa, and that the uchwała
  was recorded but never consumed (Changelog 2026-10-09). The rewritten
  rules lean on three external facts this document cannot verify alone:
  #6013's roll-up is additive over direct children (Design decisions #2),
  #6038 gains `listFiscalPeriods` (Design decisions #5a), and the loss-
  coverage categories are right (Design decisions #4). Each is marked
  **⚠ NEEDS HUMAN CONFIRMATION** where used; none is a blocker for the
  spec, all are blockers for implementation.
- **Comparatives are restated on the current mapping.** A tenant editing a
  mapping after filing year N will see a changed year-N column in year
  N+1's statements (Design decisions #8). That is the standard
  restatement behavior and is surfaced, not hidden, but mapping versioning
  is a possible Phase 2 follow-up.

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

- **Keep the antichain constraint, make tenants map leaves only** —
  rejected (second-round review): it forces one mapping row per analytic
  account (hundreds of contractor accounts under `200`) and still cannot
  express a debit child and a credit child under one syntetyk account
  without per-leaf rows; per-side attribution to the nearest mapped
  ancestor (Design decisions #2) keeps the mapping at syntetyk level and
  allows overrides.
- **Let the uchwała change year-N Bilans amounts** (e.g. split the result
  account into retained earnings and dividends payable) — rejected; the
  resolution is adopted after year-N books close, so amounts move in year
  N+1 (Design decisions #4). Showing a pro-forma post-resolution Bilans
  would be a second presentation basis, not a correction.

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

- **Non-calendar fiscal years** — Phase 1 guards and rejects them
  (Design decisions #5a); supporting them needs a fiscal-year-aware YTD in
  #6013 or per-period summation here.
- **Statement of changes in equity** — already listed above; named again
  because it is the first real consumer of `ClosingResolution` (Design
  decisions #4).
- **More than one comparative year, and mapping versioning** — Phase 1
  shows the immediately preceding year, restated on the current mapping
  (Design decisions #8).
- **Posting the profit distribution** — the module records the resolution
  and posts nothing; the entries belong to the next year's books, owned by
  whoever posts them (Design decisions #4).

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
   `ReportSection`/`ReportLine` with `sign`/`isTotal`/`previousAmount`/
   `Disclosure`), `lib/buildBalanceSheetData.ts`,
   `lib/buildIncomeStatementData.ts` (both `(em, { tenantId,
   organizationId, fiscalPeriodId, lineMappings })`, per-leaf/per-side
   attribution), `lib/computeDerivedTotals.ts`, `index.ts` (`requires:
   ['ledger']`).
2. `financial_pl_accounting`: `data/entities.ts` + migration
   (`StatementLineMapping` — `updatedAt` and `deletedAt`, partial unique
   index, no `version` field — and `ClosingResolution` with
   `closingEntryId`, `netResult`, `resolutionKind`, profit/loss columns and
   the revised unique constraint).
3. `financial_pl_accounting`: `lib/bilansTemplate.ts`, `lib/rzisTemplate.ts` (both
   variants, each line's `sign`/`isTotal` set) — the fixed Załącznik nr 1
   line structures.
4. `financial_pl_accounting`: `commands/generateAnnualStatements.ts`
   (calendar-year guard, `posting_rules.lockFiscalPeriod`-gated
   precondition, `CLOSING`-entry lookup and subtraction for RZiS, coverage
   validation, comparative pass, parity and integrity checks),
   `commands/recordClosingResolution.ts` (profit/loss shapes),
   `commands/statementLineMappings.ts` (create/update/delete).
5. `financial_pl_accounting`: `lib/exportStatementAdapter.ts` (Design decisions #6).
6. `financial_pl_accounting`: `acl.ts` (`financial_pl_accounting.statements.manage`),
   `api/statements/route.ts` (custom, mutation-guard-wired, `generate` and
   `closing-resolution` only),
   `api/statement-line-mapping/route.ts` (`makeCrudRoute`, `GET`/`POST`/
   `PUT`/`DELETE`, each backed by its command).
7. `financial_pl_accounting`: `backend/financial-pl-accounting/statements/page.tsx`,
   `backend/financial-pl-accounting/statement-line-mapping/page.tsx` (`DataTable` +
   `CrudForm` create/edit dialog, delete confirm, coverage panel).
8. Testing Strategy (below), including the integration-coverage matrix,
   implemented and passing.
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
- **Settlement account, 10/50 case** (the reviewer's own example): `200-A`
  `10` debit (an overpayment, so a receivable), `200-B` `50` credit; assert
  należności `10` and zobowiązania `50`, not a single `40` liability.
- **Settlement account, both sides** (Design decisions #2): syntetyk `200`
  mapped Wn → należności and Ma → zobowiązania; `200-A` `600` debit,
  `200-B` `50` credit. Assert należności `600` and zobowiązania `50` —
  not a single `550` — and that `200`'s own figure is `0`.
- **Parent debit / child credit with a child override**: parent mapped Wn
  only, child mapped Ma to a different line. Assert each amount lands on
  its own line, each counted once (no double count between parent and
  child).
- **Same-side override**: parent and child both mapped Wn to different
  lines. Assert the child's own figure goes to the child's line, the
  parent's own (direct) figure to the parent's, and the total equals the
  rolled-up figure.
- **Direct postings on a syntetyk account**: post `30` directly to a
  syntetyk account that also has children. Assert its own figure is `30`
  (rolled-up minus children), attributed per its own mapping.
- **Uncovered leaf**: an account with a non-zero balance, no own mapping,
  no mapped ancestor. Assert `409 MAPPING_INCOMPLETE` naming `(accountId,
  side, statementCode)`; a zero-balance unmapped account must not block.
- **Mapping coverage gap across a paginated chart**: a chart of accounts
  exceeding #6013's 100-row page size, with the uncovered account on page
  two. Assert generation still 409s on it (exhaustive traversal, Design
  decisions #2), not just on page-one accounts.
- **Contrary-balance account**: a `DEBIT`-normal account with a negative
  normalized balance (a credit balance). Assert it's bucketed on the
  credit-side line, not the debit-side line a naive numeric-sign read
  would pick.
- **Golden year** (Design decisions #3b): the worked year — Bilans Aktywa
  `1300` = Pasywa `1300`, RZiS `600`/`350`/`250`, Bilans "Zysk (strata)
  netto" `250`; a second fixture with the 4→5 reclassification through
  account 490 gives the same `250` on the kalkulacyjny variant.
- **Integrity failures**: map a liability account to an Aktywa line, assert
  `422 BALANCE_SHEET_UNBALANCED` with both totals; post `CLOSING` that
  transfers a different amount to the result account than the RZiS net,
  assert `422 NET_RESULT_MISMATCH`; both with the statements still
  returned. Repeat on the prior-year column and assert `scope:
  'previous_year'`.
- **Calendar-year guard** (Design decisions #5a): periods with a gap, an
  overlap, and a Jul–Jun year each return `409 FISCAL_YEAR_NOT_CALENDAR`;
  passing a mid-year period id resolves to the year's last period.
- **Comparatives** (Design decisions #8): second-year generation fills
  `previousAmount` from the prior year's own `CLOSING`-adjusted figures;
  first year returns `null` with `reason: 'first_year'`; unclosed prior year
  returns `null` with `reason: 'prior_year_not_closed'`; a prior year
  failing coverage returns `409` with `scope: 'previous_year'`.
- **Loss-making resolution** (Design decisions #4): a loss year accepts the
  two-field shape summing to the loss and rejects the profit shape with
  `400 RESOLUTION_SHAPE_MISMATCH`; a zero result is `400
  NOTHING_TO_RESOLVE`; asserting that recording a resolution changes no
  statement amount and posts no entry.
- Variant-parity pass/fail (existing case, kept): including a
  deliberately-unreconciled-490 fixture — but now asserted at
  `posting_rules.lockFiscalPeriod` time (Design decisions #5), with a
  second assertion that `generateAnnualStatements` itself still 422s if a
  parity mismatch somehow reaches it despite a locked period.
- **Reopen/correction round-trip, RZiS-basis arithmetic** (Design
  decisions #0/#5/#5b): revenue account real turnover `100`; original
  `CLOSING` debits it `100`; `REVERSAL` of that `CLOSING` credits it
  back `100`; a correction posts a further real `20` credit (corrected
  real revenue now `120`); new `CLOSING` debits it `120`. Assert
  `buildIncomeStatementData` against the *new* `closingEntryId` reports
  `120`, not `100`, `220`, or `0` — proving the original `CLOSING` and
  its `REVERSAL` cancel out of the raw `ytdDebit`/`ytdCredit` sums
  (Kieso, Ch. 3, p. 3-35) regardless of which side each landed on, leaving
  only the new `CLOSING`'s own contribution to subtract.
- **Reopen/correction round-trip, `ClosingResolution` revisioning**
  (Design decisions #5/#5b): `unlockFiscalPeriod` → `REVERSAL` +
  corrected postings → `lockFiscalPeriod` → new `CLOSING` → regenerate
  → assert the new `ClosingResolution` is a new row keyed to the new
  `closingEntryId`, and the original row is untouched.
- **`ClosingResolution` sum validation** against the derived net-result
  total (not a hand-summed figure) — existing case, kept.
- **Concurrent mapping edit**: two `PUT` calls against the same row's
  stale `updatedAt`; assert the second gets `makeCrudRoute`'s standard
  optimistic-lock `409` naming the current record.
- **Mapping create/delete** (Design decisions #7): create succeeds and
  appears in `GET`; a duplicate live `(accountId, side, statementCode)` is
  `409 MAPPING_DUPLICATE`; an unknown, soft-deleted or other-organization
  `accountId`, an invalid enum, and an unknown or `isTotal` `lineCode` are
  each `400`; `DELETE` soft-deletes and the same triple can then be
  re-created.
- **Export fidelity**: assert `exportStatementDocument`'s PDF/XLSX output
  reproduces the same section/line/subtotal amounts the API response
  shows, for both Bilans and each RZiS variant.
- Precondition on missing `CLOSING` entry, or an unlocked fiscal year —
  existing case, kept, split into its two distinct 409 reasons (Design
  decisions #5).

### Integration coverage (API and UI paths)

(Added in second-round review: the first draft's Testing Strategy was unit-
and domain-level only, with no coverage of the routes or pages it
defines.) Integration tests run against the HTTP routes and the pages, not
the commands directly:

| Area | Cases |
|---|---|
| Authorization | Every route and method (`generate`, `closing-resolution`, mapping `GET`/`POST`/`PUT`/`DELETE`) returns `403` for a user without `financial_pl_accounting.statements.manage`; the statements and mapping pages are not reachable without it. |
| Mutation guard | A blocking guard on `generate` and on `closing-resolution` returns the guard's `errorBody`/`errorStatus` and runs no command. |
| Tenant/organization isolation | A mapping, resolution or fiscal period from another organization is `404` or absent from lists; a mapping `accountId` from another organization is `400`; the selected organization (not the user's home organization) is used, including for a user switched to a second organization. |
| Mapping CRUD | Create, duplicate `409`, invalid account/enum/`lineCode` `400`, update `lineCode`, immutability of `accountId`/`side`/`statementCode`, stale-`updatedAt` `409` with the current record echoed, soft delete and re-create, `404` on an unknown id, pagination `pageSize ≤ 100`. |
| Generate | Each `409` code (`PERIOD_NOT_LOCKED`, `CLOSING_ENTRY_MISSING`, `FISCAL_YEAR_NOT_CALENDAR`, `MAPPING_INCOMPLETE`), each `422` code with statements still returned, and the happy path with `comparative` both available and unavailable. |
| Closing resolution | Profit and loss shapes accepted, shape mismatch and zero result `400`, sum mismatch `400`, duplicate for the same `closingEntryId` `409`, a new row after a reopen produces a new `closingEntryId`. |
| Export | PDF/XLSX export of a generated year reproduces the on-screen amounts (including `previousAmount`); export for an unmapped or mid-correction period returns the same `409` as generation. |
| UI (Playwright) | Open the statements page, pick a period, generate, see Bilans/RZiS with the prior-year column and the porównawczy/kalkulacyjny toggle; integrity-failure and unresolved-closing banners; record a resolution; on the mapping page create, edit, delete a row, and trigger the stale-update conflict bar from two sessions; the coverage panel lists an uncovered account. |

## File Manifest

| File | Change | Purpose |
|---|---|---|
| `packages/core/src/modules/financial_statements/data/types.ts` | Create | `ReportFormat`/`ReportSection`/`ReportLine` (`sign`/`isTotal`/`previousAmount`)/`Disclosure` |
| `packages/core/src/modules/financial_statements/lib/buildBalanceSheetData.ts` | Create | Closing-balance → line-bucketed aggregation (Bilans) |
| `packages/core/src/modules/financial_statements/lib/buildIncomeStatementData.ts` | Create | Pre-closing-turnover → line-bucketed aggregation (RZiS) |
| `packages/core/src/modules/financial_statements/lib/computeDerivedTotals.ts` | Create | Signed subtotal/net-result derivation |
| `packages/core/src/modules/financial_statements/index.ts` | Create | Module manifest, `requires: ['ledger']` |
| `financial_pl_accounting/data/entities.ts` | Modify | `StatementLineMapping` (`updatedAt`, `deletedAt`, partial unique index), `ClosingResolution` (+`closingEntryId`, `netResult`, `resolutionKind`, profit/loss columns) |
| `financial_pl_accounting/lib/bilansTemplate.ts` / `rzisTemplate.ts` | Create | Załącznik nr 1 line templates (`sign`/`isTotal`) |
| `financial_pl_accounting/lib/exportStatementAdapter.ts` | Create | Statement-compatible PDF/XLSX export |
| `financial_pl_accounting/commands/generateAnnualStatements.ts` | Create | Generation + calendar-year guard + per-leaf coverage + comparatives + parity and integrity checks; custom route, mutation-guard-wired |
| `financial_pl_accounting/commands/statementLineMappings.ts` | Create | `create`/`update`/`deleteStatementLineMapping` (live-account, enum, template-line, duplicate validation; soft delete) |
| `financial_pl_accounting/commands/recordClosingResolution.ts` | Create | Uchwała disclosure (profit or loss shape), keyed to `closingEntryId`; custom route, mutation-guard-wired |
| `financial_pl_accounting/acl.ts` | Modify | `financial_pl_accounting.statements.manage` |
| `financial_pl_accounting/api/statements/route.ts` | Create | `POST /generate`, `POST /closing-resolution` (custom, mutation-guard-wired, `openApi`) |
| `financial_pl_accounting/api/statement-line-mapping/route.ts` | Create | `makeCrudRoute`: `GET` list, `POST` create, `PUT /:id` update (default-ON `updatedAt` lock), `DELETE /:id` soft delete, each command-backed; `openApi` |
| `financial_pl_accounting/backend/financial-pl-accounting/statements/page.tsx` | Create | Report view + export |
| `financial_pl_accounting/backend/financial-pl-accounting/statement-line-mapping/page.tsx` | Create | `DataTable` + `CrudForm` create/edit dialog, delete confirm, coverage panel |

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

**Step 1 (maintainer-review round, 2026-09-21) — re-checked against
Posting Rules Engine and GL Bulk Read Service at the exact commits the
review cited.** `2026-09-06-posting-rules-engine.md` (commit `8d4c8c58e`)
confirmed verbatim: `posting_rules.lockFiscalPeriod` "rejects when
`findUnreclassifiedEntries` is non-empty, and... successfully delegates
to `ledger.lockFiscalPeriod` when empty" — grounds Design decisions #5's
reuse of that command as the generation precondition, in place of the
original draft's bare `CLOSING`-entry check.
`2026-09-10-general-ledger-bulk-read-service.md` (commit `e4be2d758`)
confirmed verbatim: its export endpoint serializes rows "pulled from
Phase 1's `iterateJournalEntries`/`iterateJournalEntryLines`/
`listAccounts`/`listAccountGroups`" — confirms it has no `ReportFormat`
awareness, grounding Design decisions #6's dedicated export adapter.
`2026-09-09-general-ledger-account-balances.md` (commit `21e9717db`)
re-confirmed verbatim (already cited above) for the closing-entry
turnover-inclusion text underlying Design decisions #0, and its
`TrialBalanceRowDto` rollup/100-row-pagination text underlying Design
decisions #2's exhaustive-traversal requirement (and, after the 2026-10-09 round, its per-leaf attribution).

**Step 2 — Literature grounding (Kieso, *Intermediate Accounting*, 17th
Ed.).**
- **Confirmed, with a location correction (literature-comparison
  verification round, 2026-09-21)** — Ch. 3, "Reversing Entries—An
  Optional Step" (p. 3-35): *"A reversing entry is the exact opposite of
  the adjusting entry made in the previous period."* The quote itself is
  exact and verified directly against the primary-source PDF
  (`pdftotext -layout` + `grep`), but the earlier citation in this
  document attributed it to "Appendix 3B" — that appendix (pp. 3-43–45)
  is the worked accrual/deferral illustration this same chapter section
  points forward to; the defining sentence itself sits in the main
  chapter body, not the appendix's own pages. Reused from the same
  reversal-design grounding already established for
  `2026-09-17-multi-currency.md`. Grounds Design decisions #0's reopen-cycle proof: a
  superseded `CLOSING` entry and its `REVERSAL` are, by this definition,
  exact opposite postings, which is precisely why they net to zero in
  `buildIncomeStatementData`'s raw `ytdDebit`/`ytdCredit` sums regardless
  of which side of the account each one lands on.
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
- **ERPNext (maintainer-review round, 2026-09-21) — Period Closing
  Voucher, direct confirmation of Design decisions #0's failure mode as
  a real, recurring bug class, not a theoretical concern.** ERPNext's
  own closing mechanism (`docs.frappe.io/erpnext/v12/user/manual/en/
  accounts/period-closing-voucher`, verified 2026-09-21) is structurally
  identical to this project's `CLOSING` entry: *"The entries reduce the
  period's income and expense balances to zero and move the difference
  to equity. They do not close receivable, payable, bank, stock, asset,
  liability, or other Balance Sheet accounts."* — the same permanent-
  vs-nominal-account split Design decisions #0 relies on. More directly:
  a real, merged ERPNext bug fix, `frappe/erpnext` PR #44878, "fix: show
  profit and loss after period closing" (merged 2024-12-24, backported
  to two release branches), confirms that "the consolidated financial
  statement failed to display profit and loss figures after a period
  closing voucher was posted" — the identical failure mode caught in
  this document's own maintainer review, independently arising in a
  widely-deployed real system. ERPNext's own published documentation
  does not detail its query-level fix, so this is confirmed as *the
  same class of bug*, not a verified match on *mechanism* — recorded
  as such rather than overclaiming a shared implementation.
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

## Final Compliance Report — 2026-09-21

(Added in this compliance pass — the maintainer-review round applied
`spec-checklist.md` item-by-item and fixed what it found, but the
`om-spec-writing` skill's own required Compliance Gate — this section —
had not actually been run. Running it now surfaced one further, real
gap beyond the seven review findings: Design decisions #7's
optimistic-lock mechanism was a DIY `version` column where the project's
own default-ON `updatedAt` mechanism already applied — see Design
decisions #7 and the Compliance Matrix row below. Everything else in
this report reflects the document as already revised.)

**Re-run, 2026-10-09 (second-round review).** The matrix below was last
evaluated on 2026-09-21. The second review found seven major correctness
gaps (per-leaf attribution, fiscal-year identity, integrity checks,
comparatives, mapping CRUD, `ClosingResolution` consumption, integration
coverage) and two minor ones (contract/path accuracy), and the document was
revised again. Rows touching routes, commands and UI were re-checked
against the revised text and updated; the verdict is restated below. The
earlier "Fully compliant" verdict is superseded: repository-rule
compliance is not the same as domain correctness, and the latter is what
the second review tested.

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `StatementLineMapping.accountId` and `ClosingResolution.{fiscalPeriodId,closingEntryId}` are FK-ids only (Data Model); `financial_statements` reads `ledger`/`posting_rules` in-process but never via ORM relations across module boundaries. |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | Both `financial_pl` entities carry `tenantId`/`organizationId`; `buildBalanceSheetData`/`buildIncomeStatementData` scope through #6013's own `getTrialBalance` scoping. |
| root AGENTS.md → UI & HTTP | Non-`CrudForm` writes use `useGuardedMutation(...).runMutation(...)` | Compliant | UI/UX: the "Generate" action and closing-resolution submit are `useGuardedMutation` + `apiCall()`; the mapping edit is a `CrudForm` dialog instead (see next row). |
| packages/core/AGENTS.md → API Routes | Every API route file exports `openApi`; custom (non-`makeCrudRoute`) write routes wire the mutation guard registry | Compliant | API Contracts header note + Architecture: `generate`/`closing-resolution` are custom, mutation-guard-wired; `statement-line-mapping` `GET`/`POST`/`PUT`/`DELETE` are `makeCrudRoute`, each mutation command-backed (Design decisions #7). Every route exports `openApi`. |
| packages/core/AGENTS.md → API Routes | Route metadata declares per-method `requireAuth`/`requireFeatures` | Compliant | Every route: `requireAuth: true, requireFeatures: ['financial_pl_accounting.statements.manage']` (API Contracts header note). Phase 1 has a single manage-only ACL feature, no separate read-only viewer role — noted as a Phase 2 candidate, not a gap, since no read-only accountant role exists yet anywhere in this module family. |
| packages/core/AGENTS.md → Encryption | PII/GDPR fields declared in `<module>/encryption.ts`, read via `findWithDecryption` | N/A | No PII/GDPR-relevant column in either entity — `StatementLineMapping` holds only account/line references, `ClosingResolution` only amounts and an attachment reference (a file pointer, not personal data). |
| packages/ui/AGENTS.md | Backend forms use `<CrudForm>`; lists use `<DataTable>` with stable `entityId` | Compliant | UI/UX (corrected in this pass): the mapping settings page is a `DataTable`; its row edit and the closing-resolution entry are both `CrudForm`. The original draft described a hand-rolled editable table with no named component — fixed. |
| packages/ui/src/backend/AGENTS.md | All HTTP goes through `apiCall`/`apiCallOrThrow`, never raw `fetch` | Compliant | UI/UX header note. |
| root AGENTS.md (default-ON optimistic locking) | New user-editable entities/forms get `updated_at`-based optimistic locking, not a bespoke scheme | Compliant (corrected in this pass) | Design decisions #7 replaced a DIY `version` integer + custom `409 MAPPING_VERSION_CONFLICT` code with the framework's own `updatedAt`/`CrudForm`/`surfaceRecordConflict` mechanism, after re-verifying (and correcting) the citations that had justified the DIY version. |
| packages/cache/AGENTS.md | Read-heavy endpoints declare a caching strategy; cache resolved via DI | N/A, justified | Annual statements are generated at most a few times per fiscal year per tenant (post-close), not a high-frequency read path; `buildBalanceSheetData`/`buildIncomeStatementData` already inherit whatever caching #6013's `getTrialBalance` itself defines (out of this document's scope to redefine). No new cache layer is introduced. |
| packages/events/AGENTS.md | Cross-module side effects go through `createModuleEvents`, never direct imports | N/A, justified | `financial_statements`/`financial_pl` emit no event in Phase 1 — nothing outside this module needs to react to a generated statement or a recorded closing resolution; both modules only *consume* `ledger`'s and `posting_rules`' existing surface (one-way dependency direction, knowledge-base §2). Flagged as a Phase 2 candidate if a future filing/e-Sprawozdania submission module needs to react to generation. |
| root AGENTS.md → Design System Rules | Semantic status tokens, DS text scale, shared primitives, no raw `<svg>` | N/A | This document contains no literal className/JSX snippets to audit — it describes components (`DataTable`, `CrudForm`, `Alert`-style banners) by name, not markup. Enforced at implementation time by the existing DS lint/tests, not by this spec. |
| Spec-checklist §5 | i18n keys planned, never hard-coded strings | Compliant | Internationalization (i18n) section (added in this pass): `financial_pl_accounting.statements.*` namespace via `useT()`/`resolveTranslations()`; statutory line names are explicitly out of scope for translation (Poland-specific legal text), matching Tax Management's own precedent. |
| Spec-checklist §5 | Pagination `pageSize <= 100` | Compliant | `GET /statement-line-mapping` mirrors #6013's own paginated `getTrialBalance` contract (Design decisions #2). |
| Spec-checklist §5 | Migration/backward-compatibility strategy is explicit | Compliant | Migration & Backward Compatibility section (added in the maintainer-review pass). |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | `StatementLineMapping`'s `updatedAt`-only concurrency column matches the `PUT` contract's header-based lock (no `version` field anywhere after this pass); `ClosingResolution.closingEntryId` matches every route/command reference to it. |
| API contracts match UI/UX section | Pass | The `DataTable`/`CrudForm` split in UI/UX now matches the `makeCrudRoute` vs. custom-route split in API Contracts/Architecture. |
| Risks cover all write operations | Pass | Risks & Impact Review's transparency entry names all seven review findings plus this pass's optimistic-lock correction; Edge Cases covers each write path's failure mode (uncovered account/side, variant mismatch, integrity-check failure, unlocked or non-calendar period, stale resolution, concurrent mapping edit, export rejection). |
| Commands defined for all mutations | Pass | `generateAnnualStatements`, `recordClosingResolution` are commands behind mutation-guard-wired routes; the mapping create/update/delete are `makeCrudRoute` mutations backed by `commands/statementLineMappings.ts`, because create and delete carry validation (Design decisions #7; the 2026-09-21 "no command needed" reasoning held only for editing a `lineCode`). |
| Cache strategy covers all read APIs | Pass (N/A, justified) | See Compliance Matrix — no new cache layer; inherits #6013's. |

### Non-Compliant Items

None outstanding. (One was found and fixed during this report's own preparation — Design decisions #7's DIY `version` column — rather than left for a future round.)

### Verdict

**Compliant with the repository rules above; open domain questions remain.** The 2026-09-21 verdict ("Fully compliant") is superseded by the 2026-10-09 re-run. Items that need an accountant's or an upstream-spec owner's confirmation are marked **⚠ NEEDS HUMAN CONFIRMATION** in Design decisions #2 (#6013 roll-up additivity), #4 (loss-coverage categories), #5a (`listFiscalPeriods` in #6038) and #8 (missing prior year: warn or block). Re-review requested on PR #6188.

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
  chart — Design decisions #2. **Superseded 2026-10-09:** the antichain rule
  itself was replaced by per-leaf, per-side attribution; only the full
  paginated traversal is retained (see the 2026-10-09 entry).
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

### 2026-09-21 (cont. — `om-spec-writing` compliance pass)

The maintainer-review round above fixed all seven reported findings
with verified citations, but had not actually run the `om-spec-writing`
skill's own process end to end — it approximated the skill's structure
from summary rather than reading `.agents/skills/om-spec-writing/`
itself. Re-run properly this round, in order:

- **Step "Review" — scope-cohesion check.** Checklist item 1 delegated
  to a fresh-context subagent given only this spec file (`spec-checklist.md`'s
  required procedure: "run this item in a fresh-context subagent given
  only the spec file"). **Verdict: NO SPLIT** — the spec covers one
  independently deployable capability (Annual Financial Statements,
  Core `financial_statements` + `financial_pl` plugin), with the
  Core/plugin boundary being a single, already-established integration
  seam (the same split SPEC-024 and #6013 already use), not a bundle of
  unrelated capabilities.
- **Internationalization (i18n).** The original draft named no i18n
  keys at all — an outright checklist §5 gap, not a refinement. Added
  the Internationalization (i18n) section.
- **Fresh literature/real-system grounding for the two brand-new design
  decisions.** Re-verified the Kieso Appendix 3B reversing-entry
  citation (reused, already confirmed for the Multi-Currency spec) and
  added a new, independently found real-system precedent: ERPNext's
  merged bug-fix PR `frappe/erpnext#44878` ("fix: show profit and loss
  after period closing," 2024-12-24), confirming the RZiS-basis-vs-
  closing-balance bug (Design decisions #0) is a known, recurring class
  of bug in comparable systems, not a false positive invented for this
  review.
- **Self-caught arithmetic error.** Re-deriving Design decisions #0's
  worked example while writing the fresh literature citation surfaced a
  debit/credit side error in the maintainer-review round's own numbers
  (a revenue account's `CLOSING` debit had been added to `ytdCredit`
  instead of subtracted from `ytdDebit`, and the mirror error for
  expense accounts). Corrected the worked example and the "Reopen/
  correction round-trip" test case (split into an arithmetic-focused
  case and a `ClosingResolution`-revisioning case), and added an
  explicit algebraic proof, grounded in the same Kieso citation, that a
  `CLOSING` entry and its `REVERSAL` cancel in the raw turnover sums
  regardless of which side each lands on — so the reopen case is
  unaffected by which side the original error picked.
- **Citation re-verification under challenge (`financial-spec-citation-check`).**
  Re-checked this round's own new citations against source rather than
  accepting them: Design decisions #7's "same pattern
  `PostingRulesSettings`/`TaxCodeAccountMapping` already use" claim
  turned out to be a Mismatch — both entities are real, but both use
  `updatedAt`, not a `version` field, exactly like this project's
  default-ON optimistic-lock mechanism (root `AGENTS.md`). Corrected
  Design decisions #7, Data Model, API Contracts, UI/UX, Edge Cases,
  Testing Strategy, and the File Manifest to drop the DIY `version`
  column entirely and use the canonical mechanism, which also let
  `GET`/`PUT /statement-line-mapping/:id` move from a bespoke command
  route to plain `makeCrudRoute` `list`/`update` handlers.
- **Canonical mechanisms named explicitly.** The spec previously
  described routes/forms/tables in prose without naming this project's
  actual framework primitives — a checklist §5 gap ("no DIY
  substitutes"). Added: `openApi` exports and `requireAuth`/
  `requireFeatures` metadata for all four routes; mutation-guard-registry
  wiring for the two custom (non-`makeCrudRoute`) write routes;
  `DataTable`/`CrudForm` naming in UI/UX; `useGuardedMutation`/`apiCall`
  for non-`CrudForm` writes.
- **Final Compliance Report.** Added (see above), including the one
  further gap the report's own preparation surfaced (the `version`
  column, above) — fixed here rather than reported and left open.

### Review — 2026-09-21

- **Reviewer**: Agent (`om-spec-writing` skill, this compliance pass)
- **Security**: Passed — no PII/GDPR fields introduced; `organization_id`/`tenantId` scoping explicit throughout Data Model; ACL (`financial_pl.statements.manage`) declared on every route.
- **Performance**: Passed — no new N+1 pattern; `buildBalanceSheetData`/`buildIncomeStatementData` paginate through #6013's existing `getTrialBalance` contract rather than a new query shape.
- **Cache**: Passed (N/A, justified) — no new cache layer; a low-frequency (per-fiscal-year) generation flow inherits whatever caching #6013 itself defines.
- **Commands**: Passed — `generateAnnualStatements`/`recordClosingResolution` are commands behind mutation-guard-wired custom routes; the mapping edit needs no command of its own (plain `makeCrudRoute` field update, Design decisions #7).
- **Risks**: Passed — Risks & Impact Review's transparency entry covers all seven review findings plus this pass's optimistic-lock correction; no residual risk left undocumented.
- **Verdict**: Approved — re-requesting review against this revision.

### 2026-10-08 — target layout, path fix, gate wording

- **Path.** The `financial_statements` files were listed under
  `packages/modules/financial_statements/`, a directory that does not exist
  in the repository. Corrected to `packages/core/src/modules/financial_statements/`,
  where the sibling Tax Management module (#6168) already lives.
- **Target layout (decided 2026-10-08).** The
  Polish half of this document moves from `financial_pl` into a separate
  package in `official-modules`, `financial_pl_accounting`,
  with a hard `requires` on `financial_pl`, `ledger`, `tax_management` and
  `financial_statements`. Reason: `financial_pl` is installed standalone
  for KSeF and JPK_V7 and must not require a general ledger. Identifiers
  in this document were renamed accordingly: feature
  `financial_pl_accounting.statements.manage`, routes under
  `/api/financial-pl-accounting/`, backend pages under
  `backend/financial-pl-accounting/`, i18n namespace
  `financial_pl_accounting.statements.*`. Narrative mentions of
  "`financial_pl`" as the Poland plugin still mean the same
  `official-modules` repository.
- **Gate wording** corrected in the TLDR, Overview and Design decisions #5
  (see #5): a locked period does not by itself prove zespół 4→5 was
  reconciled, because `ledger.lockFiscalPeriod` bypasses the
  `posting_rules` guard by design.
- **Reading period state.** Generation reads `FiscalPeriod` state and the
  `CLOSING` entry through two new `ledgerBulkReadService` methods
  (`getFiscalPeriod`, `findClosingEntries`, added to #6038 on the same
  date). #6038 is now a prerequisite of the generation command.

### 2026-10-09 — second-round review (@adeptofvoltron, PR #6188)

Seven major and two minor findings from the review of `c7ac9ffcb`:

- **Major 1 — per-leaf, per-side attribution (Design decisions #2).** The
  antichain rule read a syntetyk account's rolled-up *net* figure, losing
  one side of a settlement account, and forbade parent/child overrides.
  Replaced by: page the full trial balance, derive each account's own
  `Dr − Cr` figure, take the side from its sign, attribute to the nearest
  mapped ancestor-or-self, `409 MAPPING_INCOMPLETE` for uncovered
  `(account, side)`. Worked settlement example added (`600` należności /
  `50` zobowiązania, not `550`). Antichain constraint removed everywhere
  (Data Model, API, UI, Edge Cases, Testing, Manifest).
- **Major 2 — fiscal-year identity (Design decisions #5a, new).** Phase 1
  is calendar fiscal years only; the command normalizes any period id to
  the year's last period and rejects gapped/overlapping/non-calendar years
  with `409 FISCAL_YEAR_NOT_CALENDAR`. Non-calendar years moved to Out of
  scope.
- **Major 3 — integrity checks (Design decisions #3b, new).** Aktywa razem
  = Pasywa razem (`422 BALANCE_SHEET_UNBALANCED`) and Bilans "Zysk (strata)
  netto" = RZiS net result (`422 NET_RESULT_MISMATCH`), with a worked golden
  year as the regression fixture.
- **Major 4 — comparatives (Design decisions #8, new).** `ReportLine`
  gains `previousAmount`; the same functions and mapping run for the prior
  year; first-year, unclosed-prior-year and failing-prior-year behavior
  specified; API response and UI updated.
- **Major 5 — mapping create/delete (Design decisions #7, rewritten).**
  Full CRUD via `makeCrudRoute`, command-backed, with live-account, enum,
  template-line and duplicate validation, soft delete and a partial unique
  index.
- **Major 6 — `ClosingResolution` consumption and loss case (Design
  decisions #4, rewritten).** Defined as disclosure-only in Phase 1 (no
  amount derived from it, nothing posted), with a profit shape and a loss
  shape chosen by the sign of the net result; `netResult` and
  `resolutionKind` added to the entity.
- **Major 7 — integration coverage (Testing Strategy, new subsection).**
  Authorization per method, mutation guards, tenant/organization isolation,
  mapping CRUD, generate and resolution error codes, export, and the
  Playwright UI flow.
- **Minor 1 — contract accuracy.** Core function signatures now take `em`
  and `{ tenantId, organizationId, … }`; the `GET (list generated
  statements)` route was removed (statements are not stored); the error
  codes of each route are named.
- **Minor 2 — citation and verdict accuracy.** The
  `.worktrees/tax-management/…` citation is now
  `.ai/specs/2026-09-16-tax-management.md` (PR #6168); the Final Compliance
  Report was re-run with a note, rows corrected, and its "Fully compliant"
  verdict superseded. (The `packages/modules/…` path fix was already in the
  2026-10-08 entry.)
- **Open confirmations** (marked **⚠ NEEDS HUMAN CONFIRMATION** in the
  text): #6013 roll-up additivity, `listFiscalPeriods` in #6038, loss-
  coverage categories, and missing-prior-year warn-versus-block.
- **Not a change in this document:** retargeting the PR from `main` to
  `develop` is a repository action on the PR itself.
