# SPEC-010 — JPK_KR_PD (Statutory Accounting Books e-Filing) for `financial_pl`

> **Status: DRAFT — first pass, not reviewed.** Written from the
> 2026-09-10 architecture analysis (`Claude outputs/2026-09-10-jpk-kr-pd-
> financial-pl-analysis.md`). Three items below are carried over as
> **explicit assumptions** rather than blocking Open Questions, per the
> decision to draft now and iterate through review (see Open Questions /
> Assumptions To Confirm).
>
> **⚠ Temporary location.** This spec describes a `financial_pl` feature
> (implemented in the separate `official-modules` repo), and by this
> project's own convention it should eventually live there as `SPEC-010`,
> alongside `SPEC-005`–`SPEC-009` (the existing KSeF/JPK_V7 specs) — not
> in `open-mercato`'s `.ai/specs/`. It is staged here **temporarily**,
> because `official-modules` isn't checked out in this working
> environment yet, so the team can review/iterate on it now instead of
> waiting. **Move this file to `official-modules` (as `SPEC-010`) before
> any implementation work starts on it** — do not build against the copy
> in this repo.

## 📝 TLDR

`financial_pl` needs to generate and submit **JPK_KR_PD** — Poland's
annual electronic filing of a taxpayer's full statutory accounting books
(chart of accounts, journal, postings, trial balance) to the tax
authority. This is a different filing from JPK_V7 (VAT register, monthly)
and KSeF (invoice exchange): it reports the **general ledger itself**, so
it is `financial_pl`'s first-ever dependency on `ledger`
(`requires: ['ledger']`). The submission pipeline, XSD-vendoring pattern,
and filing-entity lifecycle already exist in `financial_pl` for JPK_V7 and
are reused almost unchanged; the two things that are genuinely new are
(1) the XML builder for JPK_KR_PD's own structure, and (2) reading GL data
in bulk from another module's code, which `ledger`'s Bulk Read Service
(`#6038`, still unmerged) is designed to provide. Book/tax reconciliation
(`RPD`) is treated as out of scope for this document (see Design
Decisions) and left as its own future spec.

## 📝 Problem Statement

Poland's Ministry of Finance requires taxpayers keeping full accounting
books to submit **JPK_KR_PD**, a standardized XML export of those books,
alongside their annual CIT/PIT return. This is separate from and in
addition to JPK_V7 (VAT, monthly) and KSeF (e-invoicing) — `financial_pl`
already handles both of those, but has no path today for a books-level
export, because it has never needed to read `ledger` data at all: every
existing `financial_pl` capability is built from its own tables
(`ReceivedInvoice`, `PurchaseVatRecord`) and JPK_V7's `Dziennik`-equivalent
rows never touch the general ledger.

Confirmed rollout (Ministry of Finance brochure *Broszura informacyjna
dotycząca struktury JPK_KR_PD*, podatki.gov.pl, 26.08.2024, and
`gov.pl/web/kas/elektroniczne-ksiegi-rachunkowe-w-podatku-pit-w-2026-r`):

- **CIT** — large/multinational groups (>€50M prior-year revenue): fiscal
  years ending after 31 Dec 2024, filed by end of March 2026 (**this
  window has already closed as of this writing — see Risks**).
  Entities already obligated to JPK_VAT: fiscal years starting after
  31 Dec 2025. Everyone else: fiscal years starting after 31 Dec 2026.
- **PIT** (full accounting books): JPK_VAT-obligated taxpayers — fiscal
  years after 31 Dec 2025; everyone else — after 31 Dec 2026.
- Filing rides the CIT/PIT return's own deadline — **annual**, not
  monthly like JPK_V7.

Building this without first identifying what already exists to reuse
would duplicate `financial_pl`'s JPK submission machinery for no reason,
and skipping the dependency question would produce a spec that silently
assumes GL data is reachable when, until `#6038` ships, it is not.

## 📝 Proposed Solution

