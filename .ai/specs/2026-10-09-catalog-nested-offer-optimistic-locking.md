# Catalog nested-offer optimistic locking

**Status:** Proposed follow-up
**Implementation ownership:** Open Mercato core team members only
**Scope:** Catalog product-edit data integrity
**Related:** `.ai/specs/2026-09-30-catalog-product-form-section-policy.md`, `.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md`, `.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md`

## TLDR

Make product-edit offer changes atomic and version-aware. The UI sends explicit upserts and deletions with each existing offer's own `id` and `updatedAt`; the product command acquires the scoped parent with `PESSIMISTIC_WRITE`, re-runs the DI-aware parent guard inside that transaction, checks every referenced child, and uses version-qualified child writes before commit. A successful response returns one transaction-consistent parent/offer snapshot so a second save uses matching values and versions.

This is independent of CrudForm section composition. It changes catalog command and API contracts and must be implemented and reviewed by Open Mercato core team members.

## Overview

The current product edit flow has split ownership:

- removed offers are deleted in the browser before `catalog/products` update;
- retained/new offers are sent through the nested `offers` array;
- `productBaseSchema` currently strips `id` with `offerInputSchema.omit({ id: true })`;
- `syncOffers` falls back to channel matching and does not enforce child versions;
- after a save, `mergeOfferSnapshots` can retain stale/null child versions.

A retained-child conflict can therefore arrive after a prior deletion has already committed, and successive saves can reuse stale versions.

## Problem Statement

Product optimistic locking protects the parent row, not independent offer edits. An offer can be changed through its direct route while a product editor remains open. The product save may then overwrite that child or delete another child before discovering a conflict.

Simply adding `updatedAt` to the current nested item is insufficient:

- omitted rows represent deletions but carry no token;
- pre-delete browser calls commit outside the product transaction;
- a child lookup by unscoped id could cross tenant/organization/product boundaries;
- the command-level enterprise extension is bypassed if code calls only the synchronous OSS helper;
- successful saves must refresh child versions, not just the parent `updatedAt`.

## Goals and Non-goals

### Goals

- Protect every existing offer upsert and deletion with that offer's own version.
- Close the parent check/write race and merge hidden leaves only from the transaction-locked current product.
- Preflight all child ids, scope, paired tokens, and conflicts before mutation.
- Apply parent scalar writes and all offer additions/updates/deletions in one transaction.
- Preserve the legacy `offers` array contract for older callers.
- Return authoritative child snapshots after success.
- Honor `OM_OPTIMISTIC_LOCK=off` and allow-list semantics and the enterprise DI guard seam.

### Non-goals

- Replacing direct `catalog/offers` CRUD routes.
- Requiring versions from legacy callers in the same release.
- Changing channel uniqueness or offer pricing behavior.
- Coupling this work to section-policy adoption.

## Proposed Solution

### 1. Add an explicit change envelope

Keep the existing optional `offers` field unchanged for compatibility. Add a mutually exclusive product-update field:

```ts
const nestedOfferVersionSchema = z.object({
  id: uuid(),
  updatedAt: z.string().datetime({ offset: true }),
})

const productOfferChangesSchema = z.object({
  upserts: z.array(
    offerBaseSchema.extend({
      id: uuid().optional(),
      updatedAt: z.string().datetime({ offset: true }).optional(),
    }).superRefine(requireIdAndVersionTogether),
  ).max(100),
  deletes: z.array(nestedOfferVersionSchema).max(100),
})
```

Rules:

- existing upsert: both `id` and `updatedAt` are required;
- new upsert: both are absent;
- deletion: both are required;
- an id may appear at most once across upserts/deletes;
- the envelope is a partial delta: existing offers omitted from both arrays are preserved;
- the final desired set is `(current scoped offers − deletes)`, overlaid by existing-id upserts, plus new upserts;
- a channel may appear at most once in that final desired set, including untouched existing offers;
- `offers` and `offerChanges` cannot appear together;
- the public `offerInputSchema` already accepts optional `id`; the actual additive change is the new versioned product-update envelope, not “adding id to offer input.”

The product edit UI switches to `offerChanges`. Existing API consumers may continue using `offers` and their current channel-matching behavior during the compatibility window.

### 2. Scoped transactional plan and race-free writes

