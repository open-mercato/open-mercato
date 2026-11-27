# Bounded Work Inbox pagination

Status: Draft — design review required; implementation blocked
Issue: https://github.com/open-mercato/open-mercato/issues/8165
Extends: .ai/specs/2026-07-26-workflows-ux-redesign.md

## 📝 TLDR

Propose provider-owned, parameterized SQL key projections, a request-local ordered
union, and hydration of only the selected page. This retains the projection-first
Work Inbox without a persisted Task entity, migration, worker, dependency, or new
configuration. This draft changes no runtime behavior and does not fix #8165.

## Resolved assumptions (autonomous defaults)

| Decision | Proposed answer and reason | Approval |
|---|---|---|
| Q1: seek/rank capabilities or ordered shared model? | A **virtual ordered key model**, assembled from provider-owned queries in the existing PostgreSQL database. It bounds even transferred key rows independently of offset, without a synchronized persisted model. | ⚠ NEEDS HUMAN CONFIRMATION: architecture and public capability approval under root and core AGENTS.md. |
| Q2: old providers? | Keep their exported `list` API and registration shape, but never call an unsupported prefix provider from the bounded coordinator. Report it explicitly as degraded. No hidden prefix fallback. | ⚠ NEEDS HUMAN CONFIRMATION: changes legacy provider participation; choose a compliant compatibility transition before rollout. |
| Q3: hidden tasks and totals? | Preserve candidate totals, including diagnosable entity-hidden tasks. Return diagnostics for the requested candidate page, explicitly marked `scope: 'page'`. | ⚠ NEEDS HUMAN CONFIRMATION: diagnostic coverage narrows from the collected prefix to a page. |
| Q4: canonical order? | Priority, due date, oldest creation, id; add module/kind only after equal ids. Handle nulls explicitly and truncate timestamp precision to the existing millisecond wire precision. | ⚠ NEEDS HUMAN CONFIRMATION: corrects observable SQL/comparator drift; record client migration. |
| Scope cohesion | One change: bounded Work Inbox pagination. The optional provider adopts the same mechanism in a separately located enterprise addendum. | No generic Task, command-bus, configuration, or rate-limiter redesign. |

These are coherent proposals for review, not evidence of approval. Autonomous
operation does not waive protected-contract or architecture gates. No automerge.

## 📝 Overview

The core service remains `workInboxService`. The public provider contract actually
lives at `packages/core/src/modules/workflows/lib/work-inbox/provider.ts`, not in
`packages/shared`. It must stay there; shared must not acquire a core dependency.
Core knows only provider capabilities, never optional module tables or entities.
Optional-provider details are specified only in
[the enterprise addendum](enterprise/2026-11-22-agent-disposition-bounded-pagination.md).

## 📝 Problem Statement

Observed source at `c98419720f18d2456cc8b9a00e7c55073c3559d2`:

- `user-task-source.ts:listUserTaskWorkItems` requests `limit: offset + limit`,
  `offset: 0`; the optional source repeats this strategy.
- `service.ts:listWorkInbox` collects, serializes, sorts, and finally slices.
  Offset 100000 / limit 100 permits 100100 full records **per source**.
- Offset validation from #7534 bounds the maximum but leaves amplification.
  This is source-path evidence; no live load test has been run.
- `work-inbox-provider.test.ts` currently asserts prefix size 60 for offset 40,
  limit 20. It therefore characterizes the defect rather than refuting it.

Independent source offsets are incorrect: if source A contributes the first 30
items and B contributes the next 30, global offset 20 / limit 20 must include
A20–A29 and B0–B9. Asking both sources for local offset 20 misses B0–B9.

## 📝 Prior spec drift

The UX spec §2.3/§6.3 correctly specifies optional providers over existing records
and defers the generic Task entity. It does not design bounded global paging.
§6.2 and the OpenAPI description promise priority → due → age ordering; actual
source SQL uses due ASC / created DESC, omits priority and id, and only sorts the
returned prefix in memory. The existing comparator also returns `NaN` for two
absent due dates (`Infinity - Infinity`), preventing later tie-breaks from running.
The proposed order below restores the documented intent, but is an observable
correction, not a claim of byte-identical historical pages. No prior spec is
marked superseded while this proposal remains unapproved.