Treat JPK_KR_PD as a structural parallel to the existing JPK_V7 slice,
reusing every part of `financial_pl` that is not VAT-specific, and add
exactly one new capability to `ledger` as a dependency (already specced
separately, see Architecture): a bulk, in-process read surface.

**What's reused, confirmed by reading `financial_pl`'s actual code**
(`official-modules`, branch `feat/financial-pl-invoice-ux`):

- The filing lifecycle shape: `JpkVatFiling`'s
  `draft → generating → submitting → submitted → polling →
  accepted/rejected` status machine, driven by `commands/jpk.ts`
  (`jpkGenerateSchema`/`jpkSubmitSchema` → `resolveJpkFiling` →
  `buildJpkXml` → `submitJpk`/`pollJpkStatus`).
- The submission transport, unchanged: `lib/jpk/jpk-submission-client.ts`
  implements the MF gateway protocol generically (AES-256-CBC envelope
  encryption with an RSA-wrapped key against the MF public certificate,
  XAdES signing via `lib/xades.ts`, in-memory ZIP packaging, chunked PUT
  upload, status polling) — none of it is JPK_V7-specific.
- XSD vendoring: `lib/jpk/schema/` ships the real MF schemas today
  (`JPK_V7M-3.xsd`, `JPK_V7K-3.xsd` + shared dictionaries); JPK_KR_PD
  vendors its own official XSD the same way.
- The compute/build split: `lib/jpk/compute-declaration.ts` (pure,
  testable) feeding `lib/jpk/build-jpk-xml.ts` — JPK_KR_PD gets its own
  `compute-zois.ts` / `compute-rpd.ts` (deferred, see Design Decisions)
  feeding `build-jpk-kr-xml.ts`.
- The async worker/subscriber pattern (`workers/ksef-batch-send.worker.ts`,
  `lib/queue.ts`) — JPK_KR_PD's generate/submit steps are exactly the
  kind of long-running, retryable work this pattern already handles,
  just on an annual trigger instead of a batch/interval one.

**What's new:**

- `requires: ['ledger']` on `financial_pl`'s `ModuleInfo` —
  `packages/financial_pl/src/modules/financial_pl/index.ts` declares no
  `requires` today (confirmed by reading it directly); this is the
  module's first cross-module dependency, declared the same way AP
  declared its own GL dependency (`2026-09-06-accounts-payable.md`).
- A new XML builder for JPK_KR_PD's seven top-level nodes (see Data
  Model), reading through `ledger`'s Bulk Read Service (`#6038`) instead
  of `financial_pl`'s own tables.

## 📝 Architecture

### Dependency on `ledger`'s Bulk Read Service (`#6038`)

This document assumes `2026-09-10-general-ledger-bulk-read-service.md`
(PR `#6038`, drafted, **not yet reviewed or merged**) ships as designed.
That document adds one DI-resolvable service to `ledger`,
`LedgerBulkReadService`, exposing five read-only methods:

```ts
iterateJournalEntries(params): AsyncIterable<JournalEntryDto>
iterateJournalEntryLines(params): AsyncIterable<JournalEntryLineDto>
getZois(params: { tenantId, organizationId, periodId }): Promise<ZoisRow[]>
listAccounts(params): Promise<LedgerAccountDto[]>
listAccountGroups(params): Promise<LedgerAccountGroupDto[]>
```

`financial_pl` resolves this service via
`container.resolve('ledgerBulkReadService')` (the token `#6038` proposes)
from its own annual-filing worker — no HTTP calls, no new REST routes on
either side. This is a hard dependency: **this spec cannot ship before
`#6038` merges.** Until then, this document's Data Model / API Contracts
sections describe the intended shape, not something buildable today.

### New components in `financial_pl`

- `data/entities.ts` — add `JpkKrFiling` (see Data Model).
- `commands/jpk-kr.ts` — `jpkKrGenerateSchema` / `jpkKrSubmitSchema`,
  mirroring `commands/jpk.ts`'s existing shape.
