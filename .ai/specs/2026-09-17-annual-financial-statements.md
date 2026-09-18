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
closing trial balance (`getTrialBalance`, #6013), per SPEC-024 §11's own
Core-reporting-engine + country-plugin split (the same architecture already
applied to Tax Management, §10). A small Core module, `financial_statements`,
ships only the generic report shape (`ReportFormat`/`ReportSection`/
`ReportLine`) and one aggregation function reading #6013's trial balance —
no report builder, scheduler, drill-down, or cache (those stay Out of
scope, Phase 2+, the same discipline GL core engine already applied to its
own closing-entry generator). `financial_pl` owns everything Poland-specific:
the actual Bilans/RZiS line templates (Załącznik nr 1 do Ustawy o
rachunkowości), a tenant-configured account→line mapping (`StatementLineMapping`,
per Wn/Ma side — accounts are tenant-customized, never hardcoded, per the
knowledge base's own §2 convention), a single input field for the board
resolution's (uchwała) profit-distribution outcome, and a same-net-result
check between RZiS's two variants (porównawczy/by-nature, zespół 4;
kalkulacyjny/by-function, zespół 5) — literature-grounded via Kieso's own
IAS 1 nature-vs-function discussion, and already structurally guaranteed in
this project by Posting Rules Engine's zespół 4→5 mirroring through account
490.

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
   from SPEC-024's own sketch — see Design decisions for the one
   correction needed), and a single aggregation function,
   `buildStatementData(fiscalPeriodId, lineMappings)`, that reads #6013's
   `getTrialBalance` rows and buckets each account's closing balance into
   the caller-supplied line mapping. No report builder UI, no scheduler,
   no drill-down, no cache — SPEC-024 §11.1 lists these as Core, but
   nothing here needs them yet with a single plugin consumer; deferred
   the same way GL core engine deferred its own closing-entry generator
   (Out of scope).
2. **`financial_pl`** (Poland plugin, `official-modules`) — everything
   statute-specific: the actual Bilans and RZiS (both variants) line
   templates per Załącznik nr 1 do Ustawy o rachunkowości, a
   `StatementLineMapping` settings entity (tenant-configured, nullable,
   reject-if-unset — the `PostingRulesSettings`/`TaxCodeAccountMapping`
   pattern), the `ClosingResolution` input capturing the uchwała's
   profit-distribution outcome, and `generateAnnualStatements` — the
   command that reads the post-`CLOSING`-entry trial balance, applies the
   mapping, runs the two-variant parity check, and renders both
   statements.

### Design decisions

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
2. **Account-to-line mapping is a tenant-configured settings entity, not
   a derived function.** Also corrects a related SPEC-024-era
   assumption. GL core engine's own "Alternatives considered" earlier
   rejected storing `reportType` (Balance Sheet vs. P&L) directly on
   `LedgerAccountType`, deriving it in code instead
   (`mapAccountTypeToStatement`) — reasonable when the only granularity
   needed was "which of two statements," fixed by accounting rules
   regardless of tenant. That reasoning doesn't extend to *which specific
   Bilans/RZiS line* a synthetic account maps to: two tenants can
   legitimately classify the same zespół differently at the line level,
   and — critically — a single synthetic account with a debit balance
   might belong on a different Bilans line than the same account with a
   credit balance (e.g., a rozrachunki/settlement account that's
   sometimes a receivable, sometimes a payable), which is exactly why
   the Event Storming brief calls for "osobno per stronę Wn/Ma." A
   deterministic code function can't express that; a per-account,
   per-side settings row can. `StatementLineMapping` is nullable with no
   default and rejects statement generation if any account posted-to in
   the period is unmapped — the same reject-if-unset discipline as
   `PostingRulesSettings`/`TaxCodeAccountMapping`.
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
5. **Statement generation requires the fiscal year's `CLOSING` entry to
   already be posted.** GL core engine's `CLOSING` entry type exists in
   Phase 1 (posted manually or by script; the automated generator is
   deferred). `generateAnnualStatements` reads the trial balance *as of*
   that `CLOSING` entry — it does not compute or post the closing entry
   itself, and does not require the (still out-of-scope) automated
   closing-entry generator. If no `CLOSING` entry exists for the fiscal
   year yet, generation fails with a clear precondition error rather
   than silently reporting pre-closing (still-live zespół 4-7) balances
   as final.

## Architecture

### `financial_statements` (Core, this repo)

