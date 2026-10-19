# JPK_KR_PD (Statutory Accounting Books e-Filing) for `financial_pl`

> **Moved from `official-modules`.** Originally opened as open-mercato/official-modules#54 by @mikoajp. `official-modules` is deprecated and being archived, and `financial_pl` will not live there: the financial work continues in Core, with KSeF coming later as a separate PR (see open-mercato/official-modules#29). Content is unchanged apart from this block, the Prerequisites section below, and the spec numbers: `official-modules` numbered the four `financial_pl` specs `SPEC-010` to `SPEC-013`, but Core already uses those numbers for unrelated, implemented specs under `.ai/specs/implemented/` and names new specs `{date}-{title}` only, so cross-references here use short names (see the table in Prerequisites). Dated history entries keep the original numbers. Code references to `official-modules` (for example branch `feat/financial-pl-invoice-ux`) point to that archived repository. 

## Prerequisites

`financial_pl` is not in this repository yet. Everything this document says about its current code describes the package as it stands in `official-modules`, and the `packages/financial_pl_accounting/` paths are the target layout once the packages are brought into Core. Until then, read the referenced sources at these pinned revisions:

| Reference | Source |
|-----------|--------|
| `financial_pl` code (branch `feat/financial-pl-invoice-ux`) | [`packages/financial-pl` @ `17c575c`](https://github.com/open-mercato/official-modules/tree/17c575c9eb94893c9fc3da4036f5d19dc2b9369b/packages/financial-pl) |
| JPK_KR_PD spec (`official-modules#54`, SPEC-010 there) | `2026-09-11-jpk-kr-pd-financial-pl.md` (this repository; original at [`6b5dfb9`](https://github.com/open-mercato/official-modules/blob/6b5dfb9a67f66a35e791bce2e2ef998e305d8488/.ai/specs/SPEC-010-2026-09-11-jpk-kr-pd-financial-pl.md)) |
| tax engines spec (`official-modules#55`, SPEC-011 there) | `2026-09-16-tax-management-financial-pl.md` (this repository; original at [`79aa0b9`](https://github.com/open-mercato/official-modules/blob/79aa0b9d3724affa35bdc54d4944c07defbeb716/.ai/specs/SPEC-011-2026-09-16-tax-management-financial-pl.md)) |
| integration contracts spec (SPEC-012 there), `financial_pl_accounting` accounting package spec (SPEC-013 there) | `2026-10-08-financial-pl-integration-contracts.md` and `2026-10-08-financial-pl-accounting-package.md` (this repository once open-mercato#7070 is merged) |

Open work this document waits on:

| Phase | Waits on |
|-------|----------|
| All phases | `financial_pl` and `financial_pl_accounting` brought into Core (accounting package spec), and `jpkTransportService` released in `financial_pl` (integration contracts spec, A1) |
| Phase 1 | General ledger (#6340) and its bulk read service (#6038); this document's own Implementation Plan says no work starts before #6038 merges |
| Phase 1, vendored XSD | The raw `Schemat_JPK_KR_PD(1)_v1-0.xsd`, to confirm the `RPD` field list and `S_12_1` values (Implementation Plan, step 2) |
| Phase 3 | Fixed Assets (#6014), for `JPK_ST_KR` |


> **Status: DRAFT — second pass, not reviewed.** Written from the
> 2026-09-10 architecture analysis (`Claude outputs/2026-09-10-jpk-kr-pd-
> financial-pl-analysis.md`). Three items below are carried over as
> **explicit assumptions** rather than blocking Open Questions, per the
> decision to draft now and iterate through review (see Open Questions /
> Assumptions To Confirm). **2026-09-11 update:** enriched with a
> citation-checked accounting-theory grounding for the Phase 2 `RPD`
> design (Kieso Ch.19) and a fresh direct-repo code-analysis pass — see
> Architecture → Design decisions / Code analysis below. No Open Question
> was resolved by this pass; Q1–Q3 still stand.
>
> **2026-09-12 update:** Q2 corrected and partially resolved (see Open
> Questions). The primary-source XSD verification pass this document
> named as still owed is now done (see Architecture -> Primary-source
> XSD verification) -- a real, material correction: RPD's actual scope
> is much smaller than Q1's "comparable to the Posting Rules Engine"
> framing assumed, and a real, previously-unnamed mandatory field
> (S_12_1, a per-account financial-statement-category marker) was
> found. New open item: Q4.
>
> **2026-09-18 update — independent maintainer review (@pkarw, PR
> `#6069`) verified and applied.** The review's own Validation Gate
> cited head `6c56ccf28a` (2026-09-11), but the branch already carried
> two more commits pushed 2026-09-12 -- four days before the review was
> posted (2026-09-16) -- covering exactly the ground the review's Major
> #2 asked for (the primary-source XSD pass above). Every finding was
> re-checked against the current file content rather than accepted at
> face value (per this project's citation-check discipline). Result:
> both Blockers confirmed and fixed (tenant/organization scope now
> derived server-side, never trusted from the caller, on
> `financial_pl.jpk_kr.upsert_filing`/`.generate`/`.submit` — also
> corrected the command surface itself to a real three-command split,
> not just its trust model, see Design decisions; an encryption-at-rest entry for
> `generatedXml`/`upoXml` in `financial_pl`'s `defaultEncryptionMaps`);
> Major #4 (whole-ledger scale) and Major #5 (missing test plan)
> confirmed and fixed; Major #2's XSD/scope sub-claim was already
> resolved by the 2026-09-12 commits above, but its deadline
> sub-claim was real and unaddressed -- the Ministry regulation
> effective 2026-02-20 extended JPK_KR_PD's deadline to the end of
> the 7th month after fiscal year end, so the "window already closed
> (March 2026)" framing below was itself wrong, not just stale (see
> Problem Statement); Major #1 (placement) was already flagged by
> this document's own banner, no text change needed; Major #3
> (filing status machine) is now Confirmed and fixed too (Q5) --
> `official-modules` turned out to be reachable with this session's
> read access after all, corrected from this same paragraph's own
> earlier "unreachable" claim (see Code analysis below).
>
> **2026-09-18 — moved here from `open-mercato`.** This document was
> drafted and reviewed as `open-mercato#6069` (`.ai/specs/2026-09-11-
> jpk-kr-pd-financial-pl.md`) while `official-modules` access wasn't set
> up in that working environment. It carries an independent maintainer
> review (@pkarw) and two rounds of fixes applied against it — see
> Changelog-equivalent history in the banner updates above and
> `open-mercato#6069`'s commit history for the full trail. Numbered
> `SPEC-010` provisionally: `develop` currently has `SPEC-001`–`004`
> merged, and `SPEC-005`–`009` are each independently claimed by
> multiple *different, unrelated* open PRs (patient cases, reservations,
> community workflow, staff extraction, appointment requirements) —
> none of those numbers are settled yet, so `010` is a placeholder, not
> a reservation; happy to renumber at merge time. This document also
> follows `open-mercato`'s own `om-spec-writing` structure (the
> convention used across the `ledger`/`financial_pl` spec family it
> depends on), not `official-modules/.ai/specs/AGENTS.md`'s own required
> sections verbatim — notably no separate Overview / Final Compliance
> Report / Changelog section (this document's dated banner updates and
> Open Questions log serve that role instead). Flagging rather than
> reshaping the whole document to fit both conventions at once; happy to
> restructure if maintainers here want the local format instead.
> 
> This spec's own hard dependency (`ledger`'s Bulk Read Service, `#6038`)
> lives in `open-mercato`, not here — the package that hosts this feature,
> `financial_pl_accounting` (see Target layout), is what depends on
> `ledger`: a cross-repo dependency, not just a cross-module one.

## 📝 Target layout (decided 2026-10-08)

This feature lives in a new package, `financial_pl_accounting` (module id
`financial_pl_accounting`; in `official-modules` one package holds one
module), not in `financial_pl`.

- **Why.** `financial_pl` is installed standalone for KSeF and JPK_V7 and
  must not require a general ledger. The Polish features that read the
  ledger (this document, Bilans/RZiS, the tax engines) go to the sibling
  package, which declares a hard `requires` on `financial_pl`, `ledger`,
  `tax_management` and `financial_statements` (package overview: the accounting package spec).
  This feature itself needs `financial_pl` and `ledger`.
- **Transport.** The new package does not import `financial_pl` code. It
  calls `financial_pl`'s DI service `jpkTransportService` (`submit`,
  `pollStatus`; the integration contracts spec). The signing certificate and private key stay
  inside `financial_pl`. The service takes the XML as a string, so the
  in-memory buffering concern in Open Questions Q6 is unchanged.
- **Identifiers.** Commands are `financial_pl_accounting.jpk_kr.*`, tables
  `financial_pl_accounting_jpk_kr_filing` and
  `financial_pl_accounting_jpk_kr_declaration_inputs`, the encryption entry
  `financial_pl_accounting:jpk_kr_filing`. No new features: routes require
  the existing `financial_pl.view`/`.submit`/`.manage`, which the new
  package can name because it `requires` `financial_pl`.
- **Reading this document.** Below, "`financial_pl`" as the home of the new
  components means `financial_pl_accounting`; "`financial_pl`" as the
  source of the existing JPK_V7 and KSeF machinery is unchanged.

## 📝 TLDR

`financial_pl` needs to generate and submit **JPK_KR_PD** — Poland's
annual electronic filing of a taxpayer's full statutory accounting books
(chart of accounts, journal, postings, trial balance) to the tax
authority. This is a different filing from JPK_V7 (VAT register, monthly)
and KSeF (invoice exchange): it reports the **general ledger itself**, so
it needs a dependency on `ledger` that `financial_pl` does not have and
must not get, so the feature lives in the separate package
`financial_pl_accounting` (see Target layout). The submission pipeline
exists in `financial_pl` for JPK_V7 and is used through a DI transport
service; the XSD-vendoring pattern and the filing-entity lifecycle are
followed. The two things that are genuinely new are
(1) the XML builder for JPK_KR_PD's own structure, and (2) reading GL data
in bulk from another module's code, which `ledger`'s Bulk Read Service
(`#6038`, still unmerged) is designed to provide. Book/tax reconciliation
(`RPD`) is treated as out of scope for this document (see Design
Decisions) and left as its own future spec.

## Overview

`financial_pl` (`@open-mercato/financial-pl`) is Commerce Weavers'
Polish-compliance module: KSeF 2.0 e-invoicing, JPK_V7 VAT filing,
invoice PDF/authoring, corrections. This spec adds its second
statutory e-filing surface, **JPK_KR_PD** — the annual export of a
taxpayer's full general ledger (chart of accounts, journal, postings,
trial balance) — for Open Mercato merchants who keep full accounting
books (księgi rachunkowe) under Polish CIT/PIT law. The audience is
the same one `financial_pl` already serves: Polish SMEs and their
accountants who currently prepare this filing by hand or through a
desktop ERP, and who gain a single compliance surface (KSeF + JPK_V7
+ JPK_KR_PD) instead of stitching Open Mercato's ledger data into a
separate filing tool.

> **Market Reference**: Comarch ERP XL's JPK_KR_PD implementation was
> studied directly (its published module documentation, not just a
> brochure) — see Architecture → Primary-source XSD verification.
> Adopted: treating `RPD` as a small, manually-completed summary node
> rather than an automated book/tax reconciliation engine, since a
> mature real ERP handles it the same way. Rejected: nothing borrowed
> wholesale — Comarch is a desktop, single-tenant ERP with no
> multi-tenant/API-first architecture to adopt; only the field-level
> XSD interpretation and the `RPD` scope finding transferred.

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
  years ending after 31 Dec 2024. **Corrected 2026-09-18** (per
  @pkarw's PR `#6069` review, verified against Deloitte Polska and
  Sovos primary reporting, not taken at face value): the "end of
  March 2026, already closed" deadline below was itself wrong, not
  just stale — a regulation effective 2026-02-20 extended JPK_KR_PD's
  deadline from the CIT-return filing date to **the end of the 7th
  month following the end of the tax year**, which for this cohort
  (fiscal years ending before 31 Dec 2025) lands at **end of July
  2026** — a window that, depending on this document's publication
  date relative to today, may still be open. Treat "already closed"
  claims about any JPK_KR_PD cohort as needing a fresh check against
  the current regulation, not this document's original dates.
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
- The submission transport, used through `financial_pl`'s DI service
  `jpkTransportService` (integration contracts spec), not imported: `lib/jpk/jpk-submission-client.ts`
  implements the MF gateway protocol generically (AES-256-CBC envelope
  encryption with an RSA-wrapped key against the MF public certificate,
  XAdES signing via `lib/xades.ts`, in-memory ZIP packaging, chunked PUT
  upload, status polling) — none of it is JPK_V7-specific.
  **Flagged 2026-09-18, per @pkarw's PR `#6069` review Major #4,
  confirmed real and not addressed anywhere in this document (grepped
  for "scale"/"memory"/"streaming": zero other hits): "none of it is
  JPK_V7-specific" is true of the *protocol*, but JPK_V7 assembles one
  monthly VAT register in memory, and JPK_KR_PD assembles a full
  annual general ledger — `Dziennik`/`KontoZapis` alone could be
  orders of magnitude larger. `iterateJournalEntries`/
  `iterateJournalEntryLines` are already `AsyncIterable` (streaming
  reads, per `#6038`), but `build-jpk-kr-xml.ts`'s output and
  `jpk-submission-client.ts`'s in-memory ZIP packaging are not
  designed here to consume that stream without buffering the whole
  document — this is a real, unresolved gap, not designed away in
  this pass (see Open Questions, Q6), since a proper fix (streaming
  XML serialization + streaming/chunked ZIP write) is real design
  work this document should not improvise inline.**
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

- The package `financial_pl_accounting`, whose `requires` (package-level,
  declared in the accounting package spec) include `financial_pl` and `ledger`. `financial_pl`
  declares no `requires` today (confirmed by reading
  `packages/financial_pl/src/modules/financial_pl/index.ts`) and keeps
  none; the hard dependency on `ledger` sits in the new package, declared
  the same way AP declared its own GL dependency
  (`2026-09-06-accounts-payable.md`).
- A new XML builder for JPK_KR_PD's seven top-level nodes — including
  `RPD`, which is mandatory at the file-format level, not excluded from
  the count (corrected 2026-09-12, see Architecture → Primary-source
  XSD verification) — reading through `ledger`'s Bulk Read Service
  (`#6038`) instead of `financial_pl`'s own tables.

## 📝 Architecture

### Dependency on `ledger`'s Bulk Read Service (`#6038`)

This document assumes `2026-09-10-general-ledger-bulk-read-service.md`
(PR `#6038`, drafted, **not yet reviewed or merged**) ships as designed.
That document adds one DI-resolvable service to `ledger`,
`LedgerBulkReadService`, exposing seven read-only methods (the two added 2026-10-08,
`getFiscalPeriod` and `findClosingEntries`, are not needed by the
builders below except for the fiscal year's date range):

```ts
iterateJournalEntries(params): AsyncIterable<JournalEntryDto>
iterateJournalEntryLines(params): AsyncIterable<JournalEntryLineDto>
getZois(params: { tenantId, organizationId, periodId }): Promise<ZoisRow[]>
listAccounts(params): Promise<LedgerAccountDto[]>
listAccountGroups(params): Promise<LedgerAccountGroupDto[]>
```

`financial_pl_accounting` resolves this service via
`container.resolve('ledgerBulkReadService')` (the token `#6038` proposes)
from its own annual-filing worker — no HTTP calls, no new REST routes on
either side. This is a hard dependency: **this spec cannot ship before
`#6038` merges.** Until then, this document's Data Model / API Contracts
sections describe the intended shape, not something buildable today.

### New components in `financial_pl_accounting`

- `data/entities.ts` — add `JpkKrFiling` (table `financial_pl_accounting_jpk_kr_filing`)
  and `JpkKrDeclarationInputs` (table
  `financial_pl_accounting_jpk_kr_declaration_inputs`) — see Data Model.
- `commands/jpk-kr.ts` — **corrected 2026-09-18 to a three-command
  split, mirroring `commands/jpk.ts`'s real shape exactly** (a prior
  pass on this section conflated create+generate into one
  `jpk-kr.generate` command, which had no real precedent):
  `jpkKrFilingUpsertSchema` (`financial_pl_accounting.jpk_kr.upsert_filing`,
  undoable), `jpkKrGenerateSchema` (`financial_pl_accounting.jpk_kr.generate`,
  `{ filingId }` only, not undoable), `jpkKrSubmitSchema`
  (`financial_pl_accounting.jpk_kr.submit`, `{ filingId }` only, not undoable —
  see API Contracts and the Undo Contract note below).
- `lib/jpk-kr/build-jpk-kr-xml.ts`, `build-zois.ts` (thin wrapper over
  `getZois`), `build-dziennik.ts` / `build-konto-zapis.ts` (thin wrappers
  over `iterateJournalEntries` / `iterateJournalEntryLines`),
  `compute-rpd.ts` (stubbed — see Design Decisions).
- `lib/jpk-kr/schema/` — vendored official JPK_KR_PD XSD.
- `workers/jpk-kr-generate.worker.ts` — annual trigger, reusing
  `lib/queue.ts`.
- `acl.ts` / `setup.ts` — **no new features** (added 2026-09-18): this
  spec reuses `financial_pl`'s existing three features
  (`financial_pl.view`, `.submit`, `.manage`) rather than declaring
  JPK_KR_PD-specific ones — see Design decisions for why.

### Design decisions

**`RPD` is out of scope for this spec, deferred as its own document.**
`RPD` reconciles book income/expense to taxable income (permanent and
timing differences). Nothing in `ledger`, `financial_pl`, or any sibling
spec tracks book-vs-tax classification today — `LedgerAccount` has no
"deductibility" flag, and no document has ever proposed one. **Corrected
2026-09-12 (see Architecture → Primary-source XSD verification): `RPD`
in the real XSD is a small, flat set of manually-completed summary
amounts, not a per-account/per-posting classification problem — the
"comparable in size to the Posting Rules Engine" framing below should be
read as unconfirmed, not as this document's considered estimate.**
**Phase 1 ships with `RPD` populated from manual operator input** (a
`JpkKrDeclarationInputs` shape, the same escape hatch `JpkDeclarationInputs`
already provides for JPK_V7 fields with no automatic source), not
computed — this keeps the filing legally submittable without solving
book/tax reconciliation here, and, per the XSD verification pass, may
simply be the correct permanent design, not only a Phase 1 stopgap.

**Accounting-theory grounding for the Phase 2 `RPD` design (verified
2026-09-11, per `financial-spec-citation-check`).** Kieso, Weygandt,
Warfield, *Intermediate Accounting*, 17th Ed. — already this project's
strongest-verified Tier 2 source (see
`2026-09-08-financial-module-knowledge-base.md` §3) — was checked
directly against Ch.19, "Accounting for Income Taxes" (full chapter,
pp.19-1–19-40, not just the chapter title), specifically to see whether
it gives Phase 2 a real starting taxonomy for the "deductibility
classification" this document already flags as missing (`LedgerAccount`
has no such flag today). It does, and the fit is closer than a guess —
Kieso's core distinction is exactly the axis RPD needs:

- **Temporary differences** — "the difference between the tax basis of
  an asset or liability and its reported (carrying or book) amount in
  the financial statements, which will result in taxable amounts or
  deductible amounts in future years" (p.19-5). These *reverse*: an
  originating difference in one period produces an offsetting reversal
  in a later one (Illustration 19.6/19.8's future-taxable-amounts
  schedule, pp.19-5–19-8).
- **Permanent differences** — items that "enter into pretax financial
  income but never into taxable income, or... enter into taxable income
  but never into pretax financial income" (p.19-14). These never
  reverse and need no schedule (Illustration 19.31, p.19-14, gives the
  US list: tax-exempt interest, nondeductible key-officer life-insurance
  premiums, fines, percentage depletion, the dividends-received
  deduction).
- The two axes combine per line item (Illustration 19.32, p.19-14–19-15
  works a worked example with one of each kind in the same
  reconciliation) — which is structurally what RPD's own book-to-tax
  walk has to do: classify *every* posting as (a) no difference, (b)
  permanent — drop it from the tax side, full stop, or (c) temporary —
  include it, and track the reversal.

**This is a structural/vocabulary match, not a substitute for Polish
law.** Two things do *not* transfer from Kieso and must not be assumed:
(1) the *specific* permanent/temporary items Illustration 19.31 lists
are US Internal Revenue Code items — Polish CIT's own non-deductible-cost
list (ustawa o CIT, primarily art. 15–16) is a different, unrelated
enumeration and is the only correct source for what actually goes in
each bucket; (2) Kieso's loss-carryforward/deferred-tax-asset mechanics
(Ch.19, pp.19-19–19-20 — indefinite carryforward, no carryback, per the
2017 TCJA) are US-specific and post-date a US law change with no Polish
equivalent (Polish straty podatkowe carryforward runs 5 years, capped at
50% of the loss per year or PLN 5,000,000 in one year) — do not import
this mechanic into any future `RPD` design without checking ustawa o CIT
directly. What *does* transfer is the shape of the problem: Phase 2
needs a per-account-or-posting classification (no difference / permanent
/ temporary) and, for the temporary bucket only, a reversal-tracking
schedule comparable to Illustration 19.8 — sized, as this document
already says, comparably to the Posting Rules Engine, now with a named
accounting-theory model to design against instead of a blank page.

**Fowler and Hay were also checked and confirmed to have nothing on this
topic — reported here rather than silently skipped, per this project's
citation-check discipline.** A full-text search of both PDFs for "tax"
found zero substantive hits: Hay's only three hits are unrelated
("Federal tax ID" as an example attribute in a Party/Organization
figure, pp. cited in `2026-09-08-financial-module-knowledge-base.md`
§3); Fowler's Ch.6 "Inventory and Accounting" (the chapter this
project's own knowledge base already mines for GL/posting patterns) has
no "tax" occurrence at all. Neither book models income tax, deferred
tax, or book/tax reconciliation in any form — Kieso is the only one of
the three PDFs with relevant content for this specific node, and that
finding itself is worth keeping (it stops a future pass from
re-searching Fowler/Hay for the same thing).

**Why a new module-level dependency instead of an optional/soft
integration.** `ledger` data is not optional context for this feature —
without it there is no `Dziennik`/`KontoZapis`/`ZOiS` to file. The
project's `requires` mechanism (hard, declared dependency) is the correct
tool here, not FK-id references or `tryResolve`, which this project
reserves for genuinely optional peers (see the financial-module
dependency-graph analysis this session produced).

**`jpk-kr.generate`/`jpk-kr.submit` must never trust a caller-supplied
`tenantId`/`organizationId` for scope — corrected 2026-09-18, now
Confirmed against real `official-modules` code (a prior pass on this
finding, same day, could only reason from this repo's analogous
pattern; `official-modules` turned out to be reachable after all with
this session's read access — see Code analysis below for the
network-access correction).** `commands/jpk.ts`'s real
`upsertFilingCommand`/`generateCommand`/`submitCommand` never read
`organizationId`/`tenantId` out of the parsed input at all — even
though `jpkFilingUpsertSchema` still declares them as optional fields
(legacy/back-compat only), the handler ignores `parsed.organizationId`/
`parsed.tenantId` completely and instead calls a local
`resolveCommandScope(ctx)` that derives both from `ctx.auth.tenantId`
and `ctx.selectedOrganizationId ?? ctx.organizationIds?.[0] ??
ctx.auth.orgId` — i.e. from the authenticated request context, never
the request body. Every entity lookup and every `em.create` is then
scoped by that derived value, and `ensureTenantScope`/
`ensureOrganizationScope` (`@open-mercato/shared/lib/commands/scope`)
are called with the *derived* scope, not a client-supplied one — their
job is authorizing that derived scope (superAdmin bypass,
`allowedIds` check), not validating a claim the client made.
`jpkGenerateSchema`/`jpkSubmitSchema` don't even declare
`organizationId`/`tenantId` fields — just `{ filingId }` — because
generate/submit only ever act on an *existing* filing already scoped
at creation time. **Corrected 2026-09-18, second pass: this document's
command surface itself needed to change, not just its trust model.**
The real sibling doesn't have one `generate` command that both creates
and generates — it has three: `upsert_filing` (creates/updates the
filing shell, takes `{ tenantId?, organizationId?, ...fields }` with
those two fields accepted-but-ignored per the pattern above, **is
undoable**), `generate` (`{ filingId }` only — no scope fields at all,
since it only ever acts on an already-scoped existing filing, **not
undoable**), and `submit` (`{ filingId }` only, **not undoable** —
Ministry submissions can't be un-sent). This document's original single
`jpk-kr.generate` command, `{ tenantId, organizationId, fiscalYear,
celZlozenia }` doing both create-and-generate in one step, had no real
precedent and is replaced with the same three-command split, named
`financial_pl_accounting.jpk_kr.upsert_filing` / `.generate` / `.submit` (see New
components, above, and API Contracts, below) — this closes the gap the
Edge Cases section below previously accepted as unmitigated caller
responsibility, and gives each command the right undo semantics instead
of one command conflating a reversible step (creating the filing shell)
with two irreversible ones (building XML, submitting it).

**Undo Contract (added 2026-09-18, per this repo's own spec-writing
review heuristic — "is Undo as detailed as Execute?" — which this
document had not addressed at all).** `financial_pl_accounting.jpk_kr.upsert_filing`
is undoable exactly like the real `upsertFilingCommand`: a create undo
hard-deletes the shell (no submission can have happened yet — an
already-submitted/submitting filing is rejected before it can be
edited, matching `commands/jpk.ts`'s own `status === 'submitted' ||
status === JPK_SUBMITTING_STATUS` guard), an update undo restores the
snapshot taken before the change. `financial_pl_accounting.jpk_kr.generate` and
`.submit` are **not undoable**, matching the real `generateCommand`/
`submitCommand` (neither sets `isUndoable`): regenerating a filing's
XML is idempotent re-execution, not something that needs an undo path,
and a Ministry submission is a real-world irreversible act — there is
no "undo" for a filing the tax authority has already received, only a
correction filing (`celZlozenia: korekta`, see Edge Cases).

**ACL: reuse `financial_pl`'s existing three features, don't add new
ones (added 2026-09-18).** The real `acl.ts` declares only
`financial_pl.view` / `.submit` / `.manage` — coarse, module-wide, not
per-filing-type — and JPK_V7's own commands don't check any
finer-grained feature. JPK_KR_PD should follow the same shape:
`financial_pl_accounting.jpk_kr.upsert_filing`/`.generate` require
`financial_pl.submit` (mirroring how JPK_V7's own filing commands are
gated), read/list paths require `financial_pl.view`. No new features
declared in `acl.ts`/`setup.ts`.

**`generatedXml`/`upoXml` need an encryption-at-rest contract —
Confirmed 2026-09-18 against the real `financial_pl` module (corrected
from a same-day earlier pass that reasoned from this repo's own
precedent only, believing `official-modules` unreachable).**
`packages/financial-pl/src/modules/financial_pl/encryption.ts` exports
`defaultEncryptionMaps: ModuleEncryptionMap[]`, and it already has an
entry naming `JpkVatFiling` by exactly this reasoning: *"The generated
JPK_VAT XML is... compliance-sensitive (carries the full sales+purchase
register), so it is encrypted too"* — `{ entityId:
'financial_pl:jpk_vat_filing', fields: [{ field: 'generated_xml' },
{ field: 'upo_xml' } ] }`. @pkarw's review citation of
`defaultEncryptionMaps` was accurate; this document's earlier
2026-09-18 pass was wrong to treat it as unverifiable. `JpkKrFiling`
needs the equivalent entry (`financial_pl_accounting:jpk_kr_filing`, fields
`generated_xml`/`upo_xml`) once the entity exists. **One correction to
this document's own earlier fix, not to the review:** `JpkVatFiling`'s
`declaration_inputs` (JSON, the closest sibling to this document's
`JpkKrDeclarationInputs`) is *not* in the encryption map — only the two
XML blobs are. There is no real precedent for encrypting the RPD
summary-amount columns, and this document should not have invented
one; `JpkKrDeclarationInputs`'s amount columns stay plain
`numeric(19,4)`, matching how `JpkVatFiling.declarationInputs` is
actually treated.

### Code analysis (verified 2026-09-11, direct inspection of the real `open-mercato` checkout)

This session had a live, linked connection to Mikołaj's actual `open-mercato`
working copy (not a cached/stale ref), so the claims below are freshly
re-checked, not carried over from the 2026-09-10 analysis unverified:

- **Zero financial-module code still confirmed, now cross-checked a second
  way.** Listing every `packages/*/src/modules/*` directory in the repo
  (37 real modules, e.g. `sales`, `wms`, `customers`, `directory`,
  `currencies`, `catalog`) shows no `ledger`, `accounts_payable`,
  `financial_pl`, `fixed_assets`, `posting_rules`, or `cash_bank_management`
  directory anywhere. This reconfirms, via a full listing rather than a
  handful of targeted `find` calls, that this spec's dependency on
  `ledger`'s Bulk Read Service (`#6038`) is a dependency on a *design*, not
  yet a line of shipped code.
- **`Podmiot1` (NIP/REGON/name/address) has no home in `open-mercato` core
  — this document's wording should not imply otherwise.** Grepped
  `packages/core/src/modules/directory/data/entities.ts` and
  `packages/core/src/modules/customers/data/entities.ts` for
  `taxId`/`vatId`/`registrationNumber`/`nip`/`regon` — no matches. Whatever
  entity/organization data `financial_pl` sources for KSeF/JPK_V7's own
  `Podmiot1`-equivalent fields today lives entirely inside `financial_pl`'s
  own tables in `official-modules`, not in any `open-mercato` core module.
  The Data Model section's phrase "reuse the same entity/organization data
  `financial_pl` already sources" was accurate as originally written (it
  never claimed a core-module source) but is corrected here to be explicit,
  since it would be easy to misread as implying shared core data exists.
- **`sales.SalesInvoice` / `SalesInvoiceLine` are real, not just specced** —
  confirmed at `packages/core/src/modules/sales/data/entities.ts:1383` and
  `:1466`, with `outstandingAmount` fields at `:467` and `:1436`. This is
  the one piece of real, already-shipped code anywhere in `open-mercato`
  that a future `D_12` (KSeF/source-document reference) mapping could
  eventually anchor to once Accounts Receivable (`#6046`) merges — today
  it's still a spec-only dependency like everything else here, but it's a
  real table, which the ledger/AP/financial_pl side of this document is not.
- **`official-modules` was unreachable from this environment as of
  2026-09-11/12 — corrected 2026-09-18.** No `external/` checkout
  existed locally (`activated: []` in `official-modules.json`,
  matching what the file already declared), and this session had no
  network path to `github.com` on 2026-09-11/12 (org-level proxy
  block, confirmed twice that session). **Re-checked directly, not
  assumed carried-over, on 2026-09-18: `github.com` is reachable now**
  (`git ls-remote`/`gh api` against `open-mercato/official-modules`
  both succeeded), and a shallow clone of `feat/financial-pl-invoice-ux`
  confirms `commands/jpk.ts`'s real `resolveCommandScope`/
  `ensureTenantScope`/`ensureOrganizationScope` pattern, the real
  `JpkFilingStatusColumn` enum, and `encryption.ts`'s
  `defaultEncryptionMaps` entry for `JpkVatFiling` — see Architecture →
  Design decisions and Q5, both corrected from "unverified" to
  Confirmed on that basis. Access is read-only (`pull`, not `push` —
  `mikoajp` has no write access to `official-modules`), so the actual
  file *move* to `official-modules` (Major #1 / Q3) still needs a fork
  and a separate PR there, not something this pass did unasked.
  Whether `github.com` stays reachable from whatever environment reads
  this next should not be assumed either way — check again rather than
  trusting this note.

### Primary-source XSD verification (2026-09-12)

The Implementation Plan's own step 2 named this pass as still owed:
"run the primary-source verification pass this document deliberately
skipped (field-level XSD read, not brochure prose)." Done here, against
the MF's official `Schemat_JPK_KR_PD(1)_v1-0.xsd` — via its published
documentation PDF and cross-checked against Comarch ERP XL's own
JPK_KR_PD implementation notes (a vendor that has to get the field list
exactly right to pass MF validation, not a summary). **Caveat, stated
plainly:** both readings came through document-summarization rather
than a byte-level read of the raw `.xsd` this session — high confidence
on the findings below (two independent sources agree on substance), but
the raw XSD is still the thing to check before this becomes buildable,
not this pass alone.

**The file has seven top-level nodes, not seven excluding RPD.** `JPK`
contains, in sequence: `Naglowek`, `Podmiot1`, `Kontrahent`,
`ZOiS`, `Dziennik`, `Ctrl`, **`RPD`** — and `RPD` is **mandatory**, not
optional or Phase-2-deferrable at the file-format level. This document's
TLDR line "XML builder for JPK_KR_PD's own structure... seven top-level
nodes" was ambiguous about whether `RPD` was one of the seven or
excluded from the count entirely — corrected: it's one of the seven,
Phase 1 must emit it, just with manually-entered content (see next).

**Major correction: `RPD`'s real scope is much smaller than this
document assumed, and Phase 1's "manual input" design is very likely
the right permanent shape, not a stopgap.** `RPD` is a small, flat
summary node — eight amount fields, `K_1`–`K_8` (an earlier draft said
six or eight because two secondary sources disagreed; the 2026-10-08 pass
found Comarch XL's documentation and an independent field-mapping page
agreeing on eight, see Changelog; the raw XSD remains the final check),
each a simple total (e.g.
tax-exempt revenue, non-deductible costs), **not** a per-account or
per-posting classification the way this document's Design Decisions
section (Kieso Ch.19 grounding) implied Phase 2 would need to compute.
Comarch's own product documentation for their ERP XL JPK_KR_PD
implementation states this directly: these fields "are not
automatically calculated and must be manually completed," and the
whole node "functions as a summary reconciliation, not per-account tax
accounting." This means: Phase 1's `JpkKrDeclarationInputs`
manual-passthrough design is not obviously an inferior stopgap ahead of
a "real" automated Phase 2 — a mature, real ERP treats this exact
node the same way, permanently. The Kieso Ch.19 temporary/permanent-
difference grounding (Design decisions, above) stays useful as a
*classification aid for the human filling in* `K_1`–`K_8` (which
bucket does this book/tax gap belong in), not necessarily as the basis
for an automatic engine "comparable in size to the Posting Rules
Engine" — that sizing claim should be treated as unconfirmed and
probably overstated until someone actually asks for automation here
(see Phasing, below).

**A real, previously-missing mandatory field: `S_12_1`, a per-account
"znacznik" (marker) tying every reported `LedgerAccount` to a
standardized financial-statement category.** Confirmed independently by
two sources: the XSD documentation ("znacznik konta wynikający z
rozporządzenia w sprawie dodatkowego zakresu danych," obligatory) and
Comarch's own validation rule ("pole 'Zest. ks. 1' (S_12_1) <> ''" —
rejects any account with balances/movements and no marker assigned).
Nothing in `LedgerAccount`, `LedgerAccountGroup`, or any sibling spec
carries this classification today — confirmed by re-reading `#5663`'s
Entities list above (Design decisions/Code analysis) — this is a real,
material gap this document did not previously surface, not a
restatement of `LedgerAccountGroup`'s existing zespół 0–8 grouping
(which is chart-of-accounts structure, not this financial-statement-
category tagging). Needs its own design decision before Phase 1 is
buildable: most likely a new, tenant-configured mapping (shape
comparable to `LedgerAccountGroup`'s own precedent), not a hardcoded
value, since the correct `S_12_1` value per account depends on each
tenant's actual chart of accounts. Flagged in Open Questions below
rather than designed here, since it's a real enough decision to deserve
its own confirmation, the same discipline this document already applies
to `RPD`.

**`ZOiS` has eight structural variants (`ZOiS1`–`ZOiS8`) by entity
type, not one generic shape.** Banks, insurers, public-benefit
organizations, investment funds, brokerages, credit unions (SKOK),
"other entities" (`ZOiS7`), and IFRS-reporting entities (`ZOiS8`) each
get their own variant with their own `S_12_1`/`S_12_2` allowed-value
sets (banks alone have 200+ possible marker values). Commerce Weavers'
target customers — confirmed full-book-keeping PIT/CIT entities, not
banks/insurers/funds (see Open Questions, Q2) — would file under
**`ZOiS7`** ("jednostki pozostałe"), corroborated independently by
Comarch's own documentation naming "pozostałych jednostek" as the
standard profile for their regular ERP XL customers. This document's
current Data Model (`S_1`–`S_11`, one generic shape) should be
corrected to name `ZOiS7` explicitly rather than imply a single
universal structure — see Data Model, below.

**`Dziennik` has more fields than this document previously mapped, and
they map cleanly against `JournalEntry`'s real schema (`#5663`), with
two confirmed, real gaps.** Re-checked field by field against
`JournalEntry`'s actual entity definition (`sequenceNumber`, `postedAt`,
`operationDate`, `documentType`, `documentNumber`, `documentDate`,
`description`, `type`, `currencyId`, `exchangeRate`, `referenceType`,
`referenceId`):

| `Dziennik` field | Meaning | Source |
|---|---|---|
| `D_1` | record number | `sequenceNumber` (unchanged from this doc's prior mapping) |
| `D_2` | dziennik/book description (e.g. "Zakup," "Sprzedaż") | **No source.** `JournalEntry.type` (`NORMAL`/`OPENING`/`CLOSING`/`REVERSAL`) is a different axis (accounting-cycle stage, not a subsidiary-journal label) — a real, confirmed gap, not previously named |
| `D_3` | counterparty code (optional) | Possibly `referenceType`/`referenceId`, or `JournalEntryLine.contractorSnapshot` rolled up — ambiguous, since `D_3` is header-level and `contractorSnapshot` is line-level; not resolved here |
| `D_4` | document ID number | `documentNumber` (unchanged) |
| `D_5` | document type | `documentType` (unchanged) |
| `D_6` | business operation date | `operationDate` (unchanged) |
| `D_7` | document preparation date | `documentDate` (unchanged) |
| `D_8` | date recorded in the books | **`postedAt`** — not previously in this document's mapping at all, but a clean, existing field; genuinely good news, not a gap |
| `D_9` | person responsible for the entry | **No source.** `JournalEntry` has no `createdBy`/`postedBy` field today — a real, confirmed gap, and one this document cannot solve unilaterally (see Out of scope framing below) |
| `D_10` | description of the operation | **`description`** — exists, simply missing from this document's prior field table |
| `D_11` | amount | sum of line debits/credits (unchanged from this doc's prior framing) |
| `D_12` | KSeF reference (optional) | `referenceType`/`referenceId` (unchanged) |

**`KontoZapis` is nested inside `Dziennik` (one journal entry's own
lines), not a sibling top-level node — a wording fix, not a design
change**, since this document's `iterateJournalEntries` +
`iterateJournalEntryLines` pairing already reads them exactly this way.
Field-checked against `JournalEntryLine`'s real schema (`journalEntryId`,
`accountId`, `debit`, `credit`, `amountCurrency`, `contractorSnapshot`):

| `KontoZapis` field | Meaning | Source |
|---|---|---|
| `Z_1` | line sequence number | **No source.** `JournalEntryLine` has no ordinal field — would need to be assigned from array position at read time (an implementation detail, not a schema gap, since `iterateJournalEntryLines` already returns lines in a stable order) |
| `Z_2` | line description | **No source.** No per-line description field exists — a real gap; `JournalEntry.description` is header-level only |
| `Z_3` | account | `accountId` (unchanged) |
| `Z_4`/`Z_7` | debit / credit amount | `debit` / `credit` (unchanged) |
| `Z_5`/`Z_8` | debit / credit amount in foreign currency (mutually exclusive with the base-currency side, per line) | `amountCurrency` — one field naturally covers both, since a line only ever has a non-zero debit or credit |
| `Z_6`/`Z_9` | currency code for the foreign-currency amount | `JournalEntry.currencyId` (header-level; resolved to a code), not a separate per-line field — reasonable, since `#5663` scopes currency at the entry, not the line |

This confirms the read-service shape (`#6038`) and this document's own
DTOs are broadly on the right track for `Z_3`/`Z_4`/`Z_7`, but the
builder (`build-konto-zapis.ts`) will need to synthesize `Z_1` at
serialization time and will have no source at all for `Z_2` — flagged,
not solved, here.

## 📝 Data Model

New entity, `JpkKrFiling` (table `financial_pl_accounting_jpk_kr_filing`,
snake_case plural per this repo's naming convention — added
2026-09-18, previously unstated), mirroring `JpkVatFiling`'s shape:

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `tenantId` / `organizationId` | uuid | standard scoping |
| `fiscalYear` | int | the reported year, not a period id — annual filing |
| `celZlozenia` | enum | initial / korekta (correction), matching JPK_V7's own field name |
| `status` | enum | **Corrected 2026-09-18** (see Architecture → Design decisions / Q5, now Confirmed against real `JpkVatFiling` code): `draft → generated → submitting → submitted`, not the original six-state guess. `JpkVatFiling`'s own declared type is `'draft' \| 'generated' \| 'submitted'`, but its real command code (`commands/jpk.ts`) also assigns a fourth, type-cast value `'submitting'` at runtime (`const JPK_SUBMITTING_STATUS = 'submitting' as JpkVatFiling['status']`) — the declared TS type is itself slightly behind the real runtime contract, worth noting rather than silently matching either one blindly. There is no separate `polling`/`accepted`/`rejected` state in the sibling: outcome is read off `submissionError` (`null` = last attempt clean, non-null = failed) and `submissionReference`/`updatedAt`, not extra enum values. `JpkKrFiling` should follow the same shape unless a real reason for `accepted`/`rejected` as their own states turns up (flag it if so; don't invent extra states preemptively as this document did) |
| `generatedXml` | text/blob, **encrypted at rest** (`financial_pl_accounting:jpk_kr_filing` in `encryption.ts`'s `defaultEncryptionMaps`, mirroring `financial_pl:jpk_vat_filing` — Confirmed 2026-09-18, see Architecture → Design decisions) | |
| `submissionReference` | string | |
| `upoXml` | text/blob, **encrypted at rest** (same map entry) | UPO (urzędowe poświadczenie odbioru) |
| `submissionError` | text, nullable | |

`JpkKrDeclarationInputs` (operator-entered `RPD` fields — corrected
2026-09-12, see Architecture → Primary-source XSD verification: `RPD`
is a small, flat set of summary amounts, not the open-ended
`rpdAdjustments` blob this document originally assumed). Eight amount
columns, one per `K_x`, fixed 2026-10-08:

| Field | `RPD` node | Meaning |
|---|---|---|
| `filingId` | | uuid, FK → `JpkKrFiling` |
| `rpdRevenueExempt` | `K_1` | revenue exempt from tax (permanent difference) |
| `rpdRevenueNotTaxableCurrentYear` | `K_2` | revenue not subject to tax in the current year |
| `rpdRevenueTaxableBookedPriorYear` | `K_3` | taxable revenue of the current year booked in prior years |
| `rpdCostNonDeductible` | `K_4` | costs that are not tax-deductible (permanent difference) |
| `rpdCostNotRecognizedCurrentYear` | `K_5` | costs not recognized as tax-deductible in the current year |
| `rpdCostRecognizedPriorYear` | `K_6` | tax-deductible costs of the current year booked in prior years |
| `rpdRevenueTaxableNotBooked` | `K_7` | taxable revenue not recorded in the books |
| `rpdCostDeductibleNotBooked` | `K_8` | tax-deductible costs not recorded in the books |

All eight are `numeric(19,4)`, `not null`, default `0`, operator-entered
(manual, permanent, not a Phase 2 stopgap, per Comarch's own precedent;
see Design decisions), not a jsonb blob. Meanings follow Comarch ERP XL's
JPK_KR_PD documentation and an independent field-mapping page; the field
names and the exact node element names are checked against the vendored
XSD as the first step of Phase 1 (Implementation Plan), and the columns are
corrected before the first migration if the schema differs. When all eight
values are zero, `.generate` returns a warning (not an error), matching
Comarch XL's "unfilled income tax settlement amounts" validation.

Table `financial_pl_accounting_jpk_kr_declaration_inputs` (added 2026-09-18).
**Deliberate divergence from the sibling, flagged rather than
silently diverged: `JpkVatFiling` doesn't have a separate
declaration-inputs table at all — it has one `declaration_inputs`
JSON column on the filing entity itself** (`declarationInputs:
Record<string, unknown> | null`, no fixed shape). This document
instead proposes a separate table with one typed `numeric(19,4)`
column per `K_x` field. The reason to diverge: JPK_V7's declaration
inputs are genuinely open-ended (arbitrary manual overrides across
many possible fields), while the 2026-09-12 XSD pass fixed `RPD` to
a small, *known*, closed set of eight amount fields (`K_1`–`K_8`) —
typed columns give real validation (`numeric(19,4)`, not-null
constraints) that a JSON blob
can't. If a reviewer here prefers matching the sibling exactly for
consistency over the extra type safety, collapsing this into a
single `declaration_inputs` JSON column on `JpkKrFiling` itself
(dropping the separate entity/table) is the one-line alternative —
flagging the choice rather than deciding it unilaterally.

**Field mapping — `ZOiS` node, variant `ZOiS7` ("jednostki pozostałe" —
confirmed the applicable variant for Commerce Weavers' target
customers, see Architecture → Primary-source XSD verification) ←
`#6013`'s ZSiO computation, via `getZois`:**

| `ZOiS` field | Source |
|---|---|
| `S_1`–`S_3` (account id/name/parent) | `LedgerAccount.slug` / `.description` / `.parentAccountId` |
| `S_4`–`S_5` (opening debit/credit) | opening balance, period start |
| `S_6`–`S_7` (period turnover) | period debit/credit turnover |
| `S_8`–`S_9` (YTD turnover) | year-to-date turnover |
| `S_10`–`S_11` (closing balance) | closing balance |
| `S_12_1` (mandatory account marker, financial-statement category) | **No source today.** Confirmed real gap — needs its own tenant-configured mapping, comparable in shape to `LedgerAccountGroup`'s own precedent; not designed here, see Open Questions |

**Field mapping — `Dziennik`/`KontoZapis` ← `JournalEntry`/
`JournalEntryLine`, via `iterateJournalEntries` / `iterateJournalEntryLines`
— corrected and expanded 2026-09-12 (see Architecture → Primary-source
XSD verification for the full gap analysis):**

| `Dziennik` field | Source |
|---|---|
| `D_1` | `sequenceNumber` |
| `D_2` (dziennik/book description) | **No source — confirmed gap** |
| `D_3` (counterparty code, optional) | Ambiguous — not resolved (header-level field, `contractorSnapshot` is line-level) |
| `D_4` | `documentNumber` |
| `D_5` | `documentType` |
| `D_6` | `operationDate` |
| `D_7` | `documentDate` |
| `D_8` (date recorded in books) | **`postedAt`** — newly mapped, previously missing from this table |
| `D_9` (person responsible) | **No source — confirmed gap**, not solvable inside this document alone |
| `D_10` (operation description) | **`description`** — newly mapped, previously missing from this table |
| `D_11` | sum of `JournalEntryLine.debit`/`credit` |
| `D_12` (KSeF ref) | `referenceType`/`referenceId`, when the source is a `financial_pl` KSeF invoice |

| `KontoZapis` field | Source |
|---|---|
| `Z_1` (line sequence number) | **No source — synthesize from array position** at serialization time (implementation detail, not a schema gap) |
| `Z_2` (line description) | **No source — confirmed gap**, `JournalEntry.description` is header-level only |
| `Z_3` (account) | `JournalEntryLine.accountId` |
| `Z_4`/`Z_7` (debit/credit) | `JournalEntryLine.debit`/`.credit` |
| `Z_5`/`Z_8` (foreign-currency amount, whichever side is non-zero) | `JournalEntryLine.amountCurrency` |
| `Z_6`/`Z_9` (currency code) | `JournalEntry.currencyId` (header-level) |

`LedgerAccountGroup` (`jurisdiction: 'PL'`, zespoły 0–8, already seeded
per the GL core spec) supplies the chart-of-accounts classification
`ZOiS`/`KontoZapis` need for grouping — a separate concern from
`S_12_1`'s financial-statement-category marker above; don't conflate
the two.

`Naglowek` (file metadata) and `Podmiot1` (submitting entity — NIP,
REGON, name, address) reuse the same entity/organization data
`financial_pl` already sources for KSeF/JPK_V7. `Kontrahent` (optional,
counterparties) overlaps `financial_pl`'s existing buyer/seller snapshot
data on invoices. `Ctrl` (control sums) is derived, not sourced
separately.

## 📝 API Contracts

No new HTTP routes proposed. All generation/submission happens through
commands (mirroring JPK_V7). **Corrected 2026-09-18 to the real
three-command split** (see Architecture → Design decisions for why the
original single `jpk-kr.generate` command was replaced):

- `financial_pl_accounting.jpk_kr.upsert_filing` — `{ id?, tenantId?, organizationId?, fiscalYear, celZlozenia, ... }`. `tenantId`/`organizationId` are accepted-but-ignored fields (schema compatibility only, matching `jpkFilingUpsertSchema`'s own optional-but-unused fields) — the handler derives real scope via `resolveCommandScope(ctx)` and uses that for every lookup/create and for `ensureTenantScope`/`ensureOrganizationScope`. Rejects editing a filing whose `status` is `submitted` or `submitting`, matching `commands/jpk.ts`'s own guard. **Undoable** (see Architecture → Undo Contract).
- `financial_pl_accounting.jpk_kr.generate` — `{ filingId }` only, no scope fields at all (mirrors `jpkGenerateSchema` exactly — it only ever acts on a filing already scoped at creation, looked up by `resolveCommandScope(ctx)` + `filingId`). Calls the builder chain, sets `status: draft → generated`. **Not undoable.**
- `financial_pl_accounting.jpk_kr.submit` — `{ filingId }` only. Sets `status: generated → submitting`, calls `jpkTransportService.submit` (integration contracts spec; the signing certificate and key stay inside `financial_pl`) and — matching `commands/jpk.ts`'s real behavior — **polls inline within the same command execution** (`jpkTransportService.pollStatus`, for the resume-an-in-flight-submission case), rather than through a separate exposed `.poll-status` command. A prior pass on this document proposed `jpk-kr.poll-status` as its own command; the real sibling has no such command — polling is either inline in `submit`'s own retry/resume path or driven by a background worker, never its own top-level command. Corrected. **Not undoable.**

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
- **Concurrent double-submit (added 2026-09-18, real gap — this
  document had no transaction-boundary discussion at all for
  `.submit`).** `commands/jpk.ts`'s real `submitCommand` claims the
  filing with a conditional `nativeUpdate` (`WHERE status =
  'generated'` → `SET status = 'submitting'`, checking
  `updated === 1` and throwing `409` otherwise) before calling the
  Ministry gateway — this is what stops two concurrent `.submit`
  calls (or a retry racing the original) from both reaching the
  gateway. `financial_pl_accounting.jpk_kr.submit` must use the same
  compare-and-swap claim, not a plain `em.flush()` after a
  read-then-write — this is Confirmed against real code, not an
  open question, so it's a requirement here, not a Phase 2 nice-to-have.
- **Wrong `tenantId`/`organizationId` passed to the bulk-read calls.**
  Inherited risk from `#6038` (explicit caller responsibility, no
  framework guardrail) at the `LedgerBulkReadService` layer itself —
  that part is unchanged; the bulk reads still trust whatever scope
  they're called with. **Corrected 2026-09-18, re-verified against
  real `official-modules` code:** the outer
  `financial_pl_accounting.jpk_kr.upsert_filing`/`.generate`/`.submit` commands
  are not similarly unmitigated, provided they
  follow `commands/jpk.ts`'s real pattern — `resolveCommandScope(ctx)`
  derives scope from the authenticated context, never from the
  request body, so there is no caller-supplied `tenantId`/
  `organizationId` to get wrong at that layer. The residual risk is
  narrower than originally stated: `LedgerBulkReadService`'s own
  scoping (a `#6038` concern, not this document's) and a
  wrong *fiscal year/period* passed within a correctly-derived scope.

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
- **New cross-module coupling.** The new package's `requires` edges to
  `financial_pl` and `ledger` change the module-family dependency graph
  documented in
  `2026-09-08-financial-module-knowledge-base.md` — that document's
  module map needs a corresponding update once this ships (noted, not
  actioned here).
- **Compatibility.** The only change in `financial_pl` is the new DI
  transport service (integration contracts spec, additive); everything else in this document
  is a new package with new entities and commands.

## 📋 Phasing

- **Phase 1 (this spec):** `JpkKrFiling` entity, XML builder for
  `Naglowek`/`Podmiot1`/`Kontrahent`/`ZOiS`/`Dziennik`/`KontoZapis`/`Ctrl`,
  manual-input `RPD`, reused submission pipeline. Blocked on `#6038`.
- **Phase 2 (future, separate spec, priority downgraded 2026-09-12):**
  `RPD` computed automatically — book/tax classification on
  `LedgerAccount` or postings, and the reconciliation logic itself.
  **No longer assumed "comparable in size to the Posting Rules
  Engine"** — the primary-source XSD verification pass (Architecture,
  above) found `RPD` is a small, manually-completed summary node in
  practice, including in at least one mature real ERP (Comarch XL).
  Phase 2 should not be scheduled on the old sizing assumption; it may
  turn out nobody ever asks for it, since Phase 1's manual input may
  simply be correct and sufficient. If a real need for automation does
  surface, the Kieso Ch.19 grounding under Architecture → Design
  decisions above still gives a candidate classification axis (no
  difference / permanent / temporary, the latter needing a reversal
  schedule) to design against, pending Polish CIT law (ustawa o CIT,
  art. 15–16) for the actual category contents.
- **Phase 3 (future, separate spec, noted but not designed):**
  `JPK_ST_KR` (fixed assets/intangibles register), released by the same
  MF initiative alongside JPK_KR_PD — would draw on the Fixed Assets
  module (`#6014`) the way this spec draws on `ledger`. Flagged for
  awareness only.

## 📋 Implementation Plan

1. **Blocked until `#6038` merges.** No implementation work starts
   before then.
2. **Done 2026-09-12, partially** (see Architecture -> Primary-source
   XSD verification): the field-level pass ran against the XSD's
   published documentation, not a byte-level read of the raw
   `.xsd` yet. Still needed before this is fully buildable: vendor the
   actual `Schemat_JPK_KR_PD(1)_v1-0.xsd` file itself and confirm the
   `RPD` field list (`K_1`-`K_8`, eight columns decided 2026-10-08 from
   two agreeing secondary sources) and `S_12_1`'s exact allowed-value
   enumeration for the `ZOiS7` variant against the raw schema, not
   summaries of it.
3. Create the package `financial_pl_accounting` with its manifest and
   `requires` (accounting package spec); release `financial_pl` with
   `jpkTransportService` (integration contracts spec) before it.
4. `JpkKrFiling` + `JpkKrDeclarationInputs` entities + migration
   (table names corrected 2026-09-18, see Data Model).
5. `build-zois.ts` / `build-dziennik.ts` / `build-konto-zapis.ts`, each
   independently unit-testable against `LedgerBulkReadService`'s DTOs.
6. `compute-rpd.ts` stub (manual-input passthrough only, Phase 1).
7. `commands/jpk-kr.ts`: `financial_pl_accounting.jpk_kr.upsert_filing`
   (undoable) → `.generate` (`resolveJpkKrFiling → buildJpkKrXml`) →
   `.submit` (`jpkTransportService.submit`/`pollStatus`, no reimplementation)
   — corrected 2026-09-18 to the real three-command split, see API
   Contracts.
8. `workers/jpk-kr-generate.worker.ts` on an annual trigger.
9. Update `2026-09-08-financial-module-knowledge-base.md`'s dependency
   graph to show `financial_pl_accounting → financial_pl, ledger`.

## 📋 Testing Strategy

**Added 2026-09-18, per @pkarw's PR `#6069` review Major #5 (missing
integration test plan) — confirmed real: this document previously had
no dedicated Testing Strategy section at all**, unlike sibling specs
in this family (e.g. `2026-08-18-general-ledger-core-engine.md`).

- **Unit.** `build-zois.ts` / `build-dziennik.ts` /
  `build-konto-zapis.ts`, each independently testable against fixture
  `LedgerBulkReadService` DTOs (already named in Implementation Plan
  step 5) — including the two confirmed no-source gaps (`D_2`, `D_9`,
  `Z_1`, `Z_2` from the Dziennik/KontoZapis field mapping above) so
  the builder's handling of missing fields (synthesize `Z_1`, leave
  `D_2`/`D_9`/`Z_2` as documented placeholders) is asserted, not left
  implicit.
- **Scope-derivation test (corrected 2026-09-18).**
  `financial_pl_accounting.jpk_kr.upsert_filing` ignores a payload
  `tenantId`/`organizationId` that
  disagrees with the calling context and act on the context's own
  scope instead (never the body's) — and a caller with no allowed
  access to the context-derived organization gets `403 Forbidden`
  from `ensureOrganizationScope`, mirroring `commands/jpk.ts`'s real
  tests for `upsertFilingCommand`/`generateCommand`.
- **Encryption round-trip test (new 2026-09-18).** A generated
  `JpkKrFiling.generatedXml`/`.upoXml` round-trips through
  encrypt/decrypt unchanged, and is not readable as plaintext from a
  raw row read (e.g. a direct `em.getConnection().execute` query
  bypassing the decryption helper) — see Architecture → Design
  decisions.
- **Integration.** End-to-end `generate → submit → poll` against a
  golden fixture GL dataset seeded through `LedgerBulkReadService`'s
  own fixtures once `#6038` ships; a correction-filing
  (`celZlozenia: korekta`) smoke test once that flow is designed (see
  Edge Cases).
- **Compliance gate.** Once Implementation Plan step 2's raw-XSD
  vendoring is done, validate a generated file against the real
  `Schemat_JPK_KR_PD(1)_v1-0.xsd` in CI — the field-level pass done
  2026-09-12 used documentation summaries, not the schema itself (see
  Architecture → Primary-source XSD verification), so this gate is
  the actual compliance check, not the summary pass.
- **Not designed here (flagged, not solved):** a whole-annual-ledger
  scale test — see the new Architecture note on assembly scale and
  Open Questions, Q6.

## Open Questions / Assumptions To Confirm

Carried over from the 2026-09-10 analysis, not treated as blockers to
drafting this document, but unresolved before it should be considered
final:

- **Q1 — Confirmed default: defer `RPD` computation to its own future
  spec (Phase 2).** Flagged here for override if the business decides
  otherwise.
- **Q2 — Partially resolved 2026-09-12, with the business.** First,
  the harmonogram itself needed correcting: JPK_KR_PD's cohort split is
  by **VAT filing frequency**, not by revenue/size the way JPK_CIT's
  is — confirmed directly against `gov.pl/web/kas` and cross-checked
  against a second source (taxeo.pl), since the primary gov.pl page
  itself failed to fetch this session. Group 1 = PIT taxpayers filing
  monthly VAT (`JPK_V7M`): obligated from tax year 2026, first
  `JPK_KR_PD` file due by end of April 2027. Group 2 = everyone else
  (VAT-exempt or quarterly `JPK_V7K`): obligated from tax year 2027,
  first file due by end of April 2028. Neither cohort's window has
  passed — the "largest-taxpayer window already passed" note above
  described `JPK_CIT`'s Group 1 (EUR 50M+ revenue, filed by July 2026),
  a different structure and a different taxpayer population than this
  document's own `JPK_KR_PD`, and doesn't apply here at all — that
  framing in the original Q2 was itself wrong, not just unconfirmed.
  Second, confirmed with the business (2026-09-12): Commerce Weavers'
  target Open Mercato customers keep **full accounting books** (księgi
  rachunkowe), not simplified `PKPiR` — so `JPK_KR_PD` (this document)
  genuinely is the right structure to be building, not `JPK_PKPIR`.
  **Still open:** which VAT-filing frequency (and therefore which of
  the two cohorts/deadlines above) actually matches those customers —
  explicitly not needed to decide before continuing the work that
  doesn't depend on it (`#6038`'s review, the raw-XSD confirmation
  Implementation Plan step 2 still needs) — only the ship-by date
  hinges on it. Working assumption unchanged until that's answered:
  Group 1 (FY2026, filed by April 2027) is treated as the tighter,
  safer target to build toward.
- **Q3 — Placement:** this document assumes `official-modules` /
  `SPEC-010`, per the existing JPK_V7/KSeF precedent. Not yet physically
  placed there — `official-modules` is not checked out in the
  environment this draft was written in.
- **Q4 — New 2026-09-12, from the primary-source XSD pass:** `S_12_1`
  (mandatory per-account financial-statement-category marker, see
  Architecture -> Primary-source XSD verification and Data Model) needs
  a real design decision before Phase 1 is buildable -- most likely a
  new, tenant-configured mapping on or alongside `LedgerAccount`,
  comparable in shape to `LedgerAccountGroup`'s own precedent. Not
  designed here; needs its own pass, the same discipline this document
  already applies to `RPD`. Also unresolved: `S_12_1`'s full allowed-value
  list for the `ZOiS7` variant, and the final confirmation of the `RPD`
  field list (`K_1`-`K_8`, decided 2026-10-08 from secondary sources) --
  both need the raw XSD, not the secondary documentation this pass used.
- **Q5 — Resolved 2026-09-18, from PR `#6069`'s review (@pkarw, Major
  #3).** Confirmed: `official-modules`'s real `JpkFilingStatusColumn`
  is `'draft' | 'generated' | 'submitted'`, plus a fourth, type-cast
  runtime-only value `'submitting'` `commands/jpk.ts` uses without
  declaring it in the type. This document's original six-state
  `draft → generating → submitting → submitted → polling →
  accepted | rejected` machine had no real precedent — corrected in
  Data Model, above, to `draft → generated → submitting → submitted`
  with outcome read off `submissionError`, matching the sibling
  exactly. (A same-day earlier pass on this document had marked this
  Q as unverifiable, believing `official-modules` unreachable — see
  Code analysis below for the network-access correction; that pass
  was wrong to stop at "can't check.")
- **Q6 — New 2026-09-18, from PR `#6069`'s review (@pkarw, Major #4):**
  whole-annual-ledger XML/ZIP assembly at scale (see Architecture,
  above) — does JPK_V7's in-memory submission pipeline hold up for a
  full annual ledger, or does `build-jpk-kr-xml.ts`/
  `jpk-submission-client.ts` need a streaming rewrite? Flagged, not
  designed here — real design work, not something to improvise inline
  while fixing a review.

## Final Compliance Report — 2026-09-18

Run once, at the point of migration into `official-modules` — this
document had never been checked against this repo's own `AGENTS.md`/
spec-writing rules before (it was drafted and reviewed entirely under
`open-mercato`'s own `om-spec-writing` convention). Checked honestly,
not performatively: several items below are Non-compliant or flagged,
not rounded up to Compliant.

### AGENTS.md Files Reviewed

- `AGENTS.md` (root, `official-modules`)
- `.ai/specs/AGENTS.md`
- `.ai/skills/spec-writing/SKILL.md` (review heuristics + checklist)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Module is an external extension; MUST NOT modify core packages | Compliant | No core package touched; `ledger` (in `open-mercato`) is consumed via `requires` + DI resolution, the same pattern `wms`'s real code uses for `feature_toggles` — verified against real code, not assumed |
| root AGENTS.md | No cross-module `@ManyToOne` ORM relationships | Compliant | `JpkKrFiling` has no ORM relation to any `ledger` entity; GL data comes through `LedgerBulkReadService` DTOs only |
| root AGENTS.md | MUST filter every query by `organization_id` | Compliant | `resolveCommandScope(ctx)` derives scope server-side for every command; see Architecture → Design decisions |
| root AGENTS.md | MUST validate all inputs with zod in `data/validators.ts` | Non-compliant | Schema *shapes* are named (`jpkKrFilingUpsertSchema` etc.) but no zod literal is written in this document — same as this document's own JPK_V7 citations, but real `data/validators.ts` will need the actual schemas before implementation |
| root AGENTS.md | MUST use `findWithDecryption`/`findOneWithDecryption` for PII/encrypted fields | Non-compliant | `generatedXml`/`upoXml` are specified as encrypted (Architecture → Design decisions) but no read path in this document names `findWithDecryption` explicitly — add when `commands/jpk-kr.ts` is implemented |
| root AGENTS.md | MUST use declarative guards (`requireAuth`, `requireFeatures`) | N/A | No new HTTP routes or backend pages proposed in this pass (see UI/UX) — applies once the Phase 2 UI tab is designed |
| root AGENTS.md | MUST NOT return sensitive data in error messages | Non-compliant | Not addressed — `commands/jpk.ts`'s real error paths (missing signer cert, missing MF cert) return operator-facing config errors; this document doesn't check whether any JPK_KR_PD-specific error path could leak XML content or credentials |
| root AGENTS.md naming | Command ID `<moduleId>.<feature>.<action>` | Compliant (corrected 2026-09-18) | `financial_pl_accounting.jpk_kr.upsert_filing`/`.generate`/`.submit` — a prior pass used `jpk-kr.generate` with no module prefix; fixed against real `commands/jpk.ts` IDs |
| root AGENTS.md naming | Entity singular PascalCase, table snake_case plural | Compliant (corrected 2026-09-18) | `JpkKrFiling` → `financial_pl_accounting_jpk_kr_filing`; table names were previously unstated |
| spec-writing SKILL.md | External Extension First — everything via UMES extension points | Compliant | `requires` + DI resolution is UMES's own documented cross-module mechanism, not a `packages/core` modification; verified via `wms`/`feature_toggles` precedent |
| spec-writing SKILL.md | Singularity Law (singular event/command names) | Compliant | `jpk_kr` module-scoped feature name is singular; no plural entity/command names introduced |
| spec-writing SKILL.md | Undo Contract as detailed as Execute | Compliant (corrected 2026-09-18) | Previously entirely absent; now `upsert_filing` (undoable) vs. `generate`/`submit` (not undoable, matching real code) is explicit — see Architecture |
| spec-writing SKILL.md | Module Isolation — DI usage specified for service wiring (Awilix) | Compliant | `container.resolve('ledgerBulkReadService')`, named explicitly |
| spec-writing checklist §3 | Write operations define atomicity/transaction boundaries | Compliant (corrected 2026-09-18) | Previously absent; the compare-and-swap `nativeUpdate` claim pattern for `.submit` is now specified (Edge Cases), matching `commands/jpk.ts`'s real double-submit protection |
| spec-writing checklist §5 | Migration/backward compatibility strategy is explicit | Compliant | Additive only — a new package with its own `requires`; the only change in `financial_pl` is the added DI transport service (integration contracts spec) (Risks & Impact Review) |
| spec-writing checklist §6 | Performance/cache/pagination items | N/A | No list/search HTTP API proposed in this pass — all reads happen server-side, in a worker, against `LedgerBulkReadService`'s own `AsyncIterable` streams |
| spec-writing checklist §7 | Risk Register uses the required Scenario/Severity/Affected area/Mitigation/Residual risk format | Non-compliant | This document's Risks & Impact Review predates that format (written under `om-spec-writing`'s own risk convention) — not reformatted in this pass; flagged rather than mechanically reformatted without re-checking each risk's substance |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | `JpkKrFiling`/`JpkKrDeclarationInputs` fields match the three commands' inputs/outputs |
| Commands defined for all mutations | Pass | `upsert_filing`/`generate`/`submit` cover create, build, and send; no mutation without a named command |
| Undo contract covers every command | Pass (corrected 2026-09-18) | Previously Fail (no undo discussion at all) |
| Risks cover all write operations | Partial | Covers the ones this document's own Edge Cases names; not run through the Risk Register's required format (see Compliance Matrix) |
| Cache strategy covers all read APIs | N/A | No cacheable read API in this pass |

### Non-Compliant Items

- **Rule**: MUST validate all inputs with zod in `data/validators.ts`
  **Source**: root `AGENTS.md`
  **Gap**: Schema shapes are named, not written as zod literals
  **Recommendation**: Write `jpkKrFilingUpsertSchema`/`jpkKrGenerateSchema`/`jpkKrSubmitSchema` in `data/validators.ts` before implementation starts; mirror `jpkFilingUpsertSchema`'s real shape for the upsert one

- **Rule**: MUST use `findWithDecryption`/`findOneWithDecryption` for encrypted fields
  **Source**: root `AGENTS.md`
  **Gap**: No read path in this document names the decryption helper explicitly
  **Recommendation**: Every `em.findOne(JpkKrFiling, ...)` in `commands/jpk-kr.ts` must go through `findOneWithDecryption`, matching `commands/jpk.ts`'s own usage

- **Rule**: MUST NOT return sensitive data in error messages
  **Source**: root `AGENTS.md`
  **Gap**: Not checked against this document's own error paths
  **Recommendation**: Audit `financial_pl_accounting.jpk_kr.submit`'s error responses (signer cert missing, MF cert missing, gateway rejection) before implementation, mirroring `commands/jpk.ts`'s existing care not to echo credential material

- **Rule**: Risk Register required format (Scenario/Severity/Affected area/Mitigation/Residual risk)
  **Source**: `.ai/skills/spec-writing/references/spec-checklist.md` §7
  **Gap**: Risks & Impact Review section predates this format
  **Recommendation**: Re-run Risks & Impact Review through the required Risk Register format before Phase 1 sign-off — not done in this pass because it needs re-thinking each risk's severity/residual-risk honestly, not a mechanical reformat

### Verdict

**Non-compliant — Blocked** on the four items above before implementation (not before further design review; none of them are architecture-level blockers, all are documentation/detail gaps this pass surfaced but didn't fully close). Architecture-level compliance (module isolation, DI pattern, command naming, undo contract, table naming) is Confirmed against real code as of this report.

## Changelog

### 2026-09-11
- Initial specification, staged temporarily in `open-mercato`'s `.ai/specs/` (official-modules access not available in that working environment at the time).

### 2026-09-12
- Q2 corrected (cohort/timing, VAT-frequency-based not revenue-based).
- Primary-source XSD verification pass: real 7-node structure, `RPD`'s true (small, manual) scope, new mandatory `S_12_1` marker discovered.

### Review — 2026-09-16
- **Reviewer**: @pkarw (independent maintainer, `open-mercato#6069`)
- **Security**: 2 blockers (caller-supplied tenant/org scope; missing encryption contract)
- **Performance**: 1 major (whole-ledger in-memory assembly scale)
- **Commands**: 1 major (filing status machine vs. `JpkVatFiling`'s real contract)
- **Risks**: 1 major (missing integration test plan), 1 major (placement in wrong repo)
- **Verdict**: Request changes — 2 blocker, 5 major findings

### 2026-09-18 (fixes applied, round 1)
- Confirmed the review's own Validation Gate was stale (cited a head 4 days behind the branch's real tip).
- Fixed both Blockers using this repo's own precedent (`api_keys.sessionSecretEncrypted`, `channel_discord`'s encryption pattern) — later superseded by round 2 below once direct `official-modules` access was confirmed.
- Fixed Major #2's deadline sub-claim (real Ministry regulation, 2026-02-20, extends the deadline to end of July 2026 for the earliest cohort).
- Flagged Major #4 (scale) and fixed Major #5 (added Testing Strategy).
- Left Major #3 (status machine) as Q5, believing `official-modules` unreachable.

### 2026-09-18 (fixes applied, round 2 — official-modules access confirmed)
- Corrected round 1's Blocker #1/#2 fixes against the real `commands/jpk.ts`/`encryption.ts` (scope is server-derived via `resolveCommandScope`, never client-trusted; `defaultEncryptionMaps` confirmed exactly as the review cited; walked back an overclaim that RPD amount columns needed encryption — the sibling's own `declarationInputs` isn't encrypted).
- Resolved Q5 (Major #3) as Confirmed, not left open: real `JpkFilingStatusColumn` is `draft | generated | submitted` plus an undeclared runtime `submitting` value; corrected `JpkKrFiling.status` to match.

### 2026-09-18 (moved to `official-modules`, compliance pass)
- Moved from `open-mercato#6069` to `official-modules` (this document) — Major #1 resolved.
- Corrected the command surface itself: replaced the single conflated `jpk-kr.generate` with the real three-command split (`financial_pl.jpk_kr.upsert_filing`/`.generate`/`.submit`), matching `commands/jpk.ts` exactly, including which commands are undoable.
- Added Overview, Undo Contract, ACL reuse decision, table names, the `JpkKrDeclarationInputs` JSON-vs-typed-columns divergence note, double-submit compare-and-swap protection, and this Final Compliance Report — closing this document's gap against `official-modules`' own `AGENTS.md`/spec-writing requirements, which it had never been checked against before.

### 2026-10-08 (RPD field count)
- `RPD` has eight amount fields, `K_1`–`K_8`: Comarch ERP XL's JPK_KR_PD documentation and an independent field-mapping page (Staria) give the same eight, all entered manually. The earlier "six or eight" wording is removed in Architecture, Data Model and Open Questions, and `JpkKrDeclarationInputs` now lists eight named `numeric(19,4)` columns (Data Model). An all-zero `RPD` produces a warning on `.generate`, not an error. The vendored XSD is still the final check; it is the first Phase 1 step, and the columns are corrected before the first migration if it differs. No other change in this entry (location of the code, `requires` and the use of `submitJpk` are unchanged here).

### 2026-10-08 (target layout)
- The feature moves to the separate package `financial_pl_accounting` (new Target layout section) so that `financial_pl` keeps no dependency on `ledger`. Command ids, table names and the encryption entry are renamed accordingly; the three existing `financial_pl.*` features are still the only ACL.
- Submission goes through `financial_pl`'s DI service `jpkTransportService` (integration contracts spec) instead of reusing `submitJpk`/`pollJpkStatus` inside one module; the certificate and key stay in `financial_pl`.
- `LedgerBulkReadService` now has seven methods (#6038 added `getFiscalPeriod` and `findClosingEntries`).
- Updated TLDR, Proposed Solution, Architecture, API Contracts, Risks, Implementation Plan and Final Compliance Report to match.

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
`data/entities.ts`, `commands/jpk.ts`, `lib/jpk/*`) — not re-verified
2026-09-11, see Architecture → Code analysis; Kieso, Weygandt, Warfield,
*Intermediate Accounting*, 17th Ed. (Wiley, 2019, ISBN 978-1-119503682),
Ch.19 "Accounting for Income Taxes," pp.19-1–19-20, 19-39–19-40 —
verified directly, full chapter read, 2026-09-11 (see Architecture →
Design decisions); Fowler, *Analysis Patterns*, and Hay, *Data Model
Patterns* — both full-text searched for "tax" 2026-09-11, no relevant
content found, see Architecture → Design decisions; direct inspection of
the `open-mercato` working copy, 2026-09-11 (`packages/*/src/modules/*`
listing; `packages/core/src/modules/{directory,customers}/data/entities.ts`;
`packages/core/src/modules/sales/data/entities.ts:1383,1436,1466`).

2026-09-12 addition: taxeo.pl, "JPK_PIT 2026 – od kiedy, dla kogo i jak
raportować księgi (PKPiR, EWP, ST, KR_PD)" — used to cross-check the
`gov.pl/web/kas` cohort schedule after that primary source failed to
fetch this session; confirms the same two-group, VAT-frequency-based
split (see Open Questions, Q2).

2026-09-12 addition (primary-source XSD verification): Schemat_JPK_KR_PD
schema documentation (published PDF, mirrored at pracodawcy.pl,
`Schemat_JPK_KR_PD1_v1-0.pdf`) -- node list, Dziennik/KontoZapis field
list, ZOiS1-ZOiS8 variants, S_12_1/S_12_2 markers, RPD's K_1-K_x fields;
cross-checked against Comarch ERP XL's own JPK_KR_PD implementation
documentation (pomoc.comarch.pl/xl/index.php/dokumentacja/xl177-jpk_kr_pd/)
for RPD's manual/summary nature, S_12_1's mandatory validation rule, and
the ZOiS "pozostale jednostki" (ZOiS7-equivalent) profile; secondary
sources for structure orientation only, not relied on for field-level
detail: poradnikprzedsiebiorcy.pl and akademialtca.pl. Both XSD-adjacent
sources are documentation of the schema, not a byte-level read of the
raw Schemat_JPK_KR_PD(1)_v1-0.xsd itself -- see Open Questions, Q4.

2026-09-18 addition (PR `#6069` review verification): Deloitte Polska,
"Przesunięcie terminów raportowania struktury JPK_KR_PD w 2026 r." and
Sovos, "Poland: Clarification to JPK_KR_PD and JPK_ST_KR Brochures
Published" -- both fetched directly, not recalled, to check @pkarw's
review claim of a Ministry update effective 1 July 2026; confirmed real
(a 2026-02-20 regulation extended the deadline to end of the 7th month
after fiscal year end, i.e. end of July 2026 for the earliest cohort) --
see Problem Statement. Direct inspection of this repo's own command and
encryption layers (not `official-modules`, confirmed unreachable):
`packages/shared/src/lib/commands/scope.ts`
(`ensureTenantScope`/`ensureOrganizationScope`), their real call sites in
`packages/core/src/modules/customers/commands/{pipelines,comments}.ts`,
`packages/core/src/modules/api_keys/data/entities.ts`
(`sessionSecretEncrypted`), and
`packages/channel-discord/src/modules/channel_discord/lib/credentials.ts`
-- initial (same-day) grounding for the scope-validation and
encryption-at-rest design decisions, before official-modules access
was re-checked (see below).

2026-09-18 addition (official-modules re-checked, corrected the
"unreachable" claim above): direct read access (pull, not push) to
`github.com/open-mercato/official-modules`, branch
`feat/financial-pl-invoice-ux` -- `commands/jpk.ts`
(`resolveCommandScope`, `ensureTenantScope`/`ensureOrganizationScope`
usage, `jpkGenerateSchema`/`jpkSubmitSchema`/`jpkFilingUpsertSchema` in
`data/validators.ts`), `data/entities.ts` (`JpkVatFiling`,
`JpkFilingStatusColumn`), and `encryption.ts` (`defaultEncryptionMaps`)
-- used to correct Blocker #1/#2 and resolve Q5 (Major #3) from
unverified guesses to Confirmed findings; see Architecture -> Design
decisions, Data Model, and Open Questions.