- `lib/jpk-kr/build-jpk-kr-xml.ts`, `build-zois.ts` (thin wrapper over
  `getZois`), `build-dziennik.ts` / `build-konto-zapis.ts` (thin wrappers
  over `iterateJournalEntries` / `iterateJournalEntryLines`),
  `compute-rpd.ts` (stubbed — see Design Decisions).
- `lib/jpk-kr/schema/` — vendored official JPK_KR_PD XSD.
- `workers/jpk-kr-generate.worker.ts` — annual trigger, reusing
  `lib/queue.ts`.

### Design decisions

**`RPD` is out of scope for this spec, deferred as its own document.**
`RPD` reconciles book income/expense to taxable income (permanent and
timing differences). Nothing in `ledger`, `financial_pl`, or any sibling
spec tracks book-vs-tax classification today — `LedgerAccount` has no
"deductibility" flag, and no document has ever proposed one. This is a
design question comparable in size to the Posting Rules Engine, not a
field to bolt onto `JournalEntry` inside this spec. **Phase 1 ships with
`RPD` populated from manual operator input** (a `JpkKrDeclarationInputs`
shape, the same escape hatch `JpkDeclarationInputs` already provides for
JPK_V7 fields with no automatic source), not computed — this keeps the
filing legally submittable without solving book/tax reconciliation here.

**Why a new module-level dependency instead of an optional/soft
integration.** `ledger` data is not optional context for this feature —
without it there is no `Dziennik`/`KontoZapis`/`ZOiS` to file. The
project's `requires` mechanism (hard, declared dependency) is the correct
tool here, not FK-id references or `tryResolve`, which this project
reserves for genuinely optional peers (see the financial-module
dependency-graph analysis this session produced).

## 📝 Data Model

New entity, `JpkKrFiling`, mirroring `JpkVatFiling`'s shape:

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `tenantId` / `organizationId` | uuid | standard scoping |
| `fiscalYear` | int | the reported year, not a period id — annual filing |
| `celZlozenia` | enum | initial / korekta (correction), matching JPK_V7's own field name |
| `status` | enum | `draft → generating → submitting → submitted → polling → accepted \| rejected` |
| `generatedXml` | text/blob | |
| `submissionReference` | string | |
| `upoXml` | text/blob | UPO (urzędowe poświadczenie odbioru) |
| `submissionError` | text, nullable | |

`JpkKrDeclarationInputs` (operator-entered, RPD-adjacent fields with no
automatic source — exact shape TBD once a primary-source XSD pass is
done, see Open Questions):

| Field | Type | Notes |
|---|---|---|
| `filingId` | uuid, FK → `JpkKrFiling` | |
| `rpdAdjustments` | jsonb | free-form until §RPD is designed properly |

**Field mapping — `ZOiS` (trial balance) node ← `#6013`'s ZSiO
computation, via `getZois`:**

| `ZOiS` field | Source |
|---|---|
| `S_1`–`S_3` (account id/name/parent) | `LedgerAccount.slug` / `.description` / `.parentAccountId` |
| `S_4`–`S_5` (opening debit/credit) | opening balance, period start |
| `S_6`–`S_7` (period turnover) | period debit/credit turnover |
| `S_8`–`S_9` (YTD turnover) | year-to-date turnover |
| `S_10`–`S_11` (closing balance) | closing balance |

**Field mapping — `Dziennik`/`KontoZapis` ← `JournalEntry`/
`JournalEntryLine`, via `iterateJournalEntries` / `iterateJournalEntryLines`:**

| `Dziennik` field | Source |
|---|---|
| `D_1` | `sequenceNumber` |
| `D_4` | `documentNumber` |
| `D_5` | `documentType` |
| `D_6` | `operationDate` |
| `D_7` | `documentDate` |
| `D_11` | sum of `JournalEntryLine.debit`/`credit` |
| `D_12` (KSeF ref) | `referenceType`/`referenceId`, when the source is a `financial_pl` KSeF invoice |

