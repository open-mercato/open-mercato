# Pre-Implementation Analysis: Manufacturing BOM Draft Authoring (P1.4a)

**Spec:** `.ai/specs/2026-08-19-manufacturing-bom-drafts.md`
**Analyzed:** 2026-08-19, using the repository `om-pre-implement-spec` workflow
**Codebase:** `feat/manufacturing-product-roadmap`
**Scope:** the audit pass was analysis-only; owner-approved remediation was applied to specifications afterward, with no product-code change

## Executive Summary

At audit time, the family -> draft revision -> stable line-occurrence model was coherent, additive, and a good basis for P1.4a, with no collisions for its package, tables, routes, event IDs, ACL IDs, or widget IDs. The audited revision was nevertheless **not implementation-ready yet**: target/component changes could leave quantity evidence bound to the wrong Catalog identity; undo/redo and strict optimistic locking contradicted the current framework contracts; and P1.0a's two-entry export map could not expose the convention files that the generators import for a real module. The remediation update below records the current status.

**Initial recommendation: NEEDS SPEC UPDATES FIRST.** Keep the three-entity model, but close the critical contracts below and freeze the corrected field names/payloads before implementation. P1.0a and the published Catalog exact quantity/UoM contract remain external capability prerequisites.

### Remediation update — 2026-08-19

The owner approved the recommended reusable-BOM/order boundary and spec remediation. The current P1.4a/P1.0a documents now close the five critical findings: effective-state re-normalization and explicit normalized-unit fields; strict interactive optimistic locking separated from semantic undo/redo; one-handler domain transaction with honest later CommandBus logging; generator-compatible convention exports; and complete setup/scope/guard/event/UI wiring. Important findings on snapshot consistency, FK/index checks, Catalog active-record policy, cursor tenant binding, action-log resource ordering, extension hosts, throwing UI HTTP, runtime-only operation-header evidence, and position overflow are also incorporated.

Fresh-context scope review of the remediated P1.4a returned **PASS — no further split**. The remaining P1.0 acceptance, delivered P1.0a package, and published Catalog exact quantity/UoM contract are implementation prerequisites, not missing P1.4a design decisions.

---

## Planned Field Review

The following is the recommended column set after remediation. `NEW` and `RENAME` mark corrections to the current P1.4a text, not additional product scope.

### `ManufacturingBom` / `manufacturing_boms`

| Field | Purpose | Assessment |
|---|---|---|
| `id` | Stable identity of the BOM family across all revisions. It is the aggregate/root resource ID used by API, action log, events, and future `ProductionDefinition` references. | Keep; assign with `crypto.randomUUID()` in commands when referenced before flush. |
| `tenantId` | Prevents cross-tenant reads/writes and participates in composite scope FKs and uniqueness. | Keep, required. |
| `organizationId` | Makes one family and its graph organization-local and is part of the advisory-lock key. | Keep, required; every route must resolve a concrete organization. |
| `productId` | Required Catalog product target and the product-level family-resolution key. | Keep as scalar UUID; no cross-module ORM relation/FK. |
| `variantId` | Optional Catalog variant target; exact variant family wins before product fallback. | Keep as nullable scalar UUID; command validates ownership by `productId`. |
| `nextRevisionNumber` | Transactional allocator for the next system revision number; prevents `max()+1` races and is reused by P1.7. | Keep; use `CHECK >= 2` after initial create. |
| `createdAt` | Creation audit timestamp retained through soft-delete undo/redo. | Keep. |
| `updatedAt` | Family/list ordering and change timestamp. It is not the client lock token; the active revision token is authoritative. | Keep and state this distinction explicitly. |
| `deletedAt` | Soft-delete marker required for undo and target reuse without destroying history. | Keep; nullable. |

No family name/code is required in P1.4a: the Catalog target identifies the family and `revisionLabel` carries optional user-facing revision text.

### `ManufacturingBomRevision` / `manufacturing_bom_revisions`

