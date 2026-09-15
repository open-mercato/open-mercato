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

What actually exists right now, and where. All branches below live on
the contributor's fork (`mikoajp/open-mercato`), not on `develop` — the
PR links are the only way to browse a spec's actual content until it
merges.

| Module | File | Branch | Status |
|---|---|---|---|
| Contractor Registry | [`2026-09-06-contractor-registry.md`](https://github.com/open-mercato/open-mercato/pull/5955) + `...-implementation-guide.md` | `docs/contractor-registry` | Open, PR #5955 — full spec, closed external maintainer review (two blockers + six majors fixed); Final Compliance Report: ready for maintainer review; literature/real-system findings from the 2026-09-12 pass are proposed, not yet applied (see Notes below the table and Changelog) |
| General Ledger core engine | [`2026-08-18-general-ledger-core-engine.md`](https://github.com/open-mercato/open-mercato/pull/5663) + `...-implementation-guide.md` | `docs/spec-072-general-ledger-core-engine` | Open, PR #5663 — see Changelog for the two 2026-09-14 corrections (leaf-postability guard ownership; `reverseJournalEntry` event emission) |
| Accounts Payable (invoices) | [`2026-09-06-accounts-payable.md`](https://github.com/open-mercato/open-mercato/pull/5962) | `docs/accounts-payable` | Open, PR #5962 — merged latest `develop`; first `financial-spec-writing-process` pass applied (own new Literature & Prior Art section + real-system comparison, commit `d572a4001`), see Changelog |
| Accounts Payable (payments) | [`2026-09-06-accounts-payable-payments.md`](https://github.com/open-mercato/open-mercato/pull/5962) | `docs/accounts-payable` | Open, PR #5962 |
| Journal Entry Line Dimension | [`2026-09-06-journal-entry-line-dimension.md`](https://github.com/open-mercato/open-mercato/pull/5972) | `docs/journal-entry-line-dimension` | Open, PR #5972 — written, not yet reviewed |
| GL account balances / Trial Balance (ZSiO) | [`2026-09-09-general-ledger-account-balances.md`](https://github.com/open-mercato/open-mercato/pull/6013) | `docs/general-ledger-account-balances` | Open, PR #6013 — written, not yet reviewed |
| Fixed Assets | [`2026-09-06-fixed-assets.md`](https://github.com/open-mercato/open-mercato/pull/6014) | `docs/fixed-assets` | Open, PR #6014 — full spec, adversarially reviewed, Final Compliance Report: fully compliant |
| Posting Rules Engine (konto 490) | [`2026-09-06-posting-rules-engine.md`](https://github.com/open-mercato/open-mercato/pull/6015) | `docs/posting-rules-engine` | Open, PR #6015 — two external-maintainer review rounds (nine issues, then eight more), both resolved; see the spec's own Changelog |
| This knowledge base | [`2026-09-08-financial-module-knowledge-base.md`](https://github.com/open-mercato/open-mercato/pull/6016) | `docs/financial-module-knowledge-base` | Open, PR #6016 (self-referential row — will read stale the moment this PR merges; treat "Open" as provisional) |
| GL bulk cross-module read service | [`2026-09-10-general-ledger-bulk-read-service.md`](https://github.com/open-mercato/open-mercato/pull/6038) | `docs/general-ledger-bulk-read-service` | Open, PR #6038 — not yet reviewed by a maintainer; prerequisite for SPEC-010 below |
| SPEC-010 — JPK_KR_PD (`financial_pl`, targets `official-modules`) | [`2026-09-11-jpk-kr-pd-financial-pl.md`](https://github.com/open-mercato/open-mercato/pull/6069) | `docs/jpk-kr-pd-financial-pl` (staged temporarily in this repo, not yet moved to `official-modules`) | Open, PR #6069 — first draft; depends on #6038 merging first; XSD verification pass done (see Changelog), one finding (Q4/`S_12_1`) still only proposed, not applied |
| Accounts Receivable (sales invoice → GL posting) | [`2026-08-18-sales-invoice-gl-posting.md`](https://github.com/open-mercato/open-mercato/pull/6046) | `docs/sales-invoice-gl-posting` | Open, PR #6046 — full spec, one independent adversarial review pass (eleven issues fixed) plus a Final Compliance Matrix; not yet reviewed by a maintainer |
| Cash & Bank Management | [`2026-09-10-cash-bank-management.md`](https://github.com/open-mercato/open-mercato/pull/6055) | `docs/cash-bank-management` | Open, PR #6055 — full spec, two independent adversarial review passes (14 + 5 issues fixed) plus a literature-verification pass; not yet reviewed by a maintainer |
| Multi-Currency, Budgeting & Forecasting, Cost Accounting | — | — | Not started (SPEC-024 only) |

**`financial-pl` (JPK_V7/KSeF) lives outside this repo.** It's a real,
substantial module, but in the separate `official-modules` repository —
wired in as an optional, currently-uninstalled submodule
(`external/official-modules/`; this repo's `official-modules.json` has
`activated: []`), on an unmerged branch (`feat/financial-pl-invoice-ux`).
Not shown in the table above, which is scoped to this repo's
`.ai/specs/`. JPK_KR_PD support is a confirmed target for that module
(no longer hypothetical); SPEC-010 above is the in-repo spec for the
cross-module read contract it will depend on.

**Findings recorded here but not yet written into the spec files they
describe** (the 2026-09-12 research pass produced these; only three of
the seven "written directly into the spec" claims from that pass were
actually followed through — see Changelog for which):

- Contractor Registry (`2026-09-06-contractor-registry.md`) — Fowler
  Ch.2 "Party" + Hay Ch.3 "Parties" citations, the ERPNext/Odoo/Comarch
  real-system comparison, and a fix for the stale "`sales-invoice-gl-posting`
  … planned, not yet written" cross-reference (that spec now exists,
  PR #6046) are all proposed only — no "Literature & Prior Art" section
  exists on `docs/contractor-registry` today.
- Cash & Bank Management (`2026-09-10-cash-bank-management.md`) —
  literature grounding (Kieso Appendix 7A, Fowler's Corresponding
  Account) is genuinely cited inline in Design Decisions, but was never
  consolidated into its own dedicated "Literature & Prior Art" section.
- SPEC-010 (`2026-09-11-jpk-kr-pd-financial-pl.md`) — the Q2 correction
  (VAT-filing-frequency cohort split, not the size-based one) and the
  new Q4 (`S_12_1` field gap) are both proposed only; the file as
  pushed still has the old, size-based Q2 wording and only Q1–Q3.

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
round) mis-cited this as three-argument; the real signature lives on the
`CommandBus.execute` method in
`packages/shared/src/lib/commands/command-bus.ts` (cite the symbol, not a
line range — line numbers rot on every edit above them). Worth a quick
grep-check on any new spec's code samples before finalizing.

**Account numbers are illustrative, never literal.** A real client's
chart of accounts (380 rows) confirmed account numbering is
accountant-specific, not standardized across tenants — the same way
Comarch Optima/Symfonia/enova365 all let a company customize its own
imported plan kont. `ledger` seeds only `LedgerAccountGroup` (the
zespoły 0–8 buckets), never a real `LedgerAccount` row for any
tenant. Any specific account number named in a spec ("account 490",
"account 401", a VAT clearing account, etc.) is illustrative only —
the actual account must come from tenant-specific settings, never a
seed or a hardcoded constant. Confirmed the hard way: Posting Rules
Engine's first draft hardcoded a "401 → 500" mapping and a fabricated
"500-99" suspense account; both were replaced by a `PostingRulesSettings`
entity with nullable, admin-configured account fields (reject-if-unset),
mirroring `FixedAssetSettings`'s established pattern (see Changelog,
2026-09-14).

**A module event must be documented on every command that produces
the state it describes, not just the first one written.** GL core
engine's `postJournalEntry` was documented as emitting
`ledger.journal_entry.posted`; `reverseJournalEntry` was not,
anywhere — even though a downstream subscriber (Posting Rules
Engine's reversal-mirroring design) already assumed a `REVERSAL`
entry's lines arrived through that same event. If more than one
write command touches the same aggregate and downstream subscribers
are meant to see all of them, say so for each command individually;
an event documented on only the first-written command is easy to
silently leave off later ones (see Changelog, 2026-09-14).

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
  **New 2026-09-15 — Ch.13 "Current Liabilities and Contingencies,"
  p.13-4, read for Accounts Payable.** Confirmed: "Accounts payable, or
  trade accounts payable, are balances owed to others for goods,
  supplies, or services purchased on open account," arising "because
  of the time lag between the receipt of services or acquisition of
  assets and the payment for them," with an explicit warning that "a
  company must pay special attention to transactions occurring near
  the end of one accounting period and at the beginning of the next.
  It needs to ascertain that the record of goods received (the
  inventory) agrees with the liability (accounts payable), and that
  it records both in the proper period." Directly grounds Accounts
  Payable's own account-300 (GR/IR) timing-gap design decision — a
  recognized, generic accounting concern, not a project invention.
  **Correction to how Ch.3 has been cited**: Ch.3's "Basic
  Terminology" box (p.3-5, quoted above) defines "Ledger"/"subsidiary
  ledger" only generically — it does not define "control account" as
  its own term. That term appears in Kieso only tied to the
  receivable-side footnote (Ch.7, p.7-12, fn.5).
  `2026-08-18-sales-invoice-gl-posting.md`'s own Literature & Prior
  Art section (PR #6046) describes Ch.3 as giving "the general...
  definition used for Accounts Payable's payable side" for "control
  account" specifically — that phrasing is imprecise; Accounts
  Payable's own new Literature & Prior Art section (PR #5962) carries
  the corrected citation. Not edited in the AR file itself (out of
  scope for the AP pass) — noted here so a future pass can fix it.
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
  see §4, relevant to vendor/customer dedup; cross-checked against
  Contractor Registry 2026-09-12, confirmed no such mechanism exists
  today); ch.6 "Inventory and Accounting" (Account,
  Transaction, Summary Account, Memo Account, Posting Rules, Corresponding
  Account, Specialized Account Model). Confirmed via full-text search: does
  **not** use "control account" or "subsidiary ledger."
- Hay, *Data Model Patterns* — ch.7 "Accounting" (pseudo-entity Account/
  Account Type, Account Categories and Structure, Cost/Revenue Center
  Assignment) — read in full; the ACCOUNTS PAYABLE pseudo-entity discussion
  (pp.124–130) is the closest real textual match to our control-account
  design of anything found so far. **Confirmed and applied 2026-09-15**
  in Accounts Payable's own new Literature & Prior Art section: Figure
  7.1 "Accounts" (pp.119-120, "A LIABILITY ACCOUNT is any amount owed to
  another party") and Figure 7.6 "Expenses" (pp.129-130, the VENDOR
  BILL/VENDOR PAYMENT pattern, quoted verbatim there) are a near 1:1
  structural match to `postVendorInvoice` (VENDOR BILL: expense debit +
  liability credit) and the sibling payments module's
  `markPaymentBatchSent` (VENDOR PAYMENT: liability debit + cash credit).
  Ch.6 "Contracts" (Purchase
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
  might later need undoing. **Checked against Contractor Registry
  (2026-09-12): confirmed no such mechanism exists today** — NIP
  uniqueness prevents exact duplicates but not a two-different-NIPs
  case (e.g. post-reorganization re-registration), and `nip`'s
  unconditional immutability forecloses an in-place fix. Recorded as a
  real, un-actioned gap in that document's own "Literature & Prior
  Art" section, not applied — no Phase 1 need is evidenced yet. AP's
  own vendor-registration path was not separately re-checked this pass
  (it resolves contractors by FK-id only, so any merge would happen
  here, not there).
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
specific Fowler/Hay sections onto our modules. That memo is not part of
this repository — it was supplied directly in the session that compiled
this document and is not independently re-checkable by a future reader;
treat every claim below as verified against the books themselves (§3),
not against the memo. It was written when only
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
- Chapter 2 "Accountability", 2.1 Party — confirmed real, and now read in
  full (2026-09-12, not just the chapter intro as in the original
  2026-09-08 spot-check). Fowler's Party is exactly "the supertype of
  person and organization" — a full, developed pattern, not a stub.
  Proposed for `2026-09-06-contractor-registry.md`'s own future
  "Literature & Prior Art" section, alongside an independent second
  confirmation from Hay Ch.3 "Parties" (pp.23-24) — **not yet applied**;
  no such section or commit exists on `docs/contractor-registry` today
  (see Notes in §1 and Changelog, 2026-09-12). No longer an unread lead
  as far as the *research* goes, even though the write-back is pending.

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
- Fowler, *Analysis Patterns: Reusable Object Models* (Addison-Wesley,
  1996, ISBN 0-201-89542-0) — see §3 for verification method
- Hay, *Data Model Patterns: Conventions of Thought* (Dorset House,
  1996, ISBN 0-932633-29-3) — see §3 for verification method

## Changelog

### 2026-09-08

- Initial document compiled while cross-checking Fowler/Hay against the
  GL/AP/JELD specs.

### 2026-09-09

- Fixed Assets and Posting Rules Engine moved off an uncommitted worktree
  onto their own `docs/` branches and PRs (#6014, #6015); this document
  itself got its own branch and PR (#6016).
- Fixed Assets (#6014) completed as a full spec, picked up three
  UoR-driven scope additions (salvage value; prospective-only
  revision; impairment plus mandatory reversal), and passed a
  fresh-context adversarial review (two blockers fixed).
- A reference chart of accounts surfaced a real Fixed Assets defect:
  accumulated depreciation and impairment write-downs need separate
  ledger accounts (070/071 vs. 072), not one combined field. Fixed;
  Final Compliance Report reached rev. 3.

### 2026-09-10

- Cash & Bank Management written as a full spec (bank statements, four
  match types, FX gain/loss on settlement) — initially miscategorized
  in §1 as "Not started"; corrected to its own row.
- `financial-pl` (JPK_V7/KSeF) confirmed to already exist, in the
  separate `official-modules` repo, on an unmerged branch — not visible
  in this document's module map, which is scoped to this repo (see §1
  Notes). JPK_KR_PD support confirmed as a real target for that module
  (no longer a hypothetical scoping question).
- Accounts Receivable (`sales-invoice-gl-posting`) written for the
  first time, closing a dependency three sibling specs had named since
  2026-09-06. One independent adversarial review pass (eleven issues
  fixed, including a real double-entry balance bug from an unhandled
  header-level discount).
- GL bulk cross-module read service spec written (PR #6038) as the
  read contract SPEC-010 (JPK_KR_PD) will depend on.

### 2026-09-11

- Cash & Bank Management: Step 3 (real-system comparison) closed
  against ERPNext (auto-matching baseline) and Comarch ERP Optima
  (hybrid: auto-match, mandatory manual verification before posting).
- First draft of SPEC-010 (JPK_KR_PD) written, staged temporarily in
  this repo pending a move to `official-modules`.
- Kieso Ch.19 ("Accounting for Income Taxes") read in full for
  SPEC-010's `RPD` node — temporary vs. permanent differences is a
  usable classification axis; only the axis/vocabulary transfers, not
  Illustration 19.31's US-specific example list (ustawa o CIT is the
  correct source for what Polish RPD categories actually contain).

### 2026-09-12

`financial-spec-writing-process` applied across several specs in one
pass. Three of the following seven findings were actually written back
into their spec files (marked **applied**); the other four were only
ever recorded here (marked **proposed, not applied** — see §1 Notes):

- Accounts Receivable — added a missing citation (Kieso Ch.7
  receivable-control-account footnote, art. 13/16 UoR) and an ERPNext
  comparison. **Applied** to `2026-08-18-sales-invoice-gl-posting.md`'s
  own new "Literature & Prior Art" section (commit `80b642585` on
  `docs/sales-invoice-gl-posting`).
- Posting Rules Engine — four findings (Kieso's IFRS nature-vs-function
  "dual approach"; Fowler 6.15 "Derived Accounts" as the real match,
  not 6.8; Hay's Cost Center Assignment is polymorphic where this
  module's is flat; ERPNext has no reclassification-between-charts
  analog at all). **Applied** to
  `2026-09-06-posting-rules-engine.md`'s own new "Literature & Prior
  Art" section (commit `a12b8fd15`).
- GL bulk-read service — re-verified #5663/#6013 citations (clean);
  recorded Hay/Fowler's near-total silence on ledger/posting material;
  compared against ERPNext/Frappe and Odoo (both queried directly, no
  shared read-service layer in either — this module's DI-resolved
  contract sits deliberately between the two extremes). **Applied** to
  `2026-09-10-general-ledger-bulk-read-service.md`'s own new
  "Literature & Prior Art" section (commit `dfb9b77a0`).
- Contractor Registry — added to the module map for the first time.
  Fowler Ch.2 "Party" (confirmed, read in full) and Hay Ch.3 "Parties"
  (independent second confirmation) plus an ERPNext/Odoo/Comarch
  real-system comparison. **Proposed, not applied** — no "Literature &
  Prior Art" section exists on `docs/contractor-registry` (the cited
  commit `e8dd1b1de` does not exist). The stale
  `sales-invoice-gl-posting` "planned, not yet written" cross-reference
  in that same file is likewise still uncorrected.
- SPEC-010 Q2 — re-derived the filing cohort as VAT-filing-frequency-based
  (Group 1: monthly `JPK_V7M`, FY2026, due April 2027; Group 2:
  quarterly/exempt, FY2027, due April 2028), not the size-based
  "largest-taxpayer window" the original Q2 wrongly borrowed from
  `JPK_CIT`. **Proposed, not applied** — `docs/jpk-kr-pd-financial-pl`
  still has the old, size-based Q2 wording (the cited commit
  `8c4402def` does not exist). Confirmed against gov.pl/web/kas
  (cross-checked with taxeo.pl) that the target deployment profile
  keeps full accounting books, not `PKPiR`, so `JPK_KR_PD` is the
  right structure to keep building regardless of cohort.
- SPEC-010 primary-source XSD verification — against the published
  Schemat_JPK_KR_PD documentation (cross-checked with Comarch ERP XL's
  own implementation notes): `RPD` is a small, manually-completed
  summary node, not the per-posting classification problem originally
  assumed (downgrades a "comparable to Posting Rules Engine" Phase 2
  estimate); ZOiS has eight entity-type variants and the target
  deployment profile needs ZOiS7 ("jednostki pozostałe"); a mandatory
  field, `S_12_1` (per-account financial-statement-category marker),
  has no source anywhere in `LedgerAccount`/`LedgerAccountGroup` today.
  **Proposed, not applied** — `docs/jpk-kr-pd-financial-pl` still has
  only Q1–Q3, no Q4 for the `S_12_1` gap (the cited commit `970d42e07`
  does not exist).
- A paragraph describing Posting Rules Engine as draft-quality-only
  (contradicting this document's own module-map row) was corrected in
  place: the spec already had every required section and one
  fresh-context adversarial review pass (nine issues fixed) by this
  date.
- Fowler's Object Merge/Superseding (ch.5) cross-checked against
  Contractor Registry: confirmed no such mechanism exists today — NIP
  uniqueness prevents exact duplicates but not a two-different-NIPs
  re-registration case, and `nip`'s unconditional immutability
  forecloses an in-place fix. Recorded as a real, un-actioned gap, not
  applied — no Phase 1 need is evidenced yet.
- §4b memo-verification pass: corrected two wrong Fowler section
  mappings for Posting Rules Engine (6.8 "Posting Rules for Many
  Accounts" is about one rule firing across many same-type accounts,
  not multiple simultaneous dimensions on one line — 6.15 "Derived
  Accounts" is the real match) and two for Chart of Accounts (6.13
  "Corresponding Account" is about reconciling two independent
  parties' books, i.e. a future Bank Reconciliation module, not
  ordinary double-entry; 6.14 "Specialized Account Model" is about
  subtyping into a non-monetary domain, not `parentAccountId`
  alternatives).

### 2026-09-14

- Posting Rules Engine's second, external maintainer review (pkarw,
  `om-auto-review-pr`) — 8 findings (2 blockers, 3 majors, 2 minors, 1
  nit), resolved via a settings-based redesign (`PostingRulesSettings`
  replaces the earlier hardcoded account assumptions); see that spec's
  own Changelog for the full record.
- A real client chart of accounts confirmed account numbering is
  accountant-specific, not standardized across tenants — promoted to a
  standing convention (see §2).
- GL core engine (#5663): two corrections found while cross-checking
  Posting Rules Engine's second review — claimed ownership of the
  leaf-postability guard (previously an unresolved gap between the two
  specs' Out of Scope sections), and documented `reverseJournalEntry`
  as also emitting `ledger.journal_entry.posted` (a downstream
  subscriber already assumed it did, but #5663 only ever documented
  the event on `postJournalEntry`) — promoted to a standing convention
  (see §2). See #5663's own Changelog (commits `4d17094d0`,
  `8028c3e38`).
- This document's own first external maintainer review (pkarw,
  `om-auto-review-pr`) — **CHANGES REQUESTED**: 1 blocker (B1: of the
  seven "written directly into the spec — commit X" claims in the
  2026-09-12 pass, four cited commits that don't exist in the repo;
  verified independently on 2026-09-15 — three of the seven citations
  are in fact correct, four are not, see above), 2 majors (M1: module
  map missing four open PRs; M2: corrections accreting as unstructured
  inline prose instead of a Changelog), 3 minors (m1: §3 contradicted
  §4/§4b about whether Fowler ch.5 was checked; m2: naming the target
  customer in a public repo; m3: bare filenames not navigable from
  `develop`), 4 nits (n1: line-range citation instead of a symbol; n2:
  the self-referential table row; n3: two unresolvable source
  references; n4: "draft" ambiguity for #6038).

### 2026-09-15

- Addressed the 2026-09-14 review in full: restructured this document
  so §1's table is the only current-state source and this Changelog is
  the historical record (M2); corrected the four false "applied"
  claims to "proposed, not yet applied" and left the three genuinely
  correct ones as-is (B1); added the four missing module-map rows —
  #6013 (GL account balances), #5972 (JELD), #6055 (Cash & Bank),
  #6069 (SPEC-010) — and converted filenames to PR links since none of
  these branches are on `develop` (M1, m3); promoted the two durable
  2026-09-14 findings (account-number literalism; per-command event
  documentation) from dated notes into §2 (M2); fixed §3's stale
  cross-check note (m1); reworded three specific-customer-name mentions
  to "the target deployment profile" per the reviewer's own suggested
  wording, since naming a specific customer in a public OSS repo is a
  publication decision, not a factual correction (m2, ask-first —
  flagged for confirmation rather than assumed); cited
  `CommandBus.execute` by symbol instead of a line range (n1); noted
  the self-referential table row will read stale after merge (n2);
  gave the memo and the Fowler/Hay citations something a future reader
  can actually check (n3); dropped the ambiguous "draft" wording for
  PR #6038 (n4).

### 2026-09-15 (Accounts Payable — financial-spec-writing-process, first pass)

- `2026-09-06-accounts-payable.md` (PR #5962): merged latest `develop`
  (166 commits) first, resolving one trivial conflict in this repo's
  own `.ai/specs/README.md` (two independently inserted table rows at
  the same position — kept both); commit `f7c860df9`.
- Added Accounts Payable's first "Literature & Prior Art" section
  (commit `d572a4001`): Kieso Ch.13 (p.13-4, AP definition + the GR/IR
  timing warning — direct grounding for the account-300 design
  decision); Kieso Ch.3 (pp.3-4–3-5, Ledger/subsidiary-ledger
  definition) with a correction of how
  `sales-invoice-gl-posting.md`'s own citation described that same
  section (see the Tier 2/Kieso entry in §3 above — not edited in the
  AR file itself, only noted); Hay Ch.7 Figures 7.1 and 7.6
  (pp.119-120, 129-130 — VENDOR BILL/VENDOR PAYMENT, a near 1:1 match
  to this module and its payments sibling, now promoted from "closest
  textual match" to a confirmed, applied citation — see the Tier
  3/Hay entry in §3 above); a confirmed absence in Fowler (zero
  "accounts payable"/"payable" matches anywhere in *Analysis
  Patterns*).
- Added a real-system comparison: ERPNext (genuine three-way matching
  via PO/Purchase Receipt, confirming this document's Phase 2
  deferral is a real simplification; automatic post-on-submit GL
  posting, unlike this document's explicit two-step approve-then-post;
  "Stock Received But Not Billed" as the two-sided GR/IR account this
  document's own account 300 implements only one leg of; a dedicated
  Accounts Payable Ageing report this document has no equivalent of),
  Comarch ERP Optima (an explicit, separate booking step closer to
  this document's own two-step design than ERPNext's; no PO/three-way
  matching in its cost-invoice register flow either; no aging-bucket
  report in its base tier, only due-date-filterable unreconciled-
  document lists), and enova365 (a partial, inconclusive check —
  confirmed real AP-adjacent settlement documents exist that neither
  this document nor the other two comparisons mention, recorded as
  genuinely unverified beyond that, not a confirmed absence).
- Cross-checked against this document's own §2 conventions (control
  account/subsidiary ledger, account-number-illustrative-only,
  per-command event documentation) — already compliant on all three;
  no changes needed to §2.