| `KontoZapis` field | Source |
|---|---|
| `Z_3` (account) | `JournalEntryLine.accountId` |
| `Z_4`/`Z_7` (debit/credit) | `JournalEntryLine.debit`/`.credit` |

`LedgerAccountGroup` (`jurisdiction: 'PL'`, zespoły 0–8, already seeded
per the GL core spec) supplies the account classification `ZOiS`/
`KontoZapis` need — no new reference data to invent, via `listAccountGroups`.

`Naglowek` (file metadata) and `Podmiot1` (submitting entity — NIP,
REGON, name, address) reuse the same entity/organization data
`financial_pl` already sources for KSeF/JPK_V7. `Kontrahent` (optional,
counterparties) overlaps `financial_pl`'s existing buyer/seller snapshot
data on invoices. `Ctrl` (control sums) is derived, not sourced
separately.

## 📝 API Contracts

No new HTTP routes proposed. All generation/submission happens through
commands (mirroring JPK_V7):

- `jpk-kr.generate` — `{ tenantId, organizationId, fiscalYear, celZlozenia }` → resolves a `JpkKrFiling`, calls the builder chain, sets `status: generating → draft` (XML produced, not yet submitted).
- `jpk-kr.submit` — `{ filingId }` → `submitJpk` (reused unchanged) → `status: submitting → polling`.
- `jpk-kr.poll-status` — background, reused unchanged from the JPK_V7 worker pattern.

## 📝 UI/UX

Out of scope for this pass — no UI flows are proposed here beyond
whatever `financial_pl` already has for triggering/monitoring JPK_V7
filings, which this would extend with a JPK_KR_PD tab/action once the
backend exists. Left for a follow-up once Phase 1 (backend) is agreed.

## 📝 Edge Cases & Failure Scenarios

- **`#6038` not merged when this work starts.** Hard blocker — no
  fallback path is proposed (looping the existing REST routes from
  inside the same process was explicitly rejected in `#6038`'s own
  Design Decisions as paying real cost for no benefit).