| Field | Purpose | Assessment |
|---|---|---|
| `id` | Stable identity of one revision; later release and production-definition references point to a revision, not mutable family state. | Keep; client-side UUID when needed before flush. |
| `bomId` | Parent family identity. | Keep with `(bomId,tenantId,organizationId)` composite FK and `ON DELETE RESTRICT/NO ACTION`. |
| `tenantId`, `organizationId` | Repeats scope so every revision query and child FK is independently fail-closed. | Keep, required. |
| `revisionNumber` | Immutable, system-assigned sequence within a family. | Keep with `CHECK >= 1` and unique `(bomId,revisionNumber)` including deleted rows. |
| `revisionLabel` | Optional human label/code that does not replace the system revision number. | Keep, nullable, trimmed, max 120; not unique. |
| `status` | Lifecycle seam for P1.7; P1.4a persists only `draft`. | Keep only with an explicit DB check for the P1.4a value and a stated P1.7 migration to widen it. |
| `baseOutputEnteredQuantity` | Exact quantity entered by the user for the revision's output basis. | `RENAME` from `baseOutputQuantity` for unambiguous entered-vs-normalized semantics. |
| `baseOutputEnteredUnitCode` | Canonical unit in which the base output was entered. | `RENAME` from ambiguous `baseOutputUnitCode`; the old name can be mistaken for normalized/base unit. |
| `baseOutputNormalizedQuantity` | Resolver-produced quantity in Catalog's base unit, used by P1.4b/P1.7 calculations without JavaScript arithmetic. | Keep. |
| `baseOutputNormalizedUnitCode` | Scalar unit paired with normalized quantity, so the normalized value is self-describing without parsing JSON. | `NEW`; aligns with the existing Sales persistence model and simplifies P1.4b unit checks. |
| `baseOutputUomSnapshot` | Immutable `QuantityNormalizationSnapshotV1` evidence: target, entered values, factor, base unit, result, rounding, conversion source, and resolution time. | Keep as required JSONB; validate version and equality with duplicated scalar columns. |
| `createdAt` | Revision creation timestamp retained across undo/redo. | Keep. |
| `updatedAt` | Authoritative optimistic-lock token for the entire active draft aggregate. Every successful aggregate mutation advances it monotonically. | Keep; do not use line/family timestamps as lock tokens. |
| `deletedAt` | Soft-delete marker for family delete, create undo, and future lifecycle operations. | Keep. |

### `ManufacturingBomLine` / `manufacturing_bom_lines`

| Field | Purpose | Assessment |
|---|---|---|
| `id` | Stable occurrence identity. Two identical component selections remain two different rows and undo/reorder targets the exact occurrence. | Keep; client-side UUID when needed before flush. It must never be a deduplication key. |
| `revisionId` | Parent draft revision. | Keep with `(revisionId,tenantId,organizationId)` composite FK and `ON DELETE RESTRICT/NO ACTION`. |
| `tenantId`, `organizationId` | Makes every line independently scope-safe and supports scoped indexes/FKs. | Keep, required. |
| `componentProductId` | Required Catalog product identity of this component occurrence. | Keep as scalar UUID; no Catalog ORM relation/FK. |
| `componentVariantId` | Optional variant identity for variant-first then product-fallback child-BOM resolution. | Keep nullable; validate ownership by component product. |
| `enteredQuantity` | Exact nominal quantity entered for this one occurrence. | `RENAME` from generic `quantity` to make snapshot/scalar invariants explicit. API may still expose `quantity.value`. |
| `enteredUnitCode` | Canonical unit paired with the entered quantity. | `RENAME` from generic `unitCode`. |
| `normalizedQuantity` | Resolver-produced nominal quantity in the component's Catalog base unit. | Keep. |
| `normalizedUnitCode` | Scalar unit paired with `normalizedQuantity`, avoiding a hidden unit stored only inside JSON. | `NEW`; required for self-describing values and P1.4b compatibility checks. |
| `uomSnapshot` | Immutable resolver evidence for target, entered values, conversion, normalized result, and rounding policy. Exact undo restores this historical object rather than recalculating it. | Keep as required JSONB; validate version and scalar equality. |
| `consumptionBasis` | Distinguishes output-proportional (`variable`) from per-order/batch (`fixed`) nominal consumption. | Keep; default `variable`; DB enum/check. |
| `yieldFactor` | Encodes expected usable fraction in `(0,1]`; later explosion computes gross demand deterministically. | Keep as exact decimal string/`numeric`; default `1`; DB range check. |
| `supplyMode` | `stock` makes the occurrence a leaf; `produce` enables child-family resolution and graph edges. | Keep; default `stock`; DB enum/check. |
| `position` | Stable explicit order independent of component identity and preserved by undo. | Keep positive integer for Wave 0; document practical limit or use `bigint`. |
| `createdAt` | Occurrence creation timestamp retained through undo/redo. | Keep. |
| `updatedAt` | Per-row audit/conditional-undo evidence, not a separate optimistic-lock token. | Keep and document that clients lock with revision `updatedAt`. |
| `deletedAt` | Soft-delete marker enabling exact occurrence restore and preserving repeated-component history. | Keep nullable. |