The command opens the product transaction before reading or changing the managed product or any offer. Inside that transaction it:

1. loads the parent by `id`, `tenantId`, and `organizationId` with `LockMode.PESSIMISTIC_WRITE` and `refresh: true`, before any active/hidden payload merge;
2. calls `enforceCommandOptimisticLockWithGuards(ctx.container, { resourceKind: 'catalog.product', resourceId: parent.id, current: parent.updatedAt, expected: requestParentVersion, request: ctx.request })` on that locked row; the route-level CRUD guard remains defense in depth, not the transaction's authority;
3. loads every supplied child id with the same scope and `product_id`;
4. treats any missing/wrong-scope/wrong-parent child with an expected version as the standard record-gone optimistic conflict, without revealing whether the id exists elsewhere;
5. calls the same DI-aware helper with `resourceKind: 'catalog.offer'` for every existing upsert and deletion;
6. validates duplicate ids/channels against the complete final desired set and builds an immutable plan from the locked parent and scoped children;
7. when locking is enabled for `catalog.offer`, applies every existing-offer update/delete with a scope- and version-qualified predicate over `id`, `tenant_id`, `organization_id`, `product_id`, and normalized `updated_at`, and requires exactly one affected row; each successful update assigns a freshly generated `updated_at` in that same atomic statement and returns it; an explicit off/excluded configuration retains the same scope predicates but intentionally omits the version predicate while still advancing `updated_at`.

The DI-aware helper is required for both `catalog.product` and `catalog.offer`. It runs the OSS compare first and then the optional enterprise command guard. It inherits the shared `OM_OPTIMISTIC_LOCK` behavior: default-on, `off` disables the relevant check, and an allow-list may exclude either resource kind. The parent row lock is still acquired when version checking is disabled so server-owned hidden-leaf merges read the latest committed product; disabling the version check intentionally permits last-writer-wins semantics. There is no direct core→enterprise import.

The DI guard provides the established OSS/enterprise conflict semantics; when locking is enabled, the version-qualified write is the required compare-and-swap that prevents a direct offer mutation between read and write from being overwritten. After a zero-row compare-and-swap, the transaction performs a scope-qualified re-read: a visible current row returns the standard mismatch body with its current token; an absent scoped row calls `enforceRecordGoneIsConflict`, which echoes the expected token without revealing out-of-scope existence. Either branch rolls back the transaction. Implementations may instead hold database write locks from the scoped read through commit when every supported database adapter proves equivalent behavior, but an unlocked check followed by an unconditional ORM flush is forbidden.

All validation and guard checks complete before the first transactional mutation. Custom-field writes, events, audit, cache, and index effects remain outside this atomic boundary as described below.

### 3. One transaction

Refactor `catalog.products.update` so the transaction contains:

- scoped parent `PESSIMISTIC_WRITE` acquisition, refresh, parent DI guard, and active/hidden payload merge;
- parent scalar mutation/flush;
- versioned offer upserts;
- versioned offer deletions;
- existing category and tag synchronization.

The current browser-side pre-delete loop is removed from the new envelope path. The command applies the immutable offer plan; it does not re-match a supplied id by channel. New rows may still resolve channel defaults but cannot claim an existing row without its id/version.

If any parent/offer/category/tag write conflicts or fails, the transaction rolls back every parent, sibling-offer, category, and tag change. Every caller of `catalog.products.update`, including the policy façade and legacy route, enters this same parent-lock/guard boundary; no caller may rely only on the pre-command `makeCrudRoute` read. Custom-field writes, events, audit, and cache/index side effects occur only after that transaction commits, following existing command seams; they are explicitly not claimed as part of this database atomicity guarantee. Existing recovery/idempotency behavior for a post-commit custom-field or side-effect failure is preserved and tested separately.

Legacy `offers` calls retain the current `syncOffers` behavior in a separately named compatibility branch. Tests pin that the new UI never falls back to it.

### 4. Authoritative response and client refresh

After all writes flush but before the transaction commits, the command reads the complete final offer set through the same transaction and returns that snapshot after commit:

