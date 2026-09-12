# Financial Module — Knowledge Base & Source Map

**Status:** reference document, not a feature spec — nothing here is "to implement."
Compiled 2026-09-08 while cross-checking the accounting literature (Fowler's
*Analysis Patterns*, Hay's *Data Model Patterns*) against this repo's own
financial-module specs, after discovering that the specs already answer most
of what the literature search was trying to establish.

**How to use this doc:** before starting a new financial-module spec (AR,
Cash & Bank, Multi-Currency, Cost Accounting — see §1), read §2 first. It's
the fastest way to inherit conventions already fought for and settled across
GL/AP/JELD, instead of rediscovering them per module.

---

## 1. The actual module map (SPEC-024 + what exists today)

`SPEC-024-2026-02-11-financial-module.md` is the epic-level architecture doc
(three-layer: Core Engine / Localization Contracts / Country Plugins) listing
the full intended scope: General Ledger, Accounts Payable, Accounts
Receivable, Cash & Bank Management, Fixed Assets, Multi-Currency, Budgeting &
Forecasting, Cost Accounting, plus Payroll/Compliance contracts in the
localization layer. Not all of it is committed to yet — treat it as the map,
not a promise.

What actually exists right now, and where:

| Module | File | Branch | Status |
|---|---|---|---|
| General Ledger core engine | `2026-08-18-general-ledger-core-engine.md` + `...-implementation-guide.md` | `docs/spec-072-general-ledger-core-engine` | Open, PR #5663 |
| Accounts Payable (invoices) | `2026-09-06-accounts-payable.md` | `docs/accounts-payable` | Open, PR #5962 |
| Accounts Payable (payments) | `2026-09-06-accounts-payable-payments.md` | `docs/accounts-payable` | Open, PR #5962 |
| Journal Entry Line Dimension | `2026-09-06-journal-entry-line-dimension.md` | `docs/journal-entry-line-dimension` | Written, own branch |
| Fixed Assets | `2026-09-06-fixed-assets.md` | `docs/fixed-assets` | Open, PR #6014 — full spec, adversarially reviewed, Final Compliance Report: fully compliant |
| Posting Rules Engine (konto 490) | `2026-09-06-posting-rules-engine.md` | `docs/posting-rules-engine` | Open, PR #6015 — full spec, one independent adversarial review pass (nine issues fixed) |
| This knowledge base | `2026-09-08-financial-module-knowledge-base.md` | `docs/financial-module-knowledge-base` | Open, PR #6016 |
| GL bulk cross-module read service | `2026-09-10-general-ledger-bulk-read-service.md` | `docs/general-ledger-bulk-read-service` | Open, PR #6038 — draft, not yet reviewed — prerequisite for JPK_KR_PD's future `SPEC-010` (see note below the table) |
| Accounts Receivable (sales invoice → GL posting) | `2026-08-18-sales-invoice-gl-posting.md` | `docs/sales-invoice-gl-posting` | Open, PR #6046 — full spec, one independent adversarial review pass (eleven issues fixed) plus a structured Final Compliance Matrix pass; not yet reviewed by a human/maintainer |
| Cash & Bank Management, Multi-Currency, Budgeting & Forecasting, Cost Accounting | — | — | Not started (SPEC-024 only) |

**New 2026-09-10 — Accounts Receivable started.**
`2026-08-18-sales-invoice-gl-posting.md` is the sell-side mirror of
Accounts Payable — an explicit `postSalesInvoiceToLedger` command that
reads `sales.SalesInvoice`/`SalesInvoiceLine` directly (no duplication)
and posts Dr receivable / Cr per-line revenue / Cr VAT output. It had
been named as a future dependency by the GL core engine's own Out of
scope (#5663), Accounts Payable (#5962), and Contractor Registry since
2026-09-06, without ever being written, until now. Went through one
independent adversarial review pass (eleven issues fixed, including a
real double-entry balance bug from an unhandled header-level discount
and a misattributed `contractorBankWhitelistCheck` citation) plus a
second, structured pass that added the required Final Compliance
Matrix this document's own `om-spec-writing` skill mandates (the first
pass had left it narrative-only) and a fresh-context scope-cohesion
check (verdict: cohesive). It reuses this section's own §2 conventions
correctly — no new subsidiary ledger (`sales.SalesInvoice.outstandingAmount`
already is one), FK-id-only cross-module links, Phase 1 manual
account-mapping matching AP's own stance. It leaves the
`customers.CustomerEntity` ↔ `contractors.Contractor` identity bridge a
named, unresolved gap (Contractor Registry itself only ever named this
document as an undesigned, indirect consumer — no automatic-resolution
need is confirmed anywhere in the codebase yet).

**Correction (2026-09-12) — it did need a citation, and didn't have
one.** The claim above ("without needing a new external-literature
citation") was wrong: the document uses "receivable control account"
four times with no citation anywhere for the concept. Fixed by adding
Kieso Ch.7 "Cash and Receivables," p.7-12, footnote 5 (already verified
in this knowledge base, §3, and more directly on-point here than the
general Ch.3 definition used for AP's payable side, since it names
receivables specifically) and Ustawa o rachunkowości art. 13/16.
Compared against ERPNext (docs.frappe.io — GL posting happens
automatically on Sales Invoice submission, not via a separate command;
this document's `SalesInvoiceGlPosting` table substitutes for the
idempotency guarantee Frappe's own `docstatus` field gives ERPNext for
free) and Odoo (not independently re-verified this pass). All written
directly into `2026-08-18-sales-invoice-gl-posting.md`'s own new
"Literature & Prior Art" section — commit `80b642585` on
`docs/sales-invoice-gl-posting`.

**Resolved 2026-09-09:** Fixed Assets and Posting Rules Engine used to
live only as uncommitted files in one worktree — flagged here as a
real risk of losing the work. Both now have their own `docs/` branch,
English translations (they were originally drafted in Polish, like
the early Accounts Payable draft), and open PRs (#6014, #6015). This
document itself now has a branch and PR too (#6016).

**Updated 2026-09-09 (cont.):** Fixed Assets (#6014) is now a complete
spec — Overview, Problem Statement, Proposed Solution, User Stories,
Architecture, Data Models, API Contracts, Implementation Plan (Phase 1 +
Phase 2), File Manifest, Testing Strategy, Risks & Impact Review with a
Risk Register, Out of Scope, and a Final Compliance Report (verdict:
fully compliant). It also picked up three scope additions during a
knowledge-base verification pass against this doc's own sources —
salvage/residual value (art. 32 ust. 2 UoR, optional, unlike Kieso's
mandatory depreciable-base input), prospective-only useful-life/rate
revision (art. 32 ust. 3 UoR, one of the few points where UoR and US GAAP
agree), and impairment recognition plus mandatory reversal (art. 32 ust.
4 / art. 35c UoR — the opposite of Kieso's prohibition on restoring an
impairment for an asset held for use, the spec's most consequential
divergence from the US-GAAP reference material). It then went through a
fresh-context adversarial review, which found and fixed two blocking
defects (the impairment/reversal commands weren't regenerating the
depreciation schedule tail, which could drive net book value negative;
neither command had an explicit `FixedAsset.status` guard) plus two
smaller gaps — see the spec's own Changelog for the full citation trail
and review record. Ready for a real review pass.

**Corrected 2026-09-09 (cont., again — accumulated-impairment account):**
A wzorcowy plan kont (a reference chart of accounts, zespół 0–8, supplied
directly by the accounting team) surfaced a real design defect that no
adversarial review round had caught, because it wasn't a spec-internal
inconsistency but a wrong accounting-practice assumption: the spec was
reusing `ledgerAccumulatedDepreciationAccountId` as the credit target for
impairment write-downs, when real Polish practice keeps accumulated
depreciation (070/071, "Umorzenie") and impairment write-downs (072,
"Odpisy aktualizujące") on genuinely separate synthetic accounts.
`FixedAsset` now has a fourth required, immutable ledger-account field,
`ledgerAccumulatedImpairmentAccountId`, and `disposeAsset` posts two
separate debit lines (depreciation, impairment) instead of one combined
figure. A third fresh-context adversarial review round found zero real
defects in the correction itself (one unrelated, pre-existing stale
cross-reference label was fixed in passing). Final Compliance Report is
now rev. 3. This correction is sourced from the reference chart of
accounts alone, not from Kieso or the UoR excerpt available in this
session — neither reaches Polish chart-of-accounts numbering at this
level of detail.

**Correction (2026-09-12) — the paragraph above was stale and
contradicted this document's own table.** Posting Rules Engine (#6015)
is **not** draft-quality-only. Verified directly against the actual file
on `docs/posting-rules-engine`: it already has every required section
(Overview, Problem Statement, Proposed Solution, User Stories,
Invariants, Alternatives Considered, Architecture, Data Models, API
Contracts, Migration & Deployment, Implementation Plan, File Manifest,
Testing Strategy, Risks & Impact Review, Out of Scope, Final Compliance
Report), and already went through one independent, fresh-context
adversarial review pass (2026-09-10) that found and fixed nine real
issues — see that file's own Changelog and Final Compliance Report. The
table row in §1 already had this right; this paragraph did not and was
corrected here rather than silently deleted, so the discrepancy itself
is on record. What the document's own Final Compliance Report still
defers: a Compliance Matrix and formal pass/fail verdict against
`AGENTS.md`, left to a maintainer review — that is the actual remaining
step, not more spec-writing.

**Gap found while applying the new `financial-spec-writing-process`
(2026-09-12):** zero external-literature or reference-system citations
exist anywhere in the Posting Rules Engine spec, despite this document's
own §4b already identifying Fowler 6.15 as a better match than 6.8 and
recommending it be "swapped in" — that swap was never actually made in
the spec file itself. Three further findings from this pass, not yet
applied to the spec (recorded here per Step 5, pending a decision on
whether to add them):
- **Kieso, IFRS Insights supplement to Ch.4 "Income Statement and
  Related Information," pp.4-45–4-46** — verified directly: IFRS
  requires expenses classified either by *nature* (raw expense types —
  Poland's zespół 4) or by *function* (COGS/selling/admin — zespół 5),
  and notes many companies use a **"dual approach"** (function on the
  income statement, nature-level detail in the notes), which the
  IASB/FASB discussion paper "also recommends." This gives konto 490's
  whole reclassification mechanism a real international-accounting
  grounding, not just a Polish bookkeeping quirk — Polish full-books
  practice (parallel zespół 4 + zespół 5, bridged via konto 490) *is* an
  implementation of exactly this dual approach.
- **Fowler 6.15.2 "Derived Accounts"** (p.130-131) — confirmed the exact
  match already flagged in §4b: an account defined by a filter over
  entries by attribute, not a real ledger account — structurally the
  closest analog to how `DefaultAccountPostingRule` derives a zespół-5
  posting from a zespół-4 entry's cost-center attribute.
- **Hay §7.19 "Cost Center Assignment,"** pp.150–151 — read in full:
  Hay's own model treats `COST CENTER ASSIGNMENT` as polymorphic (an
  internal organization, work center, piece of equipment, product, or
  project), deliberately generic. This module's own `CostCenter` entity
  is flat (`code`/`name`/`isActive`, no hierarchy, no polymorphic
  target) — a legitimate Phase 1 simplification, but worth naming as a
  deliberate one rather than leaving it unremarked.

**ERPNext comparison (2026-09-12, `docs.frappe.io/erpnext/cost-center`):**
ERPNext models Cost Center as a **hierarchical tree** (group/non-group,
`Parent Cost Center`), attached per line item on a transaction, with a
"Cost Center Allocation" feature for percentage-based distribution
across multiple cost centers — all real, checkable divergences from this
module's flat, single-`defaultCostCenterId` Phase 1 model. More
important: **ERPNext confirmed to have no automatic reclassification
between expense-by-nature and expense-by-function accounts at all** —
its Cost Center is a reporting/filtering tag on one chart of accounts,
not a bridge between two parallel charts. This module's entire
reclassification mechanism (real double-entry postings into a second,
zespół-5 chart via konto 490) **has no direct ERPNext analog** — worth
recording as a confirmed absence, not a gap in the research, per this
project's citation-check discipline.

**Applied to the spec itself (2026-09-12).** All four findings above
(Kieso dual nature/function-of-expense, Fowler Derived Accounts, Hay
Cost Center Assignment divergence, ERPNext absence) are now written
directly into `.ai/specs/2026-09-06-posting-rules-engine.md`'s own new
"Literature & Prior Art" section, not just recorded here — commit
`a12b8fd15` on `docs/posting-rules-engine`. This entry stays as the
searchable index; the spec carries the citations for anyone reading it
standalone.

**New 2026-09-10 — a second, real repository entered the picture.**
`financial-pl` (Polish KSeF 2.0 e-invoicing + JPK_V7/VAT compliance)
already exists as a substantial, real module — but not in *this* repo.
It lives in `open-mercato/official-modules`, a separate git repository
wired in as an optional, currently-uninstalled submodule
(`external/official-modules/`, see this repo's `official-modules.json` —
`activated: []`), on an unmerged branch (`feat/financial-pl-invoice-ux`).
Confirmed by direct inspection, not assumed: its `index.ts` declares no
`requires: ['ledger']` today, and every JPK_V7 field is sourced from its
own invoice tables (`ReceivedInvoice`, `PurchaseVatRecord`), never from
GL. **This is a correction of an earlier statement in this session** —
`financial-pl` was initially, wrongly, described as not existing yet; it
does exist, just in a sibling repo and on a feature branch, which this
document's module map above (scoped to *this* repo's `.ai/specs/`) has
no way to show. Worth remembering for any future reader of this doc: the
module map above is not the whole picture once `official-modules` is in
play.

That module matters here because of JPK_KR_PD — Poland's electronic-
accounting-books filing, phased in from 2026 (Ministry of Finance
brochure and `gov.pl/kas`, both now in §3/§5 as Tier 1 sources).
**Confirmed target (2026-09-10, internal decision):** Commerce Weavers
needs JPK_KR_PD support and has decided to build it — no longer a
hypothetical scoping question. Extending `financial-pl` to support it
is that module's first-ever cross-module *read* from `ledger`, in
bulk — a different shape of dependency than AP's existing write-side
one. Full analysis: `2026-09-10-jpk-kr-pd-financial-pl-analysis.md`
(delivered directly to the user, not committed anywhere —
research/analysis, not a spec). One concrete outcome already has a real
spec in *this* repo, listed in the table above:
`2026-09-10-general-ledger-bulk-read-service.md` (PR #6038) — the
cross-module read contract `SPEC-010` (JPK_KR_PD, in `official-modules`)
will depend on. The GL core engine spec's Out of scope section
(2026-09-10, three times now) tracks the same gap and points at the
same document.

**Literature & Prior Art applied to the spec itself (2026-09-12).**
Per the financial-spec-writing-process: re-verified this document's own
#5663/#6013 citations directly (zero corrections needed — the first
spec in the family with a clean re-check on both). Recorded a genuine,
near-total absence of ledger/posting material in Hay/Fowler (Hay
mentions "ledger" twice, unrelated; "posting" not once). Compared
against ERPNext/Frappe (docs.frappe.io — no shared bulk-read service,
each report queries directly) and Odoo (odoo-master.readthedocs.io —
the opposite extreme, any module queries any model directly via
`self.env`, no service layer at all): this document's formal
DI-resolved contract sits deliberately between both. Written directly
into `2026-09-10-general-ledger-bulk-read-service.md`'s own new
"Literature & Prior Art" section — commit `dfb9b77a0` on
`docs/general-ledger-bulk-read-service`.

**Update (2026-09-11) — a first draft of `SPEC-010` now exists.**
`2026-09-11-jpk-kr-pd-financial-pl.md`, staged **temporarily** in this
repo's own `.ai/specs/` (not yet moved to `official-modules`, and not
yet through any review — see that file's own status banner). It still
needs the primary-source XSD verification pass and depends on `#6038`
merging first, so "buildable" hasn't changed — but "still not written"
no longer describes it, and the GL core engine spec's Out of scope
bullet (PR #5663) has been corrected to match (see that spec's own
Changelog).

---

## 2. Cross-cutting conventions already settled (the real source of truth)

These were fought for once, across GL/AP/JELD, and confirmed consistent with
each other on 2026-09-08. Any new financial module should default to reusing
them rather than reinventing an equivalent.

**Control account + subsidiary ledger.** Per-counterparty (kontrahent)
breakdown of a shared liability/asset account is *not* modeled as separate
GL accounts, and not as a `journal_entry_line_dimension` row either. It's
modeled the standard bookkeeping way: one shared control account
(`accounts_payable.liabilityAccountId`) at the GL level, with the
per-vendor detail living in the consuming module's own application tables
(`VendorInvoice.vendorId`, keyed rows) as the subsidiary ledger. Confirmed
independently in `general-ledger-core-engine.md` (Out of Scope →
"Subsidiary ledgers"), `accounts-payable.md` (Access Control / Design
decisions), and `journal-entry-line-dimension.md` ("Excludes the
counterparty") — all three cross-checked against each other on 2026-09-08.
Grounded in real law, not just convention: **Ustawa o rachunkowości
(Polish Accounting Act), art. 13 ust. 1 pkt 3 and art. 16** require exactly
this — subsidiary ledgers (księgi pomocnicze) per counterparty, reconciled
against the control account. This is a stronger, more directly applicable
citation than anything in Fowler or Hay (see §3) — use *this* for any
design-decision citation in future AP/AR/GL-adjacent specs, not the
software-pattern books.

**Three distinct tagging mechanisms — don't conflate them.**
1. `LedgerAccount.parentAccountId` — static, single-dimension Chart-of-
   Accounts hierarchy (e.g. `130 Rachunki bieżące` → `130-1 mBank`). One
   parent per account, fixed at setup time.
2. `journal_entry_line_dimension` — multi-dimensional, contextual tags on a
   posted line (cost centre/MPK, bank account, fixed asset, currency) that
   can co-occur on the same line and don't belong in the chart of accounts
   (would explode it into dead combinations). Deliberately excludes the
   counterparty.
3. `JournalEntryLine.contractorSnapshot` — a denormalized, point-in-time
   audit copy of the counterparty on the line itself, not a live FK and not
   a `journal_entry_line_dimension` row (audit trails must not retroactively
   change if the counterparty record is edited later).

A future module needing "which X was this posting about" should figure out
which of these three shapes actually fits before adding a new mechanism —
most needs are already one of these three.

**Event-driven cross-module posting, not synchronous coupling.**
`postJournalEntry` emits an ephemeral, in-process, no-retry event
(`ledger.journal_entry.posted`); consumers (e.g. the planned Posting Rules
Engine) subscribe and post their own follow-up entries via their own
`postJournalEntry` call. Because delivery isn't guaranteed atomic with the
source commit, every consumer that relies on this needs two more things: a
sweeper/reconciliation command that finds and fixes orphaned unprocessed
entries after a crash (see `ReconcileCostRingCommand` in the Posting Rules
Engine draft), and its own period-lock guard at the consumer level (the
emitter's `lockFiscalPeriod` can't be vetoed by a subscriber, since
subscriber errors are only logged, never propagated).

**Module dependency direction.** Upstream modules (e.g. `ledger`) never
import or resolve a downstream consumer (e.g. `posting_rules`,
`accounts_payable`) — enforced repo-wide per `packages/core/AGENTS.md`, and
explicitly re-verified in each of these specs' compliance sections.

**Phase 1 / Phase 2 scope discipline.** Every one of these specs ships a
real, usable vertical slice first and explicitly defers the "generator"
or "automation" layer on top — e.g. the `CLOSING` journal entry type
exists in GL Phase 1, but the automated year-end-close generator that
computes and emits its lines is deferred; Fixed Assets' depreciation is a
manual trigger in Phase 1, scheduler in Phase 2. When scoping a new module,
look for this same "data model + manual/explicit trigger first, automation
later" split before inventing a different phasing.

**`commandBus.execute(commandId, { input, ctx })`** — two-argument form.
Several early spec drafts (including AP, before its maintainer-review fix
round) mis-cited this as three-argument; the real signature lives at
`packages/shared/src/lib/commands/command-bus.ts:223-226`. Worth a quick
grep-check on any new spec's code samples before finalizing.

---

## 3. External sources — ranked by actual authority for this project

**Tier 1 — normative/legal (cite these for compliance claims):**
- **Ustawa o rachunkowości** (Polish Accounting Act) — art. 13, art. 16 for
  subsidiary ledgers; the actual legal basis for this system's Polish
  compliance (Biała Lista, MPP, VAT already referenced elsewhere in AP).
  This is the primary source of truth for *this* project, ahead of any
  English-language textbook or software-pattern book.
- **IFRS** (IAS 1 presentation, IAS 37 liability recognition) and **US
  GAAP** (FASB ASC 405 "Liabilities") — only relevant if/when
  multi-jurisdiction support beyond Poland is actually built (SPEC-024's
  Layer 3 country-plugin architecture anticipates this).
- **Ministry of Finance JPK_KR_PD brochure** (podatki.gov.pl, published
  26.08.2024) and **gov.pl/kas, "Elektroniczne księgi rachunkowe w
  podatku PIT w 2026 r."** — the primary regulatory sources for
  JPK_KR_PD's structure and phase-in dates (fetched and read directly
  2026-09-10, see the `financial-pl` analysis). Same tier as UoR: a
  government source, directly on-point, ahead of any secondary
  tax-advisory explainer.

**Tier 2 — textbook/terminology (cite these when you need the *named*
pattern "control account" / "subsidiary ledger" in English, since neither
Fowler nor Hay use those exact terms):**
- **Kieso, Weygandt, Warfield, *Intermediate Accounting*, 17th Ed.**
  (Wiley, 2019, ISBN 978-1-119503682) — **VERIFIED DIRECTLY, full book**
  (1584 pages, not a sample excerpt — full-text searched end to end). Two
  independent hits, both strong:
  1. Ch.3 "The Accounting Information System," "Basic Terminology" box,
     p.3-5 — a clean glossary-style definition: "A general ledger is a
     collection of all the asset, liability, stockholders' equity,
     revenue, and expense accounts. A subsidiary ledger contains the
     details related to a given general ledger account."
  2. Ch.7 "Cash and Receivables," p.7-12, footnote 5 — applies it directly
     to AR, using *both* terms in the same sentence: a risk of "a lack of
     correspondence between the control account and the subsidiary ledger
     related to accounts receivable."
  This is now the best-verified source in the whole knowledge base: the
  most widely used/canonical intermediate-accounting textbook, checked as
  a complete book rather than a marketing excerpt. (Earlier drafts of this
  file cited a 19th Ed./ISBN 9781394254439 based on an unverified
  recommendation from a research pass — that edition was never actually
  seen. Correct it to the 17th Ed. above wherever it was already used.)
  **New 2026-09-11 — Ch.19 "Accounting for Income Taxes" (pp.19-1–19-40),
  read in full for SPEC-010's `RPD` node** (JPK_KR_PD, `financial_pl` —
  see §1 above): temporary differences ("the difference between the tax
  basis of an asset or liability and its reported... amount in the
  financial statements, which will result in taxable amounts or
  deductible amounts in future years," p.19-5, these reverse and need a
  schedule) vs. permanent differences (items in book income never in tax
  income, or vice versa, p.19-14, these never reverse) is a real,
  usable classification axis for the "deductibility flag" `LedgerAccount`
  doesn't have today. **Scope carefully**: only the axis/vocabulary
  transfers — Illustration 19.31's actual example list (municipal-bond
  interest, key-officer life insurance, fines, percentage depletion) is
  US Internal Revenue Code content, not Polish; ustawa o CIT art. 15–16
  is the only correct source for what Polish RPD categories actually
  contain. Full detail and the Phase-2 design sketch built on it are in
  `2026-09-11-jpk-kr-pd-financial-pl.md` (SPEC-010 draft) itself, not
  duplicated here.
- Free alternative: Lumen Learning, *Financial Accounting*, chapter
  literally titled "Subsidiary Ledgers and Control Accounts"
  (courses.lumenlearning.com/finaccounting/chapter/subsidiary-ledgers-and-control-accounts)
  — freely linkable, no licensing concern.
- **Spiceland, Nelson, Thomas, Winchel, *Intermediate Accounting*, 11th
  Ed.** (McGraw Hill, 2023, ISBN 978-1-264-13452-6) — verified directly,
  but only via a 55-page publisher sample excerpt (front matter + partial
  Ch.2, book pp.44-65 of 107; cuts off before Appendix 2C "Subsidiary
  Ledgers and Special Journals," p.85, and before the AP/AR chapters).
  On p.49 it states the pattern in plain English: "The general ledger
  accounts serve as control accounts," with subsidiary ledgers (e.g. one
  AR record per customer) reconciled against that control account. A
  different book from the Kieso one above — good secondary confirmation,
  but Kieso above is now the stronger citation since it was checked as a
  complete book.

**Tier 3 — software-analysis-pattern literature (data-modeling vocabulary,
not accounting authority — useful for *how to model*, not *what's
compliant*):**
- Fowler, *Analysis Patterns* — ch.5 "Referring to Objects" (Name,
  Identification Scheme, Object Merge, Superseding, Object Equivalence —
  see §4, relevant to vendor/customer dedup, not yet cross-checked against
  Contractor Registry); ch.6 "Inventory and Accounting" (Account,
  Transaction, Summary Account, Memo Account, Posting Rules, Corresponding
  Account, Specialized Account Model). Confirmed via full-text search: does
  **not** use "control account" or "subsidiary ledger."
- Hay, *Data Model Patterns* — ch.7 "Accounting" (pseudo-entity Account/
  Account Type, Account Categories and Structure, Cost/Revenue Center
  Assignment) — read in full; the ACCOUNTS PAYABLE pseudo-entity discussion
  (pp.124–130) is the closest real textual match to our control-account
  design of anything found so far. Ch.6 "Contracts" (Purchase
  Orders/Sales Orders, Contract Roles, pp.95–116) has **not** been read yet
  — flagged in §4 as the most promising unexamined lead for AP/AR vendor
  modeling.
- martinfowler.com, "Patterns for Accounting"
  (martinfowler.com/eaaDev/AccountingNarrative.html) — live, confirmed to
  also avoid "control account"/"subsidiary ledger" terminology.
- **New 2026-09-11 — checked and confirmed empty for income tax / RPD
  content.** Full-text search of both PDFs for "tax" while researching
  SPEC-010's `RPD` node: Hay's only 3 hits are an unrelated "Federal tax
  ID" example attribute; Fowler's Ch.6 "Inventory and Accounting" has zero
  "tax" occurrences. Neither book models income tax, deferred tax, or
  book/tax reconciliation — Kieso Ch.19 (above) is the only relevant PDF
  for that topic. Recorded so a future pass doesn't re-search these two
  for the same thing.
- Arlow & Neustadt, *Enterprise Patterns and MDA* (Addison-Wesley,
  ISBN 9780321112309) — same genre as Fowler/Hay, has an archetype-pattern
  treatment of party/account structures; not yet checked for AP-specific
  content.

**Tier 4 — open-source reference implementations (see it running for
real):**
- **GnuCash** docs (gnucash.org/docs/v5/C/gnucash-guide/bus_ap.html) —
  explicitly documents one shared AP GL account with per-vendor detail
  reconstructed via linked Vendor/Bill/Payment records. The cleanest
  real-world confirmation found of exactly our pattern.
- **Odoo** (odoo.com/documentation/19.0/applications/finance/accounting.html)
  — Partner Ledger report consolidates receivable/payable transactions per
  partner, filtered by account type; matches the pattern, schema-level
  detail not confirmed.
- **Apache Fineract** (cwiki.apache.org/confluence/display/FINERACT/Accounting)
  — has a documented double-entry accounting module; no AP-specific control-
  account doc found.
- **ISO 20022** — payment/remittance messaging standard; relevant only if a
  future Cash & Bank Management module needs bank-statement/payment
  interchange format, not for internal ledger modeling. Low priority.

---

## 4. Open leads for the next comparison pass (not yet done — flagging, not claiming)

This first pass was targeted, not exhaustive — it checked what the
control-account question needed, not a line-by-line audit of every spec
against every chapter of Fowler/Hay. Leads worth a real look before the next
module (AR is next per SPEC-024's ordering) is designed:

- **Hay ch.6 "Contracts"** (Purchase Orders/Sales Orders, User
  Specifications, Contract Roles, pp.95–116) — unread. This is exactly the
  chapter that would validate or challenge how AP models the vendor/PO
  relationship and how a future AR spec should model the customer/sales-
  order relationship. Worth reading before drafting AR.
- **Fowler's Object Merge / Superseding / Object Equivalence** (ch.5,
  pp.90–93) — models what happens when two records turn out to be the same
  real-world entity, with three strategies (copy-and-replace, superseding,
  essence/appearance) and explicit guidance on which to use when a merge
  might later need undoing. Relevant question, not yet checked against the
  actual repo: does Contractor Registry (#5955) or AP have any vendor
  merge/deduplication path today, and if one gets built, which of these
  three strategies fits (essence/appearance is the one Fowler recommends
  when a merge might be wrong and need undoing — plausibly the safest
  default for merging vendor records)?
- **Fowler's Corresponding Account** (6.13, p.124) — models reconciling two
  independent parties' own books for the same real-world asset (e.g. your
  checkbook vs. the bank's ledger). Directly anticipates the future "Bank
  Reconciliation" module (SPEC-024 §4.2) — worth revisiting when that spec
  is drafted.
- **Fowler's Posting Rules for Many Accounts** (6.8, p.116–118) — describes
  triggering a posting rule from any subsidiary of a summary account, and
  the knowledge-level (account-type-based) vs. summary-account-based choice
  for defining rules across many accounts. Directly relevant precedent for
  the Posting Rules Engine draft's own 4→5 reclassification design — worth
  a compare-and-contrast once that spec moves past draft.
- **Hay's Account Categories and Structure** (7.21, p.153–154) — a simple
  hierarchical account roll-up. Our actual design (parentAccountId +
  journal_entry_line_dimension split) is already more expressive than this
  (supports multiple co-occurring dimensions, not just one hierarchy) — noted
  as a validation that we're ahead of this particular pattern, not a gap.

None of the above are confirmed gaps — they're specific, checkable questions
that this pass didn't have time to answer. Worth another verification round
if/when Contractor Registry merge behavior, Bank Reconciliation, or the
Posting Rules Engine's account-selection design come up for real.

---

## 4b. Verification of the 2026-09-08 literature-notes memo

A separate memo (`kontekstliteraturadonaniesienia.md`) proposed mapping
specific Fowler/Hay sections onto our modules. It was written when only
Hay's 51-page free sample was available, so its Hay items were flagged as
"unverified, check if we buy the book." We since obtained and read the full
277-page Hay book (§3 above), so every item below was checked against real
text, not just figure titles. Corrections matter here — two of the
Posting-Rules-Engine mappings and two of the Chart-of-Accounts mappings
pointed at the wrong section.

**Posting Rules Engine:**
- 6.5 Posting Rules, 6.7 Posting Rule Execution — confirmed accurate, verbatim
  match to the chapter's own framing ("turns a traditionally passive
  recording system into an active system," p.95).
- 6.8 Posting Rules for Many Accounts — **correction**: this section is about
  *one rule firing uniformly across many accounts of the same type/hierarchy*
  (e.g. "every employee's holiday accrual"), not about *one line needing
  several simultaneous dimensions at once* (MPK + kontrahent). Different
  problem; not a match for `journal_entry_line_dimension`.
- 6.15 Booking Entries to Multiple Accounts — **correction, and the real
  find**: this is *not* about multi-legged transactions (that's §6.2.1,
  already independently confirmed elsewhere as the real match for "1 debit,
  many credits"). 6.15 is actually about one value needing classification
  along **multiple overlapping dimensions at once** — Fowler's own example is
  a consulting expense that's simultaneously "ACM's expense" and "airfare
  category." He gives three solutions: a DAG of overlapping summary accounts
  (flags a double-counting risk if dimensions overlap), memo entries, or
  **derived accounts** — an account defined by a filter over entries by
  attribute (6.9 "Choosing Entries"), not a real ledger account at all. That
  third option is structurally the closest match to what
  `journal_entry_line_dimension` actually does (a queryable attribute on the
  line, not an account). This is a stronger, more precise citation for that
  module than 6.8 — worth swapping in.

**Fixed Assets (Hay, now fully verified, not just a figure title):**
- 7.10 Depreciation (p.135) — confirmed: `DEPRECIATION EXPENSE` = an EQUITY
  (EXPENSE) DEBIT decrementing an expense account of type "depreciation
  expense," plus an ASSET CREDIT decrementing the specific depreciated
  asset's own account (Hay's example: `MACHINE A`). Matches our own
  design directly.
- 7.18 Assets (p.149) — confirmed, and a strong validation: Hay draws exactly
  our own "Ideal vs. Real" progression — an idealized 1:1 asset-to-account
  mapping, then the real-world need for a many-to-many `ASSET ASSIGNMENT`
  between assets and accounts. This directly backs the Fixed Assets draft's
  own Design Decision ("Its own asset register, not just `parentAccountId`") —
  worth citing there.

**Chart of Accounts / `journal_entry_line_dimension`:**
- 6.3 Summary Account — confirmed real (already verified in depth earlier this
  session); structurally a GL-level hierarchy roll-up, not the same shape as
  our dimension table (already noted in §3/§4 above).
- 6.4 Memo Account — the memo's "prawdopodobny" hedge was already appropriate;
  no correction, just still unconfirmed as a match for konta pozabilansowe.
- 6.13 Corresponding Account — **correction**: this is *not* about debit and
  credit pointing to related accounts within one transaction (that's
  ordinary double-entry, §6.2 Transaction). It's specifically about **two
  independent parties each keeping their own account for the same
  real-world asset**, needing reconciliation — Fowler's example is a personal
  checkbook vs. the bank's own ledger for the same account, posted on
  different dates. Not relevant to double-entry mechanics; directly relevant
  to a future **Bank Reconciliation** module (SPEC-024 §4.2), as already
  flagged in §4 above.
- 6.14 Specialized Account Model — **correction**: not about `parentAccountId`
  vs. other specialization mechanisms. It's about subtyping the whole
  Account/Entry/Transaction pattern into a non-monetary domain (Fowler's
  example: inventory "holdings" per location × goods-type instead of money
  accounts). Actually relevant to a different live question: Fixed Assets'
  draft explicitly chose *not* to model the asset register as a subtyped
  Account structure ("Its own asset register, not just `parentAccountId`") —
  6.14 is the pattern that alternative would have followed. Worth a
  one-line note in Fixed Assets' Design Decisions contrasting the choice
  made against this pattern, not adopting it as a citation.

**Contractor Registry:**
- Chapter 2 "Accountability", 2.1 Party — confirmed real (verified the actual
  chapter intro and 2.1's opening just now, not just the memo's guess from a
  title). Fowler's Party is exactly "the supertype of person and
  organization" — a full, developed pattern, not a stub. Genuinely the
  strongest unread lead in the whole memo; worth reading in full before
  next touching Contractor Registry's `isVendor`/`isCustomer` design.

## 5. Quick links

- Ustawa o rachunkowości: https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19941210591
- MF JPK_KR_PD brochure: https://www.podatki.gov.pl/media/if5hycxm/broszura_informacyjna-dotycz%C4%85ca-struktury-jpk_kr_pd-1-26082024.pdf
- gov.pl/kas, electronic accounting books (PIT, 2026): https://www.gov.pl/web/kas/elektroniczne-ksiegi-rachunkowe-w-podatku-pit-w-2026-r
- Lumen Learning, "Subsidiary Ledgers and Control Accounts": https://courses.lumenlearning.com/finaccounting/chapter/subsidiary-ledgers-and-control-accounts
- Kieso, Weygandt, Warfield, *Intermediate Accounting*, 17th Ed. (Wiley, 2019, ISBN 978-1-119503682) — verified directly, see §3
- IAS 37 (IFRS Foundation, 2025 text): https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2025/issued/ias37.html
- FASB ASU 2023-04 (ASC 405-50): https://storage.fasb.org/ASU%202023-04.pdf
- Fowler, "Patterns for Accounting": https://martinfowler.com/eaaDev/AccountingNarrative.html
- Arlow & Neustadt, *Enterprise Patterns and MDA*: https://www.amazon.com/Enterprise-Patterns-MDA-Building-Archetype/dp/032111230X
- GnuCash Accounts Payable guide: https://www.gnucash.org/docs/v5/C/gnucash-guide/bus_ap.html
- Odoo Accounting docs: https://www.odoo.com/documentation/19.0/applications/finance/accounting.html
- Apache Fineract Accounting wiki: https://cwiki.apache.org/confluence/display/FINERACT/Accounting
- Fowler, *Analysis Patterns* (PDF supplied by user, this conversation)
- Hay, *Data Model Patterns* (PDF supplied by user, this conversation)