The related pending secure-user-task-access spec (2026-07-15, Actor Contract)
proposes an exactly-one-organization human actor. Current `WorkInboxScope` accepts
an organization array or null and uses the request visibility context. This
proposal preserves the actual Work Inbox scope contract; it does not silently
implement that separate actor/auth redesign or claim the older proposal shipped.

## 📝 Proposed Solution

Use an optional `bounded` capability on `WorkInboxSourceProvider`, keeping `list`
and every current required field/signature/import path. Each provider supplies a
**read-only key relation** and a **bounded hydrator**. The coordinator unions those
relations inside PostgreSQL, orders once, and applies the global offset/limit
before any full record is returned to Node.

Rejected alternatives:

- Prefix loading or streaming/discarding prefixes: full records processed still
  grow with offset even if peak heap drops.
- Per-source local offsets: incorrect for interleaved sources.
- Cursor-only API: useful later, but would remove random-access offset behavior.
- Rank/seek probes: viable for remote sources, but add iterative rank and snapshot
  protocols and transfer key probes with offset-dependent counts. Defer rather
  than pretending these are zero-cost full pages.
- Persisted generic Task or shared index: synchronization, backfill and lifecycle
  ownership exceed this issue and the current projection-only product decision.

PostgreSQL documents that OFFSET still computes skipped rows in the server and
that LIMIT requires a unique order. This proposal removes application record and
serialization amplification, **not** database scan/sort complexity. See
[PostgreSQL LIMIT/OFFSET](https://www.postgresql.org/docs/18/queries-limit.html),
[UNION ALL](https://www.postgresql.org/docs/18/queries-union.html), and
[transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html).
No benchmark or database index efficiency is asserted by this design.

## 📝 Architecture

### Proposed optional contract

The following shapes describe a **new** capability, not existing exports:

```ts
type WorkInboxKey = {
  id: string
  priorityRank: 0 | 1 | 2 | 3
  dueAt: string | null
  createdAt: string | null
}

type WorkInboxKeyRelation = {
  sql: string
  parameters: readonly unknown[]
}

type WorkInboxBoundedSource = {
  prepare: (query: WorkInboxQuery, context: WorkInboxSourceContext) => Promise<{
    keys: WorkInboxKeyRelation
    hydrate: (ids: readonly string[], context: WorkInboxSourceContext) => Promise<WorkInboxSourceResult>
  }>
}
```

Add only `bounded?: WorkInboxBoundedSource`. The concrete property names and
transport type require approval and an ORM compilation spike before being frozen.
`sql` is internal provider-authored SELECT text with `?` bindings, compiled from
an ORM query builder. It is not a request argument or an endpoint accepting SQL.
No literal interpolation of filters, scope, ids, priorities, or feature values.
The compiler adapter must correctly compose placeholders, including literal `?`
operators/strings; a string replacement binder is forbidden. If the installed ORM
cannot supply a composable parameterized fragment, use its existing typed query
builder representation and revise this shape before approval; do not invent a
new general SQL templating library. This is a pre-implementation proof obligation.

`prepare` builds a relation over exactly the provider's existing eligible records:
existing query filters, tenant/org floor, relationship policy, source admission,
soft-delete/runtime exclusions, and tenant opt-out behavior. No source-local
OFFSET, LIMIT, payload, title, form, bindings, or description in this relation.
The coordinator injects a trusted module/kind discriminator from the registry;
providers cannot impersonate each other through returned row columns. One key
per `(moduleId, kind, id)` is required; duplicate keys fail that source.

The source owns its table names and uses its existing where builder as the sole
filter definition. Core's source uses `buildUserTaskWorkInboxWhere`, including
`buildTaskVisibilityRequestConditions`; no duplicate permission rule or general
filter translator may be introduced. The spike must show the installed ORM can
compile this predicate unchanged into a key projection. The new coordinator
imports no optional module and never discovers providers by querying their tables.

### Request algorithm

1. Retain existing query parsing, limit ≤100 and offset ≤100000. Select sources
   with `selectWorkInboxSources(query, principal)` before invoking any source.
   Freeze that registry snapshot and `query.now` for the request.
2. Open a short, read-only repeatable-read transaction through the DI-resolved
   EntityManager. An invocation-specific context resolver returns this transaction's
   EM for `resolve('em')`, delegating other keys unchanged. All provider queries,
   counts and hydration must share it; no ambient/nontransactional connection.
3. Call each supported provider's `prepare`. Missing capability or preparation
   failure marks that source degraded without invoking legacy `list`.
4. In a savepoint per supported source, validate the key projection and compute
   an exact candidate count using aggregates only. Force evaluation of normalized
   sort expressions; counting a prunable subquery is not sufficient validation.
   Check key uniqueness using database aggregation. No candidate array is loaded.
   A source failure rolls back only its savepoint, reports that kind degraded,
   and discards its count. Classify shared connection/transaction failure as a
   request failure, never as success with an empty inbox.
5. Compose `UNION ALL` of healthy relations, prefixing the trusted discriminators.
   Apply the single canonical ORDER BY, OFFSET, LIMIT in the outer SELECT. The
   database returns at most L keys; it may scan/sort more internally. Count totals
   are separate aggregates so an empty page still returns the exact count.
6. Group selected ids by source and call each hydrator once with only those ids,
   the same scoped context and original query. Hydration must apply the same WHERE
   plus `id IN (...)`, use encryption-aware shared read helpers for full records,
   and run the existing `partitionTaskPage` for core tasks. It must never load all
   matching rows then filter ids in Node. Restore order from the chosen key list;
   do not trust an IN query's return order. `result.total` from hydration is ignored;
   only the successful aggregate count owns the total.
7. If hydration fails or violates its bound/identity contract, discard that source's
   rows/count/markers, mark it degraded, and reselect the same global page over
   remaining sources. Retain a monotonically growing excluded-source set; each
   source can be removed once, at most S+1 selection rounds. Do not return the
   original offset window with arbitrary holes after a source failure. Unknown
   SQL-union failures that cannot safely be attributed cause a request failure;
   no unsupported or failed source is queried through its prefix fallback.
8. Return surviving hydrated rows and current-page markers. Compute hasMore from
   `offset + selectedCandidateKeyCount < total`, not the shorter visible row count.
   The claim-next service consumes the same page; claim writes and compare-and-set
   behavior remain unchanged and outside the read-only transaction.

A shared transaction/snapshot is part of this proposed architecture, not a new
startup mode. Savepoint and ORM hydration behavior must be proved against the
installed MikroORM version before implementation readiness can be granted.

### Materialization budget and proof

Let S be admitted sources and L the normalized page size. Healthy operation
returns ≤L keys and loads ≤L full records across all sources. With attributable
hydration failures, ≤S+1 rounds return/load at most `(S+1) * L` keys/full records;
only scalar counts and health metadata are returned by source probes. Diagnostic
markers are derived only from these records; final response rows and markers each
have ≤L entries. No bound contains the requested offset. Provider adapters must
obey the bound internally; validating array length after fetching a prefix is not
a mitigation. Integration instrumentation must count rows **before projection,
partitioning, decryption and serialization**, not only HTTP response length.

The key relation is the union of each admitted source's matching candidates.
A total deterministic ORDER BY followed by one global slice therefore selects
exactly the requested candidate page. Hydration by selected ids cannot introduce
an earlier/later candidate. Counts and keys use one snapshot. Removing a failed
source and rerunning gives the exact page of the surviving source set, with an
explicit partial-result signal. These are design arguments, not tested results.

### Canonical key order

All ascending: priority ordinal (`extreme=0, high=1, medium/unset/unknown=2, low=3`),
due timestamp NULLS LAST, creation timestamp NULLS LAST, id, moduleId, kind. Creation
is oldest first. Normalize string priorities case-insensitively exactly as
`normalizeWorkInboxPriority`. Normalize absent/invalid dates to NULL rather than
subtracting infinities. Use millisecond timestamps matching existing ISO output.
Compare textual tie-breaks by deterministic UTF-8 bytes (`COLLATE "C"` in PostgreSQL
and Buffer comparison in server-only tests). Built-in UUID ids retain ordinary
lexical order. A provider emitting arbitrary Unicode ids must migrate from JS
UTF-16 ordering; test supplementary Unicode explicitly. Distinguish coincident
ids across source kinds; never deduplicate unrelated records via plain UNION.
Keep the exported comparator consistent, finite, antisymmetric and transitive.

## 📝 Data Models

No new persisted entity, table, column, migration, backfill, event subscription or
queue. The read-only relation exists only within one request. No metadata is
cached across tenants or requests. Do not move the provider contract into shared.

## 📝 API Contracts

Keep GET `/api/workflows/work-inbox`, POST `/api/workflows/work-inbox/next`, query
keys, accepted bounds, auth/features, row projection, `details` flattening, and
existing DI method signatures. Do not change legacy `/api/workflows/tasks` or its
diagnostics schema in this issue. `next` still uses existing guarded command and
conflict paths; no new write authorization or command-bus behavior.

Preserve `pagination.total` as the exact count of eligible candidates from healthy
sources, including entity-hidden candidates for a diagnosable caller, as documented
by `taskListDiagnosticsSchema`. Preserve `meta.kinds` and `meta.degradedKinds`;
exclude a failed/unsupported source from kinds and total. Add optional fields:

```ts
meta.sourceIssues?: Array<{
  moduleId: string
  kind: string
  code: 'bounded-pagination-unsupported' | 'source-failed'
}>
diagnostics.scope?: 'page'
diagnostics.candidateCount?: number
```

`sourceIssues` has one entry per excluded source, only registry identities and
fixed codes, no SQL, record ids or raw errors. `diagnostics` is still emitted only
when entity-hidden markers exist and the caller is entitled to diagnosis. Existing
`entityHidden` marker fields remain exactly id/reason/entityType; existing
`entityHiddenCount` remains the returned array length, **not** a claimed whole-queue
count. `scope: 'page'` explicitly narrows diagnostic coverage. candidateCount is
this page's number of keys, ≤L. Empty/all-hidden/final pages retain exact totals and
honest hasMore. No count cap is proposed; numbers outside safe integer range fail
rather than silently rounding. If deployments require capped totals later, that
requires a separately specified cap and explicit completeness fields.

Request errors retain current auth/scoping/pagination responses. System read
failures keep the route's existing error transport; source failure responses remain
HTTP 200 with degraded metadata. Any new messages must use locale keys. Extend only
the Work Inbox OpenAPI response schema for optional metadata. Error logging added
during implementation must also reportError under repository telemetry rules.

## 📝 UI/UX

No new rendered UI, provider/bootstrap scope, route bundle, or client boundary in
this design. Existing `backend/work-inbox/page.tsx` renders its partial-source state
from `degradedKinds`; retain it and test unsupported providers reach that state.
Existing table, actions, loading, empty and error behavior remain the reference.
The page currently consumes hidden-record diagnostics; audit its use before
rollout and describe the page-scoped meaning in release notes. Any required copy
or display addition must be separately authorized into scope with i18n, DataTable,
Notice and existing API helpers; no silent UI expansion in this backend change.

## 📝 Delta

### Capability: work-inbox

#### MODIFIED Requirement: Globally ordered candidate pagination
The system SHALL select one canonical candidate page before materializing records.

##### Scenario: Interleaved sources and a deep page
- WHEN two admitted sources interleave and offset is 100000 with limit 100
- THEN the candidate page equals a global canonical reference slice, and total
  materialized keys/full records obey the budget above independent of offset.

Frozen by: `packages/core/src/modules/workflows/lib/__tests__/work-inbox-provider.test.ts`

#### MODIFIED Requirement: Entity-hidden diagnostics
The system SHALL retain candidate totals and report only entitled current-page
entity refusals, explicitly identified as page-scoped diagnostics.

##### Scenario: Every selected candidate is hidden
- WHEN a view_all caller's selected page contains only entity-refused candidates
- THEN data is empty, diagnostics explain those page candidates without content,
  total includes eligible hidden candidates, and hasMore uses consumed keys.

Frozen by: `packages/core/src/modules/workflows/api/__tests__/work-inbox.route.test.ts`

#### ADDED Requirement: Unsupported provider disclosure
The system SHALL report unsupported/failed admitted providers explicitly without
executing their prefix list operation.

##### Scenario: An admitted legacy provider lacks the bounded capability
- WHEN that source is registered beside a healthy bounded provider
- THEN the healthy provider supplies an exact page of its source set and the
  response identifies the excluded source in degradedKinds/sourceIssues.

## 📝 Edge Cases & Failure Scenarios

- No registered/admitted sources: empty rows, total 0, no degraded false positive.
- Scope `organizationIds: []`: no keys/count/hydration leak; `null` retains existing
  unrestricted-org semantics inside the trusted tenant, never tenant wildcard.
- Non-admin entity refusal: existing SQL whitelist excludes it; no marker or count
  may disclose a row outside the caller's candidate scope. Diagnosable callers
  retain the predicate's refusal markers without task content.
- SQL/predicate disagreement: fail closed with the existing partitioning semantics;
  no unbounded backfill loop to make a short page look full.
- Offset beyond total: no hydration, exact totals and hasMore false. Equal ties
  cannot make page membership depend on registry registration order.
- Duplicate id in different kinds: retain both, use composite identity internally.
- Capability preparation, validation or hydration throws: isolate attributable
  source failure, recompute total/window, retain healthy source work.
- Database failure, lost snapshot or unknown union error: fail the request. Do not
  swallow it into a supposedly healthy empty queue; no automatic transaction retry.
- Claims/updates between requests: normal offset pagination can move across
  requests; one request's snapshot is coherent. Claim-next CAS remains authoritative.

## 📝 Migration & Backward Compatibility

Type shapes are additive, but **that does not make the entire behavior compatible**.
An opaque `list(query)` prefix provider cannot be generically adapted into an exact
arbitrary global page with bounded record loads. A truthful bridge must acknowledge
that limitation. No automatic approval of a security exception is asserted.

| Surface in BACKWARD_COMPATIBILITY.md | Assessment for proposed runtime work |
|---|---|
| §1 discovery | Unchanged; no new auto-discovered file. |
| §2 types | Optional bounded capability and optional metadata; existing required fields retained. |
| §3 signatures | `list` and service method arguments retained; comparator and coordinator semantics change and need approval. |
| §4 imports | Existing core provider path stays; no move to shared. |
| §5 events | Untouched. |
| §6 widget ids | Untouched; details/actions/renderer fields retained. |
| §7 HTTP | URLs/row fields retained; diagnostic scope and legacy provider participation change. Requires agreed transition, not merely optional-field labeling. |
| §8 database | No schema, index or migration change. |
| §9 DI | workInboxService key retained; bounded behavior requires architecture approval. |
| §10 ACL | IDs and wildcard-aware admission unchanged; no role/config edits. |
| §11 notifications | Untouched. |
| §12 AI IDs/mutation contract | Untouched. |
| §13 CLI | Untouched. |
| §14 generated contracts | Untouched; no generated files hand-edited. |
| startup/config/release | No startup/config/dependency changes proposed; architecture change means no automerge under this task's authorization. |

Before implementation, a maintainer must choose and approve the transition for
legacy source participation and diagnostic scope. Preferred sequence: publish the
optional capability and adapter guide; port built-in providers; maintain `list`
with `@deprecated` migration guidance for at least one minor version; switch the
coordinator only after an approved compatibility decision. Keeping exported `list`
alone does not bridge its participation in HTTP results. A normal compatibility
window that keeps invoking the vulnerable prefix path does not close #8165.
If an Emergency Security Exception is requested for retiring that behavior, its
eligibility and named human waiver must be explicitly recorded; an automated
review or generic permission to fix security issues is insufficient. If it does
not qualify, remain design-only until an approved bridge/versioning plan exists.

Before rollout integrate client/provider/operator guidance into UPGRADE_NOTES.md
and any required dated BC disclosure. This child must not edit those shared root
files; a proposed patch is supplied separately for the parent to integrate after
approval. Clients retain numeric candidate totals, consume partial-source metadata,
use server order, and must not treat diagnostic samples as a whole-queue inventory.
Provider authors add the bounded adapter and prove scoped hydration; operators
upgrade providers together. No DB migration or environment variable to set.

Rollback of this design-only PR is a document revert. A future runtime rollback
restores prefix amplification; do not describe it as safe mitigation. A runtime
release needs an agreed security rollback decision before deployment.

## 📝 Risks & Impact Review

| Failure | Severity / area | Mitigation and residual risk |
|---|---|---|
| Legacy providers disappear from the merged queue | High / compatibility | Explicit degraded metadata, adapter guide and human-approved transition before implementation; no universally compatible opaque-list adapter claimed. |
| Bad predicate compilation leaks ids/counts or loses work | High / security | Reuse original where builder, binding tests, predicate parity and cross-tenant fixtures; ORM composition spike required. |
| Key scan still expensive at deep offsets | High / database | Only narrow keys selected, existing offset ceiling retained, EXPLAIN/row counters before rollout; database CPU is not constant and generic rate limiting is out of scope. |
| One failed source poisons the shared transaction | High / availability | Per-source savepoints and monotonically excluded retries; unknown/system failures fail request. Prove installed-ORM savepoint behavior. |
| Nulls, timestamp precision or text collation reorder pages | High / correctness | One SQL/JS tuple policy plus ties/Unicode/property tests; migration explicitly acknowledged. |
| Diagnostics are mistaken for exhaustive inventory | Medium / operator UX | Keep count semantics, explicit page scope and release guidance; human approval required. |
| Nondeterministic provider ignores the read session | High / integration | Contract forbids it, database-backed snapshot and hydration tests; only transaction-capable providers supported in this version. |

## 🧪 Acceptance and integration coverage

These tests are **required future implementation work**, not present or passed in
this design-only PR. All fixtures must be owned by each test and cleaned in finally;
no demo proposals, fixed seeded task counts, LLM/network service or live credential.

| ID / scenario | Required oracle / location | Delivery |
|---|---|---|
| A1 interleaved sources | Seed disjoint providers, compare pages against a trusted total-order fixture at offset 0, interior and 100000; count full loads before serialize, ≤(S+1)L. Core provider/coordinator unit suite and database-backed integration. | Phase 2 |
| A2 canonical ties | Equal/null/invalid due dates, equal creation milliseconds, null priority vs medium, id collisions across kinds, reverse registry order, mixed case/accent/supplementary ids. SQL and JS outputs equal; comparator finite/transitive. | Phase 1/2 |
| A3 empty/final pages | Offset equal/beyond total, all-hidden page and no sources: exact count, no unwanted hydration, correct consumed-key hasMore. Route and coordinator suites. | Phase 2 |
| A4 hidden records | Entitled vs non-entitled principals, denied/unknown bound types, opt-out, stale entity whitelist and SQL/predicate divergence; no payload in markers; ≤L markers with page scope; total preserves candidate semantics. | Phase 1/2 |
| A5 isolation/admission | Two tenants/two orgs, [] and null org scope, wildcard grants, kind/module/query filters. Denied source prepare/count/hydrate never invoked. Assert no foreign id, marker or count contribution. | Phase 1/2 |
| A6 failures | Prepare/count/key-validation/hydrate failures; failed set grows once per source; healthy page recalculated; total excludes failed kinds. Shared DB failure is not empty success. Legacy list never called. | Phase 2 |
| A7 snapshot/budget | Instrument actual database rows returned and serializer calls at offsets 0/1/100000; repeat with a concurrent writer; aggregate probes return scalars. EXPLAIN records database scan limits separately. | Phase 1/2 |
| A8 optional absence | Run core-only registry/module-decoupling tests without optional package import; optional adapter tests live in enterprise. | Phase 2 |
| A9 route/claim consumer | Extend TC-WF-039/040: GET accepted offset ceiling and first rejected offset, POST next candidate ordering, no reads/claims on rejected offset, concurrent claim CAS preserved. | Phase 2 |
| A10 existing UI | Existing Work Inbox table row/action behavior and partial-source state; diagnostics remain content-free. Existing page suite plus self-contained Playwright fixtures. | Phase 2 |

Large database fixtures use test-local bulk insertion in a PostgreSQL integration
transaction after creating required users/definitions/instances through existing
fixture helpers. Do not add a production seeding/debug endpoint or apply migrations
locally. Count the hydrated records in a test-only adapter seam. Scope fixtures by
unique workflowInstanceId/tenant/provider set rather than global inbox totals.
Read actual setup and cleanup handlers before copying helpers; see the fixture
cleanup lesson. Preserve existing tests as characterization before changing them.

## 📋 Phasing

| Phase | Dependencies | Observable exit |
|---|---|---|
| 0 — design approval | This draft + staff readiness audit | Named architecture/contract decision and legacy/diagnostic migration decision; status Accepted; no unresolved ⚠. |
| 1 — prove optional contract | Phase 0 | Installed ORM composes scoped key relations/parameters, counts and savepoints on the same snapshot; additive adapter tests pass; existing coordinator still works. |
| 2 — switch and verify | Phase 1 + approved compatibility transition | Both built-in adapters and coordinator ship together; A1–A10, configured gate and integration tests pass; release guidance integrated. Only this phase may claim #8165 fixed. |

## 📋 Implementation Plan

1. Obtain Phase 0 approvals; attach the exact approved contract and compatibility
   decision. Do not start implementation on this draft or silently waive a gate.
2. Characterize current ordering, prefix loads, hidden-candidate counts, diagnostic
   prefix scope, failures and claim-next in existing unit/route tests. Commit the
   passing characterization separately; no behavioral change yet.
3. Prove parameterized predicate compilation, transaction-affine execution,
   savepoints and count/key ordering in a database-backed integration spike. If
   impossible without new deps/config/architecture, return to design review.
4. Add optional bounded types beside the existing contract, plus built-in adapters
   in their owning modules. Keep the old service until the approved cutover;
   add @deprecated guidance only as agreed. Run compatibility/type tests.
5. Switch the coordinator and Work Inbox-only metadata/hasMore handling atomically,
   maintain guards and consumer signatures, and replace characterization oracles
   with A1–A10. No changes to shared command auth or unrelated modules.
6. Run configured validation in order using the repository's selected runner:
   build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage,
   typecheck, test, build:app; run the scoped integration suites as well. Record
   exact final-head failures/skips and do not claim they pass based on old heads.
7. Integrate approved release-notes/BC text, conduct independent review and required
   API/UI QA, and record the materialization counters and SQL EXPLAIN evidence.
8. Archive the accepted Delta into `.ai/specs/capabilities/work-inbox.md` only on
   the implementation PR, subject to that task's file ownership. Leave this draft
   in pending specs; never mark it implemented merely because a design PR merged.

## Final Compliance Report

Architecture and public capability approval remain missing. The legacy participation
and diagnostic coverage transition is not approved; the design is **no-go for
implementation**. No production files, schema, startup/configuration, generated
files, root governance or sibling command-auth helpers are changed by this PR.
Scope-cohesion review by a fresh agent was not run because this task explicitly
forbids further subtasks. The author audit is not independent approval. Full runtime
regressions and SQL spike evidence are future gates, not inferred passes.

## Changelog

- 2026-11-22: Drafted the virtual-key pagination proposal for #8165 after confirming
  the prefix defect at c98419720f; documented approval blockers and test obligations.