```ts
type LegacyProductUpdateResult = {
  productId: string
  updatedAt: string
  offers?: Array<{
    id: string
    channelId: string
    title: string
    description: string | null
    defaultMediaId: string | null
    defaultMediaUrl: string | null
    metadata: Record<string, unknown> | null
    isActive: boolean
    updatedAt: string
  }>
}

type VersionedOfferChangesProductUpdateResult = Omit<LegacyProductUpdateResult, 'offers'> & {
  offers: NonNullable<LegacyProductUpdateResult['offers']>
  offerChangesProtocol: 'catalog.product.offer-changes/v1'
}
```

The product edit page replaces both its editable offer values and `offerSnapshotsRef.current` from the same response in one state transition. It never combines old values with new tokens and never synthesizes versions with `mergeOfferSnapshots`. A concurrent writer after this transaction commits therefore causes the next version-qualified save to conflict instead of authorizing stale values.

Deployment is server-first and the protocol is checked on every mutation, not only at bootstrap. Phase A deploys a product-update route guard to the full fleet: when it sees `x-om-ext-catalog-offer-changes-protocol`, it either runs the implemented protocol or returns HTTP `409` `{ "error": "extension_policy_mismatch", "code": "extension_policy_mismatch" }` before body parsing/mutation. Phase A advertises no capability, so first-party clients remain legacy. Phase B deploys request validation, compare-and-swap execution, transaction-consistent responses, and only then advertises `catalog.product.offer-changes/v1`. The client sends both `offerChanges` and `x-om-ext-catalog-offer-changes-protocol: catalog.product.offer-changes/v1`; every receiving instance now recognizes or rejects it, preventing silent stripping in a mixed Phase-B fleet. The rollout controller must prove Phase-A fleet completion before Phase-B advertisement; a deployment may instead provide documented sticky/fleet-atomic routing. The client keeps the unchanged legacy `offers` behavior until bootstrap advertises the capability. There is no response-time fallback from `offerChanges`: an unknown-field rejection or a success response without the required protocol discriminator and offer snapshot is an error, and the UI never treats a reload as proof that a requested mutation was applied.

### 5. Conflict behavior

Every version mismatch returns the existing structured HTTP `409` body:

```json
{
  "error": "record_modified",
  "code": "optimistic_lock_conflict",
  "currentUpdatedAt": "...",
  "expectedUpdatedAt": "..."
}
```

For missing, deleted, or inaccessible children, the implementation calls the existing `enforceRecordGoneIsConflict` contract: `currentUpdatedAt` and `expectedUpdatedAt` both equal the normalized client-supplied expected token. This preserves the exact non-leaking body used elsewhere when no current row is available. The UI routes both cases through `surfaceRecordConflict(err, t)`. It does not convert them to a generic catalog form error first. Validation failures such as an unpaired id/token remain schema errors and mutate nothing.

## Architecture

| File/area | Change |
|---|---|
| `packages/core/src/modules/catalog/data/validators.ts` | Add `offerChanges` envelope, pairing/exclusivity/duplicate validation, derived types |
| `packages/core/src/modules/catalog/commands/products.ts` | Scoped transactional plan, DI-aware child guards, version-qualified writes, transaction-consistent snapshot result |
| product route/OpenAPI | Document additive request/response fields and exact errors |
| product edit page | Build versioned upserts/deletes, remove pre-delete path, refresh snapshots from response, surface conflicts |
| tests/integration | Two-contender atomicity, scope, kill-switch, response refresh, legacy bridge |

## Data Models

No database migration is required; `catalog_offers.updated_at` already exists. The change is an additive request/response contract plus command sequencing.

## API Contracts

- Existing `offers` remains optional and unchanged.
- New `offerChanges` is optional and mutually exclusive with `offers`.
- Existing product update result fields remain. `offers` stays optional for legacy requests but is required, with `offerChangesProtocol`, on every successful `offerChanges` request.
- `catalog.product.offer-changes/v1` is advertised server-first and repeated in the protected per-mutation header; clients must not send the envelope without it, and receiving instances must reject an unsupported marker before mutation.
- Direct offer routes retain their contracts.
- Standard optimistic conflict shape/status remains unchanged.

## UI/UX

The visible product form does not change. On conflict, the unified record-conflict bar asks the user to refresh. No sibling deletion/update should appear to succeed before the conflict. After a successful save, a second edit/save works without reload because parent and child versions are refreshed.

## Frontend Architecture Contract

