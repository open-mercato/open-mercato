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
  requirement.** Cursor pagination is proposed on the precedent of
  `#6013`'s own File Manifest, which lists
  `api/reports/trial-balance/route.ts` with "cursor pagination"
  explicitly named (confirmed by reading that file directly on
  `docs/general-ledger-account-balances` this session, not from
  GL core's spec — GL core's own paginated routes, e.g.
  `journal-entries`, use `page`/`pageSize` instead, so this precedent
  comes specifically from #6013, not from the module generally). No
  real customer's actual journal volume has been checked. If real
  volumes turn out small, a simpler non-paginated read might have been
  enough; if huge, cursor pagination alone might not be.
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

**Why cursor pagination, not a single bulk array.** Same precedent
#6013 already established for `GET /api/ledger/reports/trial-balance`.
Untested against real volumes (see Concerns) — proposed on precedent,
not measurement.

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

## Data Models

None. Reads existing `JournalEntry`, `JournalEntryLine`, `LedgerAccount`,
`LedgerAccountGroup` rows exactly as defined in the GL core engine spec
and #6013 — no new columns, no new tables.

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

## File Manifest

| File | Action | Notes |
|---|---|---|
| `services/bulk-read-service.ts` | Create | Four methods, all read-only, all delegating to existing query logic |
| `di.ts` | Modify | Register the new service under a named token |
| `queries/listJournalEntries.ts` | Create or Modify | Extract from the route handler if not already standalone (Implementation Plan step 1) |
| `__integration__/bulk-read-service.spec.ts` | Create | Cross-module resolution + tenant-isolation coverage |

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