### Fields deliberately not added

- No `childBomId` or `childRevisionId` on a draft line: resolution is dynamic (variant first, product fallback) until P1.7 freezes released dependencies.
- No `bomId` duplication on a line: `revisionId` plus the scoped FK is sufficient.
- No `operationId`, routing, work-center, site/effectivity, WMS, alternate/substitute, or phantom fields: those belong to later specs.
- No `createdBy`/`updatedBy` columns: actor history belongs to the action log unless a later requirement needs queryable ownership.
- No family `name`/`code`: the target is unique in Wave 0 and the revision has an optional label.
- No custom-field columns or extension storage in P1.4a.

---

## Backward Compatibility

### 14-Surface Audit

The skill still refers to 13 categories, while the current `BACKWARD_COMPATIBILITY.md` has 14 because AI IDs and CLI commands are separate. All current categories were checked.

| # | Surface | Impact | Verdict |
|---:|---|---|---|
| 1 | Auto-discovery conventions | Adds standard module convention files only. However, P1.0a publishes only `.` and `./modules/manufacturing/index`, while generators import discovered API, commands, DI, entities, pages, events, ACL, and locale files through deeper package subpaths. | **Critical dependency contradiction** |
| 2 | Public types/interfaces | New DTOs and event payload types only; no current type is narrowed. Payload fields must be frozen before publication. | Additive, incomplete |
| 3 | Function signatures | No existing function signature changes. | OK |
| 4 | Import paths | No existing path moves. The final Catalog public import/type and generator-visible Manufacturing subpaths are not frozen. | Blocked by dependencies |
| 5 | Event IDs | Seven new IDs are collision-free. Exact required/optional payload fields are not defined. | Additive, incomplete |
| 6 | Widget spot IDs | Proposed dotted table/form hosts are new and collision-free but are not declared in `extension-points.ts`. Once published they become frozen. | Additive, incomplete |
| 7 | API routes | Ten new routes are collision-free and do not modify existing routes. | OK, additive |
| 8 | Database schema | Three new tables/indexes are collision-free and additive. No backfill. | OK after integrity fixes |
| 9 | DI service names | The Catalog key is intentionally pending its public quantity/UoM contract; the claimed BOM aggregate service has no frozen key or `di.ts` plan. | Incomplete |
| 10 | ACL feature IDs | Two new singular IDs are collision-free. Their default grants are missing from `setup.ts`. | Additive, incomplete |
| 11 | Notification type IDs | None. | N/A |
| 12 | AI agent/tool/UI IDs | None. | N/A |
| 13 | CLI commands | None. | N/A |
| 14 | Generated file contracts | No existing generated shape changes, but source/dist discovery cannot work with P1.0a's current export map. | **Critical dependency contradiction** |

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---:|---|---|---|---|
| BC-1 | Auto-discovery/generated imports | P1.4a says it adds no package export; P1.0a exposes only two paths, but the generators emit imports to convention-file subpaths. A packed standalone module will fail resolution. | **Critical** | Amend P1.0a to expose generator-required source/dist discovery subpaths and locale JSON while keeping domain APIs private; add source, packed-dist, and create-app discovery tests. |
| BC-2 | Event contracts | Event IDs are named, but their payload schemas are described only as “scoped IDs, revision version, correlation/undo context.” Removal of a published payload field is breaking. | **Warning** | Define exact per-event schemas/types before publication; do not promise an undo token that is not available during handler execution. |
| BC-3 | Widget hosts | `extensionTableId` derives public host IDs, but the spec does not declare/freeze their contracts. | **Warning** | Add `extension-points.ts` with exact DataTable/CrudForm hosts, source bindings, context, and data contracts—or omit extension IDs until intentionally published. |

### Missing BC Section

The spec has “Migration and Compatibility,” so the section is present. It needs the package-discovery export impact and the event/widget public-contract inventory above.

---

## Spec Completeness

### Missing Sections

