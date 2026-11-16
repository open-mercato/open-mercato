# Fulltext index: keep encrypted fields out

> **Program:** package B4 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), split from [`2026-11-16-search-index-pii-protection.md`](2026-11-16-search-index-pii-protection.md). Related: #8134, #7872, #8135.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run. Meilisearch was not started.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-07-24-search-architecture-clarification-and-evolution.md

## 📝 TLDR

When Meilisearch is configured, fields that are encrypted in the database are sent to it as plaintext. A setting that keeps them out exists, is off by default, and misses some of them: a company's name and description still go in. **Proposed (future):** the setting is made correct and tested now. One minor later it becomes the default, at which point fulltext search stops matching on encrypted fields altogether and people are found through the token index instead.

**Not in this spec:** the token and vector indexes (the sibling spec); securing Meilisearch itself, where one API key covers every tenant's index.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Default | Fix and test now; flip one minor later, with an explicit `false` still honoured | ⚠ NEEDS HUMAN CONFIRMATION. The architecture spec already calls plaintext personal data in Meilisearch a regression, which argues for flipping at once. Flipping removes fulltext matching on names, so it gets a release of notice. |
| 2 | How a document names the other entities whose encrypted fields it carries | `encryptionMapEntityIds?: readonly EntityId[]` on `SearchEntityConfig` | Explicit related map ids, deduplicated with the document's own id; no business-table joins in the driver. |
| 3 | Installations without Meilisearch | Nothing changes | The setting has no effect there. |

## 📝 Problem Statement

- **The default sends plaintext.** `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` defaults to off (`packages/search/src/di.ts:50-57`). There is one index per tenant, one API key for all of them, and every attribute is searchable, including the result title.
- **The setting has a gap** (read from code, not run). The resolver looks up encrypted fields by the document's own entity id (`packages/search/src/lib/encryption-map-resolver.ts:89-103`). A company's `display_name` and `description` are encrypted under the `customer_entity` map, and the company whitelist includes both (`packages/core/src/modules/customers/search.ts:825-834`; `customers/encryption.ts:19-28`), so they still go in.
- **Declared tenant defaults are not effective stored policy.** The resolver reads only stored rows. `TenantDataEncryptionService.applySystemDefault` merges defaults only for system-scoped maps (`packages/shared/src/lib/encryption/tenantDataEncryptionService.ts`). B1 owns the tenant-map catch-up. Unioning code defaults here is deliberate fail-safe over-exclusion: a tenant whose source values are still plaintext can lose fulltext matching on them too; it does not change column encryption.
- **The resolver is uncached on purpose.** It reads `encryption_maps` on every call and unions every scope, because indexing has no tenant at that boundary and a map change can commit while its invalidation fails: over-excluding a field is preferred to publishing plaintext (`packages/search/src/lib/encryption-map-resolver.ts:74-109`). The tenant encryption service keeps no policy across units of work for the same reason (`tenantDataEncryptionService.ts:451-457`).
- **With the setting on, the driver is rebuilt on every request** (`packages/search/src/di.ts:160-176`), because the resolver holds a request-scoped database handle.
- **No test exercises document preparation with the setting on.**
- **What the flip costs.** Titles are blanked at index time and filled in again at read time (`fulltext/drivers/meilisearch/index.ts:157-170`; `presenter-enricher.ts:399-400`), so results still show names. What is lost is every fulltext match on an encrypted field: typo tolerance, word-order tolerance and ranking for people and companies by name.

## 📝 Proposed Solution