- `packages/modules/financial_statements/data/types.ts` — `ReportFormat`,
  `ReportSection`, `ReportLine` (per Design decisions #1), `Disclosure`
  (unused in Phase 1; kept for shape-compatibility with SPEC-024 §2.4 so
  a future country plugin's Notes-to-Statements section has somewhere to
  land).
- `packages/modules/financial_statements/lib/buildStatementData.ts` —
  `buildStatementData(fiscalPeriodId, lineMappings: { accountId, side:
  'debit' | 'credit', lineCode }[])`. Calls #6013's `getTrialBalance`
  internally (direct in-process read — GL/GL-balances are both upstream
  of this module, consistent with the established one-way dependency
  direction), buckets each row's closing balance into `lineCode` per its
  mapped side, and returns `{ lineCode, amount }[]`. Pure aggregation, no
  formatting, no I/O beyond the read.
- `index.ts` — `requires: ['ledger']`, no ACL of its own (this module
  exposes no route or command; `financial_pl` is the only caller).

### `financial_pl` (Poland plugin, `official-modules`)

- `data/entities.ts` — `StatementLineMapping` (tenant settings,
  nullable/no-default, per Design decisions #2), `ClosingResolution`
  (per fiscal period, per Design decisions #4).
- `lib/bilansTemplate.ts` / `lib/rzisTemplate.ts` — the fixed Załącznik
  nr 1 line structures (section codes/names/order), independent of any
  tenant's actual chart.
- `commands/generateAnnualStatements.ts` — input `{ fiscalPeriodId }`;
  preconditions: `CLOSING` entry exists for the period (Design decisions
  #5), every account posted-to in the period has a `StatementLineMapping`
  row for the side(s) it was posted on. Calls `buildStatementData` twice
  (once against the Bilans mapping, once against each RZiS variant's
  mapping), runs the variant-parity check (Design decisions #3), and
  returns the two rendered `ReportFormat` documents plus the
  `zeroSumCheck`-style pass/fail already familiar from #6013.
- `commands/recordClosingResolution.ts` — input `{ fiscalPeriodId,
  retainedEarnings, dividends, supplementaryCapital, attachmentRef? }`;
  validates the three amounts sum to the period's net result (read via
  `buildStatementData`'s RZiS aggregation) before writing
  `ClosingResolution`.
- `api/statements/route.ts` — `GET` (list generated statements) and
  `POST /generate` (invoke `generateAnnualStatements`), behind
  `financial_pl.statements.manage`.
- `backend/financial-pl/statements/page.tsx` — read-only Bilans/RZiS
  view (rendered from the returned `ReportFormat`), a `StatementLineMapping`
  admin page, and the `ClosingResolution` entry form — reusing #6038's
  export machinery for PDF/Excel output rather than building a new
  exporter.

## Data Model

### `StatementLineMapping` (`financial_pl`)

`{ id, tenantId, organizationId, accountId (FK LedgerAccount), side
('debit'|'credit'), statementCode ('bilans'|'rzis_porownawczy'|
'rzis_kalkulacyjny'), lineCode (string, matches the target template's
line codes), createdAt, updatedAt }`. Nullable/no-default: an account
posted-to in a period with no matching row for the side it was posted on
blocks `generateAnnualStatements` for that period (Design decisions #2).
Unique on `(tenantId, organizationId, accountId, side, statementCode)`.

### `ClosingResolution` (`financial_pl`)

`{ id, tenantId, organizationId, fiscalPeriodId (FK FiscalPeriod, unique
per tenant/org), retainedEarnings (decimal), dividends (decimal),
supplementaryCapital (decimal), attachmentRef (string, nullable — a
document/file reference, not a workflow state), recordedBy, recordedAt
}`. `retainedEarnings + dividends + supplementaryCapital` must equal the
fiscal period's RZiS net result at write time (validated in the command,
not a DB constraint, since it needs the RZiS aggregation to check).

## API Contracts

### `POST /api/financial-pl/statements/generate`

- **Body**: `{ fiscalPeriodId: string }`.
- **Response 200**: `{ fiscalPeriodId, bilans: ReportFormat, rzisPorownawczy: ReportFormat, rzisKalkulacyjny: ReportFormat, netResultParity: { porownawczy: number, kalkulacyjny: number, matches: boolean } }`.
- **Response 409**: no `CLOSING` `JournalEntry` posted for the fiscal
  period, or one or more posted-to accounts have no `StatementLineMapping`
  row for the side they were posted on (body names the missing
  account/side pairs).
- **Response 422**: `netResultParity.matches` is `false` — generation
  still returns both variants (for debugging) but flags the mismatch
  rather than silently succeeding.
- **Response 403**: caller lacks `financial_pl.statements.manage`.

### `POST /api/financial-pl/statements/closing-resolution`

- **Body**: `{ fiscalPeriodId, retainedEarnings, dividends,
  supplementaryCapital, attachmentRef? }`.
- **Response 200**: the created `ClosingResolution`.
- **Response 400**: the three amounts don't sum to the period's RZiS net
  result.
- **Response 403**: caller lacks `financial_pl.statements.manage`.
- **Response 409**: a `ClosingResolution` already exists for this fiscal
  period (immutable once recorded — a correction is a new fiscal-period
  adjustment, not an edit, consistent with `TaxLiabilityRecord`'s own
  "posts once; a correction is a new record" precedent).

## UI/UX

- `backend/financial-pl/statements/page.tsx` — a fiscal-period picker, a
  "Generate" action (calls `/generate`), and, once generated, two
  read-only report views (Bilans, RZiS — with a toggle between
  porównawczy/kalkulacyjny) rendered from `ReportFormat`'s sections/lines,
  plus "Export PDF"/"Export Excel" buttons wired to #6038's existing
  export machinery. A visible banner if `netResultParity.matches` is
  `false`.
- `backend/financial-pl/statement-line-mapping/page.tsx` — a settings
  table: one row per `(account, side, statement)`, editable, grouped by
  zespół for discoverability (reusing the flat, sorted-by-code
  presentation #6013 already established for its own trial-balance
  table — no new tree/indentation UI).
- Closing-resolution entry: a small form on the same statements page
  (three amount fields that must sum to the displayed net result, plus
  an optional attachment upload) rather than a separate page — it's a
  single record per fiscal period, not a list.

## Edge Cases & Failure Scenarios

- **Account posted-to but never mapped.** `generateAnnualStatements`
  returns 409 naming every `(accountId, side)` pair missing a mapping
  rather than silently omitting the amount from the statement (a
  Bilans/RZiS that doesn't balance because of a silently-dropped account
  is worse than a blocked generation).
- **RZiS variants disagree.** 422, both variants still returned for
  debugging, banner shown in UI — see Design decisions #3. The likely
  root cause (an unreconciled Posting Rules Engine account-490 residual)
  is named in the error body as a diagnostic hint, not auto-fixed here.
- **`CLOSING` entry missing or the fiscal period isn't locked.** 409 —
  generating statements against a still-open period would report
  balances that can still change.
- **`ClosingResolution` amounts don't sum to net result.** 400 at write
  time — this is the one place a manual-entry error is easy to make
  (typo in one of three fields) and easy to catch mechanically.
- **Regenerating after a correction.** `CLOSING` entries are never
  edited (GL core engine: "always reversal, never edit"); a correction
  is a `REVERSAL` + a new `CLOSING` for a reopened period, and
  `generateAnnualStatements` is re-run against the new trial balance —
  no separate "regenerate" concept needed.

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
  "eventual, not immediate" invariant) could transiently block statement
  generation right after heavy period-end activity. Acceptable for
  Phase 1 — the operator can re-run generation after the sweep catches
  up — but worth surfacing as a known interaction in Posting Rules
  Engine's own docs (see cross-spec update below).
- **Payment/legal accuracy of the rendered statements is not validated
  by tests alone.** Like Tax Management's payment-instruction risk, a
  wrong line-template or mapping produces a statutory filing a human
  must ultimately sign off on; Testing Strategy below covers structural
  correctness (parity, mapping completeness) but not accountant sign-off,
  which stays a manual review gate outside this system.

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
  the data shape and the aggregation function a Phase 2 builder/scheduler
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

## Implementation Plan

1. `financial_statements` (Core): `data/types.ts` (`ReportFormat`/
   `ReportSection`/`ReportLine`/`Disclosure`), `lib/buildStatementData.ts`,
   `index.ts` (`requires: ['ledger']`).
2. `financial_pl`: `data/entities.ts` + migration (`StatementLineMapping`,
   `ClosingResolution`).
3. `financial_pl`: `lib/bilansTemplate.ts`, `lib/rzisTemplate.ts` (both
   variants) — the fixed Załącznik nr 1 line structures.
4. `financial_pl`: `commands/generateAnnualStatements.ts`,
   `commands/recordClosingResolution.ts`.
5. `financial_pl`: `acl.ts` (`financial_pl.statements.manage`),
   `api/statements/route.ts`.
6. `financial_pl`: `backend/financial-pl/statements/page.tsx`,
   `backend/financial-pl/statement-line-mapping/page.tsx` — wire exports
   through #6038's existing machinery rather than a new exporter.
7. Tests: mapping-completeness rejection, variant-parity pass/fail
   (including a deliberately-unreconciled-490 fixture), closing-
   resolution sum validation, precondition on missing `CLOSING` entry.
8. Manual QA + `yarn generate` + typecheck + full walkthrough (mirrors
   every sibling spec's Phase-1 closing step).

## File Manifest

| File | Change | Purpose |
|---|---|---|
| `packages/modules/financial_statements/data/types.ts` | Create | `ReportFormat`/`ReportSection`/`ReportLine`/`Disclosure` |
| `packages/modules/financial_statements/lib/buildStatementData.ts` | Create | Trial-balance → line-bucketed aggregation |
| `packages/modules/financial_statements/index.ts` | Create | Module manifest, `requires: ['ledger']` |
| `financial_pl/data/entities.ts` | Modify | `StatementLineMapping`, `ClosingResolution` |
| `financial_pl/lib/bilansTemplate.ts` / `rzisTemplate.ts` | Create | Załącznik nr 1 line templates |
| `financial_pl/commands/generateAnnualStatements.ts` | Create | Generation + variant-parity check |
| `financial_pl/commands/recordClosingResolution.ts` | Create | Uchwała-outcome input |
| `financial_pl/acl.ts` | Modify | `financial_pl.statements.manage` |
| `financial_pl/api/statements/route.ts` | Create | `POST /generate`, `POST /closing-resolution` |
| `financial_pl/backend/financial-pl/statements/page.tsx` | Create | Report view + export |
| `financial_pl/backend/financial-pl/statement-line-mapping/page.tsx` | Create | Mapping settings UI |

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