None. TLDR, overview, problem, solution, architecture, data, API, UI, i18n, commands/events/undo, compatibility, phases, tests, risks, compliance, and changelog are present.

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| Data Models / Quantity persistence | Retargeting a family or line can preserve scalar quantities and a snapshot for the old Catalog identity. Normalized unit exists only in JSON. | Freeze effective-state renormalization rules; adopt the corrected field set and DB/app consistency checks above. |
| Transaction/locking | It says every execute/undo/redo requires an expected HTTP token, but platform undo/redo accepts no fresh version token. | Restrict HTTP preconditions to interactive writes. Undo/redo verifies recorded current semantic state under locks, then advances timestamps. |
| Optimistic-lock contract | Calls strict missing-header `428` “canonical,” while the platform helper intentionally treats missing/invalid tokens as an additive no-op and honors a global opt-out. | Choose explicitly: platform-optional locking, or a BOM-specific mandatory precondition implemented and documented independently. The owner-approved integrity goal favors the latter. |
| Commands/action log | “Framework compound-command” does not exist. `withAtomicFlush` atomizes phases of one handler, while CommandBus writes the action log after handler commit. | Specify one `manufacturing.bom.create` handler, internal phases, one domain transaction, and one later log/undo boundary. Do not claim domain+log transaction atomicity. |
| Undo snapshots | Security text says logs exclude snapshots, while exact undo requires historical quantity/UoM snapshots. Standard post-execute `captureAfter` can race with a later command. | Clarify that sensitive/raw request logging is excluded but minimal typed undo snapshots, including UoM evidence, are stored. Capture before/after inside the command transaction and return them internally to `buildLog`. |
| Delete undo | Deleting a family can affect an unbounded line set; the exact log representation and restore selection are not specified. | Give every row changed by one delete the same deletion marker; undo restores only rows matching revision/family plus that marker after semantic-state checks. Avoid unbounded line blobs in action-log JSON. |
| API patch semantics | “Partial nested line input” does not say whether nested component/quantity objects are complete replacements. | Require at least one top-level change; when present, `component` and `quantity` are complete objects. Build an effective target+quantity from payload and stored state, then normalize once. |
| Scope/cursors | Routes say concrete org, but do not name `resolveOrganizationScopeForRequest`/`selectionRejected`; cursors bind organization but not tenant. | Require the scope helper, fail with platform `organization_selection_invalid` before data access, use `selectedId`, and bind both tenant and organization into strict versioned cursors. |
| ACL/module wiring | Admin grants are stated but `setup.ts` and `di.ts` are absent from expected paths. | Add `setup.ts`, exact `defaultRoleFeatures`, existing-tenant `auth sync-role-acls`, and either a frozen BOM service registration or internal functions. |
| Events | Exact definitions, persistence/broadcast flags, and post-commit failure response semantics are not frozen. Undo token is generated after handler execution. | Use `createModuleEvents(... as const)`, exact schemas, required scope IDs, `clientBroadcast`, persistent emission, no undo token, and catch/log post-commit failures so a committed write still returns success. |
| UI submission | Embedded line `CrudForm` plus `useGuardedMutation` would run widget save hooks twice. `apiCall` does not throw on 409, so a guarded mutation can treat failure as success. | Let `CrudForm` own add/edit. Use `useGuardedMutation` only for non-form writes and call `apiCallOrThrow`/throwing CRUD adapters. |
| DataTable/CrudForm IDs | Dotted `manufacturing.bom` is an extension/resource ID, not the generated entity ID. Passing it as `entityId` also activates custom-field-definition loading although custom fields are excluded. | Omit `entityId` for P1.4a and retain dotted `extensionTableId`; if entity-backed custom fields are later enabled, use generated `E.manufacturing.manufacturing_bom*` IDs and declare `ce.ts`. |
| OpenAPI | The current OpenAPI response type/generator cannot describe `x-om-operation` response headers. | Keep runtime header tests, or make a separately approved shared OpenAPI enhancement; do not claim current generated docs contain the response header. |
| Constraints/indexes | “Constraint names” overlooks partial unique indexes; status/snapshot/FK delete actions and filtered list/summary indexes are incomplete. | Map database constraint **or index** names to domain errors; declare checks/FK actions and add the scoped product-keyset plus unresolved-produce indexes. |
| Catalog lifecycle | “Valid Catalog resolution” does not define whether inactive but non-deleted products/variants may be authored. | Freeze create/retarget/renormalize policy; keep cleanup/delete operations available even if Catalog enrichment later disappears. |

