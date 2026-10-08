# Attachment Access Resolvers

## 📝 TLDR

Give an owning module an additive attachment authorization extension that narrows the host's tenant/organization checks. Enforce it before original bytes, derived images, metadata, reassignment and deletion. Adopt it in Documents using its existing ownership, sharing and feature checks, and persist the required resolver identity so disabling Documents cannot expose existing files.

Issue: [#6726](https://github.com/open-mercato/open-mercato/issues/6726). This document delivers the design; implementation ships separately. Storage validation is separate work in [#6820](https://github.com/open-mercato/open-mercato/pull/6820).

## Resolved assumptions (autonomous defaults)

| Question | Decision and rationale |
| --- | --- |
| Q1: Protection lifetime and shared partitions | Persist owner-selective requirements on partitions. Bind each to a resolver ID, not merely the presence of any wildcard resolver. Documents protection must not affect unrelated `sync_excel` rows in `privateAttachments`. |
| Q2: Generic records/export | `entities/api/records.ts` rejects ORM-backed system entities before listing/exporting. `attachments:attachment` is ORM-backed despite its `ce.ts` declaration. Keep that rejection and pin it with live export tests. |
| Q3: First adopter | Include Documents. Its actual sharing policy proves the capability at the host URLs its existing private route cannot protect. Messages and Warranty Claims policy migrations remain out of scope. |
| Q4: Existing contracts | Keep synchronous `checkAttachmentAccess` and existing public service inputs. Add an asynchronous runner, optional constructor dependencies and an existing-mechanism generator plugin. |
| Q5: Disabled-on-upgrade Documents | Backfill requirements for existing partitions referenced by Documents primary or assignment ownership. This historical identifier is migration knowledge, with no runtime Documents import or ORM relation. Trusted synchronization covers future partitions. |
| Q6: Behavioral compatibility | **⚠ NEEDS HUMAN CONFIRMATION before merge:** apply the existing Documents ACL to formerly organization-wide host access. Request the Emergency Security Exception's named human maintainer acknowledgment; do not preserve a disclosure bypass. The extension itself is additive. |

## 📝 Overview and Problem Statement

The byte routes check scope and public/private partition behavior. Library routes and mutations use organization-wide attachment features. Documents separately checks each document's owner/shares, but its files remain reachable through host attachment URLs. A same-organization colleague who cannot view the document can consequently retrieve its bytes or extracted text through the host.

The scope hardening in `2026-06-09-attachments-scope-invariant.md` remains mandatory: complete tenant/organization pairs, global rows only when both are null, and existing explicit superadmin behavior. Owner resolvers cannot override the baseline.

This is one attachment authorization capability with one real adopter. It adds no external policy dependency, new UI, clinical domain logic, replacement storage service, attachment export endpoint or general authorization framework.

## 📝 Proposed Solution

Modules export declarations from `data/attachment-access.ts`. An attachments generator plugin aggregates enabled modules into `attachment-access.generated.ts`, then registers them through `bootstrap-registrations.generated.ts`. Runtime packages consume the registry through package exports, never app-generated imports.

The runner calls the unchanged core check first, verifies durable required-provider coverage, then invokes every matching resolver in deterministic order. Denial stops evaluation. No feature-based skip field exists; a callback checks server-resolved features internally. Existing unadopted owners retain their permissions and successful response shapes. Documents gains its existing per-record restrictions at all host boundaries.

### Research and alternatives

[OpenFGA relationship-query guidance](https://github.com/openfga/openfga.dev/blob/main/docs/content/interacting/relationship-queries.mdx) distinguishes checking database candidates from listing authorized objects. This design checks candidates before pagination/count disclosure and memoizes within a request; no remote policy service is introduced. [OPA error guidance](https://www.openpolicyagent.org/docs/errors) demonstrates why policy evaluation errors need explicit handling. Here errors cannot become skipped rules or allows.

Static features cannot express a document share. A last-writer-wins adapter can replace a restriction. Response enrichers act too late and can fail open. Module-owned download routes leave the host URL accessible. Generated protection alone disappears when its provider is disabled; durable data requirements prevent that failure.

## 📝 Architecture

### Public contract and placement

Export domain types/functions from `@open-mercato/core/modules/attachments`; implement them in the module's `lib/`. Shared must not import core ORM entities or Documents. Inputs are structural snapshots, not live ORM entities.

```ts
type AttachmentAccessAction =
  | 'read' | 'render' | 'metadata' | 'reassign' | 'delete' | 'export'

type AttachmentAccessTarget = {
  entityId: string
  recordId: string
  origin: 'primary' | 'assignment'
}

type AttachmentAccessDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404 | 504; reason: string }

type AttachmentAccessRequirement = {
  resolverId: string
  targetEntity: string
}

type ProtectedAttachmentTarget = AttachmentAccessRequirement & {
  targetPartition: string
}

type AttachmentAccessResolver = {
  id: string
  targetPartition: string
  targetEntity?: string
  actions?: AttachmentAccessAction[]
  priority?: number
  timeoutMs?: number
  resolve(input: AttachmentAccessInput): Promise<AttachmentAccessDecision>
}
```

`AttachmentAccessInput` contains action; immutable attachment snapshot (ID, primary owner, partition code, scope, filename, MIME type); immutable partition scope/public state; normalized primary/assignment targets; and subject with authenticated auth, concrete active `userFeatures`, effective tenant/organization and live superadmin status. It also supplies the request/service container, request-local `Map<string, unknown>` and `AbortSignal`. Do not expose raw metadata or a mutable attachment entity.

The host accepts nullable auth to preserve anonymous global-public access. Where owner policy applies, anonymous access returns 401 before callbacks, whose subjects therefore remain authenticated. This first contract does not add anonymous owner policies.

The convention file exports `attachmentAccessResolvers` and optional `protectedAttachmentTargets`. Registration receives `{ moduleId, resolvers, protectedTargets }[]`. Validate declarations with zod: nonempty stable `<module>.<name>` IDs, supported actions, finite priorities, positive bounded timeout, and valid selectors. Duplicate IDs/invalid declarations fail registration; never silently replace a resolver or discard a protection declaration.

### Matching, order and failure

Partition and entity selectors are ANDed; the entity selector matches any primary/assignment target. Support exact names, `*` and terminal `prefix.*`, following the existing wildcard conventions. Omitted entity means every owner in the partition. Reject other glob syntax. A whole-partition `*` owner requirement applies even if the row has no valid targets. For entity-specific requirements, preserve a declared owner entity when its record ID is missing/invalid: detect protection first, then deny the malformed target. Normalization must never discard a malformed Documents reference into an unprotected row.

Run matched resolvers by ascending priority (default 50), then generated module order and declaration order. The baseline runs unconditionally before this sortable list, so negative priorities cannot precede it. Allows only continue evaluation.

Union generated protected targets with persisted partition requirements. For each requirement whose owner selector matches, its named resolver must exist and match the partition, owner and action. Otherwise deny 403. An unrelated wildcard resolver cannot replace missing Documents policy; an action-restricted required resolver cannot leave other actions open.

Construct fresh frozen snapshots so one callback cannot rewrite later inputs. Malformed decisions, thrown/rejected callbacks and subject-projection failures deny 403. Callback timeout denies 504, default 1500 ms. Abort the signal, clear timers and ignore late completion. A callback ignoring cancellation cannot be forcibly stopped in-process; callbacks must be read-only and cancel their external work.

Use structured denial logs with resolver ID, action, attachment ID and a bounded reason code. Also call `reportError` for caught evaluation failures. Do not log file content, credentials, filenames, share lists, raw auth or arbitrary provider exception payloads. Return localized generic errors, not internal reason strings.

### Subject and request cache

Preserve current route scope resolution and lookup filters. After baseline authorization, use current ACL and `rbacService.getEffectiveFeatures` for the effective attachment scope. Do not trust token feature arrays, role names or stale token superadmin status for owner policy. Existing RBAC handles API-key subjects and enabled-feature overrides. Missing/failed projection denies rather than becoming permissive empty features.

Memoize projection per principal/effective scope within the request. The host gives each resolver its own cache namespace; one callback cannot accidentally read another callback's memo entry. Within that namespace, cache Documents policy data by principal, scope and document ID. Never memoize a final decision by attachment ID alone: source/destination checks have different target sets. No cross-request decision cache is introduced; the next request observes share/role revocation through existing services and invalidation.

DI-created attachment/read-link services receive a lazy policy context without eagerly constructing storage/upload dependencies. Existing constructor calls and public method inputs remain valid. Missing context when policy is required denies. `AttachmentTargetAccessService` preserves caller-supplied expected-target matching and additionally narrows its result through policy; link membership is never owner authorization.

### Documents adopter

Register `documents.document-attachments` across partitions, narrowed to `documents:document`; declare that same owner selector and required resolver ID. This covers historical assignments outside the default bucket without governing unrelated owners.

Reuse Documents' `resolvePermission`, `deriveDocumentCapabilities` and active subject-role projection. Documents queries its own scoped encrypted entities; core never imports them. For read/render/metadata/export, require `documents.view` and a current owner/share relationship; preserve the existing live Documents manager/superadmin override. `attachments.manage` is not a Documents override.

Original/derived byte reads require a viewable Documents target, matching the issue's multi-link read semantics. Metadata/export require every Documents target to be viewable because the row contains all assignment identifiers and labels; an accessible secondary target must not reveal a hidden document. Delete/reassign require the existing attachment-edit capability on **every** Documents target, including non-archived status. Existing Documents attachment deletion requires editing, not the separate document-delete feature. Missing/deleted owners deny. Ordinary Documents rejection returns 404 to avoid confirming file existence.

For transfer/assignment changes, authorize both original and prospective snapshots before modifying rows. A viewer cannot move a protected file to their own document or strip its last protected assignment without source-edit permission. Authorize all bulk rows before flush or cleanup; one denial leaves all unchanged. Use final guard-modified payloads, not the original pre-guard input. Reload and lock affected attachment rows in the mutation transaction before constructing the checked snapshots; acquire bulk locks in stable ID order. Hold the locks through the row writes so a concurrent reassignment cannot change ownership between check and use. Keep provider cleanup after its existing durable commit boundary. Do not reuse a decision cached for an earlier snapshot.

### Metadata and caching

Authorize before serializing extracted `content`, custom fields, URLs or assignment labels. Filter before user-visible pagination/counts. Available tags derive only from authorized rows; static partition configuration retains its current feature guard and does not reveal attachment existence.

Use database batches of at most 100 and stable ordering with an ID tie-breaker. Keep existing DB count/page fast paths only when no applicable declarations or durable requirements exist. With policy, scan scoped candidates for exact authorized count/page and retain only that page plus facets in memory. Preserve available tags across authorized scope, independent of active filters. Request-local owner projection caching avoids repeated document queries.

Bound the whole authorization pass to 15 seconds as well as per-callback timeouts. Incomplete evaluation returns 504 with no partial list or raw totals, never a truncated count. A measured batch-policy API is future work, not a speculative addition here.

Image authorization precedes thumbnail-cache lookup. Responses covered by owner policy use `Cache-Control: private, no-store`, including public partitions, so caches cannot preserve grants after revocation. Unadopted public caching remains unchanged. New headers cannot recall copies cached before deployment: operators must purge affected CDN/reverse-proxy caches, and previously downloaded copies cannot be revoked.

## 📝 Data Model

Add nullable JSONB `access_resolver_requirements` to `attachment_partitions`, mapped to optional `accessResolverRequirements: AttachmentAccessRequirement[] | null`. Null/empty means no durable requirement. Values are policy identifiers/selectors, with no PII, secrets or cross-module ORM relation. Use the existing partition `updated_at`; no new user-editable entity is added.

Partition create/update APIs do not accept this field. Storage `configJson` cannot replace it. Normal manager edits preserve requirements; deletion/recreation remains blocked while attachments exist. Malformed non-null durable data fails closed rather than becoming empty.

### Migration and backfill

The attachments migration creates the column, then unions `{ resolverId: 'documents.document-attachments', targetEntity: 'documents:document' }` into each partition referenced by an attachment whose primary entity is Documents or whose assignment has `type: 'documents:document'`. Use actual partition codes, preserve other requirements and avoid duplicates.

Normalize arrays and legacy single-object assignments consistently with `normalizeAttachmentAssignments`, including trimmed type strings. Missing/null/string values must not crash the migration. Valid entries still count among malformed siblings. A Documents-typed entry with an invalid/missing record ID still marks protection; runtime denies that malformed owner instead of dropping it into unprotected access.

The historical Documents identifier in this migration imports no runtime code, touches no Documents table and works with Documents disabled during upgrade. This closes the window between deploying the host and running enabled-module setup.

### Trusted synchronization

Expose an idempotent attachments-owned helper that unions registered protected targets into matching partitions. Call it during attachment setup/default-partition initialization and new-partition creation. It never removes persisted requirements when a provider disappears and never takes browser-supplied requirements. Document a trusted upgrade invocation for third-party adopters with existing partitions, required before disabling their provider.

Preserve concurrent additions with an atomic union or transaction/row lock. Use an independent unit of work to avoid flushing unrelated caller mutations. A new protected upload cannot commit before its partition requirement is durable. Failed synchronization leaves the upload uncommitted; existing reservation/provider cleanup handles rollback.

## 📝 API Contracts

No URL, method, input or successful response field is removed.

| Boundary | Policy placement |
| --- | --- |
| `GET /api/attachments/file/:id` | `read` for download, `render` for inline; before bytes. |
| `GET /api/attachments/image/:id/...` | `render`, before cache/storage. |
| `attachmentService.readScoped` | `read`, retaining expected owner/assignment, partition and scope checks. |
| `attachmentTargetAccessService.canAccessLinkedTarget` | `read`, preserving expected link membership; policy denial returns false. |
| `GET /api/attachments/library` | `metadata` before enrichment, with authorized pagination/count/facets. |
| `GET /api/attachments/library/:id` | `metadata` before content/custom fields. |
| Entity/record attachment GET | `metadata` per row before serialization. |
| `POST /api/attachments/transfer` | `reassign` on all original/prospective rows before writes. |
| `PATCH /api/attachments/library/:id` | `reassign` on original/prospective assignments before tags/custom fields/ORM mutation. |
| Both host DELETE routes | `delete` before row, thumbnail or provider mutation. |
| Generic entity records/export | Preserve the existing system-entity 400 rejection for attachment rows. |

Document policy 401/403/404 and timeout 504 in affected OpenAPI contracts. Reuse localized auth/not-found messages and add access-timeout translations in all locales. Preserve mutation guards, modified payloads, callbacks, indexer events, quotas and transaction order; authorize after guard modifications and before mutation.

Explicit trusted principal-free boundaries remain: attachment CLI deletion, OCR/text extraction workers, and `createScoped`/`releaseScoped` called by authorized owner commands. Do not invent user principals for background jobs or require new arguments on their public inputs. Request-facing host writes and authenticated `readScoped` cannot use that trusted bypass. There is no attachment-owned AI/MCP endpoint; consumers of authenticated read/link services inherit the restriction. No new generic search indexing is enabled.

## 📝 UI/UX

No screen, component or visual design change. Library lists use existing empty/error states for authorized results. Denied Documents files return generic localized 404; timeouts use the current request-error presentation. Real browser QA proves a shared recipient can open a Documents attachment and an unshared colleague cannot retrieve it at host URLs or discover it in the library. API tests verify raw content, counts and mutation integrity.

## Migration & Backward Compatibility

| Surface | Impact |
| --- | --- |
| Discovery/generated files | Additive convention/plugin/output/bootstrap call; no renamed exports or `BootstrapData` change. Test monorepo and installed-package discovery. |
| Types/signatures/imports | Additive exports/optional dependencies. Existing sync check, service inputs and paths remain. |
| Events/widgets/notifications/ACL/DI/CLI | Existing identifiers unchanged; no new policy-management endpoint/CLI. |
| Database | Nullable column plus narrow repeat-safe historical backfill; preserve old values and all attachment/provider data. Update affected snapshot. |
| HTTP/behavior | Success shapes unchanged; adopted policies introduce documented denials/filtering. Unadopted owners preserve behavior. |

Documents adoption closes the existing same-org disclosure. The Emergency Security Exception requires named human maintainer acknowledgment before merge, including the intentional access tightening and migration. **Acknowledgment is pending; agent review does not provide it.** The implementation also adds the required dated `BACKWARD_COMPATIBILITY.md` entry naming the surface, classification, qualifying argument and migration path. No merge is authorized here.

Upgrade: run the additive migration, regenerate/build registrations, then synchronize enabled declarations before new protected uploads. Backfill protects existing Documents references even when Documents was disabled before upgrade. Missing partitions remain denied by the host/storage-validation error path.

`UPGRADE_NOTES.md` must explain the historical migration identifier, lost access for unshared colleagues, preserved authorized shares/managers, disabled-provider denial, and restoration by fixing the provider/registration. There is no attachments.manage switch to erase protection. Removing a policy requires a deliberate trusted data migration that accounts for the owner's authorization.

Older binaries ignore the new column and reopen disclosure. Retaining it while rolling forward is safe; dropping policy data is not a supported security rollback. If emergency binary rollback is unavoidable, first block affected host endpoints at the deployment boundary. Coding never applies migrations to a developer database; validation uses an owned disposable database.

## 📝 Risks & Impact Review

| Failure | Severity / mitigation / residual risk |
| --- | --- |
| Disabled/missing Documents provider | High: durable named requirement plus historical backfill. Other resolvers cannot replace it. Availability intentionally decreases. |
| Counts/facets/content leak after row filtering | High: authorize before every serialization, count and facet; regress page boundaries and extracted text. |
| Source protection stripped by mutation | High: check both snapshots after guard modifications, and every bulk row before writes/cleanup. |
| Resolver failure, delay or input mutation | High: frozen snapshots, deny-wins, budgets, cancellation, safe diagnostics. Ignored cancellation cannot be forcibly terminated. |
| Wrong feature/share projection | High: current RBAC, active role helpers; test API keys, revocation, wildcard/null overrides and manager behavior. |
| Historical malformed JSON aborts upgrade | High: guarded expansion, actual partition selection and repeat-safe union tested against a disposable DB. |
| Large list authorization cost | Medium: batches, owner memoization, exact count, bounded fail-closed timeout. Future optimization needs profiling. |
| Concurrent sync loses requirements | High: atomic union/row lock, independent unit of work and concurrency regression. Never replace with enabled declarations alone. |
| Storage-validation merge overlap | Medium: preserve #6820 wrappers and resolve-before-delete ordering in shared handlers/exports. |

## 📋 Phasing and Implementation Plan

These are checkpoints of one capability. Do not deploy the adopter without complete host coverage and migration.

### Phase 1: Contract and durable protection

1.1 Add structural types, validated registry, matching/target normalization and generator plugin; test deterministic discovery/bootstrap.

1.2 Add requirements column, reviewed migration/snapshot, trusted union helper and partition synchronization; test disabled-provider backfill, legacy JSON and concurrent/repeated union.

1.3 Add runner/live subject projection, immutable snapshots, budgets, diagnostics and request memoization; preserve baseline regressions.

### Phase 2: Host and real adopter

2.1 Enforce bytes/thumbnail/public read-link services before storage/cache, with protected response cache headers.

2.2 Enforce metadata visibility/count/facets and original/destination/delete authorization before writes; preserve mutation guards and side-effect ordering.

2.3 Register Documents using existing permissions/capabilities/active roles; cover reader/editor/manager, multiple owners, scope and revocation.

### Phase 3: Validation and release evidence

3.1 Ship self-contained live coverage for affected HTTP/service paths and generic export rejection; capture browser recipient/unshared evidence.

3.2 Run configured local validation in order, `yarn test:scripts`, template parity and relevant i18n checks. Register cross-package contract audits in the existing test-classification manifest.

3.3 Review implementation and #6820 overlap, document upgrade/security waiver and measured list limits, publish evidence, and retain draft until required decisions/evidence permit readiness. Never approve QA or merge.

## Integration Test Coverage

Create temporary users, roles, documents, shares, partitions and files; clean them in finally blocks. Do not rely on demo content or another worker's database. Use managed ephemeral CLI and the owned browser descriptor.

| Scenario | Required evidence |
| --- | --- |
| Actual owner/shared/unshared callers | Recipient succeeds through Documents route and both host byte routes; unshared same-org caller gets 404 without bytes/text. Cover library list/detail and entity-record GET. |
| Current permissions | No feature denies; a visible-plus-hidden Documents assignment may allow bytes but must deny metadata/labels; revoked user/role share denies next request; active role share works; API-key subjects use current grants. |
| Metadata pagination/facets | Hidden rows interleaved across pages never enter items/totals/tags/OCR/custom fields/assignment enrichments; visible pages have no gaps/duplicates. |
| Transfer/assignment escalation | Reject source-only/destination-only permission, protected-link stripping and mixed denied bulk transfer; prove rows/bytes unchanged. A concurrent reassignment cannot invalidate the locked authorization snapshot. Editor transfer succeeds. |
| Mutations | Viewer with attachments.manage cannot PATCH/delete; permitted editor can. Denial causes no provider/thumbnail deletion, field write or event. |
| Missing provider | Primary/assignment historical Documents rows deny with empty registry; unrelated wildcard resolver cannot satisfy the requirement. Unrelated owner in the shared partition preserves access. |
| Failure/cache | Throw 403, timeout 504, no bytes/cache reads, late completion cannot grant; protected public responses are private/no-store. |
| Baseline | Global-public anonymous compatibility, private auth, tenant/org isolation, partial-null denial, superadmin baseline; callback allow never overrides core denial. |
| Export | Generic records plus csv/json/xml/markdown attachment exports retain system-entity 400 before disclosure. |
| Migration/sync | Custom/shared partitions, legacy object/array assignments, trimmed owner types, malformed JSON, preservation/union, repeated/concurrent sync, and no Documents runtime/table dependency. |

Fault/disabled-registry tests may use controlled registry real-route fixtures; live Documents tests must use the actual adopter. Do not ship a permissive test-only production resolver.

## Final Compliance Report

- Scope: one attachment authorization capability with real Documents adoption; other owner-policy migrations/storage validation excluded.
- Architecture: attachments owns persistence/runner; Documents owns ACL; generated registration avoids core importing Documents runtime.
- Contracts: additive extension/schema; preserved check/service signatures; intentional access tightening with pending named-human waiver.
- Data: no new personal fields, cross-module ORM relations, credentials or developer database mutation.
- Framework: existing discovery, DI, scoped encrypted queries, RBAC, guards, events, diagnostics and i18n remain authoritative.
- Tests: all host paths, real adopter and disabled-on-upgrade case covered in the plan; no implementation/test success claimed here.
- Review: readiness audit resolved legacy-object backfill, mutation snapshot races and multi-owner label confidentiality. Independent parent review read the full spec and found cohesive scope with no architectural blocker; it required explicit malformed-owner preservation and per-resolver cache namespaces, now included. Fresh-agent capacity was unavailable. This design inspection is not formal code approval or a human compatibility waiver.

## Changelog

- 2026-10-01: Skeleton followed by repository research and autonomous resolution. Specified complete host enforcement, real Documents adoption, durable named-provider requirements, historical backfill, metadata confidentiality and pending human compatibility acknowledgment for #6726.

- 2026-10-01: Readiness audit clarified legacy single-object assignment normalization, transactional locking for owner-changing mutations, and stricter metadata/export authorization for multiple Documents targets.

- 2026-10-01: Independent design review required preserving malformed declared owners during matching, host-isolated resolver cache namespaces, and disclosure of predeployment cache-purge limitations; incorporated before publication.