- **Boundary map:** the existing catalog product edit `page.tsx` client boundary owns offer draft state and builds the versioned envelope; the existing backend product route owns parsing/protocol negotiation; the catalog command owns scoped planning, locking, and atomic writes. No server command or ORM type crosses into the browser bundle.
- **`use client` ledger:** no new client boundary is introduced. The existing product edit page remains the only touched client entry; extracted envelope/snapshot helpers are pure, browser-safe functions with no provider or server import.
- **State and provider scope:** no context/global provider, subscription, cache, or ambient header state is added. `offerSnapshotsRef` and editable offer state remain page-local and are replaced together from one response; the existing form conflict surface remains authoritative.
- **Request/hydration budget:** no render-time request is added. One save emits one product PUT and zero pre-delete calls on the versioned path; hydration remains request-equivalent to current behavior. Strict Mode tests prove no duplicate submit, delete, retry, or state replacement.
- **Bundle/LOC budget:** keep new browser-only envelope/snapshot logic under 120 net LOC, add no production dependency, and record the catalog page chunk diff. Any increase above 5 KiB gzip requires an explicit review note and split before approval.
- **Verification evidence:** `yarn check:client-boundaries`, the recorded page-chunk diff, request-count assertions, two/three successive-save tests, and a hydration/Strict Mode run must pass. Browser coverage proves values and versions update in one state transition and the conflict bar renders once.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Existing upsert has id without version, or version without id | 400/schema error; no mutation |
| Delete lacks version | 400/schema error; no mutation |
| Supplied child belongs to another tenant/org/product | Scoped lookup only; when locking is enabled, standard record-gone 409 with no existence detail; otherwise the existing non-leaking not-found behavior |
| Child deleted concurrently | Record-gone 409 echoes the normalized expected token in both timestamp fields; parent/siblings unchanged |
| One retained child stale among many | Entire transaction rolls back |
| Parent changes after the route guard but before the command transaction | Locked refresh/DI guard returns the standard parent conflict; hidden leaves and every child write remain unchanged |
| Same id in upsert and delete | 400/schema error |
| Two upserts target same channel | 400/domain validation before mutation |
| Upsert collides with untouched offer channel | 400/domain validation before mutation |
| Existing offer omitted from envelope | Preserved unchanged |
| New offer carries expected version | 400/schema error |
| `OM_OPTIMISTIC_LOCK=off` | Version checks skip exactly as shared contract defines; transaction remains atomic |
| Allow-list excludes `catalog.offer` | Child version checks skip; other validation/scoping remains |
| Two successive saves | Second uses authoritative versions returned by first |
| Older caller sends only `offers` | Legacy channel-matching behavior retained and tested |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Parent or child check/write race overwrites a direct edit | Critical | Parent `PESSIMISTIC_WRITE` plus in-transaction DI guard; child scope/version-qualified compare-and-swap | Writers outside the product command contract remain unsupported |
| Partial parent/child writes | Critical | One transaction for parent/offers/categories/tags | Custom fields and external side effects remain post-commit by explicit contract |
| Cross-scope child lookup | Critical | Tenant/org/parent predicates in one query; isolation integration tests | None accepted |
| Stale version after success | High | Transaction-consistent values+versions; atomic client replacement | Later writers correctly cause the next save to conflict |
| Mixed-version deployment drops edits | High | Server-first capability advertisement; no response-time fallback | Legacy path remains available until fleet rollout completes |
| Enterprise lock seam bypass | High | Require `enforceCommandOptimisticLockWithGuards` | Misconfigured optional service degrades to OSS floor by existing contract |
| Legacy callers break | High | Keep `offers`; new envelope optional and exclusive | Legacy path remains last-write-wins until later deprecation |
| Oversized transaction | Medium | Max 100 upserts/deletes; batch scoped load and planning | Large product edits hold locks longer |

Before first publication, rollback may remove the new envelope/result. After publication, operational rollback disables capability advertisement and returns the first-party UI to legacy `offers` while servers continue accepting the additive request/result contract; physical removal then requires the normal deprecation bridge. No data migration or cleanup is required.

## Migration & Backward Compatibility

This release is additive. No existing request field, response field, route, command id, or database column is removed or narrowed. The edit UI adopts the safer envelope, but external callers may continue using `offers`.