---

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|---|---|---|
| New `acl.ts` features require `setup.ts.defaultRoleFeatures`. | ACL and Implementation Plan | Add `setup.ts`; grant view/manage to admin and neither to employee; run/test `yarn mercato auth sync-role-acls` for existing tenants. |
| Entity reads use `findWithDecryption`/`findOneWithDecryption`; encryption map is N/A only because there are no protected fields. | Snapshot, encryption, and security | Do not call read helpers N/A. Require scoped decryption-aware reads; keep `defaultEncryptionMaps` N/A. Put unavoidable raw graph SQL in a scoped repository utility. |
| Custom routes resolve org scope and reject an invalid explicit selection. | API Contracts | Pin `resolveOrganizationScopeForRequest`, `selectionRejected`, concrete `selectedId`, and pre-data-access rejection. |
| Guard-transformed payload must be revalidated and path/scope authority restored. | API/Testing | Initial Zod parse -> guard -> merge body -> Zod re-parse -> overwrite path/auth scope -> command -> post-commit `runAfterSuccess`. |
| `CrudForm` owns its own widget mutation lifecycle. | Direct component editor | Do not wrap a CrudForm submit in `useGuardedMutation`; reserve the hook for reorder/external delete. |
| A guarded write must reject non-2xx promises. | Direct component editor | Use `apiCallOrThrow` or throwing CRUD adapters, never bare `apiCall` inside `useGuardedMutation`. |
| Icon-only controls use `IconButton`, Lucide, explicit `type="button"`, and translated `aria-label`. | Move up/down controls | Name the primitive and attributes explicitly. |
| Commands that reference new DB-generated IDs before flush assign them client-side. | Entities/commands | Use `crypto.randomUUID()` for family/revision/line IDs as applicable; retain DB defaults as fallback. |
| Command-log after snapshots cannot reuse stale identity-map state. | Commands | Capture immutable before/after data inside the transaction/result; otherwise use a forked EM or `refresh:true`. |
| Event declarations use `createModuleEvents(... as const)`. | Events | Freeze full declarations and payload types, not only abbreviated ID families. |

The module boundary, scalar Catalog IDs, zod inputs, command-owned writes, mutation-guard choice, DataTable/CrudForm selection, keyboard behavior, i18n plan, optional-peer isolation, and no-cache decision otherwise align with the repository rules.

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Snapshot belongs to a previous family/component target | Persisted quantity evidence becomes internally false; preview/release can calculate against the wrong product or variant. | Effective-state normalization on every target/entered-quantity change plus scalar/JSON consistency checks. |
| Undo/redo uses an obsolete HTTP token or racy post-commit snapshot | Valid undo always fails, or undo overwrites/records a later writer's state. | Semantic state preconditions under the graph/row locks; transactional snapshot capture; monotonic new token. |
| P1.0a package exports hide discovered files | Source may appear to work in the monorepo while packed/dist/create-app generation fails to resolve routes, commands, entities, DI, pages, or locales. | Correct export map and test source plus packed dist before P1.4 implementation. |
| Strict lock relies on optional platform helper | Missing-token writes silently bypass the promised draft serialization when configuration is disabled or token is invalid. | BOM-specific required-token parser and in-transaction comparison, followed by Enterprise-aware guard integration. |
| Post-commit event/log failure is returned as write failure | Client retry can duplicate a valid line occurrence or family command after the DB commit. | One domain transaction; fail-soft post-commit emission; make response semantics explicit. Consider stable client occurrence ID/idempotency only if generic retry idempotency is required. |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Full organization graph load/lock on every edit | Unrelated BOM edits in one organization serialize; latency grows without a hard tenant graph bound. | Keep correctness-first Wave 0 behavior, benchmark stated scale, record lock wait/hold, and later avoid graph work for label/quantity/basis/yield/reorder-only changes. |
| Missing normalized unit scalar | Quantities are not self-describing without JSON parsing and P1.4b unit compatibility is easier to implement incorrectly. | Add the two normalized-unit columns before migration publication. |
| Partial unique index error mapping is imprecise | Target/draft races surface generic 500s or invalid `ON CONFLICT ON CONSTRAINT` SQL. | Name indexes, map unique-violation index names, and use exact predicate inference if raw upsert is ever used. |
| Scope cursor omits tenant | A cursor can be replayed into another tenant with a coincident organization ID/filter shape. | Bind and validate tenant, organization, version, limit, IDs, token, and filter digest. |
| Missing filtered indexes | Product-filtered keyset list and unresolved-produce summary degrade into growing scans. | Add targeted partial indexes and verify query plans. |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `position integer` with 1024 gaps eventually overflows | Requires roughly two million uninterrupted appends to one revision. | Document a cap/renumber strategy or use `bigint`. |
| API list item reuses full active-draft detail | Larger list payload than the list UI needs. | Define a smaller list revision summary. |
| Generic network retry of line create | A legitimate repeated occurrence can be added unintentionally. | Optional client-generated occurrence ID/idempotency contract; do not deduplicate by component identity. |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

