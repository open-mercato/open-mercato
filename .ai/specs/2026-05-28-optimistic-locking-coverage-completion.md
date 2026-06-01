# SPEC — Optimistic Locking Coverage Completion

**Scope:** OSS
**Status:** Draft
**Tracking issue:** [#2191](https://github.com/open-mercato/open-mercato/issues/2191)
**Related spec:** `.ai/specs/2026-05-25-oss-optimistic-locking.md`

---

## TLDR

Complete optimistic-locking coverage across Open Mercato edit/delete flows.
The core guard already protects `makeCrudRoute` mutations when the client
sends the expected `updated_at` header, but many custom UI handlers and
non-CRUD command endpoints still do not send or enforce a version token.

This spec turns the remaining work into phased, testable coverage:

- Build an authoritative coverage matrix for CRUD routes, UI forms, table
  deletes, nested subresources, and non-CRUD command/action endpoints.
- Wire missing UI edit/delete paths to `CrudForm` `optimisticLockUpdatedAt`
  or explicit `buildOptimisticLockHeader` / scoped request headers.
- Define explicit exclusions for commands that cannot be represented by a
  single row version token.
- Add regression tests and an audit check so future raw mutations do not
  bypass optimistic locking accidentally.

---

## Overview

The initial OSS optimistic-locking implementation added a generic
`updated_at` comparison guard for CRUD mutations and a shared client contract.
That gives the platform the right foundation, but it does not automatically
protect every write path. User-facing coverage depends on each edit/delete
flow passing the expected record version to the server.

Open Mercato has several write surfaces:

- Standard `CrudForm` pages.
- Table row actions using `updateCrud`, `deleteCrud`, or `apiCall`.
- Nested resource panels on detail pages, such as product prices, sales
  document lines, shipments, adjustments, customer deals, and activities.
- Non-CRUD command endpoints, such as sales document transitions and workflow
  execution actions.

This follow-up spec defines how to finish the coverage without changing the
core contract or introducing a new version column.

## Problem Statement

The current implementation can be misunderstood as "all entities are
protected." More precisely:

- Server-side guard support is available for `makeCrudRoute` entities when the
  client sends the optimistic-lock header.
- Missing header means the guard skips, by design, for backward compatibility.
- Non-`makeCrudRoute` endpoints are outside the generic guard unless they
  explicitly enforce their own version check.
- Bulk operations cannot safely use a single `updated_at` token for multiple
  rows.

As a result, concurrent edits can still silently overwrite each other in
custom handlers and nested panels even though the base guard exists.

## Proposed Solution

Finish optimistic-locking coverage in four layers:

1. **Inventory** every backend write route and frontend write call.
2. **Wire** every single-record CRUD edit/delete UI path to send an expected
   `updatedAt` token.
3. **Classify** non-CRUD and bulk writes as either protected by an explicit
   command-level version check or intentionally excluded with documented
   rationale.
4. **Enforce** future coverage with focused tests plus an audit script for
   raw backend UI mutations.

No new database schema is required. Existing `updated_at` remains the version
token. The `OM_OPTIMISTIC_LOCK` environment contract from the related spec
remains unchanged.

## Coverage Model

### Supported After This Spec

| Write surface | Required behavior |
|---|---|
| `CrudForm` single-record update/delete | Pass `optimisticLockUpdatedAt` from the loaded record. |
| Custom single-record `updateCrud` / `deleteCrud` | Wrap the request with `buildOptimisticLockHeader(record.updatedAt)` and `withScopedApiRequestHeaders(...)`. |
| Custom mutating `apiCall` for one existing record | Send the optimistic-lock extension header from the record being edited/deleted. |
| Nested single-record panels | Preserve each child row's own `updatedAt` and send it with the child update/delete request. |
| Server `makeCrudRoute` mutation | Compare expected header to current `updated_at`, return structured 409 on mismatch. |

### Explicitly Classified

| Write surface | Policy |
|---|---|
| Bulk update/delete | Do not use a single header. Either pass per-row expected versions in a typed payload or mark the operation excluded. |
| Command/action endpoints | Require command-specific concurrency design when the command edits existing state based on current values. |
| Imports, sync jobs, background processors | Usually excluded from UI optimistic locking; they need idempotency and job-level conflict handling instead. |
| Preferences, dashboard widgets, sidebar state | Exclude unless they overwrite business data. |
| Create operations | Exclude; no previous row version exists. |

## Initial Gap Inventory

The implementation phase must verify this list with code search before
editing, but the known gaps are:

| Area | Known missing or incomplete coverage |
|---|---|
| Auth | User list delete uses raw `apiCall DELETE` without an optimistic header. |
| Feature toggles | Global toggle table delete uses raw `deleteCrud` without a header. |
| Customers | Company v2 custom update/delete, deal deletes, pipeline changes, associations, closure flows, and deal detail side effects. |
| Catalog | Product nested offers, unit conversions, option schemas, variant deletes, and variant price update/delete flows. |
| Sales | Channel list delete, channel offer price rows, document lines, document adjustments, shipments, document action/detail flows, status settings, adjustment-kind settings. |
| Staff | Team list delete and activity/comment adapter updates/deletes. |
| Resources | Activity/comment adapter updates/deletes. |
| Dictionaries | Dictionary entry/settings mutations that bypass `CrudForm` token wiring. |
| Workflows | Definition edit form is covered; workflow execution/action endpoints need explicit classification. |
| Entities | Entity-definition deletes and custom entity admin mutations need classification because they may not be `makeCrudRoute` business records. |
| Data sync / imports | Usually excluded; document the concurrency model instead of forcing row headers. |

## Architecture

### Client Contract

Shared UI write helpers should converge on one helper shape:

```ts
const headers = buildOptimisticLockHeader(record.updatedAt);

await withScopedApiRequestHeaders(headers, () =>
  updateCrud(resourcePath, record.id, payload),
);
```

For `CrudForm`, call sites should pass the loaded record's `updatedAt` through
`optimisticLockUpdatedAt` unless the form implementation already derives it
from values in that path.

Nested tables must keep `updatedAt` in row state. If a panel currently strips
server metadata before storing child rows, it must retain `updatedAt` for
mutation only.

### Server Contract

`makeCrudRoute` remains the default enforcement point. Non-CRUD commands that
edit existing records based on current state must choose one of:

- Accept an expected version token in the command payload or extension header
  and compare inside the command transaction.
- Use an existing stronger lock/transaction mechanism.
- Document why stale-write protection is not applicable.

The generalist primitive for the first option is
`enforceCommandOptimisticLock({ resourceKind, resourceId, current, expected?, request? })`
from `@open-mercato/shared/lib/crud/optimistic-lock-command` (#2055 Phase 16).
A command handler calls it after loading the target record (usually the
aggregate root) and before mutating; it reads the expected version from the
explicit `expected` override or the request header, compares against `current`,
and throws `CrudHttpError(409, OptimisticLockConflictBody)` on mismatch. It is
strictly additive (no expected token → no-op) and honors `OM_OPTIMISTIC_LOCK`.
Sales wraps it as `enforceSalesDocumentOptimisticLock(ctx, document, resourceKind)`
in `commands/shared.ts`.

### Regression Audit

Add an audit command or test that scans backend UI code for mutating calls:

- `updateCrud(...)`
- `deleteCrud(...)`
- `apiCall(..., { method: 'PUT' | 'PATCH' | 'DELETE' })`

Every match must either:

- be inside `withScopedApiRequestHeaders(buildOptimisticLockHeader(...))`,
- be a create-only or non-business-data mutation,
- use `CrudForm` with `optimisticLockUpdatedAt`, or
- carry a local exclusion comment matched by the audit.

## Data Models

No new entities, columns, or migrations.

Existing `updated_at` / `updatedAt` remains the canonical version token.

For UI row types, add `updatedAt?: string | Date | null` where missing so row
actions can send the token. These are client type additions only.

## API Contracts

### Existing Optimistic-Lock Header

```http
x-om-ext-optimistic-lock-expected-updated-at: 2026-05-25T08:42:18.123Z
```

### Existing Conflict Response

```json
{
  "error": "record_modified",
  "code": "optimistic_lock_conflict",
  "currentUpdatedAt": "2026-05-25T08:42:18.500Z",
  "expectedUpdatedAt": "2026-05-25T08:42:18.123Z"
}
```

### Bulk Operations

Bulk operations must not reuse the single-record header. If protected in this
spec's implementation, they must use an explicit payload shape such as:

```json
{
  "items": [
    { "id": "uuid-1", "expectedUpdatedAt": "2026-05-25T08:42:18.123Z" },
    { "id": "uuid-2", "expectedUpdatedAt": "2026-05-25T08:42:20.999Z" }
  ]
}
```

The exact payload is endpoint-specific and must be covered by endpoint tests.

## Phasing

### Phase 1: Coverage Inventory And Spec Reconciliation

1. Generate a checked-in coverage matrix under `.ai/analysis/` or update this
   spec with the verified list of write paths.
2. Reconcile the related optimistic-locking spec:
   - default ON wording,
   - "server support" vs "UI coverage",
   - integration test status,
   - explicit exclusions.
3. Record every excluded endpoint with rationale.

### Phase 2: Standard CRUD Forms And Table Deletes

1. Wire missing `CrudForm` edit pages with `optimisticLockUpdatedAt`.
2. Wire single-record table deletes that call `deleteCrud` or mutating
   `apiCall`.
3. Add focused tests for at least auth users, feature toggles, customers, and
   catalog table actions.

### Phase 3: Nested Panels And Subresources

1. Wire catalog nested resources: offers, prices, unit conversions, option
   schemas, and variant child rows.
2. Wire sales nested resources: document lines, adjustments, shipments, channel
   offer prices, status dictionaries, and adjustment kinds.
3. Wire customer deals and detail side effects where they overwrite existing
   records.
4. Wire staff/resources activity adapters.
5. Add tests that prove stale child-row edits produce 409 and do not overwrite.

### Phase 4: Command And Bulk Classification

1. Review non-CRUD action endpoints in sales, workflows, entities, imports, and
   data sync.
2. Add command-level expected-version checks where the command overwrites
   current business state based on stale user input.
3. Exclude jobs/preferences/actions where optimistic locking is not the right
   mechanism, and document the alternative integrity control.
4. Define or defer per-row version payloads for bulk operations.

### Phase 5: Regression Guardrails

1. Add an audit test/script for raw mutating backend UI calls.
2. Add developer documentation for how to wire non-`CrudForm` mutations.
3. Add a checklist item to the related spec or Task Router guidance.
4. Run the focused optimistic-locking tests plus the smallest relevant package
   checks.

## Testing Strategy

- Unit tests for `buildOptimisticLockHeader` and conflict parsing remain in the
  existing spec's scope.
- Add UI tests around custom handlers to assert the header is sent.
- Add API tests for stale single-record updates/deletes on representative
  modules:
  - `auth.user`
  - `catalog.product`
  - `catalog.price`
  - `customers.company`
  - `customers.deal`
  - `sales.document`
  - `staff.team`
  - `resources.resource`
  - `workflows.definition`
- Add one negative test proving missing header remains backward-compatible.
- Add one audit test proving new raw mutations require either lock wiring or an
  explicit exclusion.

## Risks & Impact Review

#### False Sense Of Platform-Wide Coverage

- **Scenario**: Developers assume `makeCrudRoute` support means every UI write
  path is protected, but custom handlers omit the header.
- **Severity**: High
- **Affected area**: All backend UI modules with custom edit/delete handlers
- **Mitigation**: Coverage matrix, audit test, and explicit exclusions.
- **Residual risk**: Some custom command endpoints may still require domain
  review because a generic row version is not always the right model.

#### Over-Constraining Command Endpoints

- **Scenario**: A workflow or sales action fails with 409 even though the action
  is already protected by a stronger domain transaction.
- **Severity**: Medium
- **Affected area**: Sales, workflows, imports, data sync
- **Mitigation**: Phase 4 classifies commands before adding checks.
- **Residual risk**: Endpoint-specific judgment remains necessary.

#### Bulk Operation Ambiguity

- **Scenario**: A bulk delete sends one expected timestamp for many records and
  lets stale rows slip through.
- **Severity**: High
- **Affected area**: Any bulk UI or API mutation
- **Mitigation**: Ban single-header bulk protection; require per-row versions or
  explicit exclusion.
- **Residual risk**: Existing bulk operations remain excluded until redesigned.

#### User Friction From More 409s

- **Scenario**: More flows start surfacing conflict messages after proper
  header wiring.
- **Severity**: Medium
- **Affected area**: Backend users editing shared records
- **Mitigation**: Use the existing explainable conflict copy and refresh/retry
  flow.
- **Residual risk**: Merge UX remains a future enterprise/premium enhancement.

## Final Compliance Report — 2026-05-28

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `.ai/skills/spec-writing/SKILL.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root `AGENTS.md` | Check existing specs before modifying modules | Compliant | Reviewed `.ai/specs/2026-05-25-oss-optimistic-locking.md`. |
| `.ai/specs/AGENTS.md` | New specs use `{date}-{title}.md` | Compliant | This spec uses `2026-05-28-optimistic-locking-coverage-completion.md`. |
| root `AGENTS.md` | Preserve behavior unless explicitly changed | Compliant | This spec proposes phased future work only; no runtime changes in this PR step. |
| root `AGENTS.md` | Keep changes minimal and focused | Compliant | Adds a follow-up spec and tracking issue. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No schema changes; uses existing `updated_at`. |
| API contracts match UI/UX section | Pass | UI wiring sends the existing optimistic-lock header. |
| Risks cover all write operations | Pass | CRUD, nested, command, bulk, and excluded writes are covered. |
| Commands defined for all mutations | Pass with follow-up | This spec requires Phase 4 command classification before command-level implementation. |
| Cache strategy covers all read APIs | Not applicable | No caching changes. |

### Non-Compliant Items

None for this spec draft.

### Verdict

Approved as a phased follow-up draft for implementation planning.

## Implementation Status

| Write surface | Status | Where |
|---|---|---|
| `customers.company` update | Done | CrudForm `optimisticLockUpdatedAt` (companies-v2 `[id]/page.tsx`) |
| `customers.company` delete | Done (QA #2055) | custom `handleDelete` wraps `deleteCrud` with the lock header |
| `customers.person` update | Done | CrudForm `optimisticLockUpdatedAt` (people-v2 `[id]/page.tsx`) |
| `customers.person` delete | Done (QA #2055) | custom `handleFormDelete` wraps `deleteCrud` with the lock header |
| `customers.deal` update + delete | Done (QA #2055) | `useDealFormHandlers` wraps `updateCrud`/`deleteCrud` with the lock header |
| `catalog.product` update | Done | CrudForm `optimisticLockUpdatedAt` |
| `sales.channel` list delete | Done (QA #2055) | channels list `handleDelete` wraps `deleteCrud`; 409 → conflict flash + refresh |
| `sales.order` / `sales.quote` lines + adjustments (upsert + delete) | **Done (#2055 Phase 17)** | command-level document-aggregate check via `enforceSalesDocumentOptimisticLock` in the command handlers; the `makeSalesLineRoute` `{ body }` wrapping nulls the factory `candidateId` so the row-level guard is skipped and the command check is the sole guard |
| `sales.return` create | **Done (#2055 Phase 17)** | command-level document-aggregate check against the parent order |
| Quote → order conversion (`sales.quotes.convert_to_order`) | **Done (#2055 Phase 17)** | command-level check on the quote version; closes the accept/convert race (#2114). Client `handleConvert` sends the version header (Phase 18) |
| `sales.payment` / `sales.shipment` create/update/delete | **Done — row-level** | these routes use a flat `mapInput` with a top-level `id`, so the `makeCrudRoute` row-level guard fires; the client now sends each child row's **own** `updatedAt` header (NOT the document aggregate). Decision: payments/shipments are standalone rows with their own `updated_at`, so a document-aggregate command check there would conflict with the single header — they stay row-level by design (`35fbd4d30`, `c8ba97b00`, `917003e34`) |
| Sales document UI sections (lines/adjustments/returns) sending the version header | **Done (#2055 resume)** | client now sends the **document-aggregate** `updated_at` header from the detail page's sub-section editors; server-guarded by `enforceSalesDocumentOptimisticLock`. The totals-refresh flow re-fetches `record.updatedAt` after each sub-resource mutation, so no false-409 cascades. 409s surface via the unified conflict bar (`35fbd4d30`, `c8ba97b00`, `917003e34`) |
| `catalog.product-variant` delete | **Done (#2055 resume)** | variant delete routes the 409 to the unified conflict bar (`35fbd4d30`, `c8ba97b00`, `917003e34`) |
| Unified record-conflict bar (all forms) | **Done (#2055 resume)** | persistent error-styled bar in `AppShell` (`@open-mercato/ui/backend/conflicts`); `CrudForm` + `useGuardedMutation` route 409s automatically, custom pages call `surfaceRecordConflict(err, t, opts)`. Replaces the transient flash/toast (`f2a23716c`) |
| Command-level enterprise seam | **Done (#2055 resume)** | `createCommandOptimisticLockGuardService({ resolveExpected? })` — DI-overridable mirror of the CRUD `crudMutationGuardService` override; OSS default = header compare. Enterprise plugs a `record_locks`-backed resolver without touching command handlers. Tracked in #2232 (`42e1feffd`) |
| Nested panels (deal associations/pipeline/closure, channel offer prices) | **Deferred** | Phase 3 surface — large; not in the #2055 increment |

Two enforcement layers now exist:

1. **CRUD row-level** — entity-agnostic in `makeCrudRoute`
   (`runMutationGuards` with `operation: 'update' | 'delete'`), proven by
   `TC-LOCK-OSS-004` (PUT + DELETE 409). Every CRUD route auto-registers a
   generic reader (Phase 13), so any single-record edit/delete UI path gains
   protection simply by sending the row's `updated_at` header. Fires only when
   the route exposes a top-level `id` to the factory (`candidateId`).

2. **Command-level document-aggregate** — `enforceCommandOptimisticLock`
   (`@open-mercato/shared/lib/crud/optimistic-lock-command`, #2055 Phase 16)
   lets any Command-pattern handler compare a client-sent expected `updated_at`
   against an arbitrary record (typically the aggregate root) and throw the
   identical structured 409. Sales sub-resource commands use it to guard the
   parent order/quote — the consistency boundary — because those commands recalc
   document totals, which bumps the parent `updated_at` on flush so concurrent
   sub-edits conflict. Strictly additive: no header → no 409; respects
   `OM_OPTIMISTIC_LOCK`.

### Integration Coverage

| Test | Surface | Status |
|---|---|---|
| `TC-LOCK-OSS-004` | CRUD row-level PUT + DELETE 409 | Done |
| `TC-LOCK-OSS-005` | CRM concurrent edit (companies / people / deals, ×3) | **Done (#2055 resume)** — green on live branch dev server |
| `TC-LOCK-OSS-006` | catalog product concurrent edit | **Done (#2055 resume)** — green |
| `TC-LOCK-OSS-007` | `sales.order` concurrent edit + stale delete | **Done (#2055 resume)** — green |
| `TC-LOCK-OSS-008` | sales document-aggregate line conflict | **Done (#2055 resume)** — green |

The sales specs (`003`/`007`/`008`) authenticate as `admin`, which the sales module's
`setup.ts` `defaultRoleFeatures` grants `sales.*` — so they run with **no manual
`yarn mercato auth sync-role-acls` precondition and no self-skip** on a fresh install or in
CI (only a long-lived tenant created before these features existed needs the documented
one-time ACL sync). `superadmin` is intentionally not used: the order fixture POST needs the
organization/channel scope that an admin principal carries.

## Changelog

### 2026-06-01

- #2055 QA round 3 (@alinadivante 2026-05-31) — closed the remaining UI gaps:
  - **Catalog categories** edit + delete: the custom categories `GET`
    (`api/categories/route.ts`) now returns `updatedAt`, so the category edit
    `CrudForm` (already passing `optimisticLockUpdatedAt`) actually emits the
    header on update **and** delete. The reader is auto-registered via the
    route's `makeCrudRoute` command IDs (`customers`/`catalog.categories.*`).
  - **Catalog product variant delete**: wrapped `deleteCrud('catalog/variants')`
    with `buildOptimisticLockHeader(variant.updatedAt)` and surfaced the conflict
    bar on 409 (`VariantSummary` now carries `updatedAt` from the variants list).
  - **CRM sub-records (activities / tasks / interactions)**: the activity edit
    modal (`ScheduleActivityDialog`) sends the lock header on `PUT`, the
    timeline `deleteInteraction` sends it on `DELETE` (looked up from in-hook
    list state) and routes 409s to the unified conflict bar. `editData` now
    carries `updatedAt` from all three detail pages (people-v2 / companies-v2 /
    deals).
  - **Stale-edit-after-delete → conflict (not bare 404)**: new
    `enforceRecordGoneIsConflict()` in `optimistic-lock-command.ts` — when a
    command can't find its target record but the client opted into locking (sent
    the header), it throws the structured `409` instead of `404`, so a stale
    modal save shows "Record changed" rather than "Interaction not found". Wired
    into all four `customers.interactions.*` command 404 sites. Strictly additive
    (no header ⇒ unchanged 404). 5 new unit tests (28 total in the suite).
  - **Conflict bar clears on navigation**: `AppShell` now calls
    `dismissRecordConflict()` on `pathname` change, so the persistent bar no
    longer follows the user into an unrelated module.
  - **Sales false-positive (defensive)**: the order detail `afterList`
    display-only totals recalculation now runs on a **forked** EntityManager
    (`requestEm.fork()`), guaranteeing a `GET` can never enter the request Unit
    of Work / advance `updated_at`. Code analysis found the read path already
    side-effect-free; this removes the entire write-on-read risk class. The
    existing `OM_OPTIMISTIC_LOCK_DEBUG=1` server flag logs exact expected-vs-current
    on any conflict for further diagnosis if it recurs.

### 2026-05-29

- #2055 resume — **100% OSS optimistic-lock coverage**:
  - Wired the remaining client surfaces: sales document sub-sections
    (lines/adjustments/returns send the **document-aggregate** version header,
    server-guarded by `enforceSalesDocumentOptimisticLock`; payments/shipments
    send their **own row** `updatedAt`, kept on the row-level `makeCrudRoute`
    guard by design) and catalog product-variant delete. CRM v2 surfaces were
    already wired (verified live). (`35fbd4d30`, `c8ba97b00`, `917003e34`)
  - **Unified record-conflict bar** — the optimistic-lock 409 now surfaces as a
    persistent, error-styled bar in `AppShell` (like the undo banner), not a
    transient toast. New `@open-mercato/ui/backend/conflicts`
    (`surfaceRecordConflict`, `RecordConflictBanner`, store); `CrudForm` +
    `useGuardedMutation` route conflicts automatically. i18n keys
    `ui.forms.conflict.{title,refresh,dismiss}` (en/de/es/pl). (`f2a23716c`)
  - **Command-level enterprise seam** —
    `createCommandOptimisticLockGuardService({ resolveExpected? })` mirrors the
    CRUD `crudMutationGuardService` override; OSS default is the header compare,
    enterprise plugs a `record_locks`-backed `resolveExpected` via DI without
    touching command handlers. Tracked for enterprise in #2232. (`42e1feffd`)
  - Integration specs `TC-LOCK-OSS-005`..`008` added and green on a live branch
    dev server.
  - Sales lock specs (`003`/`007`/`008`) run as `admin` (granted `sales.*` by the
    sales `setup.ts` `defaultRoleFeatures`) and dropped the sync-gated self-skip, so
    they need no manual ACL sync on a fresh install / CI. (`54df84586`)
  - **Next step:** the enterprise command-level pessimistic resolver (#2232).

### 2026-05-28

- Initial phased follow-up spec for completing optimistic-locking coverage.
- QA #2055 increment: wired the optimistic-lock header into the custom
  (non-`CrudForm`) update/delete handlers for `customers.deal`,
  `customers.company` delete, `customers.person` delete, and the
  `sales.channel` list delete; added `TC-LOCK-OSS-004` DELETE coverage and
  page-level delete-header unit tests. Recorded the implementation status
  table above; sales document command endpoints and nested panels remain
  deferred (Phases 3–4).
- #2055 Phase 4 (command classification) — partially implemented:
  - Added the generalist `enforceCommandOptimisticLock` primitive
    (`@open-mercato/shared/lib/crud/optimistic-lock-command`) so Command-pattern
    handlers can enforce the same `updated_at` version check the CRUD guard
    applies, targeting any record (typically the aggregate root). 57 unit tests.
  - Wired it into the sales sub-resource commands (order/quote lines +
    adjustments upsert/delete, return create, quote→order conversion) as a
    **document-aggregate** check (parent order/quote is the consistency
    boundary; parent `updated_at` bumps automatically via totals recalc).
    Closes the quote accept/convert race (#2114).
  - Classified payments/shipments as already row-level-guarded by `makeCrudRoute`
    (flat `mapInput` keeps the factory `candidateId`); a document-aggregate
    check there would conflict with the single header — unification deferred.
  - Client: `handleConvert` sends the version header (Phase 18). Sales document
    UI section header wiring (lines/adjustments/returns) deferred to a follow-up
    issue (browser-QA-gated; the totals-refresh flow already re-fetches the
    document version, so it is safe).
