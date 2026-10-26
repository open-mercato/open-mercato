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

This is an index, not a status report. Review state, merge state and
open findings are deliberately not recorded here: the PR page is the
status and it is never stale, whereas a hand-maintained copy of the state of
twenty PRs has drifted twice. Spec branches live on the contributor's fork
(`mikoajp/open-mercato`), not on `develop`, so the
PR links are the way to browse a spec until it merges. Checked against the
PR heads on 2026-10-09.

| Module | Spec file | Branch | Spec PR | Implementation PR |
|---|---|---|---|---|
| Contractor Registry | `2026-09-06-contractor-registry.md` + `...-implementation-guide.md` | `docs/contractor-registry` | [#5955](https://github.com/open-mercato/open-mercato/pull/5955) | — |
| General Ledger core engine | `2026-08-18-general-ledger-core-engine.md` + `...-implementation-guide.md` | `docs/spec-072-general-ledger-core-engine` | [#5663](https://github.com/open-mercato/open-mercato/pull/5663) | [#6340](https://github.com/open-mercato/open-mercato/pull/6340) |
| Accounts Payable (invoices) | `2026-09-06-accounts-payable.md` | `docs/accounts-payable` | [#5962](https://github.com/open-mercato/open-mercato/pull/5962) | — |
| Accounts Payable (payments) | `2026-09-06-accounts-payable-payments.md` | `docs/accounts-payable` | [#5962](https://github.com/open-mercato/open-mercato/pull/5962) | — |
| Journal Entry Line Dimension | `2026-09-06-journal-entry-line-dimension.md` | `docs/journal-entry-line-dimension` | [#5972](https://github.com/open-mercato/open-mercato/pull/5972) | [#6708](https://github.com/open-mercato/open-mercato/pull/6708) |
| GL account balances / Trial Balance (ZSiO) | `2026-09-09-general-ledger-account-balances.md` | `docs/general-ledger-account-balances` | [#6013](https://github.com/open-mercato/open-mercato/pull/6013) | — |
| Fixed Assets | `2026-09-06-fixed-assets.md` | `docs/fixed-assets` | [#6014](https://github.com/open-mercato/open-mercato/pull/6014) | — |
| Posting Rules Engine (konto 490) | `2026-09-06-posting-rules-engine.md` | `docs/posting-rules-engine` | [#6015](https://github.com/open-mercato/open-mercato/pull/6015) | [#6711](https://github.com/open-mercato/open-mercato/pull/6711) (`feat/posting-rules-engine`) |
| This knowledge base | `2026-09-08-financial-module-knowledge-base.md` | `docs/financial-module-knowledge-base` | [#6016](https://github.com/open-mercato/open-mercato/pull/6016) | — |
| GL bulk cross-module read service | `2026-09-10-general-ledger-bulk-read-service.md` | `docs/general-ledger-bulk-read-service` | [#6038](https://github.com/open-mercato/open-mercato/pull/6038) | — |
| JPK_KR_PD (`financial_pl`; SPEC-010 in `official-modules`) | `2026-09-11-jpk-kr-pd-financial-pl.md` | `docs/financial-pl-specs-010-011-to-core` | [#7524](https://github.com/open-mercato/open-mercato/pull/7524) (moved from [official-modules#54](https://github.com/open-mercato/official-modules/pull/54) and, before that, [#6069](https://github.com/open-mercato/open-mercato/pull/6069), both closed) | — |
| Accounts Receivable (sales invoice → GL posting) | `2026-08-18-sales-invoice-gl-posting.md` | `docs/sales-invoice-gl-posting` | [#6046](https://github.com/open-mercato/open-mercato/pull/6046) | — |
| Cash & Bank Management | `2026-09-10-cash-bank-management.md` | `docs/cash-bank-management` | [#6055](https://github.com/open-mercato/open-mercato/pull/6055) | — |
| Default Chart of Accounts (Polish plan kont importer) | `2026-09-15-default-chart-of-accounts.md` | `docs/default-chart-of-accounts` | [#6137](https://github.com/open-mercato/open-mercato/pull/6137) | [#6439](https://github.com/open-mercato/open-mercato/pull/6439) (`feat/default-chart-of-accounts`) |
| Tax Management (Core framework `tax_management`) | `2026-09-16-tax-management.md` | `docs/tax-management` | [#6168](https://github.com/open-mercato/open-mercato/pull/6168) | — |
| Tax Management, Poland part (`financial_pl`; SPEC-011 in `official-modules`) | `2026-09-16-tax-management-financial-pl.md` | `docs/financial-pl-specs-010-011-to-core` | [#7524](https://github.com/open-mercato/open-mercato/pull/7524) (moved from [official-modules#55](https://github.com/open-mercato/official-modules/pull/55)) | — |
| Annual Financial Statements (Core `financial_statements` + Poland Bilans/RZiS) | `2026-09-17-annual-financial-statements.md` | `docs/annual-financial-statements` | [#6188](https://github.com/open-mercato/open-mercato/pull/6188) | — |
| Multi-Currency (exchange rate integration + period-end FX revaluation) | `2026-09-17-multi-currency.md` | `docs/multi-currency` | [#6190](https://github.com/open-mercato/open-mercato/pull/6190) | — |
| Deferred Revenue (RMP — scheduled recognition over time for AR/Sales) | `2026-09-17-deferred-revenue.md` | `docs/deferred-revenue` | [#6193](https://github.com/open-mercato/open-mercato/pull/6193) | — |
| `financial_pl` integration contracts (SPEC-012 in `official-modules`) | `2026-10-08-financial-pl-integration-contracts.md` | `docs/financial-pl-specs-from-official-modules` | [#7070](https://github.com/open-mercato/open-mercato/pull/7070) (moved from [official-modules#60](https://github.com/open-mercato/official-modules/pull/60)) | — |
| `financial_pl_accounting` package (SPEC-013 in `official-modules`) | `2026-10-08-financial-pl-accounting-package.md` | `docs/financial-pl-specs-from-official-modules` | [#7070](https://github.com/open-mercato/open-mercato/pull/7070) (moved from [official-modules#61](https://github.com/open-mercato/official-modules/pull/61)) | — |
| Budgeting & Forecasting, Cost Accounting | — | — | Not started (SPEC-024 only) | — |

**`financial-pl` (JPK_V7/KSeF) is not in this repo yet.** It is a real,
substantial module that exists only in the `official-modules` repository
(branch `feat/financial-pl-invoice-ux`, pinned at `17c575c`). As of 2026-10-09
`official-modules` is deprecated and being archived and `financial_pl` will not
live there: the financial work continues in Core, with KSeF coming later as a
separate PR (open-mercato/official-modules#29). The four `financial_pl` specs
(`SPEC-010` to `SPEC-013` in `official-modules` numbering, which clashes with the
unrelated implemented `SPEC-010`..`013` under `.ai/specs/implemented/`) are in
the table above under their Core filenames. Core names new specs
`{date}-{title}` only (`.ai/specs/README.md`), so the four specs no longer carry
a `SPEC-0xx` number in Core: they are called the JPK_KR_PD spec, the tax engines
spec, the integration contracts spec and the accounting package spec. Older
Changelog entries below keep the original numbers. Where to put the packages inside
Core (`packages/` layout, one module per package) is not decided; the specs
still say `packages/financial_pl_accounting/` as the target layout.

**2026-09-12 findings: all written into their specs.** The seven findings
of the 2026-09-12 research pass are on their sibling branches. Checked on
2026-10-09, each commit is reachable from the PR head named:

- Contractor Registry: `e8dd1b1de` on #5955 (head `dcbc4fc92`). The spec has
  its own `## Literature & Prior Art` section, which also records the
  correction of the `sales-invoice-gl-posting` cross-reference.
- Cash & Bank Management: `9843e3e2d` on #6055 (head `60749bf32`), which has its
  own `## Literature & Prior Art` section.
- SPEC-010: Q2 correction `8c4402def` and the XSD pass `970d42e07` (new Q4,
  the `S_12_1` gap) on #6069 (closed, head `70612750d`). SPEC-010 now lives in
  `official-modules#54`.
- Applied from the start and re-checked as reachable: `80b642585` (#6046),
  `a12b8fd15` (#6015), `dfb9b77a0` (#6038).

**New 2026-10-08 — what belongs to `financial_pl`, mapped from our own
specs (#6061 map) and the real module code.** Recorded here so the next
spec does not redo it.

- **Already in code** (`official-modules`, branch
  `feat/financial-pl-invoice-ux`, last commits 2026-07-27): KSeF 2.0
  FA(3) send/receive, JPK_V7 from its own register tables
  (`PurchaseVatRecord`, `ReceivedInvoice`, `SalesInvoicePlMeta`), invoice
  authoring UI and PDF. No `requires`, no `ledger` dependency; imports from
  core are only `directory`, `progress` and `sales`. The package README
  positions it for standalone installs.
- **Assigned to it by our specs, not yet in code:** the Poland VAT/CIT/PIT
  engines and the tax-payment instruction (`2026-09-16-tax-management.md`,
  #6168), Bilans/RZiS templates, line mapping and closing resolution
  (`2026-09-17-annual-financial-statements.md`, #6188), JPK_KR_PD
  (SPEC-010, `official-modules#54`, blocked on #6038). No other spec in the
  family (AP, AP Payments, Contractor Registry, Posting Rules, JELD,
  Default Chart of Accounts, Fixed Assets, Cash & Bank, Deferred Revenue)
  assigns anything to `financial_pl`.
- **Gaps closed as working decisions (pending maintainer review):**
  Contractor Registry gets a read-only `contractorLookupByNip` DI service
  (#5955); AP gets a partial unique index on `(vendor, normalized invoice
  number)` and a note that other modules create invoices through
  `createVendorInvoice` (#5962); the VAT engine reads `financial_pl`'s VAT
  register, CIT/PIT read GL balances, and GL balances only reconcile the
  register (#6168).
- **Still open, owned by the `financial_pl` authors:** whether GL-dependent
  Poland features live in a separate package with a hard
  `requires: ['ledger']` (working proposal: yes, because KSeF and JPK_V7
  work without a ledger and `packages/core/AGENTS.md` reserves hard
  `requires` for non-optional dependencies) or in `financial_pl` itself
  (SPEC-010's current wording); and the KSeF received invoice →
  Accounts Payable draft bridge, which no spec covers yet and which would
  need its own `official-modules` spec. If the separate package is chosen,
  SPEC-010's reuse of `submitJpk`/`pollJpkStatus` becomes a cross-module
  call and needs a public DI transport service in `financial_pl`, with the
  signing certificate staying inside it.

**Update 2026-10-08 (later pass) — target layout and the decisions that
close the open items above.**

- **Target layout.** `financial_pl` stays as it is (KSeF, JPK_V7, invoices),
  installable without a ledger, no `requires`. The GL-dependent Poland
  features (VAT/CIT/PIT engines and tax-payment instruction, Bilans/RZiS,
  JPK_KR_PD, VAT reconciliation report) go to a separate `official-modules`
  package, `financial_pl_accounting`, with a hard `requires`
  on `financial_pl`, `ledger`, `tax_management` and `financial_statements`
  (not `posting_rules`: it only reads period state). Dependency direction:
  `financial_pl_accounting` → `financial_pl`, core; never the reverse.
  `financial_pl` gains three things: a DI transport service for JPK
  (`submit`, `pollStatus`; certificate and key stay inside), a read-only DI
  service over its VAT register, and the KSeF received invoice → AP draft
  bridge (optional, `tryResolve`; needs its own spec). Feature ids of the
  new package carry its own module-id prefix.
- **Decisions.** NIP normalization is one shared function with a checksum
  (#5955); `vendorSnapshot` is an optional, caller-supplied input of
  `createVendorInvoice`, because AP never reads `contractors` (#5962); the
  duplicate-invoice guard stays a hard `409`; the input-VAT account for the
  reconciliation report is the new package's own setting, not AP's
  `vatInputAccountId`, which AP documents as used only by itself.
- **Findings.** `ledger.lockFiscalPeriod` bypasses the Posting Rules guard
  by design, so a locked period does not prove zespół 4→5 was reconciled
  (the annual statements spec said otherwise; corrected, with the two-variant
  parity check as backstop). No spec gave an in-process read of period state
  or of the `CLOSING` entry; two methods were added to #6038. The
  `packages/modules/` path in the annual statements spec does not exist in
  the repository; corrected to `packages/core/src/modules/`. The JPK
  transport code is generic over the XML (the `InitUpload` metadata carries
  no form code) and currently uploads a single part, which a full-year
  journal export may outgrow; multi-part support is part of the transport
  service. The `RPD` node has eight amount fields (`K_1`–`K_8`) in
  Comarch XL's documentation, entered manually; the vendored XSD is the
  tie-breaker, not yet read.
- **Not yet written into the specs concerned:** ~~SPEC-010 and SPEC-011 in
  `official-modules`~~ (written 2026-10-08/09 and moved to Core, see the
  2026-10-16 note at the end of this document).

---

## 2. Cross-cutting conventions already settled (the real source of truth)

These were fought for once, across GL/AP/JELD, and confirmed consistent with
each other on 2026-09-08. Any new financial module should default to reusing
them rather than reinventing an equivalent.

**Control account + subsidiary ledger.** Per-counterparty (kontrahent)
breakdown of a shared liability/asset account is *not* modeled as separate
GL accounts, and not as a `journal_entry_line_dimensions` row either. It's
modeled the standard bookkeeping way: one shared control account
(`accounts_payable.liabilityAccountId`) at the GL level, with the
per-vendor detail living in the consuming module's own application tables
(`VendorInvoice.vendorId`, keyed rows) as the subsidiary ledger. Confirmed
independently in `general-ledger-core-engine.md` (Out of Scope →
"Subsidiary ledgers"), `accounts-payable.md` (Access Control / Design
decisions), and `journal-entry-line-dimension.md` ("Excludes the
counterparty") — all three cross-checked against each other on 2026-09-08.
Grounded in real law, not just convention: **Ustawa o rachunkowości
(Polish Accounting Act), art. 13 ust. 1 pkt 3, art. 16 ust. 1 and art. 17
ust. 1 pkt 2** ground this — subsidiary ledgers (księgi pomocnicze) are part of
the books (art. 13), detail and are reconciled with the general-ledger accounts
(art. 16 ust. 1), and accounts for settlements with counterparties
("rozrachunki z kontrahentami") are kept as subsidiary accounts (art. 17 ust. 1
pkt 2). "Control account" is our term; the Act speaks of "konto księgi głównej".
(Corrected 2026-10-12: the per-counterparty part was earlier attributed to art.
13 and 16 alone; see the last entry.) This is a stronger, more directly applicable
citation than anything in Fowler or Hay (see §3) — use *this* for any
design-decision citation in future AP/AR/GL-adjacent specs, not the
software-pattern books.

**Three distinct tagging mechanisms — don't conflate them.**
1. `LedgerAccount.parentAccountId` — static, single-dimension Chart-of-
   Accounts hierarchy (e.g. `130 Rachunki bieżące` → `130-1 mBank`). One
   parent per account, fixed at setup time.
2. `journal_entry_line_dimensions` — multi-dimensional, contextual tags on a
   posted line (Phase 1: cost centre/MPK; each row names its owning `writer`)
   that can co-occur with other dimension types on the same line and don't belong in the chart of accounts
   (would explode it into dead combinations). Deliberately excludes the
   counterparty.
3. `JournalEntryLine.contractorSnapshot` — a denormalized, point-in-time
   audit copy of the counterparty on the line itself, not a live FK and not
   a `journal_entry_line_dimensions` row (audit trails must not retroactively
   change if the counterparty record is edited later).

A future module needing "which X was this posting about" should figure out
which of these three shapes actually fits before adding a new mechanism —
most needs are already one of these three.

**Event-driven cross-module posting, not synchronous coupling.**
`postJournalEntry` emits `ledger.journal_entry.posted` after the commit
(whether a subscriber needs at-least-once delivery is its own choice, via
`metadata.persistent`; the Posting Rules Engine subscriber is persistent,
corrected 2026-10-12 — an earlier version of this sentence called the event
ephemeral and no-retry). The emit itself is fire-and-forget
(`void emitPostedEvent(...)`), so an event can still be lost if the process
dies between the commit and the enqueue; consumers (e.g. the unmerged Posting Rules
Engine) subscribe and post their own follow-up entries via their own
`postJournalEntry` call. Because delivery isn't guaranteed atomic with the
source commit, every consumer that relies on this needs two more things: a
sweeper/reconciliation command that finds and fixes orphaned unprocessed
entries after a crash (see `ReconcileCostRingCommand` in the Posting Rules
Engine spec, unmerged), and its own period-lock guard at the consumer level (the
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
  line-item schema) — **Confirmed 2026-10-12 at the structural level** against
  the consolidated text including annexes (see the last entry); the status below
  is the earlier one. `2026-09-17-annual-financial-
  statements.md` (Annual Financial Statements) names this annex as the
  authoritative source for `financial_pl`'s Bilans/RZiS line templates,
  but the statute text read for this document (the ISAP text linked in §5) starts at
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
  period-end FX revaluation mandate) — **Confirmed**, 2026-09-21, against
  the current consolidated text (Dz.U.2026.0.522, effective 2026-08-21;
  source: lexlege.pl, cross-checked against przepisy.gofin.pl search
  snippets). Ust. 1: *"Nie rzadziej niż na dzień bilansowy wycenia się
  wyrażone w walutach obcych: 1) składniki aktywów... po obowiązującym na
  ten dzień średnim kursie ogłoszonym dla danej waluty przez Narodowy
  Bank Polski..."* — i.e. valuation is required no less often than the
  balance-sheet date, at the NBP **average rate ("Table A")**, not the
  buy/sell rate. Ust. 4 routes the resulting exchange differences to
  financial income/costs (P&L) for everything except long-term
  investments (governed instead by Art. 35). This confirms
  `2026-09-17-multi-currency.md`'s existing design was already correct on
  both points the article governs (periodic revaluation trigger, P&L
  recognition), but it also turns the spec's previously-speculative
  "`NBPProvider` only fetches Table C (buy/sell), never Table A
  (average)" gap into a **confirmed statutory non-compliance risk** — see
  that spec's Design decision 8, Risks & Impact Review, and
  Implementation Plan Step 0 for the resulting fix.
- **Ustawa o rachunkowości, Art. 6** (zasada memoriału / accrual
  principle) — **Confirmed**, 2026-09-21, same source as Art. 30 above.
  Ust. 1 (quote corrected 2026-10-12: the words "oraz w wyniku finansowym
  jednostki" are not in the consolidated text of 2026-10-08): *"W księgach
  rachunkowych jednostki należy ująć wszystkie osiągnięte, przypadające na jej rzecz
  przychody i obciążające ją koszty związane z tymi przychodami
  dotyczące danego roku obrotowego, niezależnie od terminu ich
  zapłaty."* — the general accrual principle: revenue and the costs
  connected to it are recognized in the fiscal year they belong to,
  regardless of payment timing. Ust. 2 is even more directly on point,
  naming *"koszty lub przychody dotyczące przyszłych okresów"* (costs or
  **revenues relating to future periods**) as something the matching
  principle requires allocating to the correct period — a near-literal
  statutory description of RMP/deferred revenue itself. Applied in
  `2026-09-17-deferred-revenue.md`'s Literature & Prior Art section as
  the statutory basis for recognizing revenue in the period it is earned
  rather than when cash is received.

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
  confirming `journal_entry_line_dimensions`'s own line-level (not
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
  public documentation at the time — recorded as **Unverified**, per
  `financial-spec-citation-check`, rather than assumed from their
  general Polish-market positioning. **Update 2026-09-28: now
  Confirmed.** All three store the mikrorachunek as manually entered
  configuration rather than computing it from NIP/PESEL: Comarch ERP
  Optima routes declaration payments to a Kasa/Bank preliminary list
  for manual transfer, with ZUS individual account numbers explicitly
  entered on the office form ([pomoc.comarch.pl](https://pomoc.comarch.pl/optima/pl/2026/dokumentacja/deklaracje-a-platnosci-z-nimi-zwiazane/));
  enova365 stores the account once under Narzędzia → Opcje → Firma →
  Urzędy i KRS (or per-owner for PIT) and auto-populates it onto
  VAT/CIT payments from then on ([erpit.pl](https://erpit.pl/post/54-indywidualny-rachunek-podatkowy-w-enova365));
  Symfonia Start's Mała Księgowość falls back to manual entry of the
  office's account number when none is configured ([pomoc.symfonia.pl](https://pomoc.symfonia.pl/data/mk/Start/2024_b/data/html_mkrp0054.htm)).
  Full citations in `SPEC-011-2026-09-16-tax-management-financial-pl.md`'s
  own Literature & Prior Art section — a real, disclosed divergence
  from that document's live-computation design, flagged there for a
  maintainer's explicit sign-off, not a defect in the design (live
  computation removes a manual setup step).
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
  the Posting Rules Engine spec's own 4→5 reclassification design — worth
  a compare-and-contrast once that spec is merged.
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
  `journal_entry_line_dimensions` has, but at the account level rather
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
  problem; not a match for `journal_entry_line_dimensions`.
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
  `journal_entry_line_dimensions` actually does (a queryable attribute on the
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

**Chart of Accounts / `journal_entry_line_dimensions`:**
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
  `journal_entry_line_dimensions`'s own `DIMENSION_TYPES` enum
  bounds explicitly (Phase 1: `CostCenter` only) instead of leaving
  unbounded. Difference worth
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
  Written into `2026-09-06-contractor-registry.md`'s own `## Literature &
  Prior Art` section (commit `e8dd1b1de`, 2026-09-12, reachable from #5955;
  section present at head `dcbc4fc92`, checked 2026-10-09), alongside an
  independent second confirmation from Hay Ch.3 "Parties" (pp.23-24).

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
pass. All the findings below are now written into their spec files. When
first recorded only three were (marked **applied**); the others were written
back later and are marked **applied later** (checked against the current PR
heads on 2026-10-09, see that entry):

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
  real-system comparison. **Applied later** — `e8dd1b1de` is reachable from #5955 and
  `## Literature & Prior Art` is on its head. The stale
  `sales-invoice-gl-posting` "planned, not yet written" cross-reference is
  corrected in that section.
- SPEC-010 Q2 — re-derived the filing cohort as VAT-filing-frequency-based
  (Group 1: monthly `JPK_V7M`, FY2026, due April 2027; Group 2:
  quarterly/exempt, FY2027, due April 2028), not the size-based
  "largest-taxpayer window" the original Q2 wrongly borrowed from
  `JPK_CIT`. **Applied later** — `8c4402def` is reachable from #6069 (now closed;
  SPEC-010 moved to `official-modules#54`). Confirmed against gov.pl/web/kas
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
  **Applied later** — `970d42e07` is reachable from #6069; Q4 and the
  `S_12_1` gap are in that file.
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

### 2026-09-15 (cont. — Default Chart of Accounts cross-spec consistency pass, at the spec author's request)

- At the spec author's request, to check whether any sibling spec needed
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
  placement remains an open, paused question — the spec author asked to
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
  confirmed with the spec author before drafting, given the two prior false
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
  schema) has not been primary-source verified — the
  statute text read for this document starts at Rozdział 2 and omits the annexes. Recorded
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
  (`VendorInvoice.exchangeRate`, commit `438b4410a`),
  `sales-invoice-gl-posting.md` (`SalesInvoice.currencyId`/
  `exchangeRate` + a coordination note on the now-partially-redundant
  `currencyCode`→`currencyId` resolution step, commit `5a25ee7d9`), and
  `cash-bank-management.md` (`bookedExchangeRate` default-from-invoice,
  commit `ec85ede99`).

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
  pass had missed, on direct challenge from the spec author** (whether the fix pass
  covered every review finding and followed the literature strategy). The maintainer-review
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

### 2026-09-21 (cont. — UoR Art. 6 and Art. 30 literature grounding closed; `om-spec-writing` Spec Checklist run on Deferred Revenue)

- **Both remaining open UoR literature flags in this file (Art. 6, Art.
  30) are now Confirmed.** No PDF of the statute was available this
  round (none uploaded, none found on device); the primary-source text
  was instead retrieved live via WebSearch/WebFetch against
  `lexlege.pl` (current consolidated text, Dz.U.2026.0.522, effective
  2026-08-21), cross-checked against `przepisy.gofin.pl` search-result
  snippets as a second source. See the updated Art. 6 and Art. 30
  entries above for the literal quotes. `2026-09-17-deferred-revenue.md`
  and `2026-09-17-multi-currency.md` were both updated in step (Literature
  & Prior Art sections, plus Multi-Currency's Design decision 8, Risks &
  Impact Review, and Implementation Plan Step 0, since Art. 30 confirms a
  previously-speculative NBP Table A/C gap as a real statutory
  non-compliance risk). The **Załącznik nr 1** flag (line-item schema
  annex) is deliberately left Unverified — out of scope for this round,
  a structurally larger verification job than a single article.
- **A subagent's checklist-review finding must still be independently
  re-verified, even when it names a real, existing sibling-spec
  pattern.** Running `om-spec-writing`'s Spec Checklist on
  `2026-09-17-deferred-revenue.md` for the first time (distinct from the
  Compliance Gate already run in the prior pass), a review subagent
  flagged `RevenueRecognitionScheduleEntry`'s lack of a `deletedAt`
  column as a soft-delete contract violation, by analogy to
  `RevenueDeferral`. Checked directly against
  `2026-09-06-fixed-assets.md`: `DepreciationScheduleEntry` (the exact
  structural sibling of `RevenueRecognitionScheduleEntry`) also has no
  `deletedAt` and is genuinely hard-deleted while unposted — an
  established, deliberate pattern for schedule-entry-shaped child
  tables in this project, not a gap. **Fix applied narrowly**: added
  `deletedAt` only to `RevenueDeferral` (the header entity, matching
  `FixedAsset`'s real precedent), and added an explicit spec note
  confirming `RevenueRecognitionScheduleEntry`'s lack of `deletedAt` is
  correct. General lesson: a subagent citing a real sibling entity by
  name is still a claim to verify against that entity's actual spec
  text, not a citation to accept because the named pattern genuinely
  exists elsewhere in the project.
- **Checklist pass on Deferred Revenue found 7 further real gaps**,
  each independently confirmed against Fixed Assets' actual spec text
  before fixing: missing `openApi` export statement, missing
  mutation-guard-registry wiring for the three custom write routes,
  missing per-method `requireAuth`/`requireFeatures` metadata
  statement, missing i18n section, missing `pageSize <= 100` cap on the
  list route, missing index + batch size for the due-row accrual scan
  (Fixed Assets names `(organization_id, asset_id, accrued_at)` and a
  batch size of 500 for the identical query shape — Deferred Revenue's
  equivalent is now `(organization_id, deferral_id, accrued_at)`, also
  batched at 500), and one wrong citation (a Design decision cited
  "knowledge base §3" for a fact that is actually recorded in this
  file's dated Changelog, not §3 "External sources" — corrected in
  place, per `financial-spec-citation-check` discipline of not letting
  a mismatched citation stand once caught).

### 2026-09-28 (cont. — Tax Management: PR #6168 review resolved, split into SPEC-011; financial-spec-writing-process retrospective)

- **PR #6168's automated review (`om-auto-review-pr`) resolved**: 1
  Blocker (B1 — VAT/CIT/PIT posting-shape redesign, grounded in Kieso
  Ch.13 p.13-8 and a new pp.13-10–13-11 Illustration 13.5/13.6
  citation), 6 Majors (M1 concurrency, M2 tax-engine registry, M3
  package placement, M4 authorization, M5 `SalesTaxRate`/`TaxCode`
  relation, M6 missing sections), and the applicable Minors (m2
  currency, m6 `TaxCode` base fields directly; m1/m3/m4/m5 via the
  split below). Commit `af7f6ff18` on `docs/tax-management`.
- **Direction question resolved**: split `financial_pl`'s half out to
  `official-modules`, mirroring the SPEC-010 precedent above, at the
  user's explicit decision after two rounds of clarification (the
  first AskUserQuestion framing read as ambiguous between "move the
  whole document" and "split it"; re-explaining the SPEC-010 parallel
  concretely resolved it). New document:
  `SPEC-011-2026-09-16-tax-management-financial-pl.md`,
  `official-modules#55` (fork `mikoajp:docs/spec-011-tax-management-
  financial-pl` → `official-modules:develop`); Core-only
  `tax_management` stays in this document. Module map (§1) updated.
- **financial-spec-writing-process retrospective, prompted directly by
  the spec author asking whether the process had actually been followed**:
  checked against real file state (`git log`, `grep` on the actual
  documents and skill files) rather than recollection, per
  `financial-spec-citation-check`. Step 2 (Kieso citations) and the
  citation-check discipline (mikrorachunek re-derivation) held up on
  inspection. Two real gaps found and fixed in this pass: Step 3
  (real-system comparison) had only checked ERPNext/Odoo/GnuCash for
  `SPEC-011` — none model a country-specific tax account at all, so
  this missed the actually-comparable systems; Comarch Optima/
  enova365/Symfonia are now checked (Tier 4 entry above updated). Step
  5 (this file) had not been updated with this round's findings at all
  before being asked — this entry is that catch-up.
- **One gap flagged but deliberately not retrofitted**:
  `official-modules/.ai/skills/spec-writing/SKILL.md`'s own workflow
  mandates a Skeleton Spec + Open Questions hard gate before writing a
  full new spec, which was skipped in favor of writing the complete
  document directly. Noted here as a process deviation for the record
  — not undone, since `official-modules#55` is already open and the
  user's own multi-round direction-question answer already served as
  the equivalent decision point, just not through that literal
  mechanism.
- **Retrospective critical-unknowns check, requested directly by the
  user instead of retroactively performing the skipped gate**: checked
  SPEC-011 against the four things that gate protects (data model
  shape, scope, integration points, UMES extension strategy) against
  real code, not the documents' own prose. The one genuine risk —
  whether an `official-modules` package can actually import and query
  a `@open-mercato/core` entity class directly across the repo
  boundary the way `financial_pl` reading `TaxLiabilityRecord` assumes
  — is real: confirmed via `packages/forms` (`official-modules`)
  importing `Attachment`/`AttachmentPartition` directly from
  `@open-mercato/core/modules/attachments/data/entities`. The
  `commandBus.execute(commandId, options)` two-argument signature both
  split documents rely on throughout was also independently
  re-verified against `packages/shared/src/lib/commands/command-bus.ts`.
  One minor citation mismatch found and fixed (not a design issue): the
  Core document's `seedPolishAccountGroups`/`setup.ts` citation pointed
  at this file's §2, which discusses a related but distinct point;
  corrected to cite the real `ledger/setup.ts` code directly (commit
  `e697b55e0`).
- **Cross-spec consistency pass (Step 1/5), applied in reverse after
  the split, matching the 2026-09-18 SPEC-010-move precedent**: checked
  every sibling `docs/*` branch for stale references to
  `2026-09-16-tax-management.md`/`#6168` now that its `financial_pl`
  half has moved. Two branches had live, now-stale references and got
  pointer-only, dated updates (never rewriting historical Changelog
  entries): `annual-financial-statements` (#6188 — its own "Temporary
  location" banner named `2026-09-16-tax-management.md` as a sibling
  still co-locating its `financial_pl` half; updated to note that
  sibling has since completed the move, mirroring exactly how SPEC-010's
  own completed move was recorded there on 2026-09-18) and
  `spec-072-general-ledger-core-engine` (#5663 — its "Country-specific
  tax/compliance plugins" Out of scope bullet pointed at `#6168` as
  covering both halves; updated to point at `official-modules#55` for
  the half that actually moved). No new PR was needed for either fix —
  both branches already had open PRs; pushed directly to each.

### 2026-09-29 (cont. — Posting Rules Engine: implementation shipped, PR #6711)

- **Full-module implementation shipped**, per the spec's own Design
  Decisions (settings-based account resolution, MPK priority hybrid,
  mirrored reversals, period-close guard): `lib/reclassify.ts`
  (`reclassifyLine`, the shared engine used by both the real-time
  subscriber and `reconcileCostRing`), full CRUD (commands, API
  routes, backend UI) for `CostCenter` and `DefaultAccountPostingRule`,
  a `PostingRulesSettings` settings page, migration, seed defaults
  (sentinel `UNALLOCATED` cost centre), ACL features, en/pl i18n.
  Branch `feat/posting-rules-engine`, stacked on the still-unmerged
  `feat/general-ledger-core-engine` and `feat/journal-entry-line-
  dimension` branches (so its own diff/commit count reads large until
  those merge first — expected for a stacked branch, not a defect).
  Opened as [PR #6711](https://github.com/open-mercato/open-mercato/pull/6711)
  against `develop`.
- **A scoped `tsc` sweep over the new module** (the environment's own
  `tsc` needed a missing native `linux-arm64` platform package fetched
  before it would even run at all — an environment fix, not a code
  change) caught three real implementation bugs before they reached
  review, none of which a naive read would have surfaced: (1) a
  computed-class-field ASI trap (`[OptionalProps]?: 'updatedAt'`
  placed after a statement missing a semicolon got parsed as
  `new Date()[OptionalProps]`, not a new class member — fixed by
  moving it to the class's first line, matching this module's own
  `CostCenter`/`DefaultAccountPostingRule` and JELD's
  `JournalEntryLineDimension` precedent); (2) `commandBus.execute()`
  resolves `CommandExecuteResult<TResult>` (`{ result, logEntry }`),
  never the bare command result — four call sites in this module
  (`postReclassification`, `lockFiscalPeriod`, and the settings/
  reconcile API routes) had been written as if it returned the raw
  value directly, which `tsc` alone caught only for the sites with an
  explicit result type; the settings/reconcile routes' own bug
  (nesting an extra nested `.result` level in the HTTP response body)
  produced no type error at all — surfaced only by re-reading each
  `commandBus.execute` call site by hand after the pattern was found
  once; (3) a fabricated `translateCrudErrorBody` export invented for
  two API routes' error handling — grepped the whole repo, confirmed
  it doesn't exist anywhere, replaced with the real, already-shipped
  convention (`NextResponse.json(err.body, { status: err.status })`,
  since `CrudHttpError` bodies are already translated at throw time;
  see e.g. `customers/api/settings/address-format/route.ts`). Worth
  adding to `financial-command-implementation-checklist` as a new,
  reusable item — the `CommandExecuteResult` unwrapping mistake in
  particular seems likely to recur in any command that calls another
  module's command via `commandBus.execute` and forwards its result
  as-is.
- **Testing**: `lib/__tests__/reclassify.test.ts`, 8 passing unit
  tests (actually run via `jest`, not just typechecked) covering
  Invariant 3 (ignore the engine's own output), zespół-4 detection,
  both "cannot resolve where to post" rejections (missing clearing
  account, missing target account), and all three MPK priority-hybrid
  paths (explicit tag > rule default > sentinel). Disclosed gap,
  deliberately not covered in this pass: the contra-side (reversal/
  mirror) path needs its own two-entry fixture (an original
  reclassification plus its reversal) that didn't fit this pass's
  time budget.
- **Not yet done**: the full `yarn build:app`/`yarn typecheck` run
  (the scoped `tsc` sweep is only ever an interim signal per
  `financial-command-implementation-checklist` item 5); CLA
  acknowledgment, doc/locale-generator updates, `.ai/qa/tests/`
  integration coverage, and priority/risk/QA-routing labels on PR
  #6711 are all still open, left for the maintainer/user rather than
  guessed at.

### 2026-10-09 — re-review of this document (#6016, reviewed head `084fbdc7`)

- **Evidence trail re-verified (B1).** The four 2026-09-12 commits that this
  document called missing all exist and are reachable from the current heads:
  `e8dd1b1de` (#5955, head `dcbc4fc92`), `8c4402def` and `970d42e07` (#6069,
  head `70612750d`; closed, content moved to `official-modules#54`),
  `9843e3e2d` (#6055, head `60749bf32`). The three "applied" commits
  (`80b642585`, `a12b8fd15`, `dfb9b77a0`) are reachable too. §1 Notes, the §4b
  Contractor Registry paragraph and the 2026-09-12 entry were corrected. The
  09-14 and 09-15 entries below are history and still describe the earlier
  state.
- **§1 reduced to an index (M1, M2).** The status column is gone, because the
  PR page is the status; a column for the implementation PR was added
  (#6340, #6439, #6708, #6711), and the `official-modules` specs SPEC-010 to
  SPEC-013 are listed. The per-sibling findings in this Changelog were not
  moved to the sibling specs in this pass; that is a separate, larger edit.
- **Session residue removed (m1).** `/tmp/uor.txt`, "in this session" and "the
  user" are replaced by checkable sources or a role ("the spec author").
- **Rewritten SHAs replaced (m2).** The three SHAs lost in the 2026-09-17
  force-push now point to `438b4410a` (#5962), `5a25ee7d9` (#6046) and
  `ec85ede99` (#6055).
- **Wording (n1).** "planned" and "draft" for the Posting Rules Engine are now
  "unmerged".

### 2026-10-09 (cont. — Cash & Bank / Sales Invoice GL Posting: receipt posting, overpayments)

- **`sales` does not maintain invoice balances.** `sales.payments.create`
  recalculates the *order's* `outstandingAmount`/`paidTotalAmount` only, and
  requires an `orderId`; `sales.invoices.create`/`update` take
  `outstandingAmount` from caller input (default `0`). Neither #6046 nor #6055
  may size a posting from `SalesInvoice.outstandingAmount`. Maintaining invoice
  balances from payment allocations is an OM Core `sales` change, outside the
  financial family (needs its own issue).
- **Ownership of receipt posting (decided by the spec author).** #6055 posts the
  receipt into `ledger` and owns `cash_bank_management.statement_line.matched`;
  #6046 owns the Phase 2 payment bridge to `sales.payments.create` (the only
  financial module that may depend on `sales`; a `sales`-owned subscriber would
  reverse the dependency direction); `sales` owns invoice-balance maintenance.
  #6046 stays API-only in Phase 1.
- **Cash & Bank sizing corrected.** The settled portion is an explicit
  `settledAmount` (derived from the line it made the FX gain/loss identically
  zero and booked overpayments as FX gain); the remaining balance is invoice
  gross less this module's own earlier matches; the invoice must have a
  `sales:sales_invoice` `JournalEntry` (`409 INVOICE_NOT_POSTED`).
- **Overpayments (UoR art. 7 ust. 3).** A customer's overpayment is a liability
  and is shown in liabilities, not netted against receivables; the only
  exceptions (art. 37 ust. 7, art. 46 ust. 2a) do not cover trade settlements.
  **Corrected 2026-10-12 against the primary text, see the entry at the end of
  this document: the art. 7 ust. 3 part is confirmed; the sentence about the two
  exceptions is a mismatch (art. 46 ust. 2a can apply to trade settlements).**
  Hence a separate `customerOverpaymentAccountId` in #6055. Sources checked:
  two secondary articles on poradnikprzedsiebiorcy.pl (overpayments in the
  balance sheet; per-saldo presentation). Kieso not consulted (no copy
  in the session). The account number is the tenant's chart, not prescribed.

### 2026-10-12 — Posting Rules Engine tested end to end in a local demo; decisions taken without expert confirmation

The engine was run end to end in a local demo (entry #5 `DEV` Dr `402-1` / Cr
`210-1`; engine entry #6 Dr `552-1` / Cr `490-1`, `referenceType`
`PostingRulesEngineReclassification`). What it showed, and what was decided.
These decisions are the project's own, taken after checking the specs, the code
and the knowledge base; none went to an external expert. Marked
**⚠ NEEDS HUMAN CONFIRMATION** where a convention rests on that alone.

- **Why the demo posted nothing at first (three independent causes).** (1) The
  demo's chart of accounts predated the `490` fix in the default chart (#6137
  review m3; 39 types / 43 accounts instead of 40 / 44), so no clearing account
  existed to pick. (2) The clearing account setting pointed at the cost account
  itself; the engine never treats the clearing account as a source, so the line
  was skipped without an error. (3) The sentinel `UNALLOCATED` cost centre and the
  settings row are seeded at module-enable time, which never ran for a tenant
  that existed before the module was enabled. Neither (1) nor (3) is a code
  bug; (2) is a configuration mistake the UI now makes harder (pickers filter
  by account class).
- **`490` normal balance: CREDIT.** The engine's spec describes the clearing
  account's engine-posted balance as a credit balance; the default chart had
  it as `DEBIT` (justified there as a formality, since the account clears to
  near zero). `normalBalance` is immutable once an account of the type has
  posted entries, so it was changed in the default-chart spec and #6439 before
  the first live import. Decided by the team 2026-10-12: checked against our own
  spec only, no external accounting source.
- **Zespół 5 scope in the default chart: unchanged (`550`, `552`).** The
  template is "representative, not exhaustive"; real systems checked ship an
  adjustable starting point; widening it is data only. The numbers `500`/`520`/
  `530` for production-type costs were recalled, not verified, and are not
  added. The Posting Rules settings page now says so when no zespół 5 account
  exists. Verification of the plan-of-accounts obligation (UoR art. 10 ust. 1
  pkt 3) is pending a primary source.
- **Vendor invoice open amount stays AP-derived (#6190, decision 18).** The
  per-invoice detail is the subsidiary ledger; none of the three tagging
  mechanisms fits "this line settled that invoice", and one entry per invoice
  would break the one-entry-per-batch shape bank matching relies on. Sales
  invoices read ledger-side only because `sales` does not maintain balances.
  `fx_revaluation` may read `PaymentBatchLine` as an optional, FK-id-only,
  scoped read (precedent: `communication_channels` reading `messages`), with
  the used columns listed as a contract in the payments spec.
- **Concurrency tests (#6340 / #7207).** The `documents` module already tests
  concurrency with mocks that assert the lock mode (the same class as our
  fake-EM tests) and has a `testcontainers`-based integration test, so a
  container-based suite would not be a new technology in the repository. Decision:
  no new infrastructure in #6340; a real-Postgres proof of lock-versus-post and
  double-reversal waits for an HTTP route to posting or for OM Core to adopt a
  container-based Jest suite. Nothing was changed in #6340 for this.
- **Tooling lesson.** A process outside the app server (a CLI) that posts an
  entry hands its `posted` event to a different local queue directory (`.mercato/queue`
  relative to the working directory) than the server's worker reads, and the
  fire-and-forget emit may not finish before the process exits. The dev command
  therefore runs the engine's idempotent subscriber inline. This affects only
  local tooling, not the server.
- **Naming collision to resolve.** `TC-GL-004` is used both by
  `TC-GL-004-fiscal-periods-overlap.spec.ts` (#6340) and by
  `TC-GL-004-import-default-chart-of-accounts.spec.ts` (default chart); one of
  them needs a new number before both are merged.

### 2026-10-12 (cont. — Ustawa o rachunkowości checked against the consolidated text)

Checked in the consolidated text of the Accounting Act (Dz. U. z 2026 r.
poz. 522, 640, 644, 1206; the copy was a Sejm print of 2026-10-08, supplied as a
PDF from eli.gov.pl). This replaces the earlier "unverified, secondary sources
only" status for these provisions.

- **Art. 7 ust. 3 — Confirmed.** Values of assets, liabilities, revenues and the
  related costs are determined separately, and values of assets and liabilities
  of different kinds may not be offset. The statute does not mention
  overpayments; "a customer's overpayment is a liability" is our reading of
  this rule, not statutory wording.
- **Art. 10 ust. 1 pkt 3 lit. a — Confirmed.** The entity documents its
  chart of accounts: the list of general-ledger accounts, the classification
  rules, the rules for keeping subsidiary accounts and how they link to
  general-ledger accounts; the head of the entity sets it in writing (ust. 2).
  This supports both points made earlier in this document: the chart of
  accounts is the entity's own (a default chart is only a starting point), and
  the control-account + subsidiary-ledger model matches a documented
  requirement, in addition to art. 13 ust. 1 pkt 3 and art. 16.
- **Art. 37 ust. 7 — Mismatch with how it was used.** It is about deferred
  income tax only: the provision and the asset are shown separately in the
  balance sheet and may be offset if the entity has a title to take them into
  account together when computing the tax liability. It is not an exception
  that touches trade settlements. Relevant to annual statements (#6188) and
  tax, not to overpayments.
- **Art. 46 ust. 2a — Mismatch.** Financial assets and financial liabilities
  are shown in the balance sheet net when the entity has an unconditional right
  to offset assets and liabilities of that kind and intends to settle net or
  to realize the asset and settle the liability at the same time. The earlier
  sentence "the exceptions do not cover trade settlements" is not supported:
  art. 3 ust. 1 pkt 24 defines financial assets to include a contractual right
  to receive cash, and pkt 27 financial liabilities as an obligation to
  deliver financial assets, so a trade receivable and a refund obligation to the
  same customer can fall under it. The statute does not say so expressly; this
  is an interpretation, decided by the team 2026-10-12 (no external accounting
  source). Its only effect is that Phase 1 shows these items gross.
- **Consequence.** The decision to book the excess of an overpayment to a separate
  liability account (`customerOverpaymentAccountId`, #6055) stands: the
  default in the ledger is gross, per art. 7 ust. 3. What changes is the
  reason. Net presentation under art. 46 ust. 2a depends on the entity's right
  and intent, which the system cannot know, so it is a presentation choice for
  the balance sheet (#6188), not a posting rule. Phase 1 shows these items
  gross.
- **Citation hygiene.** Earlier specs cite `Dz.U.2026.0.522`. The consolidated
  text now also carries poz. 640, 644 and 1206; cite the current version.

### 2026-10-12 (cont. — second pass: remaining Ustawa o rachunkowości citations checked against the consolidated text)

Same source as the entry above (Dz. U. z 2026 r. poz. 522, 640, 644, 1206; Sejm
print of 2026-10-08). Every citation used in the financial specs was compared
with the text.

**Mismatches (corrected in the specs where they are ours):**

- **Art. 25 ust. 2 — the General Ledger spec has it the wrong way round.** It
  says a direct correction is allowed before a period is closed, so "always a
  reversal" is stricter than the law. The Act says that after the month is
  closed **or when the books are kept by computer**, only corrections under ust.
  1 pkt 2 are allowed: a correcting document with only positive or only negative
  entries. For this system that means always. "Always a reversal" is therefore a
  legal requirement, and the rejected "conditional pre-closure edit path" would
  have been unlawful. A reversal must not mix signs inside one correction. The
  GL spec (#5663) is not changed here; to be fixed there after #6340 merges.
- **Per-counterparty subsidiary accounts — art. 17 ust. 1 pkt 2, not art. 13/16
  alone.** Art. 13 ust. 1 pkt 3 only lists księgi pomocnicze among the books; art.
  16 ust. 1 says they detail and are reconciled with the general ledger. Art.
  17 ust. 1 lists the subject areas: pkt 1 fixed assets, pkt 2 settlements with
  counterparties, pkt 4 sales, pkt 5 purchases, pkt 7 cash operations if a cash
  desk is kept. Corrected above and in #6046.
- **"Art. 40–41 UoR" for cost views (posting-rules spec) — wrong.** Art. 40 is
  repealed; art. 41 is about deferred income (rozliczenia międzyokresowe
  przychodów). The profit and loss account is prepared in the cost-of-sales
  (kalkulacyjny) **or** the by-nature (porównawczy) variant, at the choice of the
  head of the entity (art. 47 ust. 4 pkt 1, Załącznik 1). Keeping classes 4 and
  5 side by side is a chart-of-accounts practice, not a statutory rule.
- **`documentType` enum is missing a category.** Art. 20 ust. 2–3 lists seven
  kinds of document: external foreign, external own, internal, collective,
  corrective, substitute, and "rozliczeniowe" (art. 20 ust. 3 pkt 4, entries
  that restate already booked entries under new classification criteria). The GL
  spec has six and omits the last. The reclassification entries of the Posting
  Rules Engine are exactly that kind. Add `settlement` to the enum (nullable
  column, so non-breaking) after #6340; not done here because #5663 and #6340
  are not touched.
- **Art. 6 quote** — see the corrected quote above. Art. 41 ust. 1 pkt 1
  (consideration received or due for services to be performed in later periods)
  is the direct statutory basis for deferred income; art. 6 ust. 2 is the
  general matching rule.
- **Art. 30 — incomplete, not wrong.** Ust. 4 also allows, in justified cases,
  capitalising exchange differences into production cost, purchase price or the
  cost of fixed assets; and it covers differences arising on payment of
  receivables and payables, not only on balance-sheet valuation. Ust. 2 says
  that day-to-day operations in a foreign currency are booked at the NBP average
  rate of the **preceding day** (or, for payments, the rate actually applied
  where that is justified). #6190 has no rule for this yet.
- **Art. 64–65 (bulk-read spec):** art. 65 is repealed; the audit obligation is
  in art. 64.

**Confirmed against the text:** art. 3 ust. 1 pkt 24 and 27, art. 9, art. 14 ust.
2, art. 16 ust. 1, art. 18 ust. 1, art. 20 ust. 1 and ust. 2 pkt 1, art. 23 ust.
2 (five elements; the GL spec's "last two are postedAt and description" is
loosely worded: description is pkt 3, amount and date of the entry pkt 4,
designation of the accounts pkt 5), art. 30 ust. 1.

**Provisions worth citing that no spec cites yet:** art. 23 ust. 1 (computer
books: procedures against destruction, modification or hiding of an entry —
supports immutability of posted entries), art. 23 ust. 3 (foreign-currency
operations recorded so that both the Polish and the foreign amount can be
determined — supports `amountCurrency` on lines), art. 14 ust. 4 (computer
books: automatic position number **and** data identifying the person responsible
for the entry — the GL spec does not show a user field on `JournalEntry`; to be
checked), art. 17 ust. 1 pkt 1 and 7 (fixed assets, cash desk).

Not yet checked: the 20 citations in SPEC-024 (skipped on purpose, the spec is old).

### 2026-10-12 (cont. — scope decisions for cash/bank and overpayments)

Decided by the team:

- **Manual `sales` payments to the ledger:** not in #6055 or #6046. A separate spec
  after #6055 settles the contract (cash or bank account and rate, which `sales`
  does not hold today). Until then manual `sales` payments are not posted.
- **Overpayments:** Phase 1 only books the excess to `customerOverpaymentAccountId`
  (#6055). A per-customer view, a refund command and offsetting (kompensata) are a
  separate later spec: a refund is a bank payout, and an offset touches AR and AP
  at once.

### 2026-10-12 (cont. — Załącznik nr 1 and art. 45 checked)

Checked against the consolidated text including annexes (Dz. U. z 2026 r. poz.
522, 640, 644, 1206; Sejm print of 2026-10-08). This replaces the "Unverified,
annexes not available" status of the Załącznik nr 1 entries above, for the
structure (not yet line by line, because the templates in #6188 are not written).

- **Structure confirmed.** One Bilans (Aktywa, Pasywa, with "razem" on both
  sides) and an RZiS in two variants, kalkulacyjny (costs by function, class 5)
  and porównawczy (costs by nature, class 4); the final line is "Zysk (strata)
  netto". The entity chooses one variant (art. 47 ust. 4 pkt 1).
- **Scope gap in #6188, recorded there.** Art. 45 ust. 2: the statement consists
  of the balance sheet, the profit and loss account and the informacja dodatkowa;
  art. 45 ust. 3 adds the statement of changes in equity and the cash flow
  statement for entities other than micro and small. #6188 delivers the first two
  only. Simplified forms (Załączniki 4, 5, 6) and the filing format (art. 45 ust.
  1f–1g: electronic, signed, in the structure published in the BIP for KRS
  entities) are out of scope there.
- **For implementation:** generate the line codes of `bilansTemplate.ts` and
  `rzisTemplate.ts` from the text of the annex, not from memory.

### 2026-10-12 (cont. — VAT, CIT and PIT checked against consolidated texts)

Checked against consolidated texts supplied as PDFs: VAT Act (Dz. U. z 2025 r.
poz. 775, 894, 896, 1203, 1541, 1811, z 2026 r. poz. 507, 846), CIT (Dz. U. z
2026 r. poz. 554, 779, 846, 912, 1123) and PIT (Dz. U. z 2026 r. poz. 592, 779,
846, 1079, 1098, 1123). Only the provisions below were read, not the whole acts.

- **VAT art. 96b: Confirmed as the register, not as a duty.** The Head of the KAS
  keeps the wykaz (ust. 1), with settlement-account numbers (ust. 3 pkt 13),
  queryable for a chosen day (ust. 2) and updated once per business day (ust. 8).
  It carries no obligation to check and no liability rule.
- **CIT art. 15d ust. 1 pkt 2 and PIT art. 22p ust. 1 pkt 2: Confirmed.** The
  "day of transfer" rule is here: the cost is not deductible when the payment is
  made to an account other than the one in the wykaz "na dzień zlecenia
  przelewu" (supply confirmed by an invoice from an active VAT taxpayer, a
  transaction under art. 19 Prawo przedsiębiorców). Exceptions in ust. 4,
  including notification within 7 days (art. 117ba § 3 pkt 2 Ordynacji
  podatkowej). **Correction** to the contractor-registry spec, which had cited
  art. 96b for the rule and for joint liability.
- **Art. 117ba Ordynacja podatkowa and art. 19 Prawo przedsiębiorców:** checked
  later the same day, see the next entry.
- **PIT art. 22f ust. 3 and CIT art. 16f ust. 3: Confirmed.** 10 000 zł applies to
  the initial value (wartość początkowa); at or below it a one-time write-off is
  optional.
- **Accounting Act art. 32 ust. 2, 3, 4, 6 and art. 35c: Confirmed** in the
  consolidated text (previously only secondary websites). Art. 32 ust. 7–8
  (micro and small units may apply tax-law depreciation rules, except among
  others capital companies) added to the fixed-assets spec.
- **Not checked:** the other provisions of VAT, PIT and CIT; JPK_V7 and KSeF
  documents of the Ministry of Finance.

### 2026-10-12 (cont. — Ordynacja podatkowa and Prawo przedsiębiorców checked)

Checked against the consolidated texts: Ordynacja podatkowa (Dz. U. z 2026 r.
poz. 622, state of 21 April 2026; the 2025 poz. 111 text was also supplied and
is superseded) and Prawo przedsiębiorców (t.j. Dz. U. z 2025 r. poz. 1480 and
later amendments through 2026 poz. 507). Only the provisions below were read.

- **Art. 117ba Ordynacji podatkowej: Confirmed.** The payer (a VAT taxpayer) is
  jointly liable with the supplier for the supplier's VAT arrears proportional to
  the supply when the invoice-confirmed payment goes to an account not in the
  wykaz "na dzień zlecenia przelewu". Exceptions (§ 3): transaction other than
  one under art. 19 Prawo przedsiębiorców; notification to the tax office within
  7 days of ordering the transfer, at the first payment to that account; certain
  bank accounts; split payment; intra-Community acquisition, import and
  reverse-charge invoices.
- **Art. 19 Prawo przedsiębiorców: Confirmed.** Transactions with another
  entrepreneur whose one-off value exceeds PLN 15,000 go through a payment
  account; foreign-currency transactions are converted at the NBP average rate of
  the last working day before the transaction day.
- **Art. 61b Ordynacji podatkowej: Confirmed for the structure only.** The
  mikrorachunek follows the NRB format (check number, bank settlement number,
  account serial number containing the tax identifier or tax office code) and is
  made available through e-Urząd Skarbowy or the tax office (§ 1–3). The fixed
  prefix, the check-digit algorithm and the payment-title requirement are not in
  art. 61b and still rest on the Ministry of Finance page cited above.
- **Design note.** Split payment and the 7-day notification each remove the
  joint liability and the cost-deduction loss; the contractor-registry design
  enforces only the live check on the day of the transfer.

### 2026-10-12 (cont. — CIT art. 7, 15, 16 checked for SPEC-010)

Checked against the consolidated CIT text (Dz. U. z 2026 r. poz. 554 and later).
Only the provisions below were read.

- **Art. 15 ust. 1: Confirmed.** Costs of earning income or securing its source,
  except those in art. 16 ust. 1. Foreign-currency costs are converted at the NBP
  average rate of the last working day before the day the cost was incurred.
- **Art. 16 ust. 1: Confirmed** as the list of costs that are not deductible
  (category contents not mapped yet).
- **Art. 7 ust. 5: Confirmed.** Loss carryforward over five years, at most 50% of
  the loss per year, or one deduction up to PLN 5,000,000 with the rest settled
  within the same five years.
- **For multi-currency (#6190).** The tax side uses the same convention as the
  team decision for the booking-day rate (NBP average rate of the preceding
  working day; art. 15 ust. 1 CIT, art. 19 Prawo przedsiębiorców). The statutory
  source for the accounting side remains art. 30 of the Accounting Act.

### 2026-10-13 (cont. — JELD #5972: third review round; UoR Art. 25 verified, ownership guard)

- **Ustawa o rachunkowości art. 25 — Confirmed against the official text.**
  Tekst jednolity Dz.U. 2026 poz. 522 (eli.gov.pl, PDF D20260522Lj, p. 37):
  art. 25 ust. 1 pkt 2 — an error is corrected by entering into the books
  a document containing the corrections, "tylko zapisami dodatnimi albo
  tylko ujemnymi"; ust. 2 — after the month is closed, or when the books
  are kept on a computer, only that correction method is allowed. Art. 12
  ust. 5 (p. 28) defines closing the books as the irreversible exclusion of
  the possibility of making entries. Used by JELD to freeze cost-centre
  tags on lines of a locked fiscal period (a later change is a correcting
  entry). That a cost-centre tag counts as part of the booked entry is the
  spec author's reading, not stated in the Act.
- **Cross-spec convention (§2) refined:** a dimension row carries the
  consuming module as `writer`, and the module enforces one writer per
  `(line, dimensionType)` — several consumers (posting_rules, fixed_assets)
  write `CostCenter`, so per-type scoping alone is not enough. Module id and
  table are plural (`journal_entry_line_dimensions`), the command id is
  `journal_entry_line_dimensions.dimensions.set`.
- Real-code check: `postJournalEntry` (#6340) finds the covering
  `FiscalPeriod` by `operationDate` and reads it `PESSIMISTIC_READ`
  (`for share`) in the posting transaction; JELD's write command mirrors
  that lookup and lock mode.
- Implementation finding (Posting Rules #6711 → JELD #6708): a system-actor
  caller (`ctx.auth: null`, e.g. the Posting Rules engine) cannot supply
  scope through the command context, so a command called by one takes an
  optional input `tenantId`/`organizationId`, read only when `ctx.auth` is
  absent (precedent: `warranty_claims` → `create_vendor_recovery`). Also: the
  ledger line read in a cross-module command must go through
  `findOneWithDecryption`, since `ledger:journal_entry_line` has an
  encrypted `contractor_snapshot` column.

### 2026-10-14 (cont. — issue #7332 monetary findings cross-checked against our specs and code)

Issue #7332 (monetary values in Open Mercato) reviewed the first four specs of
#6061 and the current codebase. Checked against the real specs and the
implementation branches; nothing here is a decision, only findings.

- **Confirmed:** the ledger stores `debit`/`credit` as `numeric(19,4)` and
  handles them as decimal strings end to end; `sales` still computes on JS
  numbers. The implementation guide's string-only rule is kept by the ledger
  (`Number()` appears only for sequence numbers) and by JELD (no amounts).
- **Corrected in the specs:** `JournalEntry.exchangeRate` (`numeric(18,8)`,
  nullable, at most 8 decimal places) and `JournalEntryLine.amountCurrency`
  (`numeric(19,4)`) had no stated type in #5663 although the code had one
  (spec and guide updated). The #7332 text says the balance sum runs in
  Postgres; in the application it is a `BigInt` minor-unit comparison in
  `data/validators.ts` (the deferred trigger is the SQL side). `BigInt` is used
  nowhere else, in particular not for storage.
- **Corrected in code (#6711):** `posting_rules` read the debit/credit side with
  `Number(line.debit) > 0` (and the dev CLI with `Number(amount) <= 0`). Both
  now inspect the string; behaviour is unchanged.
- **Not in #7332's scope but relevant:** the Fixed Assets spec (#6014) already
  has a rounding rule for splitting an amount (the final schedule row absorbs
  the remainder). #7332 says no spec defines how to split amounts; that holds
  only for the four specs it read.
- **Open, not decided:** (1) no spec names a rounding mode (half-up or
  half-even); (2) the Multi-Currency spec computes `unrealizedGainLoss` as
  `outstanding × (valuation − booked) × sign` without stating a precision or
  rounding for the result, and types its FX report fields `numeric(18,4)`
  against the ledger's `19,4`; (3) PR #7324 makes `exchange_rates.rate` and
  `sales_orders.exchange_rate` unconstrained `numeric`, while the ledger
  rejects a rate with more than 8 decimal places, so where a rate is rounded
  before posting is undecided; (4) the AR spec refers to a local
  `decimal/toNumber` helper that a shared decimal toolkit would replace; (5)
  whether the rounding mode and FX-difference rounding follow any rule in Polish
  accounting practice is a question for the domain expert and is unverified.
  (6) `posting_rules` checks that an amount is non-zero with a small local
  helper (`isNonZeroAmount`, string-based, valid only for the ledger's plain
  non-negative decimal strings); if a shared decimal helper for money lands,
  it should replace this.

### 2026-10-15 (cont. — Deferred Revenue #6193: `sales` correction links checked, review round)

Review of the Deferred Revenue spec (#6193) found that its correction guard
keyed on a link that does not exist. Checked against `sales`' entities on
`develop` (2026-10-13); nothing here is a decision, only findings.

- **No `sales` row references `SalesInvoiceLine.id`.** `SalesCreditMemo` links to
  the invoice header (`invoice_id`, nullable) and the order (`order_id`,
  nullable). `SalesCreditMemoLine` links to `order_line_id` (nullable);
  `SalesReturn` links only to the order and `SalesReturnLine` to
  `order_line_id`. `SalesInvoiceLine.order_line_id` is itself nullable. A
  consumer that wants to know "has this invoice line been corrected" can
  therefore match only on the invoice header (credit memos) or on the order
  line (credit-memo and return lines), and cannot see a return against a line
  whose `order_line_id` is null. Any future module reading corrections hits the
  same limit; AR (`sales_invoice_gl_posting`) is the likelier place for a direct
  link.
- **Entities carry `deleted_at`** (`SalesInvoice`, `SalesCreditMemo`,
  `SalesReturn`, `SalesReturnLine`) and a `status`; the Deferred Revenue guard
  treats any non-deleted row as a correction, whatever its status — the
  conservative reading.
- **Invoice date used by AR:** `sales_invoice_gl_posting` posts with
  `operationDate: invoice.issueDate`; Deferred Revenue's reclassification now
  uses the same date so it moves revenue out of income in the period that
  booked it.
- **Reversal date rule (#5663):** a reversal's `operationDate` may not be
  earlier than the entry it reverses; `cancelRevenueDeferral` reverses on the
  cancel date.
- **Decided by the spec author, 2026-10-15:** Polish law is the reference for
  accounting questions. A locked invoice period is not redated automatically:
  `deferRevenueRecognition` rejects with 409 `FISCAL_PERIOD_LOCKED` and the
  accountant either unlocks the period or repeats the call with
  `reclassificationDate: 'CURRENT_DATE'` (a correcting entry dated today; 409
  again if today's period is locked too). Recovery from a wrong deferral is a
  `cancelRevenueDeferral` command, not a manual reversal.
- **Prior art for "what to do with a schedule when the invoice is credited"
  (checked 2026-10-15, documentation only, not source):** ERPNext's deferred
  revenue/credit-note pages and Odoo 17's deferred-revenues page describe no
  automatic freezing or adjustment of an existing schedule on a credit note;
  the correction is left to the accountant. Odoo reclassifies on the invoice
  date. Neither settles whether the schedule should be frozen, so this is not
  decisive for Design decision 14.
- **Polish law (Ustawa o rachunkowości), checked 2026-10-15.** Art. 54 —
  Confirmed (paraphrase from two legal-text sites, standardyprawa.pl and
  lexlege.pl; not ISAP): after the statements are prepared but before approval,
  the statements are changed and the entries go to the books of the year
  concerned (ust. 1); after approval, to the books of the year the information
  was received (ust. 2); an error of earlier years goes to equity as "zysk
  (strata) z lat ubiegłych" (ust. 3). It concerns events after the balance-sheet
  date; it is not a ban on dated entries and says nothing about a monthly close.
  Art. 6 ust. 1 (matching of revenue to its period) — Confirmed earlier.
  Art. 20 ust. 1 and the practice that a correction goes to the original period,
  or to the month of the correction when that month's books are closed —
  Unverified against the statute (secondary source, poradnikprzedsiebiorcy.pl;
  the source notes the Act does not say so expressly for a monthly close).
  CIT/PIT (art. 12 ust. 3j–3m CIT, art. 14 ust. 1m–1p PIT: correction in the
  period it is issued) — Unverified, tax, out of scope. Art. 25 UoR, which an
  earlier spec text cited for correcting a closed period, is not verified and
  was removed.
- **Literature, comparison only: Kieso 17th ed., Ch. 18 (US GAAP/ASC 606), full
  text searched 2026-10-15.** Sales returns and allowances are contra-revenue
  booked when they occur, recognized revenue is not rewritten (pp.
  18-19–18-20); unearned revenue is a contract liability released as the
  obligation is satisfied (p. 18-31); a contract modification is generally
  prospective (pp. 18-32–18-33, footnote 15: cumulative catch-up as the
  alternative). Where it differs from the Polish rule, the Polish rule governs.
  Neither source says whether to freeze a schedule or offer a release command.
- **Open, not decided:** Design decision 14 (freeze vs warn vs release
  command after a detected correction) pending the
  domain expert; who owns the business decision behind "recognize
  immediately, no refund" (DD6).

### 2026-10-15 (cont. — Multi-Currency #6190: review round, Table A provider checked against `currencies`)

- **Review round on #6190** (adeptofvoltron, head d9bf77e1e): all findings valid.
  Design now: valuation plus a reversing `NORMAL` entry on the first day of the next
  period in one transaction (Kieso Ch. 3 reversing entries); no settlement gate; as-of
  open amounts; per-tenant advisory lock plus a partial unique index on POSTED runs;
  rate backfill moved to the owning modules (`sales`, `accounts_payable`).
- **`currencies` extension mechanics (checked on `develop`).** `RateProvider` implementations
  are registered through `registerCurrencyRateProvider` (public registry, used by the `example`
  module) or in `currencies/di.ts`. The `exchange_rates` unique key includes `source`, so a Table A
  provider under `source: 'NBP_A'` needs no schema change. `RateProviderResult.type` and the manual-entry
  validator accept only `buy`/`sell`/`null`, so Table A rows use `type = null` (identified by `source`). `ExchangeRateService` with `autoFetch` calls all
  registered providers; scheduled fetching uses a fixed provider enum
  (`providerSchema`) and a hard-coded UI list. `findRateWithFallback` goes back a day only when no
  source has a row for the date.
- **Decision (team, 2026-10-15; OM Core may object):** Table A provider lives in `currencies`, built as the first commit of
  the implementation PR, rows `XXX → PLN` only, `date` at UTC midnight (details: spec DD9c). Reasons: AP/AR need the same rate (dependency direction), the provider registry is
  process-wide (hidden side effect on `autoFetch`), `currencies` already owns the other sources. Fallback only
  if OM Core objects: register it from `fx_revaluation`.
- **Closed 2026-10-15:** `accounts-payable-payments.md` now has `PaymentBatch.sentOn` (the `operationDate`
  of the payment entry; optional input on `markPaymentBatchSent`, default today, not later than today) and a
  "Read contract for other modules" section (AP #5962). Before, the spec did not state the posting date.

### 2026-10-16 (cont. — Deferred Revenue #6193: domain-expert answers, Mateusz Duda)

Source: email from Mateusz Duda (Financial Controller, incro) of 2026-10-16, answering the three questions sent on 2026-10-15. Domain-expert statements; no statute was checked for them beyond what is already recorded.

- **Correction or return on an invoice with an active RMP schedule (DD14).** Freeze confirmed. A correction is a new document, so the accountant corrects by hand, and also the schedule when the correction affects it. Release/adjust command stays Phase 2.
- **Locked month of the invoice (DD15).** The accountant decides. In the year: (a) correct revenue and spread evenly, or (b) correct in an open period with the future-year part as next year's RMP. After year end: unapproved statements → (a); approved → (b) in the new year's open period, or (c) through prior years' result, only for material errors (immaterial → current result). Consistent with the art. 54 reading already recorded (ust. 3); the materiality distinction is the expert's statement, not checked against the statute.
- **Cancellation (DD6).** Without a refund and with services stopped: recognize the remainder on the cancellation date. With a refund: recognize over time → cancellation stops accruals → credit note → the credit note reduces the remaining RMP balance; the remainder is not recognized as revenue (no further services, so no basis). So `stopRevenueRecognitionSchedule` is the no-refund path only; for a refund the credit note comes first and the correction guard freezes the deferral.
- **Closed:** every ⚠ NEEDS HUMAN CONFIRMATION in the Deferred Revenue spec. Not named: a business owner of the DD6 policy (informational).

### 2026-10-16 (cont. — `financial_pl` specs move to Core, #7070)

- **Direction (from #7070, @wojciechszyjka, 2026-10-09):** `official-modules` is deprecated and
  being archived; `financial_pl` will not live there. SPEC-012 and SPEC-013 moved to Core
  (`.ai/specs/2026-10-08-financial-pl-integration-contracts.md`,
  `.ai/specs/2026-10-08-financial-pl-accounting-package.md`) with a Prerequisites section: pinned links to
  the `financial_pl` code (`17c575c`) and to SPEC-010/011 (`6b5dfb9`, `79aa0b9`), and a table of what each
  phase waits on. The agreement stated in that PR covers SPEC-012/013 only; SPEC-010/011 stay as pinned links there.
- **SPEC-010/011: move to Core prepared, not yet agreed with maintainers** (branch `docs/financial-pl-specs-010-011-to-core`, local, PR not opened):
  `.ai/specs/2026-09-11-jpk-kr-pd-financial-pl.md` and `.ai/specs/2026-09-16-tax-management-financial-pl.md`,
  content unchanged except a provenance note and the same kind of Prerequisites section. Module map above already shows the target filenames.
- **Superseded wording:** the 2026-10-08 notes above that put `financial_pl_accounting` "in `official-modules`" and
  say `financial_pl` "lives in `official-modules`" describe the position before this move. The design (separate
  package, hard `requires`, DI transport and VAT read services) is unchanged; only the repository changed.
- **Still open:** package layout inside Core against `packages/core/AGENTS.md`; the stale `official-modules` banners
  inside SPEC-010/011 (kept as is, per "content unchanged"); when `financial_pl` itself is brought into Core.

### 2026-10-19 (cont. — `financial_pl` specs lose their SPEC-010..013 numbers)

- Core names new specs `{date}-{title}` only (`.ai/specs/README.md`, "Naming Convention"), and `SPEC-010` to `SPEC-013` are already taken on `develop` by unrelated implemented specs (dashboard widget visibility, dashboard analytics widgets, AI assistant schema discovery, decouple module setup). The four `financial_pl` specs therefore no longer carry a number in Core: the JPK_KR_PD spec, the tax engines spec, the integration contracts spec and the accounting package spec. The module map above shows the `official-modules` number in parentheses.
- The JPK_KR_PD and tax engines specs were renamed in their cross-references on the #7524 branch. The integration contracts and accounting package specs belong to #7070 and still use SPEC-012 and SPEC-013 in their headings; renaming them is a change to that PR. Older Changelog entries here and in the other specs keep the original numbers.
- Row for the move of the first two specs now links #7524 instead of "PR to be opened".


### 2026-10-20 (cont. — contractor bank accounts and verification evidence: #5955, #5962, #5663 aligned)

A customer implementation needed the contractor registry to hold
bank-account currency, IBAN/NRB validation, verification history with a
request id, EU VAT numbers with VIES on demand, reversible deactivation
and full-value search under encryption. Sibling specs were read in full
first (AP #5962, Cash & Bank #6055, Multi-Currency #6190, Tax #6168, GL
#5663, this document): none designed any of these for the contractor.
Decisions were then written into Contractor Registry (Design decisions
2026-10-20), AP Payments/Invoices and GL.

- **Literature (Fowler, Hay, Kieso) — Unverified this pass.** The PDFs
  could not be opened from this session (macOS denied access to the
  folder they are in), so no full-text search was run and no absence is
  claimed. What is already verified (2026-09-12, quoted in #5955's
  Literature section): Fowler, *Analysis Patterns*, §2.1 "Party", says
  parties "have bank accounts" and nothing more about them; Hay Ch.3
  "Parties" (pp.23-24) is about the PERSON/ORGANIZATION → PARTY
  generalization. Nothing verified in any of the three on bank-account
  structure, number validation or registry verification. Run the
  full-text check before citing any of them on these topics.
- **Ministry of Finance whitelist API — Confirmed** (`wl-api.mf.gov.pl`,
  2026-10-20): check responses carry `accountAssigned`,
  `requestDateTime`, `requestId`; search responses (single and batch, at
  most 30 identifiers) carry `requestDateTime` and `requestId`. The
  list is queried by NIP or REGON.
- **VIES request identifier — Unverified.** #5955 stores it when VIES
  returns one and `null` otherwise; when VIES returns it was not checked.
- **Odoo 18 — Confirmed, partially comparable.** `res.partner.bank`:
  `acc_number`, stored `sanitized_acc_number`, optional `currency_id`,
  `active` (default `True`), `allow_out_payment`,
  `unique(sanitized_acc_number, partner_id)`. `base_iban`: per-country
  length template plus mod 97, only for accounts of type IBAN. No
  registry evidence on the account.
- **ERPNext — Comparable, checksum Unverified.** Bank Account can belong
  to a Supplier/Customer; IBAN separate ("Leave it empty when the
  country does not use IBAN"); one intended default. The documentation
  does not state an IBAN checksum.
- **Comarch ERP Optima — Confirmed** (pomoc.comarch.pl, 2025): "Historia
  weryfikacji rachunków bankowych" with "Data sprawdzenia", "NIP", "W
  Wykazie", "Identyfikator wyszukiwania – unikalny identyfikator
  otrzymany po sprawdzeniu"; serial operation "Zweryfikuj status VAT i
  rachunki bankowe". The closest precedent for #5955's
  `ContractorVerificationCheck`. An "import accounts from the VAT list"
  button appeared only in search-result summaries — Unverified.
- **Comarch ERP XL — Unverified**, no public page found.
- **Code fact used by the design.** `hashForLookup`
  (`packages/shared/src/lib/encryption/aes.ts`) is HMAC-SHA256 with the
  installation pepper (`LOOKUP_HASH_PEPPER`, falling back to the
  tenant-data encryption keys), prefixed `v2:`; with no key configured
  it falls back to an unkeyed SHA-256. `hashField` in an encryption map
  writes it. #5955 already used it for `nip_hash`; the account number now
  uses the same mechanism.

**Inconsistencies between the specs and how they were resolved:**

1. AP stored `requestId` from the whitelist check, the registry did not
   return it → #5955 returns `{ status, checkedAt, requestId }` from the
   Ministry's response.
2. AP said GUS/VIES verification blocks payment, but only called the
   whitelist check, which gated on approval only → #5955 returns
   `eligible` + `reasons[]`; `VERIFICATION_FAILED` (status `FAILED`)
   blocks, `PENDING`/`NOT_APPLICABLE` do not; AP maps each reason to its
   own code (`PAYMENT_BATCH_NOT_ELIGIBLE` replaces
   `WHITELIST_CHECK_FAILED`).
3. GL's snapshot named a "Biała Lista verification status" the registry
   did not have → GL defines the keys; the status is the check result
   as of posting held by the payment module.
4. GL said the registry encrypts the bank account "on the `Contractor`
   entity" → corrected to `ContractorBankAccount`.
5. GL said AP writes `contractorSnapshot`, no AP command did → AP's
   `postVendorInvoice` (name + tax id) and `markPaymentBatchSent` (name,
   tax id, masked account paid to, whitelist check) write it.
6. AP's evidence kept no trace of which number was checked → the
   registry's history keeps the last four digits and the lookup hash;
   AP's line keeps the last four digits.
7. AP's `vendorSnapshot.taxId` may be foreign, the registry was NIP-only
   → the registry gains `euVatNumber`; the NIP lookup returns `null`
   for a foreign id without an error; AP keeps it as printed.
8. Cash & Bank's own `BankAccount` has currency and `isActive`, the
   contractor's account had neither → `currencyCode` (informational) and
   reversible `isActive` on `ContractorBankAccount`; the IBAN/NRB
   validator lives in `shared` so Cash & Bank can reuse it.

**Resolved: re-check at `markPaymentBatchSent`.** AP checks the
whitelist at `confirmPaymentBatch` and posts at `markPaymentBatchSent`,
possibly on a later day, while the legal test is the day the transfer is
ordered. #5962 (Design decisions 2026-10-20) now repeats the eligibility
check at `markPaymentBatchSent` when the stored one is from an earlier
calendar day in `Europe/Warsaw`; the new result replaces
`whitelistCheck` in `contractorSnapshot`, and a failure blocks the send
with `422 PAYMENT_BATCH_NOT_ELIGIBLE`.

### 2026-10-23 (cont. — currency, rate and original amount on the ledger line: controller's answer, literature and systems checked)

Trigger: the Money/Currency review on #7795 raised how the ledger stores
foreign amounts. The question went to the controller (Mateusz Duda, incro)
as an e-mail; his answer of 2026-10-23 07:03 UTC is the base for the
decision. Written into GL core engine (Design decisions, 2026-10-23) and
aligned in JELD, Posting Rules, Multi-Currency, Cash & Bank, Default Chart
of Accounts and GL Account Balances in the same round; the ledger code
(#6340) follows it.

- **Controller's answer — domain-expert statement, no statute checked for
  it.** Foreign-currency postings need the currency, the rate and the
  original amount on the entry line, and one entry can mix currencies
  (his example: an invoice in one currency paid from a bank account in
  another). Each bank account is its own ledger account whatever its
  currency (the balance in the account's currency must agree with the
  bank statement); settlement accounts (rozrachunki) are kept per
  contractor in the base currency. A realized exchange difference between
  the invoice rate and the payment rate is, in his words, usually booked
  as a separate entry at settlement; only the conversion difference
  belongs in the payment's own entry.
- **Decision (option 2, chosen by the spec author).** `JournalEntryLine`
  gets `currencyId`, `exchangeRate` (base-currency units per one unit of
  the line's currency) and `amountCurrency` (unsigned magnitude in the
  line's currency); `debit`/`credit` stay in the base currency and the
  entry balances only there. The header's currency and rate stay as the
  source document's and are the default for a line that omits its own,
  filled in **at write time** so a stored line is never null (a read-time
  "null means the header" rule would misread a line left unset in a mixed
  entry). `LedgerAccount.currencyId` is nullable, set on bank accounts,
  immutable once the account has posted lines.
- **Consistency rule.** `|amountCurrency × exchangeRate − base amount|`
  within half the smallest unit of the base currency; lines with
  `amountCurrency = 0` (exchange-difference lines) exempt. **⚠ NEEDS HUMAN
  CONFIRMATION:** the tolerance is a working proposal.
- **Still not confirmed by the controller:** that line currency and rate
  are NOT NULL; the account-currency rule as written; whether the
  realized difference may sit in the payment's own entry (Cash & Bank
  still books it there, the controller's "usually separate entry"
  suggests a change); whether header currency and rate become optional
  later. Cash & Bank's formula was written in the bank's currency and is
  restated in base-currency terms.
- **Kieso — Confirmed absence of mechanics.** Intermediate Accounting
  has no journal-line data structure for foreign amounts; a footnote puts
  hedging outside its scope.
  No claim is made for page numbers in this entry (not re-read this pass).
- **Fowler, *Analysis Patterns* — Confirmed, partial.** §3.1 *Quantity*
  and §3.2 *Conversion Ratio* give the pattern for an amount in one unit
  with a ratio to another. Neither decides whether one posting may mix
  currencies, so they support storing amount, unit and ratio together but
  not the line-level choice itself. Hay: nothing relevant found.
- **Ustawa o rachunkowości.** Art. 9 and art. 30 (foreign-currency
  valuation) are Confirmed in this document's earlier passes. Art. 23
  ust. 3 is cited in the GL spec and was not re-read against the
  consolidated text in this pass — **Unverified here**.
- **ERPNext — Comparable, partly silent.** The Journal Entry documentation
  has the amount typed in each row's account currency, so a row carries
  its own currency. The documentation does not say
  how many different foreign currencies one entry may hold.
- **GnuCash — Comparable.** A split holds an amount in the account's
  commodity and a value in the transaction's currency; with trading
  accounts enabled it books the difference between the two. This is the
  same two-quantity shape as ours, with the currency attached to the
  account instead of the line.
- **Odoo — Secondary source only.** A currency per journal item (amount in
  the item's currency next to the company-currency debit/credit) is
  described in a third-party article; Odoo's own documentation could not
  be fetched (blocked by robots.txt) and was not worked around. Not
  citable as confirmed.
- **Divergence worth keeping.** GnuCash and, in the partial reading
  above, ERPNext tie the currency to the account; we keep it on the line
  and add an account currency only where the account is single-currency
  (banks), because settlement accounts are base-currency per contractor
  and the invoice currency varies line by line.
- **Open for the `financial_pl` pass.** JPK_KR_PD maps Z_6/Z_9 to the
  header currency in the specs read so far; the mapping has to follow the
  line currency. Recorded here so the pass does not rediscover it.

### 2026-10-23 (cont. — booking-day rate, rounding line, payment-day difference, settlement accounts)

Checked in this pass: the code of `currencies/services/exchangeRateService.ts`
and `rateFetchingService.ts`; the Multi-Currency, AP, SIGLP, GL, Cash & Bank
and JPK specs; Comarch Optima's help (currency documents, settlement in
different currencies); Odoo's and ERPNext's documentation on exchange
differences at payment; the text of art. 30 ustawy o rachunkowości; articles
quoting art. 106e ust. 11 and art. 31a ustawy o VAT. The Kieso text was not
re-read in this pass.

- **`getRate` semantics (confirmed in code).** It tests the requested date
  first, then steps back day by day up to `maxDaysBack` (default 30), returns
  `actualDate`, rejects a future date. It fetches from the providers only when
  no row of any source exists for the date. The scheduled fetch's provider
  enum is `NBP`, `Raiffeisen Bank Polska`, `Custom` (no Table A). Consequence:
  a document rate "against the issue date" is the issue day's rate, and a day
  with a stored Table C row never gets its Table A row fetched on retry.
  Decided: callers pass operation date − 1 day (documents) or the valuation
  date; an optional `source` on `getRate` is proposed (Multi-Currency 9f/9g).
- **Rounding on a foreign-currency invoice.** The law fixes rounding to the
  full grosz, half up (art. 106e ust. 11); it does not say whether VAT is
  converted per line or per invoice. Comarch Optima converts net, VAT and gross
  separately by default and corrects the VAT line when net plus VAT differ from
  gross (a configurable alternative converts net and derives VAT and gross from
  it); on multi-line documents it corrects the line with the highest VAT rate;
  it uses no separate rounding account. In a simulation of 796 invoice amounts at four
  rates about a quarter differed by more than half a grosz between net plus VAT
  and gross. Decided by the team: every line is converted on its own and the
  difference goes to one ordinary base-currency line on `roundingAccountId`
  (AP, SIGLP).
- **VAT in złoty.** Art. 106e ust. 11 and art. 31a: the VAT amount in złoty uses
  the rate of the last business day before the tax obligation arises, which is
  not always the invoice date. Not in any spec before this pass; it belongs to
  `financial_pl` (VAT register, JPK_V7, KSeF). Whether KSeF FA(3) requires the
  złoty VAT on a foreign-currency invoice is unchecked.
- **Realized difference at payment.** Art. 30 ust. 2 pkt 1 and ust. 4: a payment
  is booked at the rate actually applied that day, differences go to financial
  income or costs; nothing says one entry or two. Odoo books the difference in a
  separate entry in its own journal after reconciliation; ERPNext books it in
  the payment entry on an exchange gain/loss account; Optima creates it
  automatically at settlement (not specified further). The controller's e-mail
  of 2026-10-23 decides for us: conversion difference between two currencies in
  the payment entry, invoice-rate versus payment-rate difference as its own
  entry.
- **Settlement accounts carry no `currencyId`.** The controller keeps one
  settlement account per contractor in the base currency and a currency on every
  document line; a currency set on such an account would reject foreign lines.
- **Gap named.** Revaluation of foreign-currency bank accounts by their balance
  in the account's currency is not in the Multi-Currency spec (Out of scope).
- **JPK_KR_PD currency fields.** The Ministry's JPK_KR (v1) instruction marks
  the foreign-amount and currency-code fields optional; a vendor mapping leaves
  them empty on PLN lines. Not checked against the JPK_KR_PD XSD.

### 2026-10-23 (cont. — settlement posting restated, bank-account valuation, KSeF and JPK evidence)

- **Settlement posting.** With a currency and rate on every line, the settlement
  of a foreign-currency invoice needs no cross-rate: a payment entry (bank line
  at the bank currency's rate, receivable at the invoice currency's rate on the
  payment day, balancing line for the conversion difference) and, when the
  invoice rate moved, a separate entry moving the receivable from the booked rate
  to the payment-day rate with an `amountCurrency = 0` line. Recorded in
  `cash-bank-management.md`; checked on two numeric cases.
- **Outflow of currency from a foreign-currency account.** Comarch ERP XL values
  outflows by FIFO or LIFO per register (chosen once, no default) and creates no
  exchange difference by FIFO or LIFO itself; a fixed rate creates an
  exchange-difference document. The method is accounting policy, not law. Open
  question for the controller (Multi-Currency, Out of scope).
- **KSeF and JPK.** A secondary source says a foreign-currency KSeF invoice
  shows the VAT in złoty with the rate (at most six decimals); the FA(3) fields
  were not read. The Ministry's JPK_KR_PD brochure (May 2024, table 12) marks
  `Z_5`, `Z_6`, `Z_8`, `Z_9` optional and silent on PLN lines; the raw XSD is
  unread.

### 2026-10-23 (cont. — `source` and the Table A provider implemented, payment contracts rewritten, XSD read)

- **Code (branch `feat/currencies-source-aware-rate-lookup`, local commits
  7957fc833 and c2fc24ede on `upstream/develop`).** `ExchangeRateService.getRate`
  and `getRates` take an optional `source`: only rows of that source count, a
  missing row triggers `fetchRatesForDate(date, scope, { providers: [source] })`,
  and the lookup steps back a day only when that provider has nothing. Omitted,
  the behaviour is unchanged. `NBPTableAProvider` (`source: 'NBP_A'`, `XXX -> PLN`
  mid rates with `type: null`, dated by the table's `effectiveDate`, nothing on
  404) is registered in `di.ts`; the scheduled fetch configuration is left
  alone. Tests: the `currencies/services` suite passes (80 tests); not yet
  discussed with OM Core (Multi-Currency decision 9g).
- **Specs.** Cash & Bank: the match input, event payload, API errors, UI, data
  model and tests now use `bankRate` and `invoiceRatePaid` (defaults from the
  bank's rate or Table A) and the invoice's stored rate instead of
  `bookedExchangeRate`. Accounts Payable payments: `markPaymentBatchSent` posts
  in the batch currency with `paymentRate` and a separate difference entry
  against `gainLossAccountId`; a cash account in another currency is rejected in
  Phase 1 (⚠ open, belongs with the conversion case in Cash & Bank).
- **XSD read.** `Schemat_JPK_KR_PD(1)_v1-1`, `KontoZapis`: `Z_5`, `Z_6`, `Z_8`,
  `Z_9` are `minOccurs="0"`, `Z_4`–`Z_6` and `Z_7`–`Z_9` are a Debit/Credit
  choice, no rule ties them to the line's currency, and the element has no
  exchange-rate field, so the ledger's line rate is not exported. Read through
  text extraction; the facets of `TKwotowy` and `TKodWaluty` were not visible.
- **FA(3) still unread.** The MF schema host redirected in a loop. Two more
  secondary sources (Billit, Inforlex) agree that a foreign-currency invoice
  carries the currency code, a rate with at most six decimals and the VAT amount
  in złoty (`P_14_xW`), and disagree on whether `KursWalutyZ` is the header rate
  or the advance-invoice rate, so the field names stay unverified.

### 2026-10-23 (cont. — controller's answer on valuing the outflow of currency)

- **Source:** e-mail from Mateusz Duda (controller), 2026-10-23, to the questions on outflow valuation and on separating realized and unrealized differences. Practice and policy, not a checked legal text.
- **Outflow valuation is accounting policy.** FIFO is the usual choice (each inflow is a lot with its own rate, an outflow consumes the oldest lot at its rate); weighted average is also permitted; an outflow at the rate of the day books no realized differences and pushes all of it to the valuation. For CIT the realized differences would then have to be computed outside the books.
- **Mandatory valuation** is only the balance at the balance-sheet date at the NBP average rate; a monthly valuation is the company's choice.
- **Realized and unrealized differences are kept apart** (separate sub-accounts), because only realized differences enter CIT; the exception is the rarely used accounting-law method in the CIT act (not checked against the act).
- **Worked example:** USD 1,000 in at 4.00, USD 500 out at 4.20, NBP 4.10 at month end: FIFO 100 realized plus 50 unrealized; rate of the day 150 at valuation.
- **Where it landed:** Multi-Currency (Out of scope bullet and changelog), Cash & Bank (Out of scope: lots, per-account method, one bank line per consumed lot), Accounts Payable payments (Phase 1 credits a foreign-currency cash account at the payment rate until lots exist). Comarch ERP XL (FIFO or LIFO per register, fixed once) is consistent with it.

### 2026-10-23 (cont. — foreign-currency lots and the cash account in another currency)

- **Lots (Cash & Bank, Architecture → Foreign-currency lots).** `BankAccountLot` per foreign-currency account, `outflowValuationMethod` FIFO (default) or weighted average, inflow creates a lot, own outflows post one bank line per consumed lot with the difference to the rate of the day on the realized account, a `payment_batch` outflow posts a cost adjustment entry (Accounts Payable has already credited the cash line at the rate of the day), `409 INSUFFICIENT_LOTS`. The base balance of the ledger account equals the sum of remaining lots at their rates, which is what the later valuation needs.
- **Cash account in another currency (AP payments).** Settled from the controller's e-mail of 2026-10-23 (one entry with lines in different currencies, the conversion difference as a balancing line): the cash line is posted in the cash account's currency with `cashRate` and `cashAmount`; the amount the bank actually debits is reconciled at statement matching, and posting a correction is not done in Phase 1.

- **OM Core proposal opened (2026-10-23).** Issue #7883 proposes the optional `source` on `ExchangeRateService.getRate`/`getRates` and the `NBP_A` provider in `currencies`; #6061 has a matching dependency row (`accounts_payable`, `sales_invoices_gl_posting`, `cash_bank_management`, `fx_revaluation` → `currencies`). Found while testing it: a stored row must be stamped at UTC midnight of its effective date because `getRate` matches that instant exactly, so `NBP_A` is stamped that way (a Warsaw-midnight stamp is never found). The existing `NBPProvider` (Table C) stamps Warsaw midnight and, in a mocked store-then-`getRate` test, its row is not found; not confirmed against a real Postgres and left to OM Core (side observation in #7883). Awaiting maintainers' answer on the `source` name and semantics.

### 2026-10-26 — revaluation of foreign-currency ledger accounts (bank, cash): consistency, literature and systems checked

- **Where it landed:** `2026-09-17-multi-currency.md`, new section "Revaluation of foreign-currency ledger accounts (bank, cash)" (decisions R1–R5, each ⚠ NEEDS HUMAN CONFIRMATION, decided by the team, not yet reviewed by a maintainer). Owner `fx_revaluation`, selection by `LedgerAccount.currencyId` ≠ base (cash desk included without an owner), one run with AP/AR, unrealized accounts only, account line in the account's currency with `amountCurrency = 0`, `balanceInAccountCurrency × NBP Table A − baseBalance`, FIFO lots untouched, balances from an extended `getAccountBalance` (#6013 change named, not made).
- **GL core engine checked (`feat/general-ledger-core-engine` at `c47359dd1`):** a line on an account with a `currencyId` must carry that currency (`postJournalEntry.ts`, `resolvePostingLines`, 422 `lineCurrencyDiffersFromAccount`); `postJournalEntry` is the only writer of lines and reversals use it; the account currency is immutable after the first posting (`ledgerAccounts.ts`, 409). `lineCurrency.ts` itself does not check the account; it only resolves the line currency and exempts `amountCurrency = 0` lines from the amount × rate rule. Consequence recorded: the valuation line on such an account cannot be the base-currency line of Multi-Currency Design decision 5.
- **Kieso (full text extracted and searched, 1,584 pages): Confirmed.** Appendix 7A, p. 7-31, Global View: multinational corporations "typically translate these currencies into U.S. dollars, using the exchange rate in effect at the balance sheet date" (cash accounts in more than one currency). Ch. 7, p. 7-28, Global View: foreign-currency receivables carry the risk "that the exchange rate may move against the company". **Absence recorded:** Kieso's FIFO and weighted average are inventory cost-flow methods only; nothing on lots of foreign currency. The foreign-currency hedging remark (Ch. 17) puts hedging/consolidation beyond the book's scope.
- **Fowler (full text, 361 pages): nothing on revaluation.** Exchange rates appear in the trading chapters and as Conversion Ratio (3.2); no period-end revaluation, unrealized differences or currency lots. **Hay (full text, 277 pages): no occurrence** of foreign currency, exchange rate, revaluation or unrealized.
- **Systems:** ERPNext Exchange Rate Revaluation (docs.frappe.io) — revalues foreign-currency balance-sheet accounts, account-currency balance unchanged, offset on a company-level Unrealized Exchange Gain/Loss Account separate from the realized one, reversal optional: **Confirmed, comparable**. Odoo, "Manage a bank account in a foreign currency" (odoo.com documentation) — Unrealized Currencies report, Adjustment Entry to chosen expense/income accounts, automatic reversal on a chosen date: **Confirmed, comparable**. Comarch ERP Optima, "Kiedy tworzą się różnice kursowe w magazynie walut" (pomoc.comarch.pl) — withdrawals settled by FIFO against the first free resource of the currency warehouse, realized difference = withdrawal value − deposit value in the system currency: **Confirmed for FIFO; nothing on period-end valuation**. GnuCash — mailing-list posts and a third-party essay only: **not used (no official documentation found)**. Symfonia, enova365: **not publicly checkable** (no vendor documentation in the search results).
- **Open points carried in the spec:** accounts with foreign-currency lines but no `currencyId` (warn, reject or ignore); a control account with a `currencyId` (proposed 422); parent and child both with a `currencyId` (double counting); a currency not in Table A (art. 30 ust. 3, to be verified); cash desk outflows without FIFO cost.

