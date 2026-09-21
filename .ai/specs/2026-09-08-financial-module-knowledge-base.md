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
| General Ledger core engine | [`2026-08-18-general-ledger-core-engine.md`](https://github.com/open-mercato/open-mercato/pull/5663) + `...-implementation-guide.md` | `docs/spec-072-general-ledger-core-engine` | Open, PR #5663 — see Changelog for the two 2026-09-14 corrections (leaf-postability guard ownership; `reverseJournalEntry` event emission); 2026-09-15 forward-pointer to Default Chart of Accounts (#6137) added, commit `7f8180e55` |
| Accounts Payable (invoices) | [`2026-09-06-accounts-payable.md`](https://github.com/open-mercato/open-mercato/pull/5962) | `docs/accounts-payable` | Open, PR #5962 — merged latest `develop`; first `financial-spec-writing-process` pass applied (own new Literature & Prior Art section + real-system comparison, commit `d572a4001`), see Changelog |
| Accounts Payable (payments) | [`2026-09-06-accounts-payable-payments.md`](https://github.com/open-mercato/open-mercato/pull/5962) | `docs/accounts-payable` | Open, PR #5962 |
| Journal Entry Line Dimension | [`2026-09-06-journal-entry-line-dimension.md`](https://github.com/open-mercato/open-mercato/pull/5972) | `docs/journal-entry-line-dimension` | Open, PR #5972 — merged latest `develop`; first `financial-spec-writing-process` pass applied (own new Literature & Prior Art section + real-system comparison, commit `3b3780bd6`), see Changelog |
| GL account balances / Trial Balance (ZSiO) | [`2026-09-09-general-ledger-account-balances.md`](https://github.com/open-mercato/open-mercato/pull/6013) | `docs/general-ledger-account-balances` | Open, PR #6013 — merged latest `develop`; first `financial-spec-writing-process` pass applied (own new Literature & Prior Art section + real-system comparison, commit `8afb415a7`), see Changelog |
| Fixed Assets | [`2026-09-06-fixed-assets.md`](https://github.com/open-mercato/open-mercato/pull/6014) | `docs/fixed-assets` | Open, PR #6014 — full spec, adversarially reviewed, Final Compliance Report: fully compliant; merged latest `develop` and `financial-spec-writing-process` Steps 2-3 applied (own new Literature & Prior Art section + real-system comparison, commit `fc1cf0464`), see Changelog |
| Posting Rules Engine (konto 490) | [`2026-09-06-posting-rules-engine.md`](https://github.com/open-mercato/open-mercato/pull/6015) | `docs/posting-rules-engine` | Open, PR #6015 — two external-maintainer review rounds (nine issues, then eight more), both resolved; 2026-09-15 Out of scope annotated re: Default Chart of Accounts (#6137) — its own chart-of-accounts-import gap stays open, commit `72469b961`; see the spec's own Changelog |
| This knowledge base | [`2026-09-08-financial-module-knowledge-base.md`](https://github.com/open-mercato/open-mercato/pull/6016) | `docs/financial-module-knowledge-base` | Open, PR #6016 (self-referential row — will read stale the moment this PR merges; treat "Open" as provisional) |
| GL bulk cross-module read service | [`2026-09-10-general-ledger-bulk-read-service.md`](https://github.com/open-mercato/open-mercato/pull/6038) | `docs/general-ledger-bulk-read-service` | Open, PR #6038 — not yet reviewed by a maintainer; prerequisite for SPEC-010 below. **Update (2026-09-16):** Phase 2 added — Compliance & Audit export/read-only access (`ledger.audit.export`, `GET /api/ledger/audit/export`), following #6013's own Phase 2 precedent; see the spec's own Changelog |
| SPEC-010 — JPK_KR_PD (`financial_pl`, in `official-modules`) | [`SPEC-010-2026-09-11-jpk-kr-pd-financial-pl.md`](https://github.com/open-mercato/official-modules/pull/54) | `official-modules` fork `mikoajp:docs/spec-010-jpk-kr-pd-financial-pl` → `official-modules:develop` | **Moved 2026-09-18** from `open-mercato#6069` (closed) — reviewed by @pkarw, two rounds of fixes applied and verified against real `official-modules` code, then a compliance pass against `official-modules`' own `AGENTS.md`/spec-writing rules (4 items still Non-compliant, see the spec's own Final Compliance Report); depends on #6038 merging first; number `010` is provisional, not reserved (see the spec's own banner) |
| Accounts Receivable (sales invoice → GL posting) | [`2026-08-18-sales-invoice-gl-posting.md`](https://github.com/open-mercato/open-mercato/pull/6046) | `docs/sales-invoice-gl-posting` | Open, PR #6046 — full spec, one independent adversarial review pass (eleven issues fixed) plus a Final Compliance Matrix; not yet reviewed by a maintainer |
| Cash & Bank Management | [`2026-09-10-cash-bank-management.md`](https://github.com/open-mercato/open-mercato/pull/6055) | `docs/cash-bank-management` | Open, PR #6055 — full spec, two independent adversarial review passes (14 + 5 issues fixed) plus a literature-verification pass; not yet reviewed by a maintainer |
| Default Chart of Accounts (Polish plan kont importer) | [`2026-09-15-default-chart-of-accounts.md`](https://github.com/open-mercato/open-mercato/pull/6137) | `docs/default-chart-of-accounts` | Open, PR #6137 — first document in this family to carry the full `financial-spec-writing-process` (own Literature & Prior Art section + real-system comparison) from its very first draft; cross-spec pass against every sibling spec found and fixed a real defect (070/071/072 split vs. Fixed Assets, commit `981dbf470`), see Changelog |
| Tax Management (Core framework `tax_management` + Poland `financial_pl`) | [`2026-09-16-tax-management.md`](https://github.com/open-mercato/open-mercato/pull/6168) | `docs/tax-management` | Open, PR #6168 — first draft, not yet reviewed; follows the Core-framework-plus-country-plugin split `SPEC-024-2026-02-11-financial-module.md` §10 already mandates |
| Annual Financial Statements (Core `financial_statements` + Poland `financial_pl` — Bilans/RZiS) | [`2026-09-17-annual-financial-statements.md`](https://github.com/open-mercato/open-mercato/pull/6188) | `docs/annual-financial-statements` | Open, PR #6188 — first draft, not yet reviewed; follows the same `SPEC-024-2026-02-11-financial-module.md` §11 Core-framework-plus-country-plugin split as Tax Management (§10); the actual Załącznik nr 1 line templates are Unverified pending a primary-source read (see Tier 1 below) |
| Multi-Currency (exchange rate integration + period-end FX revaluation) | [`2026-09-17-multi-currency.md`](https://github.com/open-mercato/open-mercato/pull/6190) | `docs/multi-currency` | Open, PR #6190 — first draft, not yet reviewed; integration spec against the already-implemented `currencies` module, not a new rate engine; UoR Art. 30 ("wycena bilansowa") is Unverified pending a primary-source read (see Tier 1 below) |
| Deferred Revenue (RMP — scheduled recognition over time for AR/Sales) | [`2026-09-17-deferred-revenue.md`](https://github.com/open-mercato/open-mercato/pull/6193) | `docs/deferred-revenue` | Open, PR #6193 — first draft, not yet reviewed; scope deliberately narrowed to what the Event Storming source material actually supports (AR/Sales only) after an earlier, informal "generic RMK+leasing+loan-installment mechanism" framing was checked against the primary transcript and found to have no basis there (see Changelog); models `RevenueRecognitionScheduleEntry` closely on Fixed Assets' own `DepreciationScheduleEntry`/`accrueDepreciation` shape |
| Budgeting & Forecasting, Cost Accounting | — | — | Not started (SPEC-024 only) |

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
- **Ordynacja podatkowa, art. 61b** and the Ministry of Finance's own
  mikrorachunek podatkowy specification (podatki.gov.pl, verified
  2026-09-16, for `2026-09-16-tax-management.md`) — the primary source
  for the mikrorachunek checksum algorithm (26-character IBAN-format,
  fixed prefix `10100071222`, ISO/IEC 7064 mod-97-10 check digits) and
  the tytuł-przelewu identification requirement. **Corrects a source
  Event Storming recording**, which named the number as "pobierany z
  integracji KIS" (Krajowa Informacja Skarbowa): checked twice, against
  six sources total (the government page, two independent algorithm
  writeups, and a direct check of what KIS itself actually is), the
  number is a pure offline computation with no external integration —
  KIS is a taxpayer telephone helpline and tax-ruling service with no
  technical/API role at all. The likely origin of the note: KIS's own
  site announced mikrorachunek's 2020 launch, plausibly misread
  secondhand as "KIS provides the number." See that document's own
  Design decisions for the full correction.

- **Załącznik nr 1 do Ustawy o rachunkowości** (the statutory Bilans/RZiS
  line-item schema) — **Unverified.** `2026-09-17-annual-financial-
  statements.md` (Annual Financial Statements) names this annex as the
  authoritative source for `financial_pl`'s Bilans/RZiS line templates,
  but this session's own extracted UoR text (`/tmp/uor.txt`) starts at
  Rozdział 2 and does not include the annexes — no primary-source
  verification of the actual line-item text has been done. Flagged
  honestly as a gap, the same discipline already applied to entry-level
  attachments in GL core engine: the template files
  (`financial_pl/lib/bilansTemplate.ts`/`rzisTemplate.ts`) must not be
  implemented from recollection: a full UoR text including its annexes
  needs to be sourced and full-text verified first, the same rigor
  already applied to the mikrorachunek algorithm above.

- **Ustawa o rachunkowości, Art. 9** — **Confirmed** (checked directly against
  the extracted statute text): *"Księgi rachunkowe prowadzi się w języku
  polskim i w walucie polskiej"* (accounting books are kept in Polish and in
  Polish currency). Grounds `2026-09-17-multi-currency.md`'s assumption that a
  Polish-registered tenant's base/functional currency (`currencies.Currency.
  isBase`) is a legal given, not a UI-configurable preference.
- **Ustawa o rachunkowości, Art. 30** ("wycena bilansowa" — the actual
  period-end FX revaluation mandate) — **Unverified.**
  `2026-09-17-multi-currency.md` (Multi-Currency) needs this article to confirm
  P&L-recognition of unrealized FX gain/loss on open balances, but this
  session's extracted UoR text (`/tmp/uor.txt`) runs only Art. 9 through
  roughly Art. 25 (Rozdział 2) — Rozdział 4 ("Wycena aktywów i pasywów"),
  where Art. 30 lives, is not present. Same discipline as the Załącznik nr 1
  gap above: flagged, not implemented from recollection.
- **Ustawa o rachunkowości, Art. 6** (zasada memoriału / accrual
  principle) — **Unverified.** `2026-09-17-deferred-revenue.md`
  (Deferred Revenue) would ideally cite this article as the statutory
  basis for recognizing revenue in the period it is earned rather than
  when cash is received, but this session's extracted UoR text
  (`/tmp/uor.txt`) only covers roughly Art. 9 through Art. 25 — Art. 6
  (Rozdział 1) is outside that range. Same gap pattern as the Art. 30
  and Załącznik nr 1 entries above; flagged rather than assumed.

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
  **New 2026-09-15 — Ch.3 "Closing Entries," Illustration 3.38, read
  for GL Account Balances (ZSiO).** Kieso's own illustrated closing
  entries route revenue and expense through a temporary Income
  Summary account across three separate journal entries — not a
  single entry debiting revenue directly against crediting expense.
  A citation in `2026-09-09-general-ledger-account-balances.md`'s
  Design decisions claimed the latter ("exactly this document's
  `JournalEntryLine` shape"); corrected there and recorded in that
  document's own new Literature & Prior Art section. Worth checking
  before any future spec cites Kieso's closing-entry illustration as
  a single combined entry — it isn't one.
  **New 2026-09-16 — Ch.13 "Current Liabilities and Contingencies,"
  p.13-8, read for Tax Management.** "Sales Taxes Payable" and "Income
  Taxes Payable" are both discussed as current liabilities computed
  from a return/formula and periodically remitted to a governmental
  authority: "a business must prepare an income tax return and
  compute the income taxes payable resulting from the operations of
  the current period"; "most corporations must make periodic tax
  payments... in an authorized bank depository." Grounds
  `2026-09-16-tax-management.md`'s `calculate → post → pay` shape and
  its `TaxLiabilityRecord` current-liability framing. A different page
  and claim from AP's existing Ch.13 p.13-4 citation (GR/IR timing).
  **New 2026-09-17 — Ch.3 "The Accounting Information System,"
  Illustration 3.21 "Categories of Adjusting Entries" and the
  "Unearned Revenues" section (p.3-15), read for Deferred Revenue.**
  Confirmed, directly on point: Illustration 3.21 places "Unearned
  revenues" alongside "Prepaid expenses" as the two deferral
  categories (mirror images of each other), and the prose states:
  "When companies receive cash before services are performed, they
  record a liability by increasing (crediting) a liability account
  called unearned revenues... Instead, [the company] delays
  recognition of revenue until the adjustment process." Directly
  grounds treating `840` (new, see the Default Chart of Accounts
  entry in §1) as a liability credited at invoice time and debited
  down as revenue is earned — the exact mirror of `640`'s RMK
  (prepaid-expense) role already established for Fixed Assets.
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
  3. **New 2026-09-17, for Annual Financial Statements** — three more
     Confirmed hits: Ch.5 "Balance Sheet and Statement of Cash Flows,"
     "Classification in the Balance Sheet" (pp.5-5–5-6, Illustration
     5.1) — the general classified format (Current assets / Long-term
     investments / PP&E / Intangibles / Other vs. Current liabilities /
     Long-term debt / Owners' equity); Mismatch noted alongside the
     confirmation — this is a *flexible* US GAAP convention, whereas
     Poland's Bilans follows a legally fixed line-item schema (see the
     new Tier 1 gap entry above). Ch.4 "Income Statement and Related
     Information," IFRS Insights §"Expense Classifications" (pp.4-44–
     4-46, citing IAS 1) — nature-of-expense vs. function-of-expense
     presentation, both required by construction to reach the same net
     income (worked example, Telaris Co., $205,000 either way); grounds
     RZiS's porównawczy/kalkulacyjny variant-parity requirement as an
     internationally-recognized IAS 1 distinction, not a Polish-specific
     quirk. Ch.4 "Retained Earnings Statement" (Illustration 4.19) — net
     income plus/minus board-decided dividends/appropriations reconciles
     beginning to ending retained earnings; grounds treating the uchwała
     zarządu as external input data, not a system-computed workflow.

- Kieso, *Intermediate Accounting*, 17th Ed. — foreign currency
  transactions/translation: **Confirmed absence, stated by the book
  itself.** Ch.17, footnote 25 (p.17-33): *"Understanding of foreign
  currency hedging transactions requires knowledge related to
  consolidation of multinational entities, which is beyond the scope
  of this text."* One limited, conceptual mention survives: the
  "Global View" sidebar, Ch.7 (p.7-28), on FX risk in receivables —
  no transaction/revaluation mechanics. Ch.3, "Reversing
  Entries—An Optional Step" (p.3-35) — **Confirmed, with a
  location correction** (this section introduces Appendix 3B, pp.
  3-43–3-45, but the appendix itself holds only the worked
  illustration — the defining sentence sits in the main chapter
  body): *"A reversing entry is the exact opposite of the
  adjusting entry made in the previous period."* Grounds
  `2026-09-17-multi-currency.md`'s reuse of GL core engine's existing
  `REVERSAL` mechanism for undoing a prior period's FX valuation,
  instead of a new `JournalEntry.type` value. Full detail in that
  document's own Literature & Prior Art section.

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
  **New 2026-09-17, for Annual Financial Statements**: §6.12 "Balance
  Sheet and Income Statement" (p.123-124) — Confirmed but limited:
  distinguishes balance-sheet accounts (persist a balance across
  periods) from income-statement accounts (reset to zero at period
  end) as a general conceptual pattern; confirms *why* GL core
  engine's `CLOSING` entry needs to zero zespoły 4-7 specifically, but
  doesn't address statement-document generation, line-item mapping, or
  multi-jurisdiction formats — this document's actual design problem
  stays unaddressed in Fowler, consistent with this book's already-thin
  accounting coverage relative to this project's real requirements.
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
- **New 2026-09-15 — confirmed for GL Account Balances (ZSiO).**
  Fowler §6.3 "Summary Account" re-verified verbatim (pp.101-102);
  its own Figure 6.6, in the same section, explicitly names the
  alternative GL Account Balances actually implements — a summary
  account that both receives direct postings and rolls up its
  descendants — not just "the leaf-only restriction we don't
  enforce." Fowler §6.15 "Booking Entries to Multiple Accounts"
  (pp.127-128, Figure 6.32) and Hay's "Summarization" section (ch.7,
  p.154) both independently confirmed: each warns against a
  multi-parent (DAG) account hierarchy as a rare, accident-prone
  design, backing the project's own single-parent `parentAccountId`
  choice from both sides. Hay's Table 7.1 "Debits and Credits"
  (p.122) and Kieso's Illustration 3.1 (ch.3, p.3-5) both confirmed
  identical to each other and to this project's `normalBalance` sign
  convention. Full detail in
  `2026-09-09-general-ledger-account-balances.md`'s own new Literature
  & Prior Art section.
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
- **New 2026-09-16 — checked and confirmed near-empty for "audit," for
  GL Bulk Read Service Phase 2 (Compliance & Audit).** Full-text search
  of both PDFs for "audit" specifically (a fresh, targeted pass —
  distinct from the 2026-09-12 immutability/posting search recorded
  elsewhere in this file). Hay: zero hits in 361 pages. Fowler: three
  hits, two of them directly useful — §6.2 (p.95, "Transactions... add
  a further degree of auditability by linking entries together") and
  §6.5.2 (p.106, "I prefer keeping transactions because they make
  auditing easier for a small price in overhead. If you don't use
  transactions, you will still need some audit mechanism.") both
  ground, in a primary source, this project's existing claim that the
  balanced, immutable `JournalEntry`/`JournalEntryLine` model already
  **is** the audit mechanism Fowler describes needing — the Phase 2
  gap was data egress, not a missing audit concept (the third hit,
  §3.9 p.34, is an unrelated medical-records chapter, noted only for
  completeness). Full detail in
  `2026-09-10-general-ledger-bulk-read-service.md`'s own Literature &
  Prior Art section.
- Arlow & Neustadt, *Enterprise Patterns and MDA* (Addison-Wesley,
  ISBN 9780321112309) — same genre as Fowler/Hay, has an archetype-pattern
  treatment of party/account structures; not yet checked for AP-specific
  content.

- Fowler, *Analysis Patterns* — §3.1 "Quantity" (p.36-38),
  **Confirmed**: *"Monetary values should also be represented as
  quantities... using a currency as the unit... monetary quantities
  can enforce the use of fixed point numbers for the amount
  attribute"* — grounds `currencies.AGENTS.md`'s own 4-decimal-
  precision, no-floating-point rule. §3.2 "Conversion Ratio" (p.38-39),
  **Confirmed, closely on point**: *"For monetary values, whose units
  are currencies, the conversion ratios are not constant over time. We
  can deal with this problem by giving the conversion ratios
  attributes to indicate their time of applicability."* — near-literal
  description of `currencies.ExchangeRate`'s `date`-stamped design;
  the single best literature match found so far in this project. Note:
  Fowler's many other "exchange rate" mentions (ch.9, Trading
  Patterns) are a **Mismatch** for this topic — that chapter models FX
  as a *traded instrument*, not a booked invoice rate or open-balance
  revaluation; flagged so it isn't mistaken for on-topic material
  later. See `2026-09-17-multi-currency.md`'s own Literature & Prior
  Art section for full detail.

- Fowler, *Analysis Patterns*, and Hay, *Data Model Patterns* — checked
  for "deferred revenue," "unearned revenue," "prepaid," and
  "amortization schedule" (Deferred Revenue, 2026-09-17): **confirmed
  absence in both books**, consistent with the established pattern for
  this pair — neither treats scheduled-recognition-over-time as a
  data-modeling problem at all. Kieso (Tier 2 above) remains the only
  literature source for this topic.

**Tier 4 — open-source reference implementations (see it running for
real):**
- **ERPNext** (`frappe/erpnext` source — `financial_statements.py` —
  and docs.frappe.io, verified 2026-09-15 for GL Account Balances):
  Trial Balance is a live query directly over `tabGL Entry`, no
  maintained running-balance table — the strongest real-system
  confirmation in this document of the project's own "live query, not
  a maintained balance table" choice, verified at the source-code
  level rather than from documentation prose alone. Shows group
  (parent) account rollup totals by default (`frappe/erpnext#27131`);
  a documented bug (`frappe/erpnext#41453`) getting nominal-account
  opening-balance zeroing wrong is worth remembering as a real failure
  mode when any future spec touches period-closing interactions.
  **New 2026-09-15, for Fixed Assets** (docs.frappe.io Asset Depreciation
  docs, documentation-level only this time, not source-verified): ERPNext
  generates the full depreciation schedule upfront at asset creation and
  posts the identical Depreciation Expense debit / Accumulated
  Depreciation credit shape — a third real system (after GnuCash/Odoo,
  Fixed Assets' own prior Market Reference callout) agreeing with Fixed
  Assets' "materialize in full at acceptance" choice. No documented
  impairment feature at all, so Fixed Assets' impairment flow goes beyond
  a mature open-source ERP's public feature set rather than merely
  matching it. Comarch ERP Optima and enova365 were also checked for
  Fixed Assets (verified 2026-09-15) but aren't open source, so they're
  not added here — see `2026-09-06-fixed-assets.md`'s own Literature &
  Prior Art section and this document's Changelog below for the full
  three-system comparison, including enova365's dedicated "Odpis
  aktualizujący" document, the strongest real-system validation found yet
  for Fixed Assets' impairment flow.
  **New 2026-09-15, for Journal Entry Line Dimension** (Accounting
  Dimensions, docs.frappe.io, documentation-level, verified 2026-09-15):
  the strongest real-system validation found for this module's own
  design. ERPNext supports an open-ended number of custom accounting
  dimensions and, critically, supports attaching dimension values at
  the individual transaction-row level, not just the document level —
  confirming `journal_entry_line_dimension`'s own line-level (not
  document-level) choice against a mature, real production ERP. Genuine
  divergence in mechanism: ERPNext implements each new dimension as a
  dynamically generated schema field (a real column per dimension),
  while our module stores every dimension type as rows in one flexible
  table — precisely why a new `DIMENSION_TYPES` value here is a
  one-line constant change, not a migration, unlike ERPNext's
  schema-per-dimension approach. Comarch ERP Optima ("Opis
  Analityczny," verified 2026-09-15) explicitly breaks document lines
  into multiple dimensions at the individual line level — a second real
  confirmation of the same line-level design choice, in this exact
  market. enova365 names a similarly-titled "Opisy analityczne"
  feature, but public documentation doesn't confirm multi-dimension-
  per-line support specifically — recorded as unverified, not a match.
  Comarch and enova365 aren't open source, so per the same convention
  used for the other modules in this family they're recorded here and
  in the spec's own section, not added as separate Tier 4 entries.
  **New 2026-09-15, for Default Chart of Accounts** (Chart of Accounts,
  docs.frappe.io, verified 2026-09-15): a genuine, honestly-recorded
  divergence, not a validation. ERPNext automatically seeds a default
  chart of accounts at company-creation time and separately offers a
  "Chart of Accounts Importer" to replace that default, but only while
  the company has no pre-existing transactions — the opposite of that
  document's opt-in-only design, which deliberately doesn't reopen GL
  core engine's own no-auto-seed Phase 1 decision. enova365 (Księga
  Handlowa module docs, verified 2026-09-15) and Symfonia
  (finanse.wsparcie.symfonia.pl, verified 2026-09-15) both match that
  document's design closely — an explicit, optional import at company
  setup, fully editable afterward — and enova365 additionally offers a
  choice of templates by business type, exactly the Phase 2
  parametrized-template idea that document defers. Comarch ERP
  Optima's public documentation was inconclusive on this specific
  question. Comarch, enova365 and Symfonia aren't open source, so per
  the same convention used for the other modules in this family
  they're recorded here and in the spec's own section, not added as
  separate Tier 4 entries.
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
- **New 2026-09-16, for GL Bulk Read Service Phase 2 (Compliance &
  Audit)** (docs.frappe.io + odoo.com, WebSearch/WebFetch-verified,
  documentation-level): both ERPNext and Odoo ship a feature literally
  called "Audit Trail," and both turn out to be **a change-log of
  edits to amendable documents** (field-level diffs, who/when,
  versioned amendments), not a bulk-export path for an external
  auditor. A genuine, explainable divergence rather than a gap: both
  reference systems allow posted journal entries to be edited/amended,
  so they need a change-log; this project's GL core engine (#5663)
  forecloses that by design (a posted `JournalEntry` cannot be edited,
  only reversed), so there is nothing to log a change *to* — the
  actual need here is data egress from an already-immutable ledger,
  not change-tracking. GnuCash was not re-checked this pass (already
  recorded above as having no audit-trail feature at all); Apache
  Fineract remains unchecked for this specific question.
- **New 2026-09-16, for Tax Management.** ERPNext, Odoo, and GnuCash
  have no equivalent of a government-assigned, checksum-derived tax
  payment account — a genuine, explainable divergence, not a gap:
  mikrorachunek podatkowy is a Poland-specific administrative
  mechanism (introduced 2020), so no general-purpose or US/EU-generic
  accounting system would have it. Odoo's own generic pattern (pay
  taxes as a normal vendor-style payment against a liability account,
  per its own community documentation) is still consistent with
  `2026-09-16-tax-management.md`'s `TaxLiabilityRecord`
  current-liability shape, just without the Poland-specific payment
  target. Comarch Optima's, enova365's, and Symfonia's specific
  mikrorachunek handling was searched for but not confirmed from
  public documentation — recorded as **Unverified**, per
  `financial-spec-citation-check`, rather than assumed from their
  general Polish-market positioning.
- **New 2026-09-17, for Annual Financial Statements.** **ERPNext**
  (`frappe/erpnext`, `chart_of_accounts.py`, `develop` branch, read
  from the live GitHub source): `report_type` ("Balance Sheet" or
  "Profit and Loss") is derived once from `root_type` (Asset/Liability/
  Equity → Balance Sheet; else → Profit and Loss) and stored on the
  Account at creation — confirms the coarse two-statement split is
  commonly a small, fixed function of a type enum, and confirms by
  *absence* that ERPNext doesn't attempt a fine-grained statutory-line
  mapping at the framework level either. **Odoo** (documentation, v19):
  Account Type fixes Balance-Sheet-vs-Profit&Loss-vs-Off-Balance-Sheet
  placement; its own docs tie correct Account Type configuration to the
  ability to "generate country-specific legal and financial reports,"
  implying the actual statutory line structure is a localization-layer
  concern, not a core-account field — independent confirmation of this
  document's Core-`financial_statements`/`financial_pl` boundary.
  Comarch Optima/Symfonia/enova365 remain Unverified (no public
  technical documentation of their account-to-statement-line mapping);
  GnuCash not directly comparable (no by-nature/by-function P&L variant
  split exists in its account hierarchy).
- **ISO 20022** — payment/remittance messaging standard; relevant only if a
  future Cash & Bank Management module needs bank-statement/payment
  interchange format, not for internal ledger modeling. Low priority.
- **Multi-Currency (`2026-09-17-multi-currency.md`) — Step 3 consciously
  narrowed, not silently skipped.** No ERPNext/Odoo comparison pass was done
  for this spec: the internal precedent is unusually strong (a production-
  grade `currencies` module already in the codebase, plus four independent
  sibling specs — GL core engine, GL account balances, Cash & Bank
  Management, Sales Invoice → GL Posting — that arrived at compatible
  designs, e.g. the same rate-direction convention and the same
  required-not-defaulted rule for a differing-currency rate, without
  coordinating with each other). Recorded here per this project's own
  discipline of noting what was deliberately not done and why, rather than
  leaving a silent gap in the record.
- **New 2026-09-17, for Deferred Revenue.** **ERPNext** (Deferred
  Accounting, docs.frappe.io, verified 2026-09-17): a native, built-in
  feature — schedule computed at the invoice-line level, direction-
  mirrored for deferred revenue and deferred expense alike, with both
  an automatic (scheduler-driven) and a manual "Process Deferred
  Accounting" trigger (Income/Expense type, posting date, service-date
  range, optional account filter). Confirms the shape (line-level
  schedule, liability-account staging) but not the Phase 1 scope
  choice — ERPNext ships the scheduler by default, this project
  deliberately doesn't yet (see the spec's own Design decisions).
  **Odoo** (odoo-users.readthedocs.io, verified 2026-09-17): the more
  load-bearing finding — "Deferred revenues" is an *optional*,
  separately-installed module ("Assets management & revenue
  recognition" under Accounting → Configuration), not part of core/
  default accounting. Once enabled: full invoice amount credited to a
  Deferred Revenue liability account at validation, then automatic
  monthly entries debit that liability and credit income (worked
  example: a $24,000/24-month contract recognizes $1,000/month). This
  directly answers whether scheduled revenue recognition is
  foundational to a financial system or safely deferrable: confirmed
  **not elementary even in a mature ERP** — it's an opt-in add-on
  there too, consistent with this project's own manual-trigger-only,
  no-scheduler Phase 1 design.


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
- **Hay's Account Categories and Structure** (7.21, p.153–154) —
  **corrected 2026-09-15 for completeness, not accuracy**: this note
  previously described 7.21 as only "a simple hierarchical account
  roll-up." On independent re-verification, the same figure actually
  shows *two* distinct mechanisms: the "pig's ear" single-parent
  roll-up (which this note already had, and which our `parentAccountId`
  is already ahead of by design — Hay himself notes generalizing it to
  a DAG "would be extremely difficult to administer," independent
  confirmation of the same single-parent-over-DAG caution already cited
  from Fowler §6.15/Hay's Summarization section elsewhere in this
  document), and ACCOUNT CATEGORY/ACCOUNT CLASSIFICATION — an explicit
  many-to-many join this note missed entirely, real precedent for "more
  than one independent tag on the same thing at once," the same shape
  `journal_entry_line_dimension` has, but at the account level rather
  than the line level. Full correction recorded in
  `2026-09-06-journal-entry-line-dimension.md`'s own new Literature &
  Prior Art section.

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
  module than 6.8 — worth swapping in. **Applied 2026-09-15**: independently
  re-verified (still accurate on a second read) and cited in
  `2026-09-06-journal-entry-line-dimension.md`'s own new Literature & Prior
  Art section as the strongest match found in either book.

**Fixed Assets (Hay, now fully verified, not just a figure title):**
- 7.10 Depreciation (p.135) — confirmed for the DEBIT-expense/CREDIT-asset-
  side mechanic, **corrected 2026-09-15 on precision**: Hay's own
  illustration (`DEPRECIATION EXPENSE` = an EQUITY (EXPENSE) DEBIT plus an
  ASSET CREDIT decrementing the depreciated asset's own account, e.g.
  `MACHINE A`) is the **net method** — crediting the asset's own account
  directly. Fixed Assets' `accrueDepreciation` instead debits
  `ledgerDepreciationExpenseAccountId` and credits a separate
  `ledgerAccumulatedDepreciationAccountId` contra-asset account — the
  **gross method**, matching Kieso's explicit treatment (ch.3, "Adjusting
  Entries," p.3-23) instead of Hay's. The prior note ("matches our own
  design directly") overstated the match; both books confirm the same
  debit/credit *sides*, but Kieso, not Hay, is the accurate citation for
  *which* account gets credited. Full detail in
  `2026-09-06-fixed-assets.md`'s own new Literature & Prior Art section.
- 7.18 Assets (p.149-150) — confirmed real and on point, **cardinality
  corrected 2026-09-15**: Hay draws an "Ideal vs. Real" progression — an
  idealized 1:1 asset-to-account mapping, then a real-world many-to-many
  `ASSET ASSIGNMENT` join letting an arbitrary number of accounts attach to
  one asset. The prior note called this "a strong validation" of Fixed
  Assets' own asset-register design without checking cardinality: Fixed
  Assets actually links each asset to *four* distinctly-named, fixed 1:1
  account roles (`ledgerAssetAccountId`,
  `ledgerAccumulatedDepreciationAccountId`,
  `ledgerAccumulatedImpairmentAccountId`,
  `ledgerDepreciationExpenseAccountId`), not Hay's general many-to-many
  join table. It's a third variant between Hay's two named ones — richer
  than "Ideal," but a fixed typed n-tuple rather than Hay's flexible
  "Real" join — still backing the same Design Decision ("Its own asset
  register, not just `parentAccountId`"), just not as a direct
  implementation of either named Hay pattern. Full detail in
  `2026-09-06-fixed-assets.md`'s own new Literature & Prior Art section.

**Chart of Accounts / `journal_entry_line_dimension`:**
- **New 2026-09-15, for Default Chart of Accounts — Kieso's Illustration
  3.9 (ch. 3, pp. 3-12–3-13), confirmed, and the first citation of
  Kieso in this knowledge base for a chart-of-accounts-shape claim
  rather than only recognition/measurement rules.** Kieso presents a
  real numbered chart of accounts organized by account type, with gaps
  deliberately left inside each numeric range specifically to permit
  the insertion of new accounts later without renumbering anything
  already in use — directly informing that document's own template
  numbering (e.g. `010`/`020`/`070`, not `010`/`011`/`012`). Also
  confirmed: Hay, ch. 7, p. 119 — "the organization has wide latitude
  in setting up the specific list" of account types — direct,
  primary-source support for treating a hardcoded starter template as
  a non-enforced starting point rather than a fixed structure. And a
  genuine absence: Fowler has zero "chart of accounts" mentions
  anywhere in *Analysis Patterns*. Full detail in
  `2026-09-15-default-chart-of-accounts.md`'s own Literature & Prior
  Art section.
- **New 2026-09-15 — Hay's Cost Center Assignment (Figure 7.19
  "Allocating Expenses," pp.150-151), confirmed, and a more precise
  match than 7.21 below for the `CostCenter` dimension type this
  module names literally.** Hay models a COST CENTER ASSIGNMENT that
  can be "of" a broad, open-ended set of entities (internal
  organization, work centre, piece of equipment/product, project, or
  "(something else)"), explicitly because "the possibilities for
  allocating expenses are so broad, COST CENTER could refer to
  virtually anything." That open placeholder is what
  `journal_entry_line_dimension`'s own `DIMENSION_TYPES` enum
  enumerates concretely instead of leaving unbounded. Difference worth
  keeping precise: Hay's assignment is anchored on the EXPENSE
  ACCOUNT (an account-level tag); this module's dimension row is
  anchored on the individual `JournalEntryLine` — one level more
  granular. Figure 7.19 itself only models the one COST CENTER
  dimension, not several co-occurring ones — for that, 6.15 below
  remains the closer match. Full detail in
  `2026-09-06-journal-entry-line-dimension.md`'s own new Literature &
  Prior Art section.
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
  6.14 is the pattern that alternative would have followed. **Applied
  2026-09-15**: cited in `2026-09-06-fixed-assets.md`'s own new Literature
  & Prior Art section as a confirmed "road not taken," not adopted as a
  citation for the design actually chosen.

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
- ERPNext Accounting Reports docs: https://docs.frappe.io/erpnext/v13/user/manual/en/accounts/accounting-reports
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

### 2026-09-15 (GL Account Balances — financial-spec-writing-process, first pass)

- `2026-09-09-general-ledger-account-balances.md` (PR #6013): merged
  latest `develop` (166 commits) first; the only shared-file overlap
  (`.ai/specs/README.md`, this document's own Pending row vs.
  develop's unrelated new row) resolved cleanly by git itself with no
  manual conflict markers; commit `319694a20`.
- Added this document's first "Literature & Prior Art" section
  (commit `8afb415a7`), consolidating and independently re-verifying
  citations already scattered through its Design decisions: Fowler
  §6.3 "Summary Account" (confirmed, plus a newly-cited Figure 6.6
  variant matching the document's own choice to allow direct postings
  to syntetyk accounts — see the Tier 3/Fowler entry in §3 above);
  Fowler §6.15 and Hay's "Summarization" section (both confirmed
  verbatim for the single-parent-over-DAG warning); Hay Table 7.1 and
  Kieso Illustration 3.1 (confirmed for the `normalBalance` sign
  convention). One genuine correction found: Kieso's illustrated
  closing entries (Illustration 3.38) route revenue/expense through a
  temporary Income Summary account across three entries, not one
  entry debiting revenue directly against crediting expense as the
  document previously claimed — fixed there and recorded in the Tier
  2/Kieso entry in §3 above.
- Added a real-system comparison (previously only an inline Odoo
  callout): ERPNext (live query confirmed at the source-code level —
  see the new Tier 4 entry in §3 above), Comarch ERP Optima (the
  closest real-system match found anywhere in this document family —
  its eleven-column ZSiO report is a one-to-one match to the
  document's six `TrialBalanceRowDto` figures, but implies a
  leaf-only-posting restriction this document's Phase 1 doesn't
  enforce — a genuine, recorded divergence; not added to §3 since
  Comarch isn't open source, but see the spec's own Literature & Prior
  Art section for the full finding), and enova365 (same
  four-figure-group shape, recorded as a partial match).
- Cross-checked against this document's own §2 conventions — none
  apply directly (no control-account modeling, no new commands) — no
  changes needed.

### 2026-09-15 (Fixed Assets — financial-spec-writing-process applied for the first time)

- `2026-09-06-fixed-assets.md` (PR #6014): merged latest `develop` (166
  commits) first; the only shared-file overlap (`.ai/specs/README.md`)
  resolved cleanly by git itself, no manual conflict markers; commit
  `caac275d0`.
- Added that document's first "Literature & Prior Art" section (commit
  `fc1cf0464`). Two prior notes in this knowledge base (2026-09-12 pass)
  were independently re-verified against the actual Hay text and found
  imprecise, corrected in both places (see the Tier 3 entries above):
  Hay 7.10 "matches our own design directly" → Hay's illustration is the
  net method (credits the asset's own account); Fixed Assets uses the
  gross method (separate `ledgerAccumulatedDepreciationAccountId`
  contra-asset account), matching Kieso instead. Hay 7.18 "a strong
  validation" → Fixed Assets' actual schema is a fixed four-role 1:1 FK
  design, not Hay's general many-to-many `ASSET ASSIGNMENT` join — a
  third variant, not a direct implementation of either of Hay's two named
  patterns. Fowler §6.14 "Specialized Account Model" (previously only
  flagged as worth a one-line note) was applied as a confirmed "road not
  taken." Also recorded a genuine absence: neither Hay nor Fowler has
  anything on disposal, retirement, or impairment as an accounting
  pattern.
- Added a real-system comparison (previously only the Overview's own
  GnuCash/Odoo asset-lifecycle-shape callout): ERPNext (upfront schedule
  generation and the identical Depreciation Expense/Accumulated
  Depreciation posting; no documented impairment feature — see the new
  Tier 4 note above), Comarch ERP Optima (a genuine divergence — its
  depreciation plan is generated on demand, not upfront, closer to
  Odoo's computed-on-read posture; confirms dual book/tax depreciation
  as a real, separate capability worth Fixed Assets' own Phase 2
  deferral), and enova365 (a dedicated "Odpis aktualizujący" document —
  the strongest real-system validation found for Fixed Assets' own
  impairment flow, plus a "Likwidacja ŚT (LT)" document matching Fixed
  Assets' own disposal naming directly). Comarch and enova365 aren't
  open source, so per the same convention used for GL Account Balances
  they're recorded here and in the spec's own section, not added to the
  Tier 4 list above.
- Cross-checked against this document's own §2 conventions — none apply
  directly (no control-account modeling, no new commands, no new tagging
  mechanism) — no changes needed to §2.

### 2026-09-15 (Journal Entry Line Dimension — financial-spec-writing-process applied for the first time)

- `2026-09-06-journal-entry-line-dimension.md` (PR #5972): merged
  latest `develop` (166 commits) first; unlike the clean auto-merges
  for AP/GL Account Balances/Fixed Assets, this one had a real
  conflict — both branches added a new row to `.ai/specs/README.md`'s
  Pending Specifications table at the same position. Resolved by
  keeping both rows, in date order; commit `65c6a15e4`.
- Added that document's first "Literature & Prior Art" section (commit
  `3b3780bd6`). Independently re-verified two citations already sitting
  in this knowledge base under that document's own entry (see the Tier
  3/§4 entries above): Fowler §6.15 "Booking Entries to Multiple
  Accounts" (confirmed accurate on a second read — the strongest match
  in either book for JELD's own "more than one simultaneous dimension"
  problem); Hay §7.21 "Account Categories and Structure" (corrected for
  completeness — the prior note described only the single-parent
  roll-up half of the figure, missing that the same figure also shows
  an ACCOUNT CATEGORY/ACCOUNT CLASSIFICATION many-to-many join). Added
  one citation this knowledge base never had: Hay's Cost Center
  Assignment (Figure 7.19, pp.150-151) — a more precise match than 7.21
  for the `CostCenter` dimension type JELD names literally. Also
  recorded a genuine absence: Kieso has nothing on cost centres,
  responsibility accounting, or per-transaction analytical dimensions
  anywhere.
- Added a real-system comparison (JELD had none before): ERPNext
  (Accounting Dimensions — the strongest validation found, confirming
  line-level multi-dimensional tagging against a mature open-source
  ERP via a different mechanism, dynamically generated schema fields
  rather than JELD's flexible dimension-type rows — see the new Tier 4
  note above), Comarch ERP Optima ("Opis Analityczny" — explicitly
  breaks document lines into multiple dimensions, a second real
  confirmation of line-level tagging in this exact market), and
  enova365 (a similarly-named "Opisy analityczne" feature exists, but
  public documentation doesn't confirm multi-dimension-per-line support
  specifically — recorded as unverified, not a match).
- Cross-checked against this document's own §2 conventions — JELD is
  already one of the three sources §2's "Three distinct tagging
  mechanisms" convention was built from; no changes needed.

### 2026-09-15 (Default Chart of Accounts — new document, financial-spec-writing-process applied from the first draft)

- `2026-09-15-default-chart-of-accounts.md` (PR #6137): brand-new spec,
  not an enrichment pass — the first document in this family to carry
  a full Literature & Prior Art section and real-system comparison
  from its very first draft rather than as a later pass. Branched
  fresh off `upstream/develop` at `a52dc6707`, no merge conflict to
  resolve.
- Step 1 (cross-spec consistency): confirmed no existing spec, branch,
  or PR already covered this. Found GL core engine's own explicit,
  load-bearing "no default chart of accounts is seeded; tenants build
  their own" Phase 1 decision (#5663, Design decisions), and SPEC-024's
  aspirational, since-diverged-from `IChartOfAccountsTemplate`
  FP-style plugin contract. Surfaced two genuine, consequential design
  forks as Open Questions rather than guessing: (1) scope — PL-only
  hardcoded template vs. a pluggable multi-country framework, resolved
  as PL-only hardcoded; (2) seeding model — resolved as a Phase 1
  opt-in command + button on the existing chart-of-accounts backend
  page (no change to GL core engine's `onTenantCreated` behavior),
  with the onboarding-wizard-integration alternative explicitly
  tracked in Phase 2/Out of Scope, not dropped.
- Step 2 (literature grounding): confirmed Kieso Illustration 3.9 (ch.
  3, pp. 3-12–3-13) — deliberate account-numbering gaps, the first
  citation of Kieso in this knowledge base for a chart-of-accounts-
  shape claim; confirmed Hay ch. 7, p. 119 — "the organization has wide
  latitude in setting up the specific list" of account types; recorded
  a genuine absence — Fowler has zero "chart of accounts" mentions
  anywhere in *Analysis Patterns*. See the new Tier 2/3 entry above.
- Step 3 (real-system comparison): ERPNext recorded as a genuine,
  honestly-documented divergence (it auto-seeds a default chart of
  accounts and separately offers a Chart of Accounts Importer to
  replace it, the opposite of this document's opt-in-only design);
  enova365 and Symfonia both confirmed as close matches to this
  document's opt-in/template/customizable-after design; Comarch
  recorded as inconclusive rather than forced into a comparison. See
  the new Tier 4 note above.
- Step 4 (`om-spec-writing` structure): full document drafted from
  TLDR through Changelog in one pass; Open Questions gate satisfied via
  explicit user confirmation on both questions raised in Step 1.
- Cross-checked against this document's own §2 conventions — no new
  tagging mechanism, no new control-account pattern, no new event; the
  "account numbers are illustrative, never literal" convention (§2)
  directly informed that document's own Data Models section. No
  changes needed to §2.

### 2026-09-15 (cont. — Default Chart of Accounts cross-spec consistency pass, at the user's request)

- Per the user's request to check whether any sibling spec needed
  updating relative to the new Default Chart of Accounts document (or
  vice versa), read every sibling spec directly (GL core engine, JELD,
  Posting Rules Engine, Accounts Payable, GL account balances, AR
  sales-invoice-GL-posting, Fixed Assets) rather than relying on this
  knowledge base's own summaries, per `financial-spec-citation-check`.
- **Found and fixed a real defect in the new document**: its Data
  Models draft modeled zespół 0's `070` as one combined "Umorzenie
  środków trwałych oraz wartości niematerialnych i prawnych" account,
  with no `072` account at all. Fixed Assets' own 2026-09-09 Changelog
  entry ("dedicated accumulated-impairment account, corrected against
  a reference chart of accounts") had already established, against a
  real accounting-team-supplied wzorcowy plan kont, that Polish
  practice keeps `070` (Umorzenie środków trwałych), `071` (Umorzenie
  wartości niematerialnych i prawnych), and `072` (Odpisy
  aktualizujące — impairment) as three genuinely separate accounts,
  and gave `FixedAsset` its own dedicated
  `ledgerAccumulatedImpairmentAccountId` expecting `072` to exist.
  Fixed in `2026-09-15-default-chart-of-accounts.md`, commit
  `981dbf470`: split `070`/`071`, added `072`, totals updated from
  36/40 to 38/42 `LedgerAccountType`/`LedgerAccount` rows.
- **Posting Rules Engine** (#6015): its own Out of scope already named
  "a general chart-of-accounts import mechanism... a distinct,
  `ledger`-owned feature this module depends on existing... but does
  not itself build" (added 2026-09-14). Annotated with an
  **Update (2026-09-15)** pointing to the new document, commit
  `72469b961` — while explicitly recording that the new document is
  *narrower*: it ships one fixed template, not the general "import a
  tenant's own arbitrary numbering scheme" capability that bullet
  describes. That gap stays open.
- **GL core engine** (#5663): its "no default chart of accounts is
  seeded; tenants build their own" statement is a plain architecture
  fact, not a flagged deferred item, so no correction was needed —
  added a one-line forward-pointer for discoverability, commit
  `7f8180e55`.
- **JELD, Accounts Payable, GL account balances, AR sales-invoice-GL-
  posting**: read in full; none make an account-numbering or seeding
  claim the new document contradicts or duplicates (AP/AR both confirm
  the existing "accountant configures via Module Config, no
  auto-picked account" pattern the new document is fully compatible
  with). No changes needed to any of the four.

### 2026-09-16 — GL Bulk Read Service Phase 2 (Compliance & Audit) — research recorded, cross-spec consistency checked

Per Step 5 of the financial-spec-writing-process: recording the
research performed before adding Compliance & Audit as "Phase 2" to
`2026-09-10-general-ledger-bulk-read-service.md`
(`docs/general-ledger-bulk-read-service`), rather than as a new
standalone spec — following the same precedent #6013 itself used for
its own Phase 2 (`ledger.reports.view` added directly to an
already-shipped module).

- **Step 1 (cross-spec consistency):** re-checked this file's §2 and
  #6013's own Phase 2 as the direct precedent. Separately, read
  `2026-09-06-posting-rules-engine.md` in full (1453 lines) — **this
  corrects an earlier informal "Tax Management → Posting Rules
  Engine" pairing**: that document's entire scope is the zespół 4→5
  cost reclassification through account 490; nothing in it touches
  payments, exports, or auditor access. Compliance & Audit and Tax
  Management (KIS/mikrorachunek podatkowy) are two unrelated concerns
  that only ever shared a sentence in an early, informal topic list,
  not a real architectural relationship. Tax Management's own
  placement remains an open, paused question — the user asked to
  defer deciding it; not resolved by this pass.
- **Step 2 (literature):** see the new Tier 3 entry in §3 above
  (Fowler §6.2/§6.5.2, Hay zero hits for "audit").
- **Step 3 (real systems):** see the new Tier 4 entry in §3 above
  (ERPNext/Odoo "Audit Trail" is a change-log, not an export path — a
  genuine divergence explained by this project's immutable
  `JournalEntry` design).
- **Cross-spec consistency check, post-hoc** (does any *other* spec
  need updating for this new scope?): grepped every sibling
  worktree's spec for "bulk-read"/"#6038"/"audit". Three real hits,
  all already fine as-is: **GL core engine** (#5663) points
  generically at "PR #6038 is where the interface is actually
  designed" in its Out of scope bullet — still true, Phase 2 doesn't
  change that pointer. **Posting Rules Engine** (#6015) cites #6038's
  Final Compliance Report only as a formatting convention, unrelated
  to Phase 2's content. **Fixed Assets** names #6038 only as a shared
  merge-ordering dependency among GL-adjacent specs, unaffected by
  Phase 2's content. No sibling spec needed a content change; only
  this knowledge base and
  `2026-09-10-general-ledger-bulk-read-service.md` itself needed
  updating.

### 2026-09-16 (cont. — Tax Management: initial draft, PR #6168)

New module, first draft of the sixth genuinely new open-mercato/
financial_pl piece in this family (after Contractor Registry, Fixed
Assets, JELD, GL bulk read service, and now this one). Per Step 5:

- **Placement**: `SPEC-024-2026-02-11-financial-module.md` §10 ("Tax
  Management") already mandates a Core-framework-plus-country-plugin
  split ("Tax Management is almost entirely implemented through
  country plugins. The Core Engine provides only the framework for
  tax handling") — this document (`tax_management` + `financial_pl`)
  follows that split rather than the single standalone module first
  proposed, before SPEC-024 §10 was found. See the module map above.
- **Mikrorachunek correction**: see the new Tier 1 entry in §3 above —
  the source Event Storming recording's "KIS integration" framing is
  corrected there in full, including the likely origin of the note.
- **New citations**: Kieso Ch.13 p.13-8 (Tier 2, new) and the
  ERPNext/Odoo/GnuCash mikrorachunek-divergence finding (Tier 4, new)
  — see §3 above for both.
- **Cross-spec consistency check** (does any *other* spec need
  updating for this new module?): re-read `2026-09-06-posting-rules-
  engine.md` in full (1453 lines) confirming, independently of the
  Compliance & Audit pass that first found this, zero relation to tax
  payments — its scope is exclusively zespół 4→5 reclassification
  through account 490. Re-checked `2026-09-06-accounts-payable-
  payments.md` and `2026-09-10-cash-bank-management.md` (Overview/
  Problem Statement) and confirmed neither offers a reusable
  payment-initiation primitive this document could reuse without
  breaking their own scope (vendor-specific compliance; explicitly
  not a payment-initiation system, respectively). **GL core engine**
  (#5663) did need a change: its bare "Country-specific tax/compliance
  plugins" Out of scope bullet had no pointer anywhere — added one
  (commit `d6c968a04`), matching the pointer pattern already used for
  #6038. `SPEC-024` itself was read but not edited — it carries no
  cross-reference pointers to any dated spec anywhere in the document,
  for any module, so adding one here would be a new, unprecedented
  convention, not a fix to an existing one.

### 2026-09-17 (cont. — Annual Financial Statements: initial draft, PR #6188)

- **Placement**: `SPEC-024-2026-02-11-financial-module.md` §11
  ("Financial Statements") mandates the same Core-framework-plus-
  country-plugin split already found for Tax Management (§10) —
  confirmed with the user before drafting, given the two prior false
  starts on Tax Management's own scope. `financial_statements` (Core)
  ships only the generic `ReportFormat`/`ReportSection`/`ReportLine`
  shape plus a trial-balance aggregation function; `financial_pl` owns
  the actual Bilans/RZiS templates, mapping, and uchwała input. See
  the module map above.
- **Two SPEC-024-era sketch details corrected** against this project's
  own later conventions: `ReportLine.formula` as an account-number-
  range string (SPEC-024 §2.4's own `"SUM(1000:1999)"` example) —
  replaced with a `StatementLineMapping` table reference, since
  accounts are tenant-created and tenant-renumbered (Default Chart of
  Accounts, #6137); and an implicit assumption that statement-line
  placement could be derived the way GL core engine's simpler
  `reportType` question was (`mapAccountTypeToStatement`, rejected
  there for being redundant state) — replaced with a tenant-configured,
  per-Wn/Ma-side settings entity, once the debit/credit-dependent
  classification requirement (a rozrachunki account can be an asset or
  a liability depending on its balance side) surfaced from the source
  Event Storming session.
- **New citations**: three Kieso hits (Tier 2, new — Balance Sheet
  classification, IAS 1 nature-vs-function parity, Retained Earnings
  Statement), one Fowler hit (Tier 3, new — confirmed but limited), and
  the ERPNext/Odoo statement-placement comparison (Tier 4, new) — see
  §3 above for all.
- **Explicit gap flagged, not silently assumed**: Załącznik nr 1 do
  Ustawy o rachunkowości (the actual Bilans/RZiS statutory line
  schema) has not been primary-source verified in this session — the
  extracted UoR text starts at Rozdział 2 and omits the annexes. Recorded
  as Unverified (Tier 1, new) rather than implemented from recollection;
  a real UoR text including annexes is needed before
  `bilansTemplate.ts`/`rzisTemplate.ts` are actually written.
- **Cross-spec consistency check**: re-read GL core engine (#5663 —
  `CLOSING` entry type, the rejected `reportType`-on-account-type
  alternative), GL account balances (#6013 — `getTrialBalance` shape,
  its own Bilans/P&L Out-of-scope pointer), Posting Rules Engine
  (#6015 — account 490 invariant, its own "different owner" pointer),
  and Default Chart of Accounts (#6137 — accounts fully tenant-editable
  post-import). Both #6013 and #6015 needed a forward-pointer update
  (commits `21e9717db` and `8d4c8c58e`), matching the pattern already
  used for Tax Management → GL core engine.


### 2026-09-17 (cont. — Multi-Currency: initial draft, PR #6190)

- **Scope narrowed significantly from the informal "silnik kursowy"
  framing before drafting began.** Direct reads of the already-
  implemented `currencies` module (`AGENTS.md`, `data/entities.ts`,
  `services/README.md` — not a dated spec, real shipped code) found a
  production-grade, multi-provider (NBP, Raiffeisen), date-based
  exchange-rate service already consumed in production by
  `customers/api/deals`. This spec's real job narrowed to: (1) add
  `exchangeRate`/`currencyId` to `VendorInvoice`/`SalesInvoice`, and
  (2) period-end FX revaluation of open foreign-currency balances — a
  genuinely new capability, but a small one, as a new `fx_revaluation`
  module.
- **Four independent sibling specs, checked in Step 1, all already
  deferred to this document without coordinating with each other**: GL
  core engine (#5663, "a future Multi-Currency spec"), GL account
  balances (#6013, `currency: null` + "a Multi-Currency-spec
  concern"), Cash & Bank Management (#6055, manual `bookedExchangeRate`
  entry required pending this gap), and Sales Invoice → GL Posting
  ("multi-currency exchange-rate handling... stays out of scope").
  `sales.SalesOrder.exchangeRate`'s existence (previously known only
  secondhand via Cash & Bank Management) was verified directly against
  `packages/core/src/modules/sales/data/entities.ts` this pass.
- **Step 3 (ERPNext/Odoo comparison) consciously skipped**, by explicit
  user decision, given how strong the internal precedent already is —
  see Tier 4 note in §3 above.
- **New citations**: two Kieso hits (Tier 2 — a confirmed absence
  stated by the book itself, plus a genuinely load-bearing Ch. 3,
  "Reversing Entries—An Optional Step" (p. 3-35) citation), two Fowler
  hits (Tier 3 — the
  strongest literature match found in this project so far, "Quantity"
  and "Conversion Ratio"), one Hay confirmed-absence (consistent with
  the established pattern for this book), and one UoR Art. 9 confirmed
  citation plus an Art. 30 Unverified flag (Tier 1) — see §3 above for
  all.
- **Design choice**: no new `JournalEntry.type` value for the
  revaluation entry — reuses GL core engine's existing `REVERSAL`
  mechanism plus `referenceType`/`referenceId` tagging (the same
  pattern Cash & Bank Management already uses), avoiding a schema
  change to `ledger` for a case its own reversal design already covers.
- **Cross-spec forward-pointer patches applied**: `accounts-payable.md`
  (`VendorInvoice.exchangeRate`, commit `31a08b1aa`),
  `sales-invoice-gl-posting.md` (`SalesInvoice.currencyId`/
  `exchangeRate` + a coordination note on the now-partially-redundant
  `currencyCode`→`currencyId` resolution step, commit `f7bb59473`), and
  `cash-bank-management.md` (`bookedExchangeRate` default-from-invoice,
  commit `e9dd3da8d`).

### 2026-09-17 (cont. — Deferred Revenue: initial draft, PR #6193)

- **Scope correction applied before drafting, under direct challenge.**
  An earlier-conversation framing ("the recording explicitly says this
  should be one generic mechanism, reused for leasing installments and
  loan/bond capital-plus-interest installments too") had been accepted
  and built into the proposed scope without re-verifying it against
  the actual primary source. When asked directly what the recording
  transcript itself supports, the three actual Event Storming output
  files were read in full (`eventstormingpodsumowanie.md`,
  `eventstormingfinal.md`, `eventstormingwall.html`) and searched for
  "leasing," "kredyt," "obligacj," and "rata kapitałowo-odsetkowa" —
  **zero hits in any of the three files.** The only primary-source
  basis for this topic is narrower and AR/Sales-specific: "Rozpoznano
  przychód w czasie → Zawieszono na koncie bilansowym (RMP) →
  Wygenerowano harmonogram rozliczeń (1/12 co miesiąc)" and "Harmonogram
  rozliczania przychodu w czasie (subskrypcje/POC) — własny spec,"
  explicitly listed under "Nowe względem obecnego zakresu — do
  rozważenia w kolejnych fazach." The spec was scoped to exactly this:
  revenue recognized over time for AR/Sales (subscriptions, annual
  licenses), not a generic RMK+leasing+loan-installment engine. Per
  `financial-spec-citation-check`'s "re-verify under direct challenge"
  rule — recorded here so a future spec doesn't reintroduce the
  leasing/loan framing without first checking for its own primary-source
  basis.
- **Percent-of-Completion (POC) explicitly out of scope**, per the
  source material's own flag: "POC — Percent of Completion (metoda
  stopnia zaawansowania; dopisek „Przewaga" niejasny, do wyjaśnienia z
  ekspertem domenowym)" — the wall itself marks this unclear and
  pending a domain expert, not a design decision this spec should make.
- **Central architectural precedent**: Fixed Assets' own
  `DepreciationScheduleEntry`/`accrueDepreciation` (materialize
  schedule in full, manual/explicit accrual trigger, per-entry
  transaction, idempotent via `accruedAt IS NULL`, fiscal-period-lock
  aware, `referenceType`/`referenceId` tagging) is reused almost 1:1 as
  `RevenueRecognitionScheduleEntry`/`accrueRevenueRecognition` — Fixed
  Assets' own spec had already named this pattern's future
  generalization "Revenue Recognition module" and deliberately declined
  to extract it early with only one real consumer
  (`2026-09-06-fixed-assets.md`, "Generic RMK/scheduled-recognition
  extraction... deliberately deferred architectural debt"). This spec
  follows that same discipline rather than forcing a shared extraction
  now.
- **Module naming**: `deferred_revenue`, deliberately not "Revenue
  Recognition" — SPEC-024 §3.5 already reserves that name for a larger,
  separate topic (ASC 606-style multi-element contract billing/
  allocation, ranked Phase 3 in SPEC-024's own priority table).
- **Reuses `sales_invoice_gl_posting`'s `SalesInvoiceLineRevenueAccount`**
  (each invoice line's originally-credited revenue account, already
  persisted per line at posting time) instead of adding new
  "which income account" configuration — checked directly against
  `2026-08-18-sales-invoice-gl-posting.md`. Also checked directly
  against `packages/core/src/modules/sales/data/entities.ts`:
  `SalesInvoiceLine` has no service-period or deferral fields of its
  own (only a generic `metadata` jsonb), confirming the new module must
  own all deferral-specific data itself.
- **New Default Chart of Accounts gap found and patched**: Zespół 6 has
  `640` Rozliczenia międzyokresowe kosztów czynne (RMK, DEBIT) but
  Zespół 8 had no RMP counterpart. `840` Rozliczenia międzyokresowe
  przychodów (CREDIT) added to `2026-09-15-default-chart-of-accounts.md`
  as a forward pointer (commit `fa3a456dd`), mirroring `640`'s role on
  the credit side.
- **New citations**: one Kieso hit (Tier 2 — Ch.3 Illustration 3.21 +
  the "Unearned Revenues" section, directly on point), one confirmed
  absence spanning both Fowler and Hay (Tier 3), one new UoR Art. 6
  Unverified flag (Tier 1, same gap pattern as the existing Art. 30/
  Załącznik nr 1 entries), and the ERPNext/Odoo comparison (Tier 4) —
  see §3 above for all. The Odoo finding is the load-bearing one: even
  in a mature ERP, scheduled revenue recognition is an optional,
  separately-installed module, not core accounting — directly answers
  whether this capability is foundational or safely deferrable
  (deferrable; Phase 1 here is deliberately manual-trigger-only, no
  scheduler, matching that precedent).

### 2026-09-18 (cont. — SPEC-010 moved to `official-modules`, review verification + compliance pass)

- **PR #6069's review (@pkarw) verified against current HEAD before acting on it** — its own Validation Gate cited a head 4 days stale relative to the branch's real tip at review time. Both Blockers, Major #2's deadline sub-claim, and Major #4/#5 confirmed and fixed on the first pass, reasoning from `open-mercato`'s own precedent (Blocker #2's encryption citation, `api_keys.sessionSecretEncrypted`) since `official-modules` was believed unreachable.
- **`official-modules` access re-checked directly rather than trusted as still-unreachable — it works (`pull`, not `push`).** This let three findings move from guessed/generic to Confirmed against the real `financial_pl` module in `official-modules` (`feat/financial-pl-invoice-ux` branch): Blocker #1's exact scope-derivation pattern (`resolveCommandScope(ctx)`, never trusting the request body — `commands/jpk.ts`), Blocker #2's `defaultEncryptionMaps` citation (confirmed exactly, and a correction to this project's own overclaim: `JpkVatFiling.declarationInputs` is *not* encrypted, so RPD's amount columns don't need to be either), and Major #3/Q5 (real `JpkFilingStatusColumn` is `draft | generated | submitted` plus an undeclared runtime `submitting` value, not the six-state machine originally proposed).
- **New, reusable finding for any future `official-modules` spec: `requires` + direct `container.resolve(...)` on the required module's DI-registered service is an established, sanctioned pattern here, not a Module Isolation violation** — confirmed by reading `open-mercato`'s own `wms` module (`requires: ['catalog', 'sales', 'feature_toggles']`), which resolves `featureTogglesService` directly. The "event bus only" reading of the Module Isolation checklist item is about ORM relations and side effects, not DI-registered service calls for a declared hard dependency. Worth checking again before any future community-module spec assumes a stricter reading.
- **New finding: `requires` cross-repo dependencies (`official-modules` package depending on an `open-mercato`-repo module id) are technically real and enforced** — the module registry generator validates `ModuleInfo.requires` across whatever modules are actually discovered/installed in an app instance, regardless of source package. No existing `official-modules` package does this yet (SPEC-010 would be the first), so it's unprecedented in practice, not unsupported in the framework.
- **`official-modules` has its own, stricter spec process** (`AGENTS.md`, `.ai/skills/spec-writing/SKILL.md`, its checklist and compliance-review templates) that SPEC-010 had never been run against, having been drafted under `open-mercato`'s own `om-spec-writing` convention the whole time. Concrete gaps this surfaced, useful for any future spec destined for `official-modules`: command IDs must include the module prefix (`<moduleId>.<feature>.<action>`, e.g. `financial_pl.jpk.generate` — a prior SPEC-010 draft used `jpk-kr.generate` with no prefix); every mutating command needs an explicit Undo Contract (undoable vs. not, matching real code rather than assumed); table names need the `<module>_<entities>` snake-case-plural convention stated explicitly; a real `Final Compliance Report` with an honest compliance matrix (not rounded up) and a proper `Changelog` section are both required, separate from any banner-style dated notes.
- **SPEC-010 moved**: `open-mercato#6069` closed; now `official-modules#54` (fork `mikoajp/official-modules`, branch `docs/spec-010-jpk-kr-pd-financial-pl` → `official-modules:develop`). Numbered `SPEC-010` provisionally — `develop` only has `SPEC-001`–`004` merged, and `SPEC-005`–`009` are each independently claimed by other, unrelated open PRs there already, so this project's own numbering isn't coordinated across contributors.
- Module map (§1) updated to point at `official-modules#54` instead of the closed `open-mercato#6069`.
- **Cross-spec consistency audit completed (2026-09-18)**, per this project's
  standing five-step spec-writing process, Step 1/5, applied in reverse
  after SPEC-010 moved: checked all other financial-family specs on this
  account's `docs/*` branches for stale SPEC-010/JPK_KR_PD references.
  9 branches were clean (`accounts-payable`, `cash-bank-management`,
  `contractor-registry`, `default-chart-of-accounts`, `deferred-revenue`,
  `general-ledger-account-balances`, `journal-entry-line-dimension`,
  `multi-currency`, `posting-rules-engine`, `sales-invoice-gl-posting`).
  4 branches had live references and got pointer-only, dated updates
  (never rewriting historical Changelog entries): `spec-072-general-
  ledger-core-engine` (#5663), `general-ledger-bulk-read-service` (#6038),
  `annual-financial-statements` (#6188), `tax-management` (#6168). The
  last two both cited SPEC-010's own "Temporary location" banner as
  precedent for staging a `financial_pl`-side spec in this repo — both
  banners now note that SPEC-010 itself has completed that move, while
  making clear their own `financial_pl` halves have not.

### 2026-09-21 (cont. — Annual Financial Statements: maintainer-review + `om-spec-writing` compliance pass, PR #6188)

- **A maintainer-review round (`haxiorz`, running `om-auto-review-pr`) on
  PR #6188 was answered by re-verifying, not just applying, its seven
  findings** — each independently re-derived from #6013's/#5663's own
  design text before being accepted (e.g. confirming `getTrialBalance`'s
  `closingBalance` really is definitionally `0` for zespół 4-7 accounts
  post-`CLOSING`, rather than trusting the review's characterization).
  All seven confirmed and fixed: RZiS-basis-vs-closing-balance (the
  headline bug — RZiS must read pre-closing YTD turnover, never
  post-closing balance, or every fiscal year reports zero revenue/
  expense by construction), account-mapping double-counting via
  `parentAccountId` rollups (fixed with a validated antichain, not "one
  row per account"), missing derived totals/subtotals, missing
  reconciliation-before-lock (reused `posting_rules.lockFiscalPeriod`'s
  existing zespół-4→5 gate rather than inventing a new one — see the
  reusable finding below), `ClosingResolution` having no link to which
  `CLOSING` revision it validated against, an unusable raw-audit
  exporter, and no `StatementLineMapping` concurrency control.
- **Reusable finding: prefer reusing an existing command's own
  precondition machinery over inventing a parallel one.** The RZiS/
  Bilans generation precondition ("is this fiscal period safe to
  report on") turned out to already exist, nearly verbatim, as Posting
  Rules Engine's `lockFiscalPeriod`'s own reconciliation gate
  (`findUnreclassifiedEntries`) — reusing it instead of writing a
  second, parallel reconciliation check kept the two modules from
  silently disagreeing about when a period is "closed enough."
- **A full `om-spec-writing` process run surfaced gaps a review-findings-only
  pass had missed, on direct challenge from the user** ("czy to pokrywa
  wszystkie zgłoszone issues w review i naniosłeś zgodnie ze strategią
  naszą literature i wywołałeś om-spec-writing"). The maintainer-review
  fix pass had approximated the skill's structure from its own summary
  rather than reading `.agents/skills/om-spec-writing/` itself. Reading
  it surfaced: a missing Internationalization (i18n) section (an
  outright §5 gap, not a refinement); the required scope-cohesion check
  had never been delegated to a fresh-context subagent (run properly
  this round — verdict NO SPLIT); fresh Step 2/3 literature/real-system
  grounding had not been done specifically for the two brand-new design
  decisions (added: a real, independently found ERPNext merged bug-fix
  precedent, `frappe/erpnext#44878`, for the RZiS-basis bug's real-world
  comparability); and the Final Compliance Report / formal `### Review`
  changelog block the skill requires had never actually been produced.
- **Self-caught arithmetic error, found on re-derivation, not reported by
  anyone**: the maintainer-review fix's own worked example for the
  RZiS-basis correction put a revenue account's `CLOSING` debit on the
  wrong side (`ytdCredit` instead of subtracting from `ytdDebit`), and
  the mirror error for expense accounts. Caught while re-deriving the
  example for the fresh literature citation; corrected, with an added
  algebraic proof (grounded in Kieso Ch. 3's reversing-entry
  mirror-image property, p. 3-35 — not Appendix 3B itself, which only
  holds the worked illustration — already verified for the
  Multi-Currency spec)
  that a `CLOSING` entry and its `REVERSAL` cancel in the raw turnover
  sums regardless of which side each lands on — so the reopen/correction
  flow is unaffected by which side the original arithmetic slip picked.
- **`financial-spec-citation-check` caught a fabricated-precedent risk in
  this project's own prior work, not just external literature.** The
  maintainer-review fix for mapping-edit concurrency cited "the same
  pattern `PostingRulesSettings`/`TaxCodeAccountMapping` already use" for
  a DIY `version`-integer optimistic lock. Re-checked directly against
  both entities' actual Data Model sections
  (`2026-09-06-posting-rules-engine.md`; `tax_management`'s
  `2026-09-16-tax-management.md`): both entities are real, but **neither
  uses a `version` field — both are `{ …, updatedAt }`**, matching this
  project's actual default-ON optimistic-lock convention (root
  `AGENTS.md`), not the DIY scheme the citation had been used to justify.
  Reusable finding: a citation naming a real, correctly-spelled entity
  can still misdescribe *which* mechanism that entity uses — spelling a
  name right is not the same as verifying the claim, and the check has
  to read the entity's own field list, not just confirm the entity
  exists.
- **Net effect of the compliance pass**: `StatementLineMapping` dropped
  its bespoke `version` column entirely in favor of the framework's
  `updatedAt`/`CrudForm`/`surfaceRecordConflict` mechanism, which in turn
  let its `GET`/`PUT` routes move from a hand-written command-backed
  route to plain `makeCrudRoute` `list`/`update` handlers — a
  simplification that came *from* running the compliance check properly,
  not despite it.
- Still open, unaffected by this round: the Załącznik nr 1 statutory line
  names' primary-source verification (Ustawa o rachunkowości) remains
  Unverified, as first flagged in the 2026-09-17 entry above — this
  round touched architecture/mechanism compliance only, never the actual
  statutory line-name content.

### 2026-09-21 (Multi-Currency — maintainer-review + `om-spec-writing` compliance pass, PR #6190)

- An automated specification review found ten issues in
  `2026-09-17-multi-currency.md` (rate selection, sign convention,
  zero-netting, reversal atomicity, settlement timing, historical
  cutoff, cross-currency defaulting, migration semantics, base-currency
  identity, missing preview/history contracts). Every finding was
  re-verified directly against primary sources — the actual
  `currencies` module source, the GL core engine and Cash & Bank
  Management specs, and the live `sales`/`currencies` commands — before
  being addressed, following the same discipline as the Annual
  Financial Statements maintainer-review round.
- **New, reusable facts about the `currencies` module, confirmed
  directly against source (not previously recorded here):**
  - `ExchangeRateService.getRate()`/`getRates()` take currency
    **codes**, not `currencyId`s, and return a `RateResult` whose
    `rates` field is an **array** (every provider row for that exact
    pair/date), not a scalar — a caller that reads `rates[0]` (as
    `customers/api/deals/aggregate/route.ts` already does, for
    display only) is not a pattern to reuse for a posting decision.
  - `ExchangeRate.type` (`'buy' | 'sell' | null`) is **fixed by query
    direction** for both bundled providers, not an independent axis:
    querying `XXX → PLN` always returns `type: 'buy'` rows from both
    NBP and Raiffeisen (checked directly against
    `providers/nbp.ts`/`providers/raiffeisen.ts`) — the only real
    multiplicity within a single directional query is **which
    provider** (`source`), confirmed by `ExchangeRate`'s own unique
    constraint (`organizationId, tenantId, fromCurrencyCode,
    toCurrencyCode, date, source` — no `type` column in the
    constraint).
  - `ExchangeRateService.findExactRates()` **does** filter stored
    `ExchangeRate` rows by their own `isActive: true` — this is a
    different `isActive` flag from `Currency.isActive`, which is what
    `currencies/AGENTS.md`'s "MUST NOT filter rate fetching by
    `isActive`" rule actually governs (which currencies
    `RateFetchingService` fetches new rates *for*, never which stored
    rate rows a lookup selects). A citation in the Multi-Currency
    spec's first draft conflated the two — corrected there (Design
    decision 2); recorded here so a future spec doesn't repeat the
    conflation.
  - Both bundled rate providers (`NBPProvider`, `RaiffeisenPolandProvider`)
    hard-require **PLN** on one side of every pair
    (`providerBaseCurrency = 'PLN'`, gated by
    `availableCurrencies.has('PLN')`) — auto-fetching is structurally
    PLN-base-only today, regardless of what `Currency.isBase` says for
    a given tenant. Relevant to any future non-PLN-base scenario.
  - `NBPProvider` fetches only NBP's **Table C** (commercial bid/ask),
    never **Table A** (the average rate Polish statutory practice
    generally associates with balance-sheet valuation, "kurs średni
    NBP") — checked directly against `providers/nbp.ts`'s API endpoint
    (`/exchangerates/tables/c/...`). If UoR Art. 30 (still Unverified
    in this project — see the Multi-Currency spec's Design decision 8)
    turns out to require the Table A average rate specifically, this
    is a real gap in `currencies`' own fetcher scope, not just a
    Multi-Currency-spec policy choice — flagged as an open item for
    whoever next confirms Art. 30's text.
  - `Currency.isBase` is **mutable** — `currencies/commands/
    currencies.ts`'s `updateCurrency` command permits changing it, with
    uniqueness enforced only per `(organizationId, tenantId)` at write
    time, not pinned for the organization's lifetime. No module in this
    family currently guards against a live base-currency change once
    foreign-currency documents/entries exist referencing the old base —
    a real, currently-unaddressed cross-module risk (Multi-Currency's
    own `FxRevaluationRun.baseCurrencyId` snapshot, Design decision 16,
    only detects the problem after the fact on its own next run).
- **GL core engine's `reverseJournalEntry` contract reconfirmed
  load-bearing for a second consumer**: like Posting Rules Engine's
  reversal-mirroring subscriber, Multi-Currency's period-end unwind
  must call the dedicated `reverseJournalEntry` command (own
  `operationDate`, inverted lines, linked via `referenceType`/
  `referenceId`) rather than `postJournalEntry` with a `type:
  'REVERSAL'` override — an earlier Multi-Currency draft's Architecture
  section described the latter; corrected.
- **Cross-module transaction pattern reconfirmed**: Cash & Bank
  Management's `matchBankStatementLine` already establishes the
  precedent this project uses for "one command needs to call another
  module's command and write its own entity atomically" — the outer
  command opens its own `em.transactional()` and the nested
  `commandBus.execute()` call joins it, since `CommandBus.execute`
  directly invokes the handler rather than queueing it. Multi-Currency's
  `revalueOpenBalances` reuses this same pattern for its
  reverse-then-repost sequence (Design decision 10), now also with an
  explicit `SELECT ... FOR UPDATE` row lock for the concurrency case
  Cash & Bank Management's own single-document settlement flow didn't
  need to consider (one settlement never races another settlement of
  the *same* invoice the way two revaluation runs for the same
  tenant/org can race each other).

### 2026-09-21 (Deferred Revenue — maintainer-review + `om-spec-writing` compliance pass, PR #6193)

- **A per-entry `accruedAt IS NULL` filter is an idempotency check, not
  a concurrency guard, on its own.** Fixed Assets' `accrueDepreciation`
  (and this spec's own initial draft, mirroring it) relied on this
  filter alone to make retries safe. That's correct for *sequential*
  retries (a crash-then-rerun) but not for *concurrent* calls: two
  requests can both read `accruedAt IS NULL` before either writes.
  Checked directly against GL core engine's schema
  (`2026-08-18-general-ledger-core-engine.md`): the
  `(organization_id, reference_type, reference_id)` index on
  `journal_entry` is a plain, non-unique supporting index for list
  filters — it provides no deduplication a caller can lean on instead.
  **Fix adopted (reusable pattern)**: reuse Multi-Currency's (#6190,
  Design decision 10) own `SELECT ... FOR UPDATE`-on-the-parent-row
  shape — lock the one row that gates the operation
  (`FxRevaluationRun` there, `RevenueDeferral` here) as the transaction's
  first statement, before any read that decides whether to write.
  Any future module in this family that claims a row for one-time
  processing (an `accruedAt`/`processedAt`/similar nullable marker)
  should default to this locked-claim shape rather than a bare
  `WHERE ... IS NULL` filter, once concurrent callers are possible —
  Fixed Assets' own `accrueDepreciation` was never reviewed against
  concurrent calls and may carry the same latent gap; flagged here as
  a candidate for a future pass, not fixed in this pass (out of scope
  for a Deferred Revenue-only review).
- **A snapshot on the header entity must cover every account a later
  command posts against, not just the "original" side.** This spec's
  own initial draft snapshotted `originalRevenueAccountId` but kept
  reading `deferredRevenueLiabilityAccountId` live from
  `ModuleConfigService` on every accrual — an asymmetry the maintainer
  review caught (a later config change would silently move which
  account future recognition entries credit, while the already-posted
  reclassification entry stays pinned to the old one, permanently
  unclearable). General lesson for this project: any command that
  posts against a **pair** of accounts derived from tenant config at
  creation time must snapshot **both**, not just the one that happens
  to come from an existing entity (here, `SalesInvoiceLineRevenueAccount`)
  rather than fresh config.
- **Sibling-spec forward-pointers survive a compliance-pass edit
  cleanly when the edit stays internal to the module being revised.**
  Checked directly: `2026-09-15-default-chart-of-accounts.md`'s `840`
  forward-pointer note, `2026-08-18-sales-invoice-gl-posting.md`'s
  `SalesInvoiceLineRevenueAccount`-reuse note, and
  `2026-09-06-fixed-assets.md`'s "second real consumer" note about
  `DepreciationScheduleEntry`'s shape all remained accurate after this
  pass with no edits needed — because every fix in this round (the
  locking contract, the currency restriction, the liability-account
  snapshot, the period preflight, the schedule-boundary rule, the
  correction guard) is internal to `deferred_revenue`'s own design and
  changes no fact any sibling spec had actually asserted about it. A
  useful general check for the next compliance pass: a sibling note
  only needs revisiting when the *fact it cites* (an entity's shape, a
  dependency direction, a chart-of-accounts row) changes — not merely
  because the module it's about got more design detail added.