Making versioned offer changes mandatory for all callers is a future breaking change requiring `@deprecated` guidance, a bridge release, `UPGRADE_NOTES.md`, and its own migration spec.

## Phasing

1. Phase-A route guard with no advertised capability, deployed and proven fleet-wide.
2. Validator/OpenAPI contract and pure final-set planner tests.
3. Transaction-held parent lock/guard, DI-aware child checks, version-qualified writes, and atomic product-command implementation.
4. Authoritative response, capability advertisement, and product-edit client migration.
5. Integration/concurrency/compatibility verification.

## Implementation Plan

### Phase 0 — mixed-fleet guard

1. Add the protocol-header route guard and exact no-mutation 409 while keeping capability advertisement off; record fleet-completion or sticky/fleet-atomic evidence before proceeding.

### Phase 1 — contract

2. Add `offerChanges` schemas and derived types; validate paired tokens, mutual exclusion, duplicate ids/channels, limits, and new-row semantics.
3. Extend product update OpenAPI request/response docs and compatibility tests without changing `offerInputSchema` claims incorrectly.
4. Add a pure planner that constructs `(current − deletes) + upserts`, preserves omitted rows, validates channels against untouched rows, and returns create/update/delete sets without mutating entities.

### Phase 2 — atomic command

5. Open the transaction, acquire and refresh the tenant/org-scoped parent with `PESSIMISTIC_WRITE`, run the parent `catalog.product` DI guard there, and only then merge active and hidden leaves. Load all referenced offers in one parent-scoped query and convert missing scoped records with supplied versions through `enforceRecordGoneIsConflict`.
6. Run `enforceCommandOptimisticLockWithGuards` for every update/delete using `resourceKind: 'catalog.offer'`; test parent and child default-on, `off`, included/excluded allow-list, and enterprise-service conflict propagation.
7. Apply parent scalars and the planned offer/category/tag work under the held parent lock in one transaction. When child locking is enabled, existing-offer updates/deletes use scope/version-qualified compare-and-swap predicates, update `updated_at` atomically, and require one affected row; zero rows trigger the scoped re-read mismatch-versus-gone algorithm. Explicit off/excluded configurations use scope-only predicates but still advance `updated_at`. Keep custom fields and side effects after successful commit and do not claim they roll back with that transaction.
8. Retain and isolate the old `offers` compatibility branch; assert the new path cannot fall back to channel matching.

### Phase 3 — client and response

9. Read and return the complete authoritative offer snapshot inside the write transaction after flush, including every child value, `id`, and `updatedAt`.
10. Advertise the capability only after Phase-A fleet evidence and the complete server path are present.
11. Build explicit UI `upserts` and `deletes`; remove the browser pre-delete loop from this path and stop using `mergeOfferSnapshots` for versions.
12. Replace editable offer values and the version snapshot together from the required discriminated server result. Gate the envelope on bootstrap capability plus the per-request protocol marker; never retry or infer success from an unadvertised/invalid response.
13. Route nested conflicts through `surfaceRecordConflict` and preserve other localized validation errors.

### Phase 4 — integration

14. Add barrier-controlled two-contender tests: (a) editor A passes the route-level parent check, editor B commits a product update, then A acquires the transaction lock and returns the exact parent 409 without restoring hidden leaves; (b) editor A passes the child read and pauses, editor B updates or deletes that offer directly, then A's compare-and-swap returns the exact mismatch or record-gone 409. No losing parent/sibling/deletion persists.
15. Cover new offer, retained update, omitted-offer preservation, explicit delete, mixed batch, wrong tenant/org/product id, concurrent deletion, duplicate ids/channels including untouched-row collision, and direct-offer edit competition.
16. Cover two and three successive saves asserting every updated offer token changes monotonically, transaction-consistent returned values/versions, a post-commit competing write, kill switch/allow-list cases, exact mismatch/record-gone bodies, required response discriminator/snapshot, Phase-A-only/Phase-B receiving instances, capability-present/absent clients, and legacy unversioned callers.
17. Run catalog focused tests/build, `yarn check:client-boundaries`, record the product-page chunk diff/request-count evidence, and run the configured validation gate.

## Integration Coverage