1. Union declared default map fields with active stored fields across all scopes. This is a search publication boundary, deliberately stricter than tenant column encryption. Do not change the encryption service to make it merge tenant defaults.
2. Add `SearchEntityConfig.encryptionMapEntityIds?: readonly EntityId[]`. Resolve the document's own id and these related ids as one deduplicated set, then union their field names. Declare the customer profile maps and every composite source found in the inventory below. The driver reads policies through shared metadata/resolver helpers; it never queries another module's business tables.
3. Keep `createEncryptionMapResolver(db, legacyPolicyVersionCache?)` and `FullTextSearchDriverConfig.encryptionMapResolver(entityId)` callable unchanged. Add `createLiveEncryptionMapResolver` as a separate export. It takes a provider of a fresh entity-manager fork and the enabled search/default-map metadata. At each invocation it obtains a new fork from `(await getOrm()).em.fork({ useContext: false })`, gets that fork's Kysely handle, resolves own/related policies, and clears the fork in `finally`. It never captures a request container or transaction and never closes the shared ORM pool. Missing handles or unreadable required policy refuse indexing.
4. DI installs that live resolver in the existing one-argument driver callback. The driver can then be shared once per process because it captures only immutable module metadata and a fork factory, never a request handle. `SEARCH_DISABLE_SINGLETON_CACHE=1` still disables reuse. Rebuild the driver when enabled module/config metadata changes; no resolved field set survives a call.
5. Pin timing: at entry to `index`, resolve its complete field set. At entry to `bulkIndex`, collect distinct document entity ids and resolve each complete set during a preflight before preparing or submitting any document. Keep each result only for that call. These reads are not one atomic snapshot across entities; a map committed before the call starts is seen, and a change after an entity's preflight read affects that entity from the next call. No lazy first-document resolution occurs.
6. Stamp excluded documents with `_privacyExclusion: { version: 1, policyDigest, preparedAt }`. The digest is SHA-256 of sorted own/related entity ids and resolved field names plus the exclusion version; no values or secrets enter it. Off-mode documents carry no stamp. Replacing a document replaces its old fields and stamp, rather than merging removed attributes.
7. Add report-only `mercato search fulltext-privacy-status --tenant <id>`. The Meilisearch driver pages raw stored documents in groups of at most 100 and returns counts only: documents without the stamp, stale policy digests, documents still carrying excluded attributes, provider tasks still pending, and total documents. Missing/unavailable indexes are explicit states; an empty index is reported as empty, not proof that source coverage is complete. A non-zero unsafe count remains visible after the setting is on. Run this with writers paused for an authoritative scan; a live scan is labelled non-atomic.
8. Fix and test now, then flip the exclusion default one minor later with explicit `false` honored. After every producer and worker is upgraded, enabling or flipping exclusion requires the named fulltext rebuild for every tenant: start `yarn mercato search worker fulltext-indexing`, then authenticated `POST /api/search/reindex` with `{ "action": "reindex", "useQueue": true }`, no `entityId`, under the tenant's unrestricted organization scope and the `search.reindex` feature. Wait for all queued jobs and Meilisearch tasks to finish, pause writers and require zero unsafe counts from the status command. `mercato search reindex` does not rebuild Meilisearch.

| Alternative | Why rejected |
|---|---|
| Flip the default now | See assumption 1. |
| Encrypt before sending | Meilisearch cannot search ciphertext; the result is the same as exclusion with more moving parts. |
| Infer related maps from field names | A `display_name` on one entity is not the `display_name` on another. |
| Cache the field set per tenant and entity for a short time | After a map change, a newly mapped field would go to Meilisearch in clear until the entry expired, and a later reindex does not recall what was sent. |
| Narrow the resolver to the document's tenant | The resolver has no tenant at this boundary. The union over-excludes, which is the safe direction. |

## 📝 Delta

### Capability: search-index-protection

#### MODIFIED Requirement: Fulltext exclusion of encrypted fields
The system SHALL, when the exclusion setting is on, keep out of the fulltext index every field encrypted under the document's own map, a declared default map, or the map of an entity its search configuration names.

##### Scenario: Company document
- WHEN the setting is on and a company is indexed
- THEN its display name and description are not in the fulltext document