1. **Target/snapshot coupling:** family retarget and line component replacement need deterministic effective-state renormalization and atomic rewrite of every scalar plus JSON snapshot.
2. **Undo/redo contract:** undo/redo cannot require a fresh request token; snapshots must be captured transactionally and exact UoM evidence must remain in the action log.
3. **Mandatory locking contract:** choose and document a BOM-specific strict precondition instead of calling the platform's optional compatibility behavior canonical.
4. **Package discovery:** correct P1.0a's export map so P1.4 convention files can be imported from source and packed `dist`.
5. **Framework sequencing:** replace the nonexistent compound-command claim; freeze one-handler/domain-transaction/action-log/event ordering and fail-soft post-commit behavior.

Known external capability prerequisite: the exact Catalog resolver/key/type is not implemented or frozen yet. P1.4 must not recreate its arithmetic locally.

### Important Gaps (Should Address)

- Freeze the corrected entered/normalized field names and add normalized-unit scalar columns.
- Add DB checks for status/enums/ranges/snapshot V1/scalar consistency, explicit composite FK delete actions, and filtered indexes.
- Add `setup.ts`, DI plan, package manifest/export changes, exact event payloads, and intentional extension-point declarations.
- Specify scope-helper rejection, tenant-bound cursors, guard transform re-parse, action-log resource ordering, and delete restore markers.
- Correct UI submission ownership, throwing HTTP calls, generated-vs-extension entity IDs, page metadata, and exact IconButton behavior.
- Decide Catalog inactive-record authoring behavior.
- Treat `x-om-operation` as runtime-tested unless shared OpenAPI response-header support is separately approved.

### Nice-to-Have Gaps

- Avoid the organization graph lock/check for mutations that provably cannot change an edge after Wave 0 correctness is established.
- Consider `bigint` for `position`/revision counter or document practical maxima.
- Add optional retry idempotency using occurrence identity, never component deduplication.
- Trim the BOM list DTO to the columns actually displayed.

---

## Remediation Plan

### Before Implementation (Must Do)

1. Amend P1.0a's package exports/discovery evidence; consume the Catalog resolver key/type once its public quantity/UoM contract is available.
2. Amend P1.4a quantity mutation rules using effective target+entered values and atomic complete snapshot replacement.
3. Freeze the corrected column names, normalized-unit columns, DB checks/FKs/indexes, and Catalog lifecycle policy.
4. Replace the strict-lock/undo contradiction with separate interactive-write and semantic undo/redo contracts.
5. Replace “compound command” with one handler plus transactional phases; define action-log/event ordering, exact event payloads, and fail-soft post-commit behavior.
6. Add missing module/API/UI wiring contracts: `setup.ts`, DI, scope helper, cursor tenant, guard re-parse, extension points, UI submission ownership, and runtime-only operation-header evidence.

### During Implementation (Add to Spec)

1. Assign required UUIDs before pre-flush references and capture command snapshots inside the transaction/result.
2. Hand-review migration SQL and snapshot for partial predicates, composite FKs, `ON DELETE RESTRICT`, checks, and index names.
3. Extend generator fixtures for source, packed dist, disabled module, Catalog-required failure, optional peers absent, and create-app packaging.
4. Assert constraint/index-to-domain-error mapping and query plans for product list, ordered lines, unresolved summary, and graph validation.

### Post-Implementation (Follow Up)

1. Run the documented generate/build/typecheck/unit/integration/OpenAPI/i18n/client-boundary/create-app gates.
2. Measure organization graph-lock wait/hold and graph memory/query bounds at and above the stated benchmark.
3. Let P1.7 widen revision status and freeze released child revisions without changing P1.4a occurrence identity.

---

## Recommendation

**Spec-level remediation complete.** The three-entity model, two normalized-unit scalars, entered-value names, API/UI/command contracts, and package-discovery contract are now frozen in the current specifications. P1.4a is ready at specification level; product implementation must still wait for P1.0 acceptance, delivered P1.0a, and the Catalog public quantity/UoM contract.
