# SPEC-010 — JPK_KR_PD (Statutory Accounting Books e-Filing) for `financial_pl`

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
> `jpk-kr.generate`/`.submit`; an encryption-at-rest entry for
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
- The submission transport, unchanged: `lib/jpk/jpk-submission-client.ts`
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

- `requires: ['ledger']` on `financial_pl`'s `ModuleInfo` —
  `packages/financial_pl/src/modules/financial_pl/index.ts` declares no
  `requires` today (confirmed by reading it directly); this is the
  module's first cross-module dependency, declared the same way AP
  declared its own GL dependency (`2026-09-06-accounts-payable.md`).
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
at creation time. **This document's `jpk-kr.generate` command shape,
`{ tenantId, organizationId, fiscalYear, celZlozenia }`, should follow
the same pattern**: drop `tenantId`/`organizationId` from what the
handler trusts (accepting-but-ignoring them, as `jpkFilingUpsertSchema`
does, is acceptable for schema compatibility; the point is the handler
must call `resolveCommandScope(ctx)` and use *that*, never
`parsed.tenantId`/`parsed.organizationId`, for every lookup, create,
and `ensureTenantScope`/`ensureOrganizationScope` call) — this closes
the gap the Edge Cases section below previously accepted as
unmitigated caller responsibility.

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
needs the equivalent entry (`financial_pl:jpk_kr_filing`, fields
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
summary node — six or eight amount fields (two independent sources
disagree on the exact count, `K_1`–`K_6` vs `K_1`–`K_8`; the raw XSD is
the tie-breaker, not attempted here), each a simple total (e.g.
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
*classification aid for the human filling in* `K_1`–`K_6`/`K_8` (which
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

New entity, `JpkKrFiling`, mirroring `JpkVatFiling`'s shape:

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `tenantId` / `organizationId` | uuid | standard scoping |
| `fiscalYear` | int | the reported year, not a period id — annual filing |
| `celZlozenia` | enum | initial / korekta (correction), matching JPK_V7's own field name |
| `status` | enum | **Corrected 2026-09-18** (see Architecture → Design decisions / Q5, now Confirmed against real `JpkVatFiling` code): `draft → generated → submitting → submitted`, not the original six-state guess. `JpkVatFiling`'s own declared type is `'draft' \| 'generated' \| 'submitted'`, but its real command code (`commands/jpk.ts`) also assigns a fourth, type-cast value `'submitting'` at runtime (`const JPK_SUBMITTING_STATUS = 'submitting' as JpkVatFiling['status']`) — the declared TS type is itself slightly behind the real runtime contract, worth noting rather than silently matching either one blindly. There is no separate `polling`/`accepted`/`rejected` state in the sibling: outcome is read off `submissionError` (`null` = last attempt clean, non-null = failed) and `submissionReference`/`updatedAt`, not extra enum values. `JpkKrFiling` should follow the same shape unless a real reason for `accepted`/`rejected` as their own states turns up (flag it if so; don't invent extra states preemptively as this document did) |
| `generatedXml` | text/blob, **encrypted at rest** (`financial_pl:jpk_kr_filing` in `encryption.ts`'s `defaultEncryptionMaps`, mirroring `financial_pl:jpk_vat_filing` — Confirmed 2026-09-18, see Architecture → Design decisions) | |
| `submissionReference` | string | |
| `upoXml` | text/blob, **encrypted at rest** (same map entry) | UPO (urzędowe poświadczenie odbioru) |
| `submissionError` | text, nullable | |

`JpkKrDeclarationInputs` (operator-entered `RPD` fields — corrected
2026-09-12, see Architecture → Primary-source XSD verification: `RPD`
is a small, flat set of summary amounts, not the open-ended
`rpdAdjustments` blob this document originally assumed; exact field
count (`K_1`–`K_6` vs `K_1`–`K_8`, sources disagree) still needs the
raw XSD, so the shape below is named but not yet locked):

| Field | Type | Notes |
|---|---|---|
| `filingId` | uuid, FK → `JpkKrFiling` | |
| `rpdRevenueExempt` … `rpdCostRecognizedPriorYear` | numeric(19,4), one column per `K_x` | Six-to-eight named amount columns, not a jsonb blob — operator-entered per Comarch's own precedent (manual, permanent, not a Phase 2 stopgap; see Design decisions) |

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
commands (mirroring JPK_V7):

- `jpk-kr.generate` — `{ tenantId, organizationId, fiscalYear, celZlozenia }`, but **`tenantId`/`organizationId` are accepted-but-ignored, not trusted (corrected 2026-09-18, see Architecture → Design decisions): the handler must derive scope via `resolveCommandScope(ctx)` from `ctx.auth`/`ctx.selectedOrganizationId`, exactly matching `commands/jpk.ts`'s real pattern, and use that derived scope for every lookup/create and for `ensureTenantScope`/`ensureOrganizationScope`** → resolves a `JpkKrFiling`, calls the builder chain, sets `status: draft → generated` (XML produced, not yet submitted — corrected to the real two-value naming, see Data Model).
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
  framework guardrail) at the `LedgerBulkReadService` layer itself —
  that part is unchanged; the bulk reads still trust whatever scope
  they're called with. **Corrected 2026-09-18, re-verified against
  real `official-modules` code:** the outer `jpk-kr.generate`/
  `.submit` commands are not similarly unmitigated, provided they
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
   `RPD` field count (`K_1`-`K_6` vs `K_1`-`K_8` -- two secondary
   sources disagree) and `S_12_1`'s exact allowed-value enumeration for
   the `ZOiS7` variant against the raw schema, not summaries of it.
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
- **Scope-derivation test (corrected 2026-09-18).** `jpk-kr.generate`/
  `.submit` ignore a payload `tenantId`/`organizationId` that
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
  already applies to `RPD`. Also unresolved: the exact `RPD` field count
  (`K_1`-`K_6` vs `K_1`-`K_8`) and `S_12_1`'s full allowed-value list for
  the `ZOiS7` variant -- both need the raw XSD, not the secondary
  documentation this pass used.
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