- `PUT /api/catalog/products`: new envelope happy path, every schema failure, stale/missing/wrong-scope child, mixed atomic rollback, exact 409, legacy `offers`.
- Concurrent `PUT /api/catalog/products`: barrier after the route guard proves the command reloads/guards the parent under its transaction lock and never restores a hidden leaf from the stale request snapshot.
- `PUT /api/catalog/offers` versus product update: barrier-controlled check/write interleaving proves compare-and-swap conflict.
- Product edit UI: deletion is not sent separately, capability gates the new request, conflict bar appears once, values and versions refresh together, successive saves work.
- Frontend contract: no new client boundary/provider/render-time request, one PUT and zero pre-delete requests per versioned save, Strict Mode has no duplicate mutation, browser helper growth stays within the 120-LOC budget, and the product-page chunk delta stays at or below 5 KiB gzip or receives explicit split review.

## Acceptance Criteria

1. Existing offer upserts/deletes require paired child id/version on the new path; new offers require neither.
2. All referenced children are scoped to tenant, organization, and parent product before version comparison.
3. A scoped parent `PESSIMISTIC_WRITE` plus in-transaction `catalog.product` DI guard closes the parent route-check/write race and makes hidden-leaf preservation authoritative; version-qualified child writes prevent an offer mutation between check and write from being overwritten.
4. The command uses the DI-aware lock seam for parent and children and honors `OM_OPTIMISTIC_LOCK` off/allow-list semantics while retaining the parent row lock for current-state merging.
5. Missing/deleted/wrong-scope supplied child ids cannot reveal cross-scope existence and return the documented no-mutation conflict behavior.
6. Success returns one transaction-consistent, protocol-discriminated child snapshot; each updated offer has a new token, and the client adopts values and versions together for consecutive saves.
7. The UI no longer pre-deletes offers outside the parent transaction.
8. Exact standard 409 responses reach `surfaceRecordConflict`.
9. Server-first capability negotiation plus the protected per-mutation protocol marker prevents mixed-instance silent loss; legacy `offers` callers remain compatible.
10. The frontend boundary/request/Strict-Mode/LOC/chunk budgets have recorded passing evidence.
11. Unit, route-level integration, UI, concurrency, and rollback tests pass.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root + catalog guides | Scope every child by tenant, organization, and parent; preserve command side effects | Compliant | Offer lookup/write predicates include all scopes and execute within `catalog.products.update` |
| root optimistic-lock rule | Use each child record's version and the DI-aware command guard, including gate modes | Compliant | Paired ids/versions, `catalog.offer`, `enforceCommandOptimisticLockWithGuards`, gone-record handling, and off/allow-list semantics are pinned |
| UI guides | Keep boundaries/providers/requests bounded and use the shared conflict surface | Compliant | The frontend contract pins one existing client boundary, no provider, one PUT, zero pre-deletes, budgets, and `surfaceRecordConflict` |
| `.ai/specs/AGENTS.md` | One deployable capability with API/UI integration tests | Compliant | Atomic nested-offer locking is independent of section adoption and has exact route/client/race coverage |
| `BACKWARD_COMPATIBILITY.md` | Keep legacy callers additive | Compliant | Version envelope/result are additive and legacy payload behavior is retained |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Existing offer `updatedAt` is transported in paired snapshots; no migration |
| API contracts match UI/UX section | Pass | Successful responses refresh authoritative ids/versions for the next save |
| Risks cover all write operations | Pass | Add/update/delete, wrong scope, conflict, rollback, and successive saves are covered |
| Commands defined for all mutations | Pass | One `catalog.products.update` transaction owns all child mutations |
| Cache strategy covers all read APIs | N/A | No cache contract changes |
| Frontend architecture contract is measurable | Pass | Boundary, provider, request, Strict Mode, LOC, chunk, and hydration evidence is required |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation.

## Changelog

- **2026-10-27:** Corrected the product command id and completed the mandatory AGENTS/internal-consistency compliance report.
- **2026-10-22:** Expanded the follow-up into an implementable atomic protocol: explicit partial-delta envelope, scoped transactional planning, DI-aware guard plus version-qualified writes, transaction-consistent snapshots, exact conflicts, server-first capability negotiation, kill-switch matrix, legacy bridge, and complete integration coverage.
- **2026-10-09:** Recorded nested offer optimistic locking as independent follow-up work.