##### Scenario: Declared default with no stored row
- WHEN a tenant has no stored map for an entity whose module declares one
- THEN the declared fields are excluded

##### Scenario: Result display
- WHEN a person is found through another strategy with the setting on
- THEN the result still shows their name

##### Scenario: Map change between calls
- WHEN a field is added to an entity's map after one `index` call and before the next call starts
- THEN the second call excludes the field

##### Scenario: Map change during a bulk call
- WHEN a field is mapped after that entity's preflight read in an already running `bulkIndex` call
- THEN that call retains its preflight set and the next call excludes the new field; the status scan reports the earlier documents stale

Frozen by: `packages/search/src/__tests__/meilisearch-prepare-document.characterization.test.ts` (to be added; no test covers this path today)

## 📝 Architecture

- `packages/search/src/lib/encryption-map-resolver.ts`: default maps, related entities, per-call handle, no field set kept across calls.
- `packages/search/src/di.ts`: one fulltext driver per process with the fresh-fork resolver; this sharing never captures the tenant-selected embedding service. The operation-scoped embedding correction in [`2026-06-15-tenant-scoped-search-settings.md`](2026-06-15-tenant-scoped-search-settings.md), “Runtime configuration isolation”, applies to vector services, independently of this container-free fulltext driver.
- The search configuration type in `packages/shared`: one optional field.
- `packages/core/src/modules/customers/search.ts`: declares the related entity.

### First-party source inventory

The inventory comes from every module `search.ts` under `packages/*/src/modules/` plus the create-app example. `SearchIndexer.buildIndexableRecord` sends `params.record` as `fields`; builder `text` is vector input, while fulltext stores its fields, presenter and links. Presenter/title and link-label sanitization therefore applies to every composite below even when its related values never appear in `fields`.

| Search configuration | Source entities | Fulltext declaration / acceptance check |
|---|---|---|
| `customers`: person and company profiles | Profile plus `customers:customer_entity`, hydrated by `hydrateProfileContext` | Both declare `encryptionMapEntityIds: ['customers:customer_entity']`; prepare each document with related fields in its record and assert mapped names/descriptions absent |
| `customers`: comments and activities | Own row plus customer entity for parent name/link labels | Both declare `customers:customer_entity`; prepare each and assert parent name absent from serialized presenter and links |
| `customers`: todo link | Own row, customer entity and the runtime `todo_source` record via `getLinkedTodo` (default `example:todo`) | Declare `customers:customer_entity`; related todo text is vector-only and presenter/labels are sanitized regardless of its source. A preparation test pins this; adding related raw fields later requires declaring their map |
| `customers`: deal | Own record | Own map; preparation regression test |
| `warranty_claims`: claim | Claim plus `warranty_claims:warranty_claim_line` through `loadClaimLineRows` | Declare `warranty_claims:warranty_claim_line`; test related mapped fields and presenter sanitization; line text remains vector-only |
| `documents`: document | Document plus `documents:document_content` through scoped `findOneWithDecryption` | Currently `enabled: false`; preserve that state. Declare `documents:document_content` for a deliberately enabled test fixture and test preparation without enabling production document search |
| `customer_accounts`, `catalog`, `sales`, `staff`, `wms` | Each builder consumes its supplied record/custom fields, with no extra entity query in that file | Own map per declared entity; table-driven preparation tests enumerate every entity in these configurations |
| `planner`, `resources`, `eudr`, `ecommerce`, `inbox_ops`, `messages`, `checkout` | Each builder consumes its supplied record/custom fields, with no extra entity query in that file | Own map per declared entity; same enumerated tests |
| Create-app `example:todo` | Supplied todo record/custom fields | Own map; keep template behavior; preparation test covers composite customer todo presentation separately |

Implementation must re-enumerate these files at the implementation commit and update this table for any new builder before acceptance. The inventory test compares discovered first-party builders with its reviewed entries, so a new file cannot silently escape the audit.

### Shared decisions consumed