- **A fiscal year with an open/unposted period at filing time.** Not
  addressed here — depends on `soft_closed` period semantics the GL core
  spec deliberately deferred (same "no real consumer yet" logic noted in
  `#6038`'s TLDR). Flagged, not solved.
- **Correction filings (`celZlozenia: korekta`).** The status machine
  supports it structurally (same as JPK_V7), but this document does not
  work through what changes between an initial and a corrected
  `JpkKrFiling` beyond the field itself — needs its own pass once Phase 1
  is built and a real correction scenario is in front of us.
- **Wrong `tenantId`/`organizationId` passed to the bulk-read calls.**
  Inherited risk from `#6038` (explicit caller responsibility, no
  framework guardrail) — this module's worker must get scoping right;
  no additional mitigation proposed here beyond code review.

## 📝 Risks & Impact Review

- **Sequencing risk, high.** This entire spec is contingent on `#6038`
  merging first. Until then it documents intent, not buildable work.
- **Timeline risk.** The largest-CIT-taxpayer filing window (fiscal years
  ending after 31 Dec 2024, due end of March 2026) has already passed as
  of this writing (2026-09-10 analysis date). **Needs confirmation from
  the business side which cohort Commerce Weavers' actual target
  customers fall into** before treating any specific year as the working
  deadline — see Open Questions.
- **Scope risk on `RPD`.** Shipping with manual-input `RPD` is a
  legitimate Phase 1 scope cut (JPK_V7 has precedent for manual-input
  fields), but it means the filing is not a "one click, fully automatic"
  export the way JPK_V7 generation mostly is — accounting staff still do
  the book/tax reconciliation manually and enter the result.
- **New cross-module coupling.** `financial_pl`'s first-ever `requires`
  edge changes the module-family dependency graph documented in
  `2026-09-08-financial-module-knowledge-base.md` — that document's
  module map needs a corresponding update once this ships (noted, not
  actioned here).
- **Compatibility.** No existing `financial_pl` contract changes; this
  is additive only (new entity, new commands, new dependency
  declaration).

## 📋 Phasing

- **Phase 1 (this spec):** `JpkKrFiling` entity, XML builder for
  `Naglowek`/`Podmiot1`/`Kontrahent`/`ZOiS`/`Dziennik`/`KontoZapis`/`Ctrl`,
  manual-input `RPD`, reused submission pipeline. Blocked on `#6038`.
- **Phase 2 (future, separate spec):** `RPD` computed automatically —
  book/tax classification on `LedgerAccount` or postings, and the
  reconciliation logic itself. Comparable in size to the Posting Rules
  Engine; not attempted here.
- **Phase 3 (future, separate spec, noted but not designed):**
  `JPK_ST_KR` (fixed assets/intangibles register), released by the same
  MF initiative alongside JPK_KR_PD — would draw on the Fixed Assets
  module (`#6014`) the way this spec draws on `ledger`. Flagged for
  awareness only.

## 📋 Implementation Plan

1. **Blocked until `#6038` merges.** No implementation work starts
   before then.
2. Vendor the official JPK_KR_PD XSD; run the primary-source
   verification pass this document deliberately skipped (field-level XSD
   read, not brochure prose) before finalizing the `Data Model` field
   list above.
3. Add `requires: ['ledger']` to `financial_pl`'s `ModuleInfo`.
4. `JpkKrFiling` entity + migration.
5. `build-zois.ts` / `build-dziennik.ts` / `build-konto-zapis.ts`, each
   independently unit-testable against `LedgerBulkReadService`'s DTOs.
6. `compute-rpd.ts` stub (manual-input passthrough only, Phase 1).
7. `commands/jpk-kr.ts` wiring `resolveJpkKrFiling → buildJpkKrXml →
   submitJpk/pollJpkStatus` (last two: reuse, not reimplementation).
8. `workers/jpk-kr-generate.worker.ts` on an annual trigger.
9. Update `2026-09-08-financial-module-knowledge-base.md`'s dependency
   graph to show `financial_pl → ledger`.

## Open Questions / Assumptions To Confirm

Carried over from the 2026-09-10 analysis, not treated as blockers to
drafting this document, but unresolved before it should be considered
final:

- **Q1 — Confirmed default: defer `RPD` computation to its own future
  spec (Phase 2).** Flagged here for override if the business decides
  otherwise.
- **Q2 — Needs business confirmation, not answerable from the repo:**
  which cohort (fiscal-year timing) actually matches Commerce Weavers'
  target customers, given the largest-taxpayer window has already
  passed. Treat "Phase 1 ships in time for FY2026 filers (JPK_VAT-
  obligated cohort, filed 2027)" as this document's working assumption
  until confirmed otherwise.
- **Q3 — Placement:** this document assumes `official-modules` /
  `SPEC-010`, per the existing JPK_V7/KSeF precedent. Not yet physically
  placed there — `official-modules` is not checked out in the
  environment this draft was written in.

---

Sources: MF brochure *Broszura informacyjna dotycząca struktury
JPK_KR_PD* (podatki.gov.pl, 26.08.2024); `gov.pl/web/kas`, "Elektroniczne
księgi rachunkowe w podatku PIT w 2026 r."; `2026-09-10-jpk-kr-pd-
financial-pl-analysis.md` (this project); `.ai/specs/2026-08-18-general-
ledger-core-engine.md`; `.ai/specs/2026-09-09-general-ledger-account-
balances.md`; `.ai/specs/2026-09-10-general-ledger-bulk-read-service.md`
(PR #6038); `.ai/specs/2026-09-06-accounts-payable.md`; `official-modules`
repo, branch `feat/financial-pl-invoice-ux`,
`packages/financial-pl/src/modules/financial_pl/` (`index.ts`,
`data/entities.ts`, `commands/jpk.ts`, `lib/jpk/*`).
