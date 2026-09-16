# General Ledger — Bulk Cross-Module Read Service

Status: draft, not yet reviewed. Tracking issue number to be assigned
(no GitHub issue exists for this yet — do not cite a number for it until
one is filed).

## TLDR

**Key Points:**

- Adds one new, narrow capability to the `ledger` module: a DI-resolvable
  service another backend module can call **in-process** to bulk-read
  `JournalEntry`/`JournalEntryLine`/`LedgerAccount`/`LedgerAccountGroup`
  data for a tenant/organization — not through HTTP, not through
  `commandBus`. Ships as `ledger` Phase 3 (#6013 was Phase 2), not a new
  module, and not a Phase 3 addition *to #6013's document* — see
  Alternatives considered for why that placement was rejected.
- **Why design this now, when the parent spec just declined to.** GL
  core's own 2026-09-10 Changelog entry named this gap but deliberately
  didn't design it, on the same "no real consumer yet" logic already
  applied to `soft_closed` period status and Bilans/P&L. That logic
  still holds for JPK_KR_PD's *specific* field mappings (`Dziennik`'s
  exact structure needs the real JPK_KR_PD XSD, not yet verified at
  primary-source level). It does not hold the same way for *this*
  generic read contract: every method here is derived from read
  capabilities that already exist and are already fully specified
  (#5663's journal entries, #6013's trial balance) — nothing here is
  guessed ahead of an unwritten consumer's requirements, only assembled
  from requirements that already shipped. That distinction is the
  reason this is being written now and JPK_KR_PD's own spec isn't.
- Named as a gap in `2026-08-18-general-ledger-core-engine.md`'s Out of
  scope (2026-09-10, "A bulk, cross-module read/export path for
  `JournalEntry`/`JournalEntryLine`"), surfaced by researching how
  JPK_KR_PD (Poland's electronic-accounting-books filing) would work
  from the `financial-pl` official module's side. This document is that
  gap, designed.
- No new entities, no migration. Every method is a thin wrapper over
  logic that already exists: `getZois` delegates directly to #6013's
  `getAccountBalance`/`getTrialBalance` (already standalone functions
  under `queries/`, confirmed by reading #6013 directly — not
  reimplemented here); the journal/line iterators wrap the same
  query logic `listJournalEntries` (#5663) already uses.
- **This is a new kind of contract for this codebase, not an extension
  of an existing one.** Every existing cross-module call is a write,
  through `commandBus` (`ledger.postJournalEntry`, called by AP). Nothing
  today is a cross-module *read*. This document proposes the first one —
  flagged explicitly because it's a precedent other future modules will
  also reach for, not a one-off.

**Scope:**

- `iterateJournalEntries` / `iterateJournalEntryLines` — cursor-paginated,
  posted-only, ordered by `sequenceNumber`, explicit `tenantId`/
  `organizationId` arguments (not inferred from request context — see
  Design decisions).
- `getZois` — thin wrapper over #6013's existing trial-balance
  computation; same numbers the ZSiO REST endpoint returns, for the
  same inputs.
- `listAccounts` / `listAccountGroups` — full snapshot (chart of
  accounts doesn't grow the way a journal does; no pagination needed).
- Registered in `ledger`'s `di.ts` under a named token, resolved by any
  module that declares `requires: ['ledger']`.

**Concerns:**

- **A real consumer is now confirmed, its spec is not written yet.**
  Update (2026-09-10): JPK_KR_PD is a confirmed target for
  `financial-pl` — this is no longer a hypothetical future consumer,
  Commerce Weavers has decided to build it. `SPEC-010` itself (in
  `official-modules`) still doesn't exist — the primary-source JPK_KR_PD
  XSD verification it needs hasn't happened yet — so this document
  stays deliberately scoped generically (five named methods, not a
  JPK_KR_PD-shaped API) rather than guessing field-level requirements
  ahead of that verification. Every field/method here should still be
  re-checked against `SPEC-010`'s actual requirements once it's written,
  but "will this get used" is no longer the open question — "will this
  shape survive contact with the real requirements" is.
- **Cross-repo contract stability.** Once `financial_pl` (in
  `official-modules`) depends on this service's shape, changing that
  shape is a breaking change across two separate git repositories, not
  a same-PR fix. No versioning/deprecation mechanism is proposed here —
  flagged in Out of scope as a real, deferred question.
- **Volume/streaming design is an assumption, not a verified
  requirement.** Cursor pagination is chosen on its own terms, not by
  precedent: `iterateJournalEntries`/`iterateJournalEntryLines`
  return an `AsyncIterable` for a backend job pulling a full fiscal
  year in one logical pass — a different consumption shape than an
  HTTP route rendered by `DataTable`, where a bounded `page`/
  `pageSize` response is what the UI can render at all. **Correction
  (2026-09-14):** an earlier version of this bullet cited `#6013`'s
  `api/reports/trial-balance/route.ts` cursor pagination as this
  choice's precedent; #6013's own PR review response (2026-09-14)
  switched that route to `page`/`pageSize` (its `DataTable` has no
  cursor/keyset support to drive), so that precedent no longer
  exists anywhere in this module. This document's own cursor choice
  is unaffected — it never actually needed #6013 as precedent, since
  the two solve different consumption shapes — but the citation was
  wrong and is corrected here rather than left standing. No real
  customer's actual journal volume has been checked either way. If
  real volumes turn out small, a simpler non-paginated read might
  have been enough; if huge, cursor pagination alone might not be.
- Whether `listJournalEntries`'s underlying query is already a
  standalone, importable function (like #6013's `getAccountBalance`) or
  currently inlined in `api/journal-entries/route.ts` was **not
  confirmed** while drafting this document — #6013's file manifest shows
  the pattern explicitly (`queries/getAccountBalance.ts`), #5663's does
  not show the same explicitness for `listJournalEntries`. Treated as an
  open implementation-time check, not assumed either way (see
  Implementation Plan, step 1).

## Overview

Every read path `ledger` exposes today is shaped for a person looking at
a screen: `GET /api/ledger/journal-entries` is a paginated list for a
`DataTable`; #6013's `GET /api/ledger/accounts/:id/balance` and
`GET /api/ledger/reports/trial-balance` answer one account or one report
at a time. `2026-09-06-accounts-payable.md` already established the one
cross-module contract this engine has — a **write**, through
`commandBus` (`ledger.postJournalEntry`) — but nothing lets another
module **read** this engine's data in bulk, in-process, the way a
year-end regulatory filing needs to.

That gap surfaced concretely (not hypothetically) while analyzing how
`financial-pl` — a real, existing official module (KSeF e-invoicing,
JPK_V7 VAT declarations) — would need to extend to support JPK_KR_PD,
Poland's electronic-accounting-books filing (mandatory in phases from
2026, per the Ministry of Finance's own JPK_KR_PD brochure and
`gov.pl/kas`). JPK_KR_PD's `Dziennik` and `KontoZapis` nodes are,
respectively, the journal and the postings — there is no way to build
them without reading `ledger`'s data in bulk, and its `ZOiS` node is the
same computation #6013 already built for a different audience (a human
looking at a trial-balance report). This document designs the read
surface that gap needs, generically enough that JPK_KR_PD is its first
consumer, not its only intended one.

## Problem Statement

Three things are true today:

1. `AP`'s existing dependency on `ledger` (`requires: ['ledger']`) is a
   write-side contract only — one command call per invoice, through
   `commandBus`. It says nothing about how a module would read GL data.
2. #6013's REST routes are real, tested, correct — and built for a
   browser tab open to one report, not for a backend job that needs a
   full fiscal year's journal and every account's trial balance in one
   pass.
3. There is no DI-resolvable service, query bus, or any other
   in-process mechanism a module can call to get GL data without going
   through HTTP against its own monolith — checked directly against
   both the GL core engine spec and #6013, neither defines one.

A module that needs bulk GL data today has exactly two bad options:
issue paginated HTTP calls to its own backend from inside the same
process (workable, but the wrong tool — real network/auth overhead for
an in-process call), or query `ledger`'s tables directly from outside
the module (breaks the FK-only coupling convention AP already
established, and re-implements balance logic GL already owns).

## Proposed Solution

A single new service, registered by `ledger` in its own DI container,
exposing five read-only methods. Every method takes `tenantId`/
`organizationId` as required, explicit arguments — not inferred from an
HTTP request's auth context, because a caller here may not be inside an
HTTP request at all (a background worker generating an annual filing,
for instance, the same shape `financial_pl`'s own
`workers/ksef-batch-send.worker.ts` already runs as).

```ts
export interface LedgerBulkReadService {
  iterateJournalEntries(params: {
    tenantId: string
    organizationId: string
    dateRange: { from: Date; to: Date }
    cursor?: string
    limit?: number
  }): AsyncIterable<JournalEntryDto>

  iterateJournalEntryLines(params: {
    tenantId: string
    organizationId: string
    dateRange: { from: Date; to: Date }
    cursor?: string
    limit?: number
  }): AsyncIterable<JournalEntryLineDto>

  getZois(params: {
    tenantId: string
    organizationId: string
    periodId: string
  }): Promise<ZoisRow[]>

  listAccounts(params: {
    tenantId: string
    organizationId: string
  }): Promise<LedgerAccountDto[]>

  listAccountGroups(params: {
    tenantId: string
    organizationId: string
  }): Promise<LedgerAccountGroupDto[]>
}
```

`getZois` calls #6013's existing `getTrialBalance`/`getAccountBalance`
functions directly — it does not recompute anything. `iterateJournalEntries`/
`iterateJournalEntryLines` wrap the same underlying query
`listJournalEntries` already runs, adding cursor semantics if that
query doesn't already expose them for a full-range (not just one page a
UI would render) pull.

Because posted `JournalEntry`/`JournalEntryLine` rows are immutable
(established invariant, GL core engine spec's Invariants section), a
bulk read over a closed fiscal period needs no snapshot or consistency
mechanism beyond an ordinary read at call time — the data cannot change
under the caller.

### Design decisions

**Why a DI-resolved service, not `commandBus`.** `commandBus` commands
are built with undo semantics available to them — the shared
`@open-mercato/shared/lib/commands/undo` helper (`extractUndoPayload`)
is real infrastructure, observed in use in `financial_pl`'s own
`commands/jpk.ts` (`official-modules`, not this repo) — even though
neither the AP nor the GL core spec walks through undo mechanics for
`postJournalEntry` specifically; that citation is to the framework
capability, not to AP's documented behavior. A read has no undo/audit
trail to record — forcing it through `commandBus` would mean carrying
machinery built for writes on an operation that has nothing to undo. A
plain DI-resolved service is the right shape for a query; `commandBus`
stays exclusively for commands.

**Why not internal HTTP calls to the existing REST routes.** Technically
possible (call `fetch('/api/ledger/journal-entries')` from inside the
same process) but pays real cost for no benefit in a monolith: an extra
HTTP round trip, and re-deriving `tenantId`/`organizationId` from a
constructed request instead of just passing them as arguments.

**Why explicit `tenantId`/`organizationId` arguments, not context-inferred.**
Every existing GL read path (the REST routes) pulls tenant/org scope
from the authenticated request. This service has no request — its
callers include background workers with no HTTP context at all. Scoping
becomes the caller's explicit responsibility, which is a real shift
worth naming: a caller that passes the wrong `tenantId` gets that
tenant's data, with no framework-level guardrail catching the mistake
the way request-derived scoping does today. Mitigated only by review,
not by the type system — flagged, not solved, here.

**Why cursor pagination, not a single bulk array.**
`iterateJournalEntries`/`iterateJournalEntryLines` return an
`AsyncIterable` for a backend job pulling an unbounded number of rows
in one logical pull (a full fiscal year's journal) — cursor-based
iteration is the standard shape for exactly that, independent of
what any HTTP route in this module does. **Correction (2026-09-14):**
this decision previously cited "the same precedent #6013 already
established for `GET /api/ledger/reports/trial-balance`"; #6013 has
since switched that route to `page`/`pageSize` (Concerns), so no
such precedent exists in this module anymore. The choice here stands
on its own regardless — it was never actually the same problem
#6013's `DataTable`-rendered page was solving. Untested against real
volumes (see Concerns) — proposed on the shape of the consumption,
not on measurement.

## Literature & Prior Art

Per the project's financial-spec-writing-process — applied here even
though this document is primarily an infrastructure/service-design
decision, not an accounting pattern, because the process runs uniformly
across the spec family, and because it surfaced a real, useful finding
anyway. Verification trail recorded in full in
`financial-module-knowledge-base.md` §3.

**Cross-spec consistency (Step 1).** Both of this document's own
external citations were re-verified directly against the sibling specs,
not accepted from memory: `2026-08-18-general-ledger-core-engine.md`'s
Invariants confirm "a posted entry is immutable... Reversing one means
posting a new `JournalEntry`" — exactly the property this document's
snapshot-free bulk-read design leans on — and its Out of scope entry
("A bulk, cross-module read/export path for `JournalEntry`/
`JournalEntryLine`... shaped for a person through a UI") is quoted
correctly. #6013's "Scoped to ZSiO only, not Bilans/P&L/Cash Flow" and
its File Manifest's cursor-pagination precedent for the trial-balance
route both checked out exactly as cited, as of this verification pass
(2026-09-12) — worth naming as a positive finding, not a formality:
this was the first spec in the family whose own citations required
zero corrections on independent re-verification. **Update
(2026-09-14):** the second citation has since gone stale, not
wrong-at-the-time — #6013's own PR review response switched
`trial-balance` from cursor to `page`/`pageSize` pagination the same
day (its `DataTable` has no cursor/keyset support), so the File
Manifest text this paragraph verified against no longer reads that
way. Corrected in Concerns and Design decisions above; "zero
corrections needed" above describes this document's citations as of
2026-09-12, not as of today.

**Literature grounding (Step 2) — a genuine, near-total absence.**
Searched Hay's *Data Model Patterns* and Fowler's *Analysis Patterns*
full text for ledger/posting/audit-trail material relevant to this
document's central claim (posted rows are immutable, so a bulk read
needs no snapshot mechanism). Hay mentions "ledger" only twice, in
unrelated contexts, and "posting" not once, across 361 pages. Fowler's
immutability discussion (pp. 3908–3916, 11301–11306) is about
identifier/currency value objects, not ledger postings. Kieso's closest
material — Reversing Entries and Correcting Entries — describes fixing
mistakes with a new, later entry rather than editing the original,
consistent with this document's assumption but exercise-level textbook
content, not a dedicated treatment of posting immutability as a system
property. Recorded honestly: the underlying claim is sound (and
independently confirmed against #5663's own Invariants above), but none
of the three books has a citation-worthy passage for it.

**Comparison against real systems (Step 3).** Checked whether
comparable systems have an equivalent bulk, cross-module, DI-resolved
read contract for compliance filings, or solve it differently:

- **ERPNext/Frappe** (docs.frappe.io Script Report reference, verified
  2026-09-12): every report — compliance reports included — implements
  its own query directly inside the report's Python file
  (`frappe.db.get_all` / `frappe.db.sql`), with **no shared bulk-read
  service layer between modules at all**. This is functionally the
  "direct cross-schema queries from the consumer module" alternative
  this document itself rejects (see Alternatives considered) — Frappe
  accepts that cost for simplicity; this document explicitly won't, to
  preserve the FK-only coupling convention.
- **Odoo** (odoo-master.readthedocs.io ORM API reference, verified
  2026-09-12): confirmed the opposite architecture — any module can call
  `self.env['any.model.name'].search(...)` directly on any other
  module's model (the documented example queries `res.partner` this
  way), with no per-module service or DI layer in between at all. Odoo
  doesn't need a document like this one because its ORM registry itself
  *is* the universal cross-module read API; Open Mercato's deliberate
  module-isolation convention (FK IDs only, no direct cross-schema
  queries) is exactly what makes a bespoke service like this necessary
  here — a real, load-bearing architectural difference between the two
  systems, not an oversight in either.
- GnuCash and Apache Fineract were not re-checked this pass (Fineract's
  REST/reporting layer in particular may be a closer analog, being a
  true client-server platform rather than a single-process monolith or
  desktop app) — flagged as not yet done, not silently skipped.

This confirms the document's central design bet (a formal, named,
DI-resolved bulk-read contract) is a deliberate trade of upfront design
cost for enforced module isolation — a real choice Open Mercato is
making differently from both reference systems checked, not a default
neither considered.

**Structure (Step 4).** Checked against `om-spec-writing`'s mandatory
sections (TLDR & Overview, Problem Statement, Proposed Solution,
Phasing, Implementation Plan) — all present. User Stories / Invariants /
API Contracts are correctly *omitted*, not missing: this document adds
no entity, no route, no UI, so none of those sections would carry real
content — exactly the "cut the noise" heuristic the skill itself calls
for, not a compliance gap.

**Update (2026-09-16) — Phase 2 changes this.** The paragraph above
describes this document as it stood through Phase 1: a pure,
unreachable-over-HTTP DI service. Phase 2 (below) adds exactly the
surface that paragraph said didn't exist — an API route, a backend
page, and an ACL feature — because a second, independent need
(compliance/audit data egress, surfaced by the 2026-09-05 Event
Storming recording, not by JPK_KR_PD) turned out to need a
human-facing delivery path, not just an in-process read contract. The
Phase 1 statement was accurate for Phase 1; it is superseded, not
retracted, by what follows.

**Phase 2 — Compliance & Audit: cross-spec consistency (Step 1).**
Re-checked against `financial-module-knowledge-base.md` §2 before
designing anything new. The relevant precedent is #6013's own Phase 2:
it added `ledger.reports.view` (a `.view`-only feature, no `.manage`
counterpart — "this capability has no mutation surface") directly to
`ledger`'s existing `acl.ts`/`setup.ts`, plus new API routes and a new
backend page, all inside the already-shipped `ledger` module rather
than a new one. This document follows the same shape: a new
`ledger.audit.export` feature (again `.view`-only in spirit — an
export is a read, not a mutation), added the same way. Checked
directly against `2026-09-06-posting-rules-engine.md` too, since Tax
Management was initially proposed as living there — that document's
entire scope is the zespół 4 → zespół 5 cost reclassification through
account 490; nothing in it touches payments, exports, or auditor
access, confirming (independently of this document) that Compliance &
Audit and Tax Management are two unrelated concerns that only ever
shared a sentence in an early, informal 6-topic list, not a real
architectural relationship.

**Phase 2 — Literature grounding (Step 2).** Searched Fowler's
*Analysis Patterns* and Hay's *Data Model Patterns* full text for
"audit" (this pass, 2026-09-16, not superseding the 2026-09-12 pass
above, which searched for immutability/posting material specifically).
Hay: zero hits for "audit" anywhere in 361 pages — a genuine absence,
consistent with the 2026-09-12 finding for "ledger"/"posting". Fowler:
three relevant hits, all supporting this document's existing
immutability claim rather than introducing a new one — §6.2
("Transactions... add a further degree of auditability by linking
entries together", p.95) and §6.5.2 ("I prefer keeping transactions
because they make auditing easier for a small price in overhead. If
you don't use transactions, you will still need some audit
mechanism.", p.106) both ground, in a primary source, the claim this
document already leans on for its snapshot-free design: that Open
Mercato's balanced, immutable `JournalEntry`/`JournalEntryLine` model
already **is** the audit mechanism Fowler describes needing — Phase 2
only needs to add a way to get that data *out*, not to build a
change-log or versioning layer on top of it. (A third Fowler hit,
§3.9's "Observations cannot be deleted if a full audit trail is
needed", p.34, is from an unrelated medical-records chapter and is
noted only for completeness, not cited as grounding.) Kieso's
Sarbanes-Oxley/internal-controls material (Ch.1) is regulatory history
for US public companies attesting to internal-control effectiveness —
real, but not a data-export or system-design requirement, and not
obviously applicable to a Polish SME anyway (statutory audit
thresholds and requirements for this project's actual market sit in
Ustawa o rachunkowości art. 64–65, not in US securities law) —
recorded as Unverified-for-this-context rather than force-cited.

**Phase 2 — Comparison against real systems (Step 3): a genuine,
useful divergence, not a gap.** Checked whether ERPNext and Odoo have
an equivalent "give the auditor the data" feature (2026-09-16,
WebSearch/WebFetch against docs.frappe.io and third-party
documentation, since neither product's own docs site was directly
crawlable for this specific feature). Both ship something literally
called "Audit Trail" — and both turn out to be **a change-log of edits
to amendable documents** (field-level diffs, who/when, up to N
historical versions), not a bulk data-export path for an external
auditor: ERPNext's tracks "values for the fields changed across
different versions" of submittable doctypes; Odoo's records "the time,
what was altered, and who made the modification" on journal entries
and invoices. **This is a real, explainable divergence, not something
Open Mercato is missing:** ERPNext and Odoo need a change-log because
their journal entries can be edited/amended after posting; Open
Mercato's GL core engine (#5663) already forecloses that by design —
a posted `JournalEntry` cannot be edited, only reversed via a new
entry (Invariants) — so there is nothing to log a change *to*. The
actual gap this document's Event-Storming source names ("eksport do
XML/CSV/Excel/PDF oraz pełna, niezmienna historia zapisów") is
squarely about data egress from an already-immutable ledger, not
about adding change-tracking Open Mercato's data model doesn't need.
GnuCash was not re-checked this pass (already recorded, prior
session, as having no audit-trail feature at all —
single-entity-designed tool); Apache Fineract remains not yet checked
(same open lead as the 2026-09-12 pass above).

## Architecture

### New files

- `packages/ledger/src/modules/ledger/services/bulk-read-service.ts` —
  the five methods above, each delegating to existing query logic.
- `packages/ledger/src/modules/ledger/di.ts` — register the service
  under a named token (e.g. `ledgerBulkReadService`) resolvable via
  `container.resolve('ledgerBulkReadService')` by any module declaring
  `requires: ['ledger']`.

No new entities, no migration, no API route, no backend page, no ACL
feature — this surface isn't reachable over HTTP, so it has no route to
gate. Scoping is entirely the caller's responsibility (see Design
decisions); this document does not propose a new ACL mechanism for
in-process DI calls, since none exists anywhere else in this codebase
for the same kind of call (the `commandBus` write path has none either
— `AP`'s `postJournalEntry` call carries no separate ACL check beyond
what `postJournalEntry` itself enforces).

### Phase 2 — Compliance & Audit: export & read-only access

Adds exactly one new surface: an HTTP export endpoint plus the ACL
feature and backend page needed to reach it, following #6013's own
Phase 2 shape (a `.view`-only feature added to an already-shipped
module's existing `acl.ts`/`setup.ts`, not a new module). No new query
logic — Phase 2 is a thin serialization layer over the Phase 1 service
above:

- `packages/ledger/src/modules/ledger/acl.ts` /`setup.ts` — register
  `ledger.audit.export`, a `.view`-only feature with no `.manage`
  counterpart (an export is a read, not a mutation — same reasoning
  #6013 used for `ledger.reports.view`).
- `packages/ledger/src/modules/ledger/api/audit/export/route.ts` — the
  export endpoint (see API Contracts, below), gated by
  `ledger.audit.export`, delegating internally to the Phase 1 service's
  `iterateJournalEntries`/`iterateJournalEntryLines`/`listAccounts`/
  `listAccountGroups` for every row it serializes.
- A single backend "Audit Export" page (period picker, format picker,
  download button), gated the same way.

Unlike Phase 1's DI callers, which self-declare `tenantId`/
`organizationId` as explicit arguments (Design decisions, above), the
Phase 2 route derives both from session/request context the way every
other API route in this codebase does — an HTTP caller doesn't get to
assert its own scope the way an in-process DI caller does, which
closes rather than widens the isolation risk Phase 1's Risks section
already flags for the DI surface (see Risks, below).

## Data Models

None. Reads existing `JournalEntry`, `JournalEntryLine`, `LedgerAccount`,
`LedgerAccountGroup` rows exactly as defined in the GL core engine spec
and #6013 — no new columns, no new tables.

Phase 2 adds no new tables either. Every export is synchronous and
bounded to a single `periodId` — the same period-bounded contract
`getZois`/`getTrialBalance` already use — and serializes rows already
returned by Phase 1's iterators and dictionary methods. There is no
export-job entity, no queued or background state, and no new
persisted artifact: the response is a generated CSV/XML/XLSX/PDF byte
stream, not a stored file the system needs to reason about later. A
future need for unbounded (multi-period, whole-tenant) or scheduled
export is out of scope (see below) and would need a job entity if and
when it actually arrives — not designed speculatively now, matching
this document's reduced-scope mandate from the 2026-09-05 Event
Storming recording.

## API Contracts

Phase 1 has none (Architecture, above) — this section exists only for
Phase 2.

### `GET /api/ledger/audit/export`

Query parameters: `format` (`csv` | `xml` | `xlsx` | `pdf`, required),
`periodId` (required — bounds every export to one accounting period,
same as `getTrialBalance`). `organizationId`/`tenantId` are derived
from session/request context, not caller-supplied — unlike the Phase 1
DI service's caller-scoped arguments, this route is reached over HTTP
and uses this codebase's normal request-scoped auth (see Architecture,
Phase 2). Response: the generated file in the requested format,
produced by serializing rows pulled from Phase 1's
`iterateJournalEntries`/`iterateJournalEntryLines`/`listAccounts`/
`listAccountGroups` — no new query logic, only serialization. Requires
`ledger.audit.export`. The openapi entry follows the same pattern as
#6013's `trial-balance` route.

### `GET /api/ledger/audit/export/formats`

Trivial metadata endpoint returning the supported format list and any
per-format limits (e.g. a row cap on `pdf`, the format least suited to
large tabular dumps) — lets the backend page render available options
without hardcoding them client-side.

## Testing Strategy

- `iterateJournalEntries`/`iterateJournalEntryLines` respect `dateRange`,
  `cursor`, `limit`, and both scope parameters — a query for tenant A
  never returns tenant B's rows, checked directly (not just implied by
  existing GL test coverage).
- `getZois` returns byte-identical figures to
  `GET /api/ledger/reports/trial-balance` for the same
  `periodId`/`organizationId`/`tenantId` — a regression guard against
  the two access paths silently drifting apart over time.
- Only posted entries are ever returned — no draft/buffer state, matching
  every other GL read path.
- `listAccounts`/`listAccountGroups` each get their own tenant-isolation
  assertion too, not just the generic DI-resolution smoke test below —
  tenant A's call never returns tenant B's chart of accounts or account
  groups, checked the same explicit way as the journal iterators, not
  left to the "each method gets called once" smoke test to cover by
  implication.
- A stub consumer module (test-only, declaring `requires: ['ledger']`)
  resolves the service via DI and calls each method — proves the
  registration/resolution mechanism actually works cross-module, not
  just that the functions are individually correct.

**Phase 2:**

- `GET /api/ledger/audit/export` tenant isolation: a caller
  authenticated for tenant A can never receive tenant B's rows in any
  format — checked the same explicit way as Phase 1's iterator tests,
  not left to the ACL check alone to prove it.
- `ledger.audit.export` gating: a session without the feature gets a
  403, mirroring #6013's `ledger.reports.view` test pattern.
- Each of the four formats (csv/xml/xlsx/pdf) round-trips the same
  underlying rows as the equivalent Phase 1 iterator call for a fixed
  `periodId` fixture — a parsed csv/xml/xlsx must match value-for-value
  what `iterateJournalEntries` returns for that period (pdf, which
  doesn't parse back cleanly, gets a row-count/page-count assertion
  instead) — guarding against the export layer silently drifting from
  the read layer it wraps.
- A `periodId` outside the caller's tenant/org, or omitted, is rejected
  with a 400 before any row is read — the same "no default scope"
  discipline Phase 1's Risks section already requires of the DI
  methods, applied here at the HTTP boundary instead.

## Risks

### Data integrity failures

Not applicable — read-only, no write path exists here.

### Cascading failures & side effects

A caller pulling a full fiscal year of journal data in one un-paginated
call could hold a long-running query open — mitigated for
`iterateJournalEntries`/`iterateJournalEntryLines` by cursor pagination
being the only shape offered for those two methods. A consumer that
ignores the cursor and loops without bound is a caller-side bug this
service can't prevent, same as any paginated API. `listAccounts`/
`listAccountGroups` are the one deliberate exception to "no 'give me
everything' method" — unpaginated by design, on the assumption that a
tenant's chart of accounts and account-group dictionary are bounded,
small, human-curated sets, nothing like journal volume. If that
assumption turns out wrong for some tenant, these two would need
pagination added later — a breaking change to their signature, which is
exactly the cross-repo contract-stability risk named in Concerns.

### Tenant & data isolation

The single largest risk this document introduces (see Design decisions):
scoping is caller-supplied, not context-derived. Every method requires
both `tenantId` and `organizationId` as non-optional arguments — there
is no "current tenant" default to accidentally fall back to — but a
caller that passes the wrong values gets that tenant's data with no
framework check catching it. Recommend integration tests specifically
target this (a stub consumer resolving the service with intentionally
mismatched scope, asserting empty/rejected results) before this ships.

### Compliance & Audit export (Phase 2)

The genuine risk Phase 2 adds isn't a new one — it's Phase 1's own
"caller-scoped, no framework default" isolation risk, moved to an HTTP
boundary where it's actually more contained: unlike Phase 1's DI
callers (any in-process module resolving the service, self-declaring
scope), Phase 2's route handler derives `tenantId`/`organizationId`
from session context the normal way every other API route in this
codebase does, closing the "wrong caller-supplied scope" failure mode
Phase 1's Tenant & data isolation risk flags for the DI surface. What
Phase 2 does add: `pdf` generation for a large `periodId` (a full
fiscal year, many thousands of lines) could be slow or memory-heavy
synchronously — mitigated by treating `pdf` as the format most likely
to need a row cap (API Contracts, above), not by adding async/queued
export machinery, which this document's reduced scope (per the
2026-09-05 Event Storming recording: "minimum to możliwość
eksportu... brak jednego uniwersalnego standardu") explicitly doesn't
ask for.

### Migration & deployment

None — no schema change, no data migration, additive-only DI
registration.

## Alternatives considered

**Append this as Phase 3 to `2026-09-09-general-ledger-account-balances.md`
(#6013).** Rejected. `getZois` genuinely is "the same computation, a new
access path" and would fit there — but `iterateJournalEntries`/
`iterateJournalEntryLines`/`listAccounts`/`listAccountGroups` read
`JournalEntry`, `JournalEntryLine`, and `LedgerAccount` directly, which
are the core engine's own entities (#5663's scope), not #6013's
balance/ZSiO scope. Folding all five methods into #6013 would stretch
that document past what it says it covers — #6013 itself is explicit
about staying "Scoped to ZSiO only, not Bilans/P&L/Cash Flow" (quoted
verbatim from #6013's own Concerns section, confirmed by reading that
file directly on `docs/general-ledger-account-balances` this session —
#6013 is not among the files this document can be cross-checked against
elsewhere, so this citation is called out explicitly rather than left
looking like an assumption). A new, small document that can cite both
#5663 and #6013 as sources is more honest about what it actually is: a
cross-cutting service over both.

**Direct cross-schema `EntityManager` queries from the consumer
module.** Rejected. Breaks the FK-only coupling convention AP already
established for its GL dependency, and would re-implement (or
re-import in an unsupported way) balance logic GL already owns and
tests.

**Route this through `commandBus` as a read-only "command."** Rejected
— see Design decisions; a read has no undo/audit semantics to carry.

## Out of scope

- **JPK_KR_PD itself.** This document is the dependency, not the
  feature — see the (not yet written) `SPEC-010` in `official-modules`.
- **Book/tax reconciliation (`RPD` in JPK_KR_PD terms).** Nothing in
  `ledger` tracks book-vs-tax differences on accounts or postings;
  building that is independently sized work, not a read-service
  concern.
- **Contract versioning/deprecation policy.** A real question once a
  second consumer exists or the shape needs to change — not designed
  here; flagged as a genuine gap, not silently ignored.
- **Any query shape beyond the five named methods.** No generic
  ad-hoc query builder is proposed — a future consumer needing
  something these five don't cover extends this service explicitly
  (a new named method), not a generic escape hatch.
- **A universal audit-export standard.** The 2026-09-05 Event Storming
  recording itself names this as unsolved industry-wide ("Brak jednego,
  uniwersalnego standardu eksportu pod audyt w branży") — Phase 2 ships
  four common formats (XML/CSV/Excel/PDF), not an attempt to define or
  adopt a standard that doesn't exist.
- **A change-log / amendment-history feature (an ERPNext/Odoo-style
  "Audit Trail").** Checked directly against both (Literature & Prior
  Art, Phase 2) — both track edits to amendable documents, which has
  no equivalent need here: Open Mercato's `JournalEntry` rows are
  immutable once posted (#5663 Invariants), so there is nothing to log
  a change to. Building one anyway would solve a problem this
  codebase's own data model already forecloses.
- **Scheduled or recurring export.** Every export in this document is
  a synchronous, on-demand HTTP call — no cron, no subscription, no
  delivery mechanism (email/SFTP/etc.) for a periodically-regenerated
  export. A real ask once an actual auditor workflow needs it, not
  designed speculatively now.
- **Multi-period or whole-tenant export in one call.** Every export is
  bounded to one `periodId`, matching `getZois`/`getTrialBalance`'s
  existing period-bounded contract (Data Models, above) — a caller
  needing a full year makes one call per period, same as any other
  period-scoped report in this codebase today.

## Implementation Plan

1. Confirm whether `listJournalEntries`'s underlying query is already a
   standalone function (per #6013's `queries/` pattern) or inlined in
   `api/journal-entries/route.ts`. If inlined, extract it first — a
   small, low-risk refactor, not a redesign, and a prerequisite for step 2.
2. Implement `services/bulk-read-service.ts`: `iterateJournalEntries`/
   `iterateJournalEntryLines` (cursor-paginated, wrapping step 1's
   query), `getZois` (delegating to #6013's `getAccountBalance`/
   `getTrialBalance`), `listAccounts`/`listAccountGroups`.
3. Register the service in `di.ts` under a named, documented token.
4. Add the test coverage in Testing Strategy, including the
   tenant-isolation-specific cases called out in Risks.
5. Document the token and method signatures somewhere a future
   `official-modules` contributor can actually find them without
   reading this spec file directly (e.g. a short note in `ledger`'s own
   `AGENTS.md` or module README, if this repo's convention supports
   that) — a cross-repo contract that only exists in a `.ai/specs/`
   markdown file is easy to miss.

**Phase 2:**

6. Add `ledger.audit.export` to `ledger`'s `acl.ts`/`setup.ts`,
   following #6013's `ledger.reports.view` precedent exactly
   (view-only feature, no `.manage` counterpart).
7. Implement `GET /api/ledger/audit/export` and
   `GET /api/ledger/audit/export/formats`, each delegating to the
   Phase 1 service (steps 2-3, above) for rows and adding only
   serialization (csv/xml/xlsx/pdf) on top.
8. Add the backend "Audit Export" page (period picker, format picker,
   download button), gated by `ledger.audit.export`.
9. Add the Phase 2 test coverage from Testing Strategy, including the
   per-format round-trip and route-level tenant-isolation cases.
10. Record the Fowler §6.2/§6.5.2 grounding, the Hay absence, and the
    ERPNext/Odoo audit-trail divergence finding in
    `financial-module-knowledge-base.md` §3, per Step 5 of the
    financial-spec-writing-process.

## File Manifest

| File | Action | Notes |
|---|---|---|
| `services/bulk-read-service.ts` | Create | Four methods, all read-only, all delegating to existing query logic |
| `di.ts` | Modify | Register the new service under a named token |
| `queries/listJournalEntries.ts` | Create or Modify | Extract from the route handler if not already standalone (Implementation Plan step 1) |
| `__integration__/bulk-read-service.spec.ts` | Create | Cross-module resolution + tenant-isolation coverage |
| `acl.ts` / `setup.ts` | Modify | Phase 2 — register `ledger.audit.export`, following #6013's `ledger.reports.view` pattern |
| `api/ledger/audit/export/route.ts` | Create | Phase 2 — serializes Phase 1 service output to csv/xml/xlsx/pdf |
| `api/ledger/audit/export/formats/route.ts` | Create | Phase 2 — supported-format metadata |
| Backend "Audit Export" page | Create | Phase 2 — period/format picker, gated by `ledger.audit.export` |
| `__integration__/audit-export.spec.ts` | Create | Phase 2 — per-format round-trip + route-level tenant-isolation coverage |

## Final Compliance Report

Not yet reviewed — this is a first draft. Most `AGENTS.md` compliance
rows that apply to API routes, entities, or migrations are **not
applicable** here (no route, no entity, no migration is added), which
is itself worth stating explicitly rather than leaving the Compliance
Matrix looking incomplete. What does apply: tenant/org isolation
discipline (addressed above, but not yet code-reviewed), and the
`.ai/specs/AGENTS.md` requirement to keep cross-references accurate —
this document cites #5663, #6013, and the GL core engine's 2026-09-10
Out of scope addition; all three were checked directly while drafting,
not from memory.

## Changelog

### 2026-09-10

- Initial specification. Written in direct response to the gap named
  in `2026-08-18-general-ledger-core-engine.md`'s Out of scope
  ("A bulk, cross-module read/export path for `JournalEntry`/
  `JournalEntryLine`", 2026-09-10) and to the 2026-09-10 `financial-pl`
  JPK_KR_PD analysis that surfaced it. Not yet reviewed; no
  implementation exists yet.

### 2026-09-10 (cont. — JPK_KR_PD confirmed as a real target)

Internal decision, not a document change on its own: JPK_KR_PD is now a
confirmed target for `financial-pl` (Commerce Weavers needs it). This
document's design doesn't change — it was already scoped generically
rather than guessing JPK_KR_PD's field-level requirements, since the
primary-source XSD verification `SPEC-010` needs still hasn't happened.
What changes is the framing in Concerns, above: this is no longer a
speculative future consumer.

### 2026-09-12 — Literature & Prior Art applied

Per the financial-spec-writing-process: re-verified both this
document's own citations (#5663 Invariants + Out of scope, #6013
Concerns + File Manifest) directly against the source specs — zero
corrections needed. Searched Hay and Fowler for ledger/posting
immutability material and found a genuine, near-total absence (recorded
honestly rather than forced). Compared against ERPNext/Frappe (no
shared bulk-read service — each report queries directly) and Odoo (the
opposite extreme — any module queries any other module's ORM model
directly via `self.env`, no service layer at all): this document's
formal DI-resolved contract is a deliberate middle path neither
reference system takes, trading design cost for enforced module
isolation. Findings recorded in full in
`financial-module-knowledge-base.md` §3.

### 2026-09-14 — corrected a citation invalidated by #6013's own review response

Not a design change. #6013's PR review response (2026-09-14) switched
`GET /api/ledger/reports/trial-balance` from cursor pagination to
`page`/`pageSize` (its `DataTable` has no cursor/keyset support to
drive — checked directly against `packages/ui/src/backend/
DataTable.tsx`). This document's Concerns and Design decisions both
cited that route's now-removed cursor pagination as the precedent for
this document's own `iterateJournalEntries`/`iterateJournalEntryLines`
cursor choice — a citation that checked out exactly as written on
2026-09-12 (Literature & Prior Art) and went stale two days later, not
one that was wrong when made. Corrected both passages to justify
cursor pagination on its own terms (an `AsyncIterable` backend pull is
a different consumption shape than a `DataTable`-rendered page,
regardless of what pagination scheme any single HTTP route uses) and
flagged the Literature & Prior Art re-verification as accurate only
as of its own date. This document's actual design — cursor-paginated
`AsyncIterable` methods, `getZois` delegating to #6013's
`getTrialBalance`/`getAccountBalance` — is unchanged; only the
citation supporting one design decision needed fixing.

### 2026-09-16 — Phase 2 added: Compliance & Audit (export & read-only access)

Per the confirmed direction to treat Tax Management and Compliance &
Audit as two separate, individually-researched extensions rather than
one bundle: added Compliance & Audit to this document as "Phase 2"
rather than a new standalone spec, following the same precedent #6013
itself used for its own Phase 2 (`ledger.reports.view` added directly
to an already-shipped module). This supersedes, for the parts of this
document Phase 2 touches, the 2026-09-10 "no API route, no backend
page, no ACL feature" framing — that framing was correct for what
existed at the time (Phase 1) and remains correct for Phase 1 itself;
Phase 2 is additive, not a retraction.

Research performed before writing Phase 2 (per
financial-spec-writing-process):

- **Step 1 (cross-spec consistency):** re-checked
  `financial-module-knowledge-base.md` §2 and #6013's own Phase 2
  addition as the direct precedent for adding a `.view`-only ACL
  feature to an already-shipped module. Separately, read
  `2026-09-06-posting-rules-engine.md` in full (1453 lines) to confirm
  it has zero relation to Compliance & Audit or Tax Management (its
  entire scope is zespół 4→5 reclassification via account 490) —
  correcting an earlier informal "Tax Management → Posting Rules
  Engine" pairing that this reading showed was a mismatch, unrelated
  to the Phase 2 work landing in this document.
- **Step 2 (literature):** searched Fowler's *Analysis Patterns* and
  Hay's *Data Model Patterns* for "audit" specifically (a fresh pass,
  distinct from the 2026-09-12 immutability/posting search above).
  Hay: zero hits in 361 pages. Fowler: §6.2 (p.95) and §6.5.2 (p.106)
  both support the claim that this document's existing immutable,
  linked-entry design already constitutes the audit mechanism Fowler
  describes needing — Phase 2 only needed to add data egress, not a
  change-log.
- **Step 3 (real systems):** confirmed ERPNext's and Odoo's "Audit
  Trail" features are both change-logs of edits to amendable
  documents, not bulk-export paths — a genuine, explainable divergence
  given Open Mercato's `JournalEntry` is immutable-by-design (#5663
  Invariants), not a gap to close by imitating them.

Findings recorded in `financial-module-knowledge-base.md` §3.