| Decision | Owning design |
|---|---|
| R3-2 — The registry carries the whole `privacy.ts` default export | [`privacy-data-class-contract`](2026-11-16-privacy-data-class-contract.md), “Export shape”; preserve the complete default object |
| DEC-I — The doctor's extension point | [`privacy-doctor-cli`](2026-11-16-privacy-doctor-cli.md), API Contracts; reuse `search.encrypted_fields_indexed` |
| R3-4 — An opt-in database tier for the doctor | Same doctor spec, Architecture; a provider enumeration is not a doctor database counting check |

## 📝 Data Models

No database table or user-editable entity. Meilisearch documents gain the internal `_privacyExclusion` provenance object. It is removed when exclusion is explicitly off and is never a legal-compliance assertion. A full index recreation deletes pre-upgrade attributes; final verification reads the stored documents after provider tasks settle.

## 📝 API Contracts

- **Search configuration:** `encryptionMapEntityIds?: readonly EntityId[]` on the exported `SearchEntityConfig` in `packages/shared/src/modules/search.ts`. Additive and optional. Deduplicate entries and the own entity id. An empty/missing list means own map only. A disabled related module contributes no loaded code defaults; active stored policies still contribute. If a declared related id has neither available metadata nor readable stored policy, refuse that document with `encryption_policy_unavailable`; never silently drop the required protection. Do not auto-enable related modules or create cross-module ORM links.
- **Resolver bridge:** `createEncryptionMapResolver(db, legacyPolicyVersionCache?)` and `FullTextSearchDriverConfig.encryptionMapResolver?: (entityId: EntityId) => Promise<EncryptionMapEntry[]>` retain their signatures. `createLiveEncryptionMapResolver` is a new additive export with options `{ createEntityManager: () => Promise<EntityManager>, entityConfigs: readonly SearchEntityConfig[], defaultMaps: readonly ModuleEncryptionMap[] }`. Each invocation owns a new fork until `finally`; no database argument is added to an existing callback. DI supplies `getOrm`'s fresh-fork factory. Existing custom resolvers keep working and remain responsible for their own handle lifetime.
- **Inspection:** optional `FullTextSearchDriver.inspectPrivacy?(tenantId: string): Promise<FulltextPrivacyStatus>` is additive; providers without it return `unsupported` through the command. The new type contains `state`, `totalDocuments`, `legacyDocuments`, `stalePolicyDocuments`, `documentsWithExcludedFields`, `pendingTasks`, `scanStartedAt`, `scanCompletedAt` and `atomic` (always false for a scan; operators pause writes externally for final evidence). The CLI never prints document values. Argument validation uses zod; page size is at most 100.
- **Verification consumer:** [`2026-11-16-privacy-verification-suite.md`](2026-11-16-privacy-verification-suite.md), “Owner scan members”, owns optional `FullTextSearchDriver.iterateTenantDocuments({ tenantId, batchSize }): AsyncIterable<FullTextSearchDocument>` and DI `privacySearchScan.scanFulltextValues`. Its exhaustive, tenant-scoped raw-document enumeration may back this spec's `inspectPrivacy`; preserve both optional capabilities and their distinct results. The status scan checks policy/provenance, while verification matches in-memory values and returns locations only. Unsupported adapters and partial provider-page failures are incomplete, never clean. Neither path goes through ranked `SearchService.search` or treats a configuration doctor result as stored-document proof.
- **`SEARCH_EXCLUDE_ENCRYPTED_FIELDS`:** unchanged in the bridge minor; unset becomes true in the following minor; explicit false stays honored. Use the shared exclusion predicate owned by the doctor spec. Its existing `search.encrypted_fields_indexed` check follows the predicate's default; this spec adds no duplicate doctor check (DEC-I, R3-2). Doctor configuration output does not claim historical documents were purged. R3-4's database tier is unrelated to this provider status scan.
- **Rebuild:** existing `POST /api/search/reindex` and its `search.reindex` feature remain. Full-tenant rebuild uses `{ "action": "reindex", "useQueue": true }`, omitting `entityId`; no invented strategy flag. Workers run with `yarn mercato search worker fulltext-indexing`. Search APIs and presenters retain their response shapes and tenant/org guards.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Map changes during `bulkIndex` | Each entity uses its preflight set for the whole call; after that entity's read, changes apply from the next call. The status scan finds stale policy stamps and a full rebuild replaces them |
| Two requests share a driver | Each resolver invocation gets a distinct fork/Kysely handle and clears it; no transaction or identity map crosses requests |
| A related module is disabled | Keep stored active fields; if required policy is unavailable, refuse the document. Never enable that module implicitly |
| Declared default exceeds the stored tenant map | Exclude the declared field anyway, even if source data remains plaintext; token lookup remains available |
| Setting enabled on an old index | Old documents remain unsafe until the full-tenant API rebuild settles; the status command still counts them after the configuration doctor becomes quiet |
| Old writer runs after the rebuild | Its unstamped replacement is counted as legacy; finish upgrading all writers and rebuild again |
| Fulltext rebuild fails or Meilisearch tasks remain | Do not claim convergence; report failure/pending and rerun after repair |
| Typo in a person's name after the flip | Fulltext no longer matches encrypted names; tokens retain exact-word/prefix behavior |

