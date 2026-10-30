# CRM company hierarchy

**Date:** 2026-10-22 · **Status:** Draft · **Issue:** [#7700](https://github.com/open-mercato/open-mercato/issues/7700)

## 📝 TLDR

Add an optional parent company to the existing customers company aggregate, with a parent picker and bounded ancestor/child navigation. Parents describe organizational structure; they do not grant permissions, merge contacts, roll up revenue, inherit classifications, or create legal liability. This capability ships independently of classification, identifiers, contact points, and deal line items.

## Resolved assumptions (autonomous defaults)

| ID | Question | Default and rationale |
|---|---|---|
| H1 | Is hierarchy a separate capability? | Yes. A company can choose a parent without any classification or consent migration. |
| H2 | Does parentage imply permissions or shared ownership? | No. Read and mutation access remain scoped to the current organization and tenant; no inheritance. |
| H3 | What happens when a parent with stored child references is deleted? | Extend existing company-dependency rejection for every persisted child profile, including inactive/soft-deleted rows. Require explicit reparent/unlink or the existing child-delete operation first; never silently detach children. |
| H4 | How large can a hierarchy become? | At most 32 ancestors, direct children paginated at 100. A simple tree/list is enough; no graph library or whole-tree download. |

## 📝 Overview and Problem Statement

At audited HEAD `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`, `CustomerCompanyProfile` has no parent company field. Companies already share the `CustomerEntity` aggregate, while people can relate to multiple companies through separate links. Overloading those person-company links or adding parentage to a custom text field would lose referential validation and make cycles possible.

[Salesforce's account/contact relationship guidance](https://trailhead.salesforce.com/content/learn/modules/accounts_contacts_lightning_experience/understand-account-and-contact-relationships-lightning) demonstrates parent-account hierarchies and multiple account/contact relationships as distinct concepts. Open Mercato adopts that separation, using its existing aggregate and scoping rules rather than introducing a separate account module. A rep can find a branch's parent, and an account manager can navigate its direct subsidiaries without seeing another tenant's records.

## 📝 Proposed Solution

Extend company create/update with `parentCompanyId`, pointing to another live company in the same tenant and organization. Show the parent and direct children in company detail. Reject self-links, cycles, inaccessible targets, and excessive depth in the command layer for every writer, including undo/redo and imports. An empty picker sends `null`; an omitted key leaves the relationship unchanged.

Rejected alternatives: a free-text parent name has no stable target; a separate generic graph service is unnecessary for one-parent trees; automatic rollups would introduce independent accounting and permission semantics. Company group segmentation is also different from hierarchy and is not implemented here.

## 📝 Architecture

Keep code in customers: `data/entities.ts`, company validators and commands, company list/detail projections, and a small `lib/companyHierarchy.ts` query/validation helper. No cross-module ORM relation, new DI service, package, or production dependency is required. The existing customer `updatedAt` is the aggregate version even though the new field lives on its company profile.

All topology writers acquire the same bounded transaction advisory lock for `customers_company_hierarchy:<tenantId>:<organizationId>` using the shared `withAdvisoryXactLock` helper. The underscore-only namespace matches that helper's validated key grammar. Pass the request EM and let this helper own the outer transaction; it deliberately creates an isolated transactional fork, so do not wrap it inside an existing domain transaction and assume the transactions are shared. Inside its callback, perform every topology-dependent mutation using the supplied exact `txEm`: re-read target company, proposed parent and ancestor chain, check scope, check the child's optimistic version, then persist and bump the child's aggregate `updatedAt`. Do not fork, call a command helper that forks, or open nested transactions inside the callback. Flush scalar writes before relation queries; the exact-EM multi-phase flush mechanism may be reused without opening another transaction. Emit side effects only after the helper returns successfully. Company delete and its undo/redo also acquire this lock before the dependency check so a concurrent attach cannot race a parent deletion.

A scope lock deliberately serializes infrequent topology writes rather than trying to lock an ancestor set that can change during discovery. Concurrent `A→B` and `B→A` attempts therefore cannot both commit. Lock timeout is a translated retryable conflict, never an unbounded wait. The helper's `commit_unknown` failure is not reported as a definite rollback: return the standard retryable server error and require a fresh record read before retry, using the expected version to avoid blind replay. Read queries remain unlocked.

The validator follows the proposed parent's chain with tenant/org predicates, a visited-ID set and a maximum of 32 ancestors. A cycle or broken existing chain produces a deterministic conflict and leaves the company unchanged. The query must also check the child's deepest descendant depth when moving a subtree; limiting only the parent's chain would allow a valid 32-deep tree to become 60-deep after reparenting. A recursive parameterized query returns IDs/depth only; names are loaded through decryption helpers after authorization.

## 📝 Data Models

| Owner | Property / column | Definition |
|---|---|---|
| `CustomerCompanyProfile` / `customer_companies` | `parentCompanyId` / `parent_company_id` | Nullable UUID pointing to `customer_entities.id`; target must have `kind='company'` in the same tenant and organization. Default `NULL`. |
| Existing customer/profile | `updatedAt` | Profile updates and customer aggregate version advance on an actual topology change; same-value requests preserve normal existing command behavior. |

Add a nullable FK with `ON DELETE RESTRICT` and a scoped index `(tenant_id, organization_id, parent_company_id)`. The FK prevents physical orphaning; tenant/kind/live-row/cycle checks remain command-level invariants. A company may be inactive but live and still serve as a parent; soft-deleted companies cannot be selected. No parent field exists on person profiles or the generic customer base.

Parent IDs are internal references, not copied PII. Never copy a parent name into a new unencrypted text column. Return parent labels by `findWithDecryption`/`findOneWithDecryption` under caller scope. Hierarchy itself does not expose a company's private interactions or profile beyond existing `customers.companies.view` access.

### Commands, undo and deletion

`customers.companies.create` and `.update` include parentage in before/after snapshots. Capture both authoritative snapshots and their expected aggregate versions using the exact `txEm` while the topology lock is held, before mutation and after the final flush. Return immutable internal snapshots from execute for the existing command logging hooks; never reload authoritative after-state from an unlocked `captureAfter` fork. The existing company `prepare`/`captureAfter` callbacks currently fork separately and must be changed for this path: outside-transaction snapshots can be hints only, not replay authority. Do not serialize these internal snapshots in HTTP responses. Undo/redo restores the previous parent under the same topology lock, current permissions, optimistic/conflict safeguards, and validation. If restoration would now form a cycle or reference an absent parent, return conflict with the company unchanged; never resurrect the parent or rewrite siblings automatically.

Existing `customers.companies.delete` physically removes the company profile and customer entity at this baseline. Preserve that behavior. Reject every persisted direct-child profile reference with existing `422 COMPANY_HAS_DEPENDENTS`, adding a children blocker to the translated explanation; this includes inactive or soft-deleted entity rows that still retain a profile, matching `ON DELETE RESTRICT`. Existing people/deals/staff blockers remain. Deleting a child through the existing command removes its profile/reference and captures its parent in the immutable delete snapshot, so the parent can then be deleted. Recovery is explicit and already supported: undo the parent's deletion first, then undo the child's deletion. Child restore validates its saved parent and reports conflict if the parent is still absent; it does not promise an undefined update-on-deleted-record or restore-with-override API. If the parent's undo is no longer available, automatic child restoration remains blocked and requires an explicitly authorized repair outside this feature. Capture delete/restore snapshots under the same lock as their mutations. Hard purge cannot bypass the FK or dependency policy.

After commit, existing company CRUD/query-index events and cache invalidation refresh the changed child plus old/new parent detail caches. Publish no recursive cascade of company-updated events for unchanged descendants. Undo invalidates the same affected set. Event consumers receive the existing payload shape; any parent ID addition is optional and additive. Audit/replay tests interleave two valid reparentings between execute and command-log publication and verify that each log retains its own locked before/after pair, never the other writer's state.

## 📝 API Contracts

| Route | Change |
|---|---|
| `POST /api/customers/companies` | Optional `parentCompanyId: UUID|null`, same manage guard and create response. |
| `PUT /api/customers/companies` | Optional `parentCompanyId: UUID|null`, company `updatedAt` lock token, same update response plus existing fresh token. |
| `GET /api/customers/companies` | Add nullable `parent_company_id`; optional `parentCompanyId` UUID query filters direct children before pagination, count, and export. |
| `GET /api/customers/companies/[id]` | Add `profile.parentCompanyId`; no replacement of existing `company`, `profile`, people or deals fields. |
| `GET /api/customers/companies/[id]/hierarchy` | New read-only route: `{ parent: CompanyRef|null, ancestors: CompanyRef[], children: CompanyRef[], page, pageSize, total }`, with `CompanyRef={id,displayName,updatedAt}`. Ancestors root-first, maximum 32; direct children default 20/max 100, stable name/ID order. |

The hierarchy route requires `customers.companies.view`; writes reuse `customers.companies.manage`. Scope derives from auth/selected organization and is applied to every recursive query and relation lookup. Missing/inaccessible target IDs are indistinguishable 404s. Invalid UUID/self-link/depth errors are translated field errors (400); cycles and competing topology changes produce 409 with stable `company_hierarchy_conflict` code; ordinary stale update remains the platform optimistic-lock 409. Parent deletion retains its established 422 response shape/code. All routes export `metadata`/`openApi`; existing CRUD routes keep `makeCrudRoute` and indexing.

The picker uses the companies list search and excludes the current ID; exclusions are UX hints only. Do not send the whole descendant tree to the browser. The server remains authoritative when the user selects a descendant. The new hierarchy GET has no response cache initially; existing company-detail/list caches are invalidated on relevant writes. No cache key can omit tenant/org.

## 📝 UI/UX and Frontend Architecture Contract

Add Parent company to existing company create/detail forms, with a searchable `LookupSelect` and explicit clear action. The detail page has a Hierarchy section showing breadcrumb-like ancestors, current company, and a paginated `DataTable` of direct children. On narrow screens the same navigation becomes a vertical list; no horizontal canvas. Keep existing company form group IDs and injection spots.

Use `CrudForm`, `apiCall` helpers, `LoadingMessage`, `ErrorMessage`, `EmptyState`, semantic tokens, i18n in all five locales, and labeled icons. Existing versions travel through form updates/deletes; non-form mutation actions use guarded mutation/scoped optimistic headers and conflict surfaces. Escape cancels and Cmd/Ctrl+Enter submits dialogs.

| Client ledger / boundary | Reason and guardrail |
|---|---|
| Existing company create/detail client roots | Legacy client-root exception retained; add no directive, global provider or heavy dependency. Existing form host owns save state. |
| `CompanyParentField` client leaf | Debounced searchable selection and dirty state; abort/ignore stale searches on unmount or scope change. |
| `CompanyHierarchySection` client leaf | Child pagination and navigation state; under 300 LOC, fetch bounded pages. |

All server queries stay in API/lib code; neither client leaf imports ORM or recursive SQL. Zero new global bootstrap imports, zero graph libraries, zero new client page roots. Require route hydration and keyboard tests, client-boundary check, plus a production bundle comparison capped at 10 KiB gzip added route code. Investigate any growth above budget; existing large roots must not gain new orchestration logic.

## 📝 Migration and Backward Compatibility

Add the nullable column, FK and index with matching module migration snapshot. All existing companies start with `NULL`; never infer parents from names, domains, tax IDs, addresses or contacts. Existing API payloads and application code behave unchanged. No deprecated API or schema surface is removed and no automatic data reconciliation is required. Rollback leaves the additive column in place; an older app simply ignores parentage. Do not drop the column on rollback or cascade-delete relationships.

## 📝 Edge Cases & Failure Scenarios

An archived but live parent stays selectable and is labeled inactive. A child being deleted while another user attaches it is serialized by the same scope lock. If historical corruption is discovered, fail the attempted topology write and show a repair-needed error, without rendering cross-scope references or looping. If read data changes between hierarchy pages, navigation remains stable by ID and a refresh resolves it. A deleted proposed parent produces 404 without changing the child.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Concurrent reparenting introduces a cycle | High | Scope transaction advisory lock shared by every topology writer and replay. | Direct SQL is unsupported. |
| Parent deletion strands children | High | Existing dependency blocker plus restrictive FK, same lock. | Deleted-child restoration may need repair. |
| Hierarchy exposes another organization | High | Exact scope at every CTE step; inaccessible IDs omitted/rejected, labels decrypted after scope. | No hierarchy-wide visibility inheritance. |
| Large tree overloads UI or DB | Medium | Max depth 32, direct-child pagination, supporting index and bounded query count. | Scope lock serializes rare edits. |

## 🧪 Integration and Test Coverage

Self-contained fixtures cover company create/update/list/detail and the new hierarchy GET, permissions, tenant/org isolation, nullable/omitted/same-value parent inputs, invalid person target, inactive parent and deleted target. Race tests run reciprocal moves and attach/delete concurrently and assert exactly one valid result. Test subtree depth, self/cycles, preexisting corruption, 409 recovery, undo/redo after reparent/delete, dependency 422, and cache refresh for old/new parents. Browser tests cover company create and detail picker, empty state, 100+ children pagination, narrow viewport, keyboard submit/cancel, hydration and stale-save conflict. Every fixture is cleaned up in finally/teardown in reverse dependency order.

## Final Compliance Report — 2026-10-22

Reviewed root, core/customers, shared, UI/backend, cache/events, QA/specs rules and backward-compatibility contract. Fresh-context review passed cohesion and identified unlocked audit snapshots plus an undefined deleted-record recovery. Both are resolved with lock-held immutable snapshots and the explicit parent-first undo sequence matching current physical deletion. One capability, no cross-module relation, aggregate versioning, scoped recursive reads, encrypted labels, standard UI and full tests are specified. Data/API/UI and replay use the same graph invariant. Runtime validation remains implementation work. Verdict: ready for design review.

## Changelog

- 2026-10-22 — Initial autonomous specification; split hierarchy, fixed concurrent cycle/delete behavior, and addressed independent review of audit snapshot races and actual physical-delete recovery.

## 📋 Phasing and Implementation Plan

1. **Add schema and read seam.** Add nullable profile column/FK/index and module snapshot; preserve all existing behavior. Unit-test scoped ancestor/descendant queries and bounded hierarchy GET.
2. **Protect writes and replay.** Extend company commands with one topology lock, validation, snapshots and aggregate lock-token updates; extend delete blocker. Prove reciprocal-move and attach/delete races before UI exposure.
3. **Expose existing API flows.** Extend create/update/list/detail validators and OpenAPI, direct-child filter/count/export and cache invalidation. Run self-contained API integration suite.
4. **Ship navigation UI.** Add picker and bounded hierarchy section, translations and all browser flows; preserve extension spots and group IDs.
5. **Verify release.** Run scoped validation plus configured gates with selected runner, client-boundary/bundle checks and migration no-op check. No local database migration without explicit authorization.