## 📝 Migration & Backward Compatibility

| Change | Route |
|---|---|
| Default/related maps excluded under the opt-in | Defect fix with documented fail-safe over-exclusion; source encryption stays unchanged |
| Shared driver and resolver factory | Additive helper; preserve both exported resolver/config signatures and singleton opt-out |
| `encryptionMapEntityIds`, optional inspection and status command | Additive contracts; no required fields removed |
| Exclusion on by default | Ordinary protocol: announce in the bridge minor, flip in the next, explicit false honored |
| Existing plaintext documents | Required full-tenant API rebuild after the last old writer, then provider status scan; no configuration-only success claim |

`UPGRADE_NOTES.md` and the search docs show the exact fulltext sequence from Proposed Solution for **every tenant**, under unrestricted organization scope: finish upgrading every writer; start `yarn mercato search worker fulltext-indexing`; enable exclusion; invoke `POST /api/search/reindex` with `{ "action": "reindex", "useQueue": true }` and no entity filter; wait for queue/provider completion; pause writers; run `mercato search fulltext-privacy-status --tenant <id>` until unsafe counts are zero; resume. A setting flip alone does not recall stored plaintext. The flip release requires this step and states the lost fulltext matching. `mercato search reindex` rebuilds tokens/vector work, not Meilisearch.

## 📋 Phasing

| Phase | Outcome |
|---|---|
| 1 | Correct opt-in boundary, complete builder inventory, live resolver, provenance/status command and provider integration coverage |
| 2 | Following minor's default flip, required per-tenant rebuild and zero-unsafe status evidence; explicit false retained |

## 📋 Implementation Plan

1. **Characterize** existing document preparation and company leakage under the opt-in in `meilisearch-prepare-document.characterization.test.ts`.
2. Re-enumerate all first-party search builders and their source entities; update the inventory above, add every related-map declaration and one preparation test per composite (person, company, comment, activity, todo link, warranty claim and disabled document fixture). Enumerate direct-record entities too; fail the inventory guard for unreviewed new builders. Use services/metadata for policy reads, never business-table joins.
3. Add `encryptionMapEntityIds` with zod validation and tests for duplicate/own ids, missing list, stored-only policies, disabled modules and unavailable required policies. Union defaults deliberately; test a plaintext tenant row whose declared encrypted field is over-excluded without changing the encryption service.
4. Add the live resolver export and DI factory using fresh `getOrm` forks. Keep old exported signatures. `encryption-map-resolver.test.ts` covers two requests sharing one driver while receiving different handles, fork cleanup on success/failure, the singleton opt-out and metadata-triggered driver replacement.
5. Resolve complete entity sets during `bulkIndex` preflight and retain none across calls. `meilisearch-policy-timing.test.ts` asserts one resolve per entity before any preparation/submission, a change committed before a call applying to all documents, and a mid-call change leaving that entity stale until the next call.
6. Add document provenance and report-only status inspection. `fulltext-privacy-status.test.ts` covers missing/stale stamps, excluded attributes left by history, explicit off, provider unavailable, empty index, pending tasks and an old writer after a rebuild. Never output field values. Await provider task completion before a rebuild reports completion.
7. Add TC-SEARCH-FULLTEXT-001 and 002 below using a disposable Meilisearch service and real DI; this is required coverage, not an embedding-provider exemption. Update docs and upgrade notes. Use the doctor's existing shared exclusion predicate and `search.encrypted_fields_indexed`; unit-test unset/true/false before and after the default flip instead of registering a second check.
8. In the following minor, flip only that shared default; require the full-tenant API rebuild and status evidence for each tenant. Track this as a release task. Run `yarn generate` after discovery/config changes; archive the Delta if adopted.

### File manifest

| File | Action |
|---|---|
| `packages/search/src/lib/encryption-map-resolver.ts`, `packages/search/src/di.ts`, `packages/search/src/fulltext/{types.ts,drivers/meilisearch/index.ts}`, `packages/search/src/modules/search/cli.ts` | Modify — additive resolver, singleton binding, provenance and status inspection |
| `packages/shared/src/modules/search.ts`; search predicate under `packages/shared/src/lib/search/` | Modify additively; retain old exported contracts and doctor-owned predicate |
| `packages/core/src/modules/{customers,warranty_claims}/search.ts`, `packages/documents/src/modules/documents/search.ts` | Declare audited related maps without enabling disabled search |
| Search unit tests named above; module integration `TC-SEARCH-FULLTEXT-00{1,2}.spec.ts`; integration service/test profile | Create / modify with disposable provider and owned fixtures |
| `UPGRADE_NOTES.md`, search docs | Modify at implementation, including exact rebuild and flip requirement |

## 🧪 Integration Coverage

Use a disposable Meilisearch service supplied by the integration profile; no new production dependency. Each test owns its tenant/org and API-created records, seeded encryption-map variations, index and queued work. It stops/drains its own work and deletes its provider index, source fixtures and scopes in `finally`. A deterministic embedding seam can disable vector provider calls; this suite tests fulltext and token enrichment, not external embeddings.

| Test | Paths | Assertions |
|---|---|---|
| TC-SEARCH-FULLTEXT-001 | `POST /api/search/reindex` with fulltext worker; provider stored-document inspection; `GET /api/search/search`, `GET /api/search/search/global`, search palette | API-create encrypted company/person with a non-sensitive searchable marker; real DI indexes them with exclusion on; after provider tasks finish no mapped company/name/description or presenter/link name appears in stored documents. Marker search and token name search still return enriched names; palette shows the name; another tenant/org cannot read them |
| TC-SEARCH-FULLTEXT-002 | Per-tenant `POST /api/search/reindex`; `mercato search fulltext-privacy-status --tenant <id>`; Settings > Search rebuild flow | Seed owned pre-upgrade plaintext documents, enable exclusion and prove status still reports legacy rows; run full-tenant rebuild with worker, wait for jobs/provider tasks, then prove unsafe counts zero. A failed task and a simulated final old writer keep status incomplete until rebuild succeeds; key UI reports progress/errors through existing calls |

## 📝 Risks & Impact Review

#### Fulltext matching on names is lost
- **Scenario**: After the default flips, a misspelled or reordered name finds nobody.
- **Severity**: Medium
- **Affected area**: global search for people and companies
- **Mitigation**: One minor of notice; exact and prefix search stay through tokens; the setting can be turned off explicitly.
- **Residual risk**: A real loss of function for installations that keep the new default.

#### A document still carries an encrypted field
- **Scenario**: An entity's document is built from another entity's fields and nobody declared it.
- **Severity**: Medium
- **Affected area**: the fulltext index
- **Mitigation**: The source inventory is recorded above, re-enumerated in plan step 2 and guarded by per-composite preparation tests plus a real provider integration test.
- **Residual risk**: Third-party modules.

#### A newly mapped field reaches the index
- **Scenario**: A field is added to an entity's map while that entity's documents are being indexed.
- **Severity**: Medium
- **Affected area**: the fulltext index
- **Mitigation**: No field set is kept across calls, so the next call reads the new map; a unit test covers a change between two documents.
- **Residual risk**: Documents whose entity preflight read preceded the commit, even if preparation has not started. Meilisearch keeps what it received until those documents are replaced.

#### Old plaintext stays in the index
- **Scenario**: The setting is turned on and no reindex follows.
- **Severity**: Medium
- **Affected area**: installations that enable it late
- **Mitigation**: Required per-tenant API rebuild after the last old writer and a stored-document provenance/policy scan that remains unsafe even when the setting is on.
- **Residual risk**: An operator can ignore the status or explicitly opt out. Historical provider backups and an in-flight old writer remain outside a completed scan; upgrade order and provider retention must be followed.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root/spec rules, search guidelines, shared search/encryption boundaries, core module-boundary rules and exported contract protection. DEC-I, R3-2 and R3-4 are consumed without redefining them. This is design-only; tests below are implementation requirements.

| Rule | Status | Notes |
|---|---|---|
| Behaviour-changing default follows the protocol | Compliant | Flip deferred one minor |
| Additive contract change | Specified | Named optional config/inspection members and live factory; old resolver and config signatures preserved |
| No encryption policy kept across units of work | Compliant | The resolver reads the map per call and keeps the all-scope union |
| Integration coverage | Specified | Disposable Meilisearch, real DI, raw stored documents, full-tenant rebuild, search API and key UI paths |
| Historical plaintext removal | Specified | Required named API/worker rebuild and persistent document provenance scan; doctor is configuration-only |

**Verdict:** approved for the fix. The default flip waits on assumption 1.

## Changelog

### 2026-11-16
- Split from the search-index protection spec on its reviewer's advice: it shares no reindex with the token and vector work. Carries that review's corrections: declared default maps, the related-entities field stated as a contract addition, a mechanism for building the driver once, and the loss on flip described as all fulltext matching on encrypted fields.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g1-05 — the short per-tenant cache of the resolved field set is removed. The resolver keeps no field set across calls (one read per `index`, one per entity id in a `bulkIndex`) and keeps its all-scope union, so a map change is honoured from the next call. Added a Delta scenario, a unit test, two rejected alternatives, an edge case, a risk and a compliance row. The statement that the encryption service merges declared defaults into tenant maps is corrected: it does so only for system-scoped maps.
- Council round two fixes (GPT-6.1 Sol workers): r2iqa-09 — fresh-fork live resolver with additive bridges; r2iqa-16 — required rebuild and stored-document provenance; r2iqa-17 — real Meilisearch integration coverage; r2iqa-18 — complete builder inventory and acceptance tests; r2iqa-19 — exact tenant API and worker commands; r2iqa-33 — preflight policy timing; r2iqa-34 — reuse doctor-owned predicate/check; g1-12 — preserve corrected system-only merge claim and state over-exclusion; g1-30 — named related-map contract.

- Council round two fixes, pass two (GPT-6.1 Sol workers): Align singleton ownership with tenant-scoped embedding operations; cite the verifier-owned optional fulltext enumeration and location-only scan without changing its names or results; use exact R3-2, R3-4 and DEC-I names and preserve the doctor-owned exclusion check.
