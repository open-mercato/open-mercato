# Encryption-map coverage and backfill

> **Program:** packages B1 and B2 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). Related: #3854, #7593, #7644; open PRs #8987, #9011.
> **Verified at** `main` @ `08dada9624` by reading every column's writers, readers and value queries; nothing was run. The vector-map refusal is verified from the classifier and tenant setup; no command was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-10-04-encryption-map-scope-uniqueness.md

> **Coordinates with** `.ai/specs/enterprise/2026-11-12-key-rotation-data-verification.md`, which designs Enterprise verification around the existing Core rotation command and a bounded maintenance adapter. It adopts the store-owned classification below and B4's specified `searchVectorDisplayMaintenance.run` / `VectorDisplayMaintenanceReport`; their implementation must verify on the OSS path before A1 ships (A1 gate in Phase A item 6); the Enterprise baseline/read hand-off adds protected verification and is not an A1 gate. System-scoped records, which that spec leaves to their own owners, are rotated by Phase D here, in `mercato entities backfill-system-encryption`.

## 📝 TLDR

About thirty columns that hold personal data are stored in clear because no encryption map names them: webhook payloads sent to third parties, notification text, extracted attachment text, single-sign-on emails and names, inbound message senders, HR notes, workflow form data. Adding a map does not help an existing installation by itself. The tenant's maps are copied at tenant creation, so an older tenant never receives a field added later unless a migration adds it; most mapped fields have no such migration. And existing rows are currently encrypted by re-saving or by the ORM rotation path without an old key, which reads a whole tenant's table into memory and, by design, refuses to start if any map cannot be resolved. **Proposed (future):** first make the path trustworthy — catch-up migrations for the maps that never had one, three guards in the test suite, and a separate row-backfill command that works in batches and reports what it skipped. Then bring the columns under maps module by module, each with its migration and its reader fixes. Last, Phase D gives CRM people an email and phone lookup hash, adds a command that refreshes lookup hashes after a secret change, and lets the system-scope backfill rotate.

**Not in this spec:** MFA secrets (PR #8987) and assistant maps (PR #9011), which are in flight; vector display fields (the search-index spec); document content, which stays in clear by design; the three names that lists search and sort in SQL, and the CRM `participants` column, which stay in clear by decision, each with its reason recorded; the rotation command, apart from its store-owned vector classification (Phase A item 7); reads that bypass decryption in general (#2115, #5447, #7048).

## 📝 Overview

> **Market reference.** Rails' Active Record Encryption migrates an existing column by declaring it encrypted with `support_unencrypted_data` on, re-saving rows in batches, then turning the option off; it documents that a deterministic key is needed for any column queried by value. Adopted: read-tolerant mixed state (which this codebase already has), batched re-encryption, a lookup hash for value queries. Rejected: its per-model switch for tolerating plaintext — here tolerance is permanent and silent, so the guard tests are what tell an author a column was missed.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Order | Catch-up migrations, guards and the row-backfill command first; columns after | Each column added before the guards repeats the defect in #7644. |
| 2 | Columns searched or sorted by value in SQL — attachment file name, staff display name, warranty customer name | Left in clear, with the reason recorded | Decided. Encrypted sort is capped or declined by the query engine, and the attachments library is a hand-written query with no search configuration, so encrypting these would mean rewriting one list and losing substring search and full sorting on three lists staff use daily. The values stay under tenant access control, and each owning coverage class covers them in export and erasure. |
| 3 | Columns on tables with no tenant, or a nullable tenant | Tenant-bearing rows are mapped; rows with no tenant stay plaintext and are listed unless a system-scoped map owns them | The tenant key cannot apply to a row with no tenant; a nullable column does not exempt the tenant-bearing rows. |
| 4 | Document content | Stays in clear, with its reason recorded | Server-side merge and full-text search need plaintext; the module says so. |
| 5 | The SSO subject and SCIM external id | Left in clear, with the reason recorded | Decided. They are the join key with the identity provider, unique, queried by value, and for SCIM users the two columns hold the same value. Where a provider uses an email as the subject, that email stays readable; it stays under tenant access control, and the enterprise SSO coverage class deletes the identity on erasure. |
| 6 | CRM interaction `participants` and `linked_entities` | Left in clear, with the reason recorded | Decided. The erasure spec finds a person inside them with a bounded query. Encrypted, that becomes decrypting every interaction in the tenant for each erased person. Encrypting them later is one joint change with the erasure spec, never a change to this spec alone. |
| 7 | Who runs the row backfill | The operator runs it per scope. The separate read-only `verify-encryption` command proves persisted required map coverage and whether the mapped values are already sealed. | Map migrations do not have tenant keys. A migration, preview, successful apply or clean configuration check cannot stand in for the persisted verification. |
| 8 | Old tenants whose maps lack fields the code already declares | Brought up to date by one catch-up migration per module | Freezing them as known exceptions would leave most mapped fields outside the guard. |
| 9 | Maintenance command convention | All new commands preview unless `--apply` is passed | Existing rotation and system backfill keep their `--dry-run` contract for compatibility; no new command writes by default. |
| 10 | SCIM legacy fallback | Minor N preserves the existing route matching. Minor N+1 at the earliest activates bounded filtering per scoped configuration through the readiness gate below. After activation, configurations with a lookup secret use hash candidates and at most 100 null-hash fallback rows with 503 above that count. In approved no-secret mode, plaintext email/name SQL equality stays unlimited and at most 100 ciphertext candidates may be decrypted, with 400 `scimFilter.lookupSecretRequired` above the bound. | Decided. Existing tenant maps may already encrypt `idp_email` and `idp_name`. The warning bridge depends on the read path staying unchanged, regardless of those maps. A tracked task removes the configured-secret fallback no earlier than the next minor after all active configurations have zero missing required hashes. |

## 📝 Problem Statement

**How coverage works today**

- A module's `encryption.ts` holds defaults. A tenant's *effective* maps live in the `encryption_maps` table and are copied from the defaults at tenant creation or by `seed-encryption`. With no row for an entity, writes go out in clear, silently (`packages/shared/src/lib/encryption/tenantDataEncryptionService.ts:359-432, 619-622`).
- `buildEncryptionMapBackfillSql` adds or extends those table rows for existing tenants. It never touches data rows, and it throws for a system-scoped map (`packages/shared/src/lib/encryption/migration-backfill.ts:8-89`). Three modules use it: `staff`, `checkout` and `customers` (`customers/migrations/Migration20261030195138_customers.ts`, added after the verified baseline).
- Existing data rows are encrypted only by `mercato entities rotate-encryption-key` run without an old key, or by re-saving. One command serves both rotation and backfill (`packages/core/src/modules/entities/cli.ts:552`). It reads each scope with one unbatched select, skips rows with no tenant and system-scoped maps, and — deliberately, before any write — lists every map it cannot resolve and refuses to run (`cli.ts:409-412, 428-491`). For rotation that is right: a skipped map would leave data under a key about to be retired.
- A module `encryption.ts` can declare several entity maps, so a count of files is not a count of maps. Only the `staff`, `checkout` and `customers` migrations use the backfill helper in this checkout; Phase A records exact field and entity-map counts from its guard rather than treating file counts as map counts.
- Verified from source: `buildEntityMetaRegistry` uses ORM metadata only; `classifyEncryptionMap` returns `unresolvable` for `vector:vector_search`, and `resolveMapsOrFail` aborts before any write (`cli.ts:392-490`). Search has no ORM entity for that map. Tenant setup materializes all non-system defaults (`auth/lib/setup-app.ts:172-191, 420-430`), including search when enabled. The refusal therefore already affects these tenants, before any catch-up migration.
- A table with plaintext and ciphertext rows reads correctly: a value that fails to decrypt is returned as it is.
- A JSON column decrypts to a string. Only the ORM hook parses it back; query-builder and raw readers must call `parseDecryptedFieldValue`.
- `db:generate` prints a warning when a map lacks a backfill (`packages/cli/src/lib/db/encryption-backfill-check.ts:81`). It needs a connected database, is satisfied by any migration that mentions the names — which `title`, `data` or `payload` always are — and can be silenced. Nothing fails.
- The stored map rule is rebuilt as `{ field, hashField }` in five places, the admin editor included, so any other key on a rule is dropped when a tenant edits its map.
- A lookup hash is written only inside the encrypt step. With encryption off, no map row, or a row with no tenant, it stays null.
- Raw-write call sites include variable payloads. Phase A counts those that target mapped tables, rather than using a repository-wide estimate as the guard baseline.

**Lookup hashes and system-scoped records**

- `customers` has no lookup hash for `primary_email` or `primary_phone`, both encrypted (`packages/core/src/modules/customers/data/entities.ts:55-59`; `customers/encryption.ts:19-28`). A CRM person can be found by email or phone only by decrypting every person of the tenant.
- Nothing recomputes a lookup hash after the lookup secret changes. Lookup candidates cover the current keyed form and the legacy unkeyed one, not an old keyed secret (`packages/shared/src/lib/encryption/aes.ts:234-238`). The runbook says there is no rehash command (`starters/docker/encryption-migration.md:142-152`).
- A second, older rotation entry point exists: `mercato auth rotate-encryption-key` (`packages/core/src/modules/auth/cli.ts:221-260`, exported at `:909`) takes the old key as an `--old-key` flag and rotates only `User`. It is not a supported rotation path for any procedure in this spec: it covers one entity, exposes the secret in process listings and skips every other map.
- `mercato entities backfill-system-encryption` encrypts plaintext only. It accepts no old key and skips a value that is already ciphertext, so a value sealed under an old root stays as it is (`packages/core/src/modules/entities/cli.ts:1270-1288, 1403`). The rotation command skips system-scoped maps (`cli.ts:594`).
- The encrypt step writes a mapped `hashField` as `hashForLookup` over the value with no context (`packages/shared/src/lib/encryption/tenantDataEncryptionService.ts:553-555`).

**The columns.** Verdicts come from reading each one's writers, readers and queries.

| Module | Columns | State |
|---|---|---|
| `webhooks` | `custom_headers`; delivery `payload`, `response_body` | Safe to map. The worker and retry route read with a plain find |
| `webhooks` | delivery `error_message` | Safe to map in Phase B. The lease `nativeUpdate` only clears it (`delivery.ts:326-339`); non-null writes use the entity and flush (`delivery.ts:142-165, 390-396, 447-466`; `subscribers/outbound-dispatch.ts:173-175`) |
| `notifications` | `title`, `body`, both variable sets, `action_data`, `link_href`, `data` | Safe if `group_key`, `channels` and the source columns stay in clear; filters use only those. `action_result` was not read; its step maps it or records why not |
| `attachments` | `content` | Safe; large text; rows with no tenant cannot be covered |
| `attachments` | `file_name` | Searched with `ILIKE`, ordered and paged in SQL by a hand-written query (`api/library/route.ts:85-108`); no search configuration. Left in clear |
| `communication_channels` | conversation `subject`; link `channel_payload`; message `sender_display_name` | Safe. `channel_metadata` must stay in clear: threading queries it by value |
| `communication_channels` | message `sender_identifier` | No value query today; the module's note says contact resolution will need one, so it gets a lookup hash |
| enterprise `sso` | `idp_subject`, `external_id` | Looked up by value, unique, and equal to each other for SCIM users (`sso/services/scimService.ts:87-91`; `sso/lib/scim-filter.ts:50`). Left in clear |
| enterprise `sso` | `idp_email`, `idp_name` | Queried by SCIM equality filters (`scim-filter.ts:53`); read with plain finds |
| enterprise `sso` | `idp_groups` | Safe; the table's tenant is nullable |
| `checkout` | `user_agent` | Safe |
| `staff` | addresses, comments, job histories, three `customer_snapshot` columns | Safe |
| `staff` | `display_name` | Searched with `ILIKE` twice and sorted in SQL. Left in clear |
| `workflows` | instance `context`; step `input_data`, `output_data`; `event_data` | Safe; no JSON-path queries on them |
| `workflows` | `user_tasks.form_data` | Written with `nativeUpdate`, which bypasses encryption |
| `integrations` | log `message`, `payload` | Safe; already read with the decrypting helper |
| `customers` | deal `loss_notes`; interaction `location` | Safe |
| `customers` | interaction `participants`, `linked_entities` | Left in clear; see assumption 6 |
| `warranty_claims` | `customer_name` | Searched with `ILIKE` in the list route and an assistant tool. Left in clear |
| `shipping_carriers` | `label_data`, `tracking_events` | Safe |
| enterprise `record_locks` | `locked_by_ip` | Safe |
| `push_notifications` | delivery `payload` | Written with a query-builder insert, which bypasses encryption |
| `forms` | access audit `ip`, `ua` | The table has no tenant column |
| `query_index` | indexer error `payload` | Diagnostic dead-letter payload; raw writer and reader need their own design. Left in clear and bounded by the operational-pruners spec, not exempted merely because tenant is nullable |
| `documents` | content, comments, versions | In clear by design |

## 📝 Proposed Solution

### Phase A — make the path trustworthy

1. **Catch-up migrations.** One per module whose map predates the helper. Each calls `buildEncryptionMapBackfillSql` with the module's current fields, written out as literals. For a tenant created after a field was declared it changes nothing; for an older tenant it adds the missing fields, and that tenant's new writes to them are encrypted from then on. The `search` module's catch-up migration is written in this phase, for `vector:vector_search` with the nine fields its map declares today. The search-index spec's Phase 2 later adds `presenter` in a second, idempotent migration, so the map migration itself does not wait for that spec. First land item 7's store-owned classification in the Core rotation and decryption commands and item 5's in the row backfill; do not seed a row that any maintenance path calls an unknown map.
2. **Guard: a map needs a backfill.** A test with no database reads every module's `encryption.ts` and every migration, finds the `buildEncryptionMapBackfillSql` calls and their literal field lists, and fails when a tenant-scoped field appears in none. After step 1 it starts with no exceptions.
3. **Guard: a personal-data column needs a decision.** A test reads each module's migration snapshot and looks for columns whose name contains, as a whole word, one of: `email`, `phone`, `first_name`, `last_name`, `full_name`, `display_name`, `address`, `street`, `postal`, `ip`, `user_agent`, `birth`, `recipient`, `sender`. Each match must be in a map or in the test's data file. The data file has two kinds of entry: *reviewed*, with a reason from a fixed list, and *unreviewed*, the initial backlog, whose count the test caps so it can only shrink. The guard records the exact initial match count when implemented. It does not find free text or JSON — `payload`, `body`, `content`, `form_data` — which reach this spec through the table above and the program's coverage specs.
4. **Guard: raw writes to a mapped table are listed.** Column-level detection is unsound when the payload is a variable, so the rule is per table: any `nativeUpdate` or query-builder insert or update against a table with a map must appear in the test's data file with the columns it writes and, where one is mapped, the explicit encrypt call it makes, or why the mapped write is null-only. `mapped-table-raw-write-coverage.data.ts` has reviewed and unreviewed entries. The first run records the exact unreviewed count of mapped-table sites as a checked-in cap; it can only shrink, and a new site must be reviewed. A reviewed webhook lease entry names `error_message: null` and needs no encrypt call.
5. **Row backfill.** A new command, `mercato entities backfill-encryption`, previews by default and encrypts with `--apply` in keyset batches. A batch is bounded by rows and by bytes: before fetching contents, the command reads the next keyset page's ids with `octet_length` of each mapped column, and takes rows until the next would exceed the byte budget (`--max-batch-bytes`, default 8 MiB, 1–64 MiB). A single row larger than the budget is processed alone and listed as `oversized` by opaque id, without failing the run. Entities with known large text (`attachments:attachment` `content`; webhook deliveries `payload` and `response_body`) default to a batch size of 10 rows. It retains rotation's scope and compare-and-set protection, but continues past an unknown map or concurrently changed row and exits non-zero for those incomplete items. The explicit `store-owned` classification applies only to `vector:vector_search`: it is outside the ORM writer, is listed as delegated rather than skipped, and names `mercato search encrypt-vector-display` from the search-index spec for plaintext display rows. A tenant-wide ORM pass can exit 0 with delegated work, but its summary must say `complete: false` and list the store command until that separate step has been verified; it never claims full-store coverage. Unknown non-ORM maps remain incomplete errors.
6. **Rotation hand-off.** The enterprise rotation spec uses the same exact store-owned classification and resolves B4's DI `searchVectorDisplayMaintenance: SearchVectorDisplayMaintenance`, without core reading search tables or spawning its CLI. B4's API Contracts → Search-owned vector maintenance adapter exports the contract from `@open-mercato/search/modules/search/lib/vector-display-maintenance`, with `enumerateScopes`, `prepare`, `readBaselinePage`, `resealPage` and `readTargetPage`. Sessions pin concrete source/target DEKs; the bounded baseline stream precedes any mutation, resealing uses `resealPage`, and independent persisted target reads use only the pinned target key. API Contracts → Vector CLI / service, extended by R4-10 as corrected by R5-3, defines the planned facade `searchVectorDisplayMaintenance.run(input: { tenantId: string; mode: 'report' | 'apply'; batchSize?: number; after?: string; pin?: { providerIdentity: string; wrappedDekFingerprint: string } }): Promise<VectorDisplayMaintenanceReport>`; `mercato search encrypt-vector-display` is its operator entry point. For protected rotation, Enterprise supplies the optional frozen-target `pin` to each exact-scope `prepare` and derives the report from those sessions, without widening to the tenant-wide facade. `providerIdentity` is `VectorDisplayMaintenanceKeyPin.providerIdentity`; `wrappedDekFingerprint` is the SHA-256 of the tenant's provider key check (B4, **Rotation pin source**), read fresh through `readTenantKeyPin` and changed on every rotation. The pinned adapter refuses with `pin_mismatch` if the active provider identity or key-check fingerprint differs. Calls without a pin retain the existing behavior. With `TENANT_DATA_ENCRYPTION_OLD_KEY` from the maintenance environment only, the service reads current/old envelopes, reseals old-key values and encrypts plaintext, preserving logical values. After OSS apply, require a fresh tenant-wide facade report from the beginning with `verification: 'full'`, `done: true`, `complete: true` and zero per-column `plaintext`, `oldKey`, `unreadable` and `blocked` counts; every non-null mapped value must open with the target key. The protected path instead checks those same unsafe outcome counts over each exact selected scope using the adapter and includes every scoped value in its encrypted baseline and independent pinned-target logical comparison. A report alone cannot establish equivalence. B4 now specifies that adapter; its implementation, capability preflight and independent full both-store verification remain required. R5-3's owner, the search-index spec, defines the source in B4's **Rotation pin source**: a provider key check read through `KmsService.readTenantKeyCheck` and `readTenantKeyPin`, for both built-in providers. Until B4 Phase 2 delivers that read, pinned preparation refuses under B4's missing/unsupported-key-provenance rule. Missing capabilities refuse combined rotation before any write. Keep the old key until ORM, system and vector target-key gates and any required token rebuild/purge gates all verify. A1 is gated on item 7's OSS path, item 5's `backfill-encryption`, Phase D items 2 (`rehash-lookups`, per tenant and for `none`) and 3 (system-scope rotation in `backfill-system-encryption`), and B4's reseal, all verified with search enabled (key guard, Phase 3 gate); this Enterprise hand-off adds protected verification on top and is not an A1 gate. No runtime implementation is claimed here.

   **Persisted upgrade verification.** The `entities` maintenance owner supplies `mercato entities verify-encryption --tenant <uuid> | --system`, with mutually exclusive scopes. The tenant command selects the exact tenant and verifies all of its organizations, including null organization, using the same required-map inventory, installed owner metadata and classification as the backfill. The system command walks the exact system-scoped or explicitly classified tenantless owners. It uses the applicable key for each declared scope and treats unexplained tenantless data as missing policy. Enumerate required maps from the approved owner inventory even if no stored map exists. An expected owned table with no live resolver or unprovable inventory makes the scope unverified. Optional absent modules with no applicable persisted scope are reported separately, with positive inventory evidence.

   Run in a dedicated repeatable-read, database-enforced read-only transaction with bounded query time and keyset/byte pages. Use the shared authenticated envelope classifier and verify each non-null required mapped value under its active scope key with no provisioning, logging of content or implicit fallback to plaintext. Distinguish `protected`, `plaintext`, `unverifiable`, `missing_policy`, approved exceptions, and store-owned delegated work. Wrong-key, malformed or unknown envelopes, parser/codec/provider failure, unreadable or incomplete pages, unknown scope and stale verification evidence cannot count as zero. Keep rows and transient decrypted values internal to the registered owner; print only counts, reason codes, scoped inventory revision and timestamp, with no row ids, values, ciphertext, lengths or secrets. A result records the verified module/map and active-key binding without exposing the key. Exit 0 only for a complete ORM scope with zero plaintext/unverifiable and no missing required policy. A delegated store still needs its current owner proof under B4 before this can establish installation readiness; the Core report must say `complete: false` for the installation when the store is unverified.

   Complete a fresh verification after the last apply with legacy and unsafe writers stopped. Record the release/config/inventory binding for every affected populated scope, including soft-deleted tenants with stored rows, system scopes and applicable B4-owned stores. Release or rollout evidence is stale after a writer downgrade, active key or mapping revision change, reopened unsafe writer or incomplete scope. A clean check with zero rows counts only after the required owner/inventory can establish the scope is empty. Reject readiness until applicable reports are complete and current. Keep mixed-state reads during migration. This gate does not turn on tenant maps that were deliberately disabled under an approved policy disposition. Its results are evidence for B1 and the umbrella gate, not authorization to retire keys without the rotation-specific proof.
7. **Core rotation and decryption classifier.** In `packages/core/src/modules/entities/cli.ts`, `classifyEncryptionMap` gains a `store-owned` status for exactly `vector:vector_search`, checked before ORM metadata resolution; `resolveMapsOrFail` passes it through instead of listing it as unresolvable, and every other unresolved map still blocks before any write (`cli.ts:441-490`).
   - `mercato entities rotate-encryption-key` rotates the ORM maps, then lists the vector map as delegated with `complete: false` and prints the store step: `mercato search encrypt-vector-display --tenant <id> --apply` with the old root still in `TENANT_DATA_ENCRYPTION_OLD_KEY`, then a fresh full report from the beginning under the gate of item 6. It exits 2 (`delegated_store_pending`) while any applicable vector store lacks current target-key verification, even when every ORM row rotated successfully. Exit 0 requires the complete ORM pass plus a fresh full B4 owner report under the same frozen target key and scope, with zero plaintext, old-key, unreadable and blocked counts. When a store-owned map is applicable, read B4's `readTenantKeyPin` before the first write and retain that target binding for the run; inability to pin refuses before mutation. Resolve the optional search-owned maintenance facade after the ORM pass and call `run({ tenantId, mode: 'report', pin })` from the beginning to read that proof; never query search tables directly. A missing adapter or failed proof remains exit 2. Rerunning after the separate vector apply is idempotent and verifies both stores before returning 0. The old key is retained until both verify; exit-code-only automation must not retire it on exit 2. The separate newly introduced ORM backfill command keeps its explicitly documented narrower completion semantics.
   - `mercato entities decrypt-database` keeps refusing before any write when `vector:vector_search` is in scope, now with a store-owned reason instead of an unknown-map one: B4 defines no decrypt path for vector display, and decrypting the ORM data alone would leave the store sealed under a key the operator intends to drop.
   - This is the OSS rotation exit for search-enabled tenants. The key guard gates A1 on it, item 5's `backfill-encryption`, Phase D items 2 and 3 and B4's `mercato search encrypt-vector-display` old-key reseal and full report, verified with search enabled and without the Enterprise coordinator; Enterprise protected rotation reuses the same classification and adds its independent verification. It lands in Phase A before item 1's search catch-up migration seeds older tenants, because that migration otherwise extends today's refusal to every tenant.

### Phase B — columns that are safe once mapped

One step per module. Each adds the map entries, the migration, and switches plain finds on the entity to the decrypting helpers.

### Phase C — columns that need a code change first

- `user_tasks.form_data` and push delivery `payload` get a writer that goes through encryption. Until its step, the push payload copy stays in clear.
- SSO `idp_email` and `idp_name` get hash columns that the SSO service writes itself on every write, whether or not encryption is on, when a lookup secret is configured. With no secret it is null; no new module-written hash uses the unkeyed fallback. SCIM filters move to the hash after the activation gate, with a comparison of the decrypted value afterwards. No index is dropped.
- Inbound message `sender_identifier` gets a hash column the same way. Phase C delivers the exact SSO and sender fill commands specified by R3-12 under Phase D, alongside their columns and readers. After the SCIM activation gate, SSO filters use `lookupHashCandidates` for a bounded hash match, then compare the decrypted source using the existing SCIM equality semantics. With a configured secret, while the fill has not yet run, a null-hash fallback counts within the tenant, organization and configuration first, decrypts at most 100 candidates in pages of at most 100, and refuses larger filtered requests with HTTP 503 using the existing SSO `buildScimError` / `scimJson` response helpers and an i18n remediation detail naming the fill command. Under R5-4, with no lookup secret, `userName` or email filters keep today's SQL equality on `idp_email` (`sso/lib/scim-filter.ts:46-47`), and `displayName` filters on `idp_name` (`:52-53`), for rows whose stored value is plaintext, with no count limit. Rows whose stored value is a v1 envelope (selected in SQL by its `:v1` suffix, confirmed in memory with `isEncryptedPayloadShape`) are counted within the tenant, organization and configuration, regardless of existing hashes; when that count is at most 100 they are decrypted in pages of at most 100 and compared, and above 100 the request returns HTTP 400 with the localized detail `scimFilter.lookupSecretRequired`, built through the same SCIM helpers. Neither path returns a partial match set.

**SSO release order (ordinary protocol, program DEC-5).** Minor N ships the additive hash columns, writers and fill command, maps `idp_groups`, and emits the `sso.scim_lookup_secret_missing` doctor error and once-per-process runtime warning only with encryption enabled. `GET /api/sso/scim/v2/Users` keeps its existing matching and response behavior for every configuration in N. Existing tenant-authored maps may already have ciphertext. N introduces neither filter refusal. Introduce the bounded reader in minor N+1 at the earliest. Add `idp_email` and `idp_name` to the product map in a separate PR with an upgrade gate. For an upgraded installation, activate compatible filtering before applying those product maps or their catch-up migration to a scope with active SCIM configurations. Until every affected configuration is ready, stay on the bridge release or defer the map rollout. Operators activate that reader explicitly for an exact tenant, organization and SCIM configuration through a server-owned readiness setting, additive to its existing configuration. For keyed activation, keep scoped writers paused and verify from the beginning that the fill under the effective secret leaves zero missing, stale, legacy or unreadable required hashes. Only then record readiness and resume writers which all maintain those hashes. A newly empty configuration can pass the same check. Clear readiness before changing the effective lookup-secret configuration and follow the rotation runbook before reactivating. Without a secret, a configuration stays on legacy matching until an explicit operator activation after the warning minor that acknowledges the 100-ciphertext limit. Until either gate passes, retain the legacy reader. Operators restore ciphertext filtering at scale by configuring a secret, running the fill and verifying keyed readiness. The fill refuses without a secret. Track removal of the configured-secret fallback no earlier than the next minor and only after zero missing hashes across every active configuration.

### Phase D — Lookup hashes and system-scope rotation

This section implements DEC-F — The B1 hand-offs and R3-12 — Fill commands for module-written hashes. The key guard's lookup-secret refusal and its `enforce` default wait for this phase, the coverage-owned fills below for enabled modules, and B4's verified token rebuild/report procedure. A1's release also waits for items 2 and 3 and for Phase A item 5 (`backfill-encryption`), verified with search enabled (key guard, Phase 3 gate), because A1's refusal message names those commands.

1. **`customers` email and phone lookup hashes.**
   - `customer_entities` gains `primary_email_hash` and `primary_phone_hash`, nullable text, each with a partial index with `tenant_id` and `organization_id`, built concurrently in its own non-transactional migration (Data Models → Index builds).
   - The customers module checks `hasLookupSecret()` and computes both hashes for every ORM create or changed contact value, whether encryption is on or off, using module-owned `@BeforeCreate` / `@BeforeUpdate` hooks on `CustomerEntity`. It runs before the encryption subscriber, on verified plaintext; a unit test pins that order. This includes CLI seeders, imports and ORM writes outside commands. It calls `hashForLookup` only when a lookup secret is configured; otherwise both hashes are null, including on an edit of a previously hashed value. The email hash has no context. The phone hash is over `normalizePhoneDigits(value)` from `@open-mercato/shared/lib/privacy/identifier`, the canonicalizer used by privacy `phone_hashes` ([data-class contract](2026-11-16-privacy-data-class-contract.md), Addendum: aliases and people known only by an address → Aliases; DEC-A — Subjects known only by an identifier (`privacy:identifier`)). C1 Phase 1 delivers that helper; if B1 lands first it adds the identical helper at that path and C1 reuses it. Its ASCII-digits output matches the existing `extractPhoneDigits` helper; it does not apply phone validation. A cleared value clears its hash. Raw writers listed by the Phase A guard call the same customers-owned helper before encryption; no reader in another module reads customers tables directly.
   - They are not declared as `hashField` on the map rule: the encrypt step would hash the raw phone, not its digits, and only when it encrypts.
   - `mercato customers fill-lookup-hashes --tenant <id> [--apply]` fills existing rows. It reads the tenant's people and companies in keyset batches, decrypts both columns, and compares each stored hash to the computed hash of verified plaintext, so non-null stale hashes are repaired too. It follows the shared maintenance safety contract below and refuses without a lookup secret. Without `--apply` it only counts. This command and the columns do not exist today; they are new Phase D work under R3-12 — Fill commands for module-written hashes.
   - Until the command has run for a tenant, a reader that finds people by these hashes falls back to a decrypting scan of the rows whose hash is null, as the data-class contract spec requires of a module-written hash. The scan stays tenant/organization-scoped and keyset-batched; newer writers maintain non-null hashes atomically with contact edits.
2. **`mercato entities rehash-lookups --tenant <id> [--apply]`.**
   - Scope: one tenant and all its organizations. `--tenant none` selects rows with no tenant, such as users with no tenant, whose values are stored in clear.
   - Columns: every rule with a `hashField` in the module-declared tenant-scoped maps or in the scope's stored maps, so a rule an older tenant's stored map lacks is still covered.
   - Per row, in keyset batches: read the source value, decrypting it where it is ciphertext; compute the current form as the encrypt step does; compare it with the stored hash. Equal: skipped. Null, the legacy unkeyed form, or the old keyed form: rewritten. Anything else: rewritten from verified plaintext and listed as unrecognised, since it may come from another normalization. If the decrypted result still matches `isEncryptedPayloadShape`, leave the row and its hash unchanged, list `unreadable_source`, continue and exit non-zero. Never hash an envelope.
   - The old secret is read from the environment only: `LOOKUP_HASH_OLD_PEPPER`, or, when that is unset, `TENANT_DATA_ENCRYPTION_OLD_KEY`, which is what the lookup secret was while it fell back to the encryption key. Never from a flag. Without either, old keyed hashes are counted as unrecognised and still rewritten.
   - Without `--apply` it counts per entity and form and writes nothing. With `--apply`, each batch commits on its own and a re-run skips rows already current, so an interrupted run resumes by running again.
   - Each row runs inside a savepoint within its batch transaction. A unique violation, such as `users_tenant_email_hash_uniq`, rolls back to and releases that row's savepoint, leaves the row unchanged and lists its opaque id; later valid rows in the same batch continue. The command exits non-zero until collisions are resolved.
   - It refuses to run when no lookup secret is configured: the current form would then be the unkeyed digest, and a run would downgrade keyed hashes.
   - The B1 module-written hashes are refreshed by exactly `mercato customers fill-lookup-hashes`, `mercato sso fill-lookup-hashes` and `mercato communication_channels fill-lookup-hashes`, defined below under R3-12. Later coverage-owned hashes use the additional owning-module fills under Coverage-owned hash refreshes; the mapped rehash never guesses their normalization or reads their tables directly.
3. **Rotation of system-scoped records.** `mercato entities backfill-system-encryption` is extended.
   - Without `TENANT_DATA_ENCRYPTION_OLD_KEY` it encrypts plaintext as today, and a value sealed under another root is listed as unreadable and left untouched; the command exits non-zero.
   - With it, for each value: one that decrypts under the current system DEK is left as it is; one that decrypts under the old system DEK, derived from the old root as the rotation command derives old tenant DEKs (`DerivedKeyKmsService`, `cli.ts:570`), is resealed under the current DEK; plaintext is encrypted, as today. A value that decrypts under neither is listed, the batch that holds it is not written, and the command exits non-zero.
   - In both modes, each `hashField` is recomputed only from verified plaintext and only with a configured lookup secret. Without one, the hash refresh is skipped, existing hashes are preserved, and the summary warns and exits non-zero for incomplete hash work; encryption-only work may continue. Undecryptable envelopes never become hash input. With item 2, every mapped lookup-hash column has a refresh path.
   - `--dry-run` reports the same classification and writes nothing. Under a Vault-backed KMS the old system DEK cannot be derived from a root, so rotation is refused there, as the runbook already says of the rotation command (`starters/docker/encryption-migration.md:113-116`).

### R3-12 — Fill commands for module-written hashes

All three are new commands: `mercato customers fill-lookup-hashes --tenant <id> [--batch-size <n>] [--apply]`, `mercato sso fill-lookup-hashes --tenant <id> [--batch-size <n>] [--apply]` and `mercato communication_channels fill-lookup-hashes --tenant <id> [--batch-size <n>] [--apply]`. SSO lives in the enterprise package and ships with Phase C there; the other commands live in their OSS owning modules. None is an existing remedy until its phase ships.

Each visits only its tenant's rows across organizations, retaining the row's organization predicate on writes. SSO also retains the configuration id. Batch size is zod-validated, 1–100, default 100; keyset by primary key. Reports contain entity, opaque row id and counts, never source values, hashes or secrets. Exit 0 means all visited rows were current or repaired; missing secret, unreadable sources, collisions or concurrent changes give non-zero. No `--apply` means no database or KMS writes. A rerun from the start skips current rows and resumes interrupted work.

| Command | Source and hash columns | Normalization |
|---|---|---|
| `customers fill-lookup-hashes` | `customer_entities.primary_email` → `primary_email_hash`; `primary_phone` → `primary_phone_hash` | Email uses `hashForLookup` without context; phone uses it over `normalizePhoneDigits`, without context |
| `sso fill-lookup-hashes` | `sso_identities.idp_email` → `idp_email_hash`; `idp_name` → `idp_name_hash` | `hashForLookup` without context for both; the decrypted comparison preserves SCIM equality semantics where the normalized hash admits extra candidates |
| `communication_channels fill-lookup-hashes` | `external_messages.sender_identifier` → `sender_identifier_hash` | `hashForLookup` without context over the stored sender identifier; no provider-specific address rewriting |

Every fill classifies current, old-keyed, legacy-unkeyed, null and unrecognised forms by computing candidates from verified plaintext. Current is unchanged; other forms are repaired to the current keyed form. Old-secret precedence is `LOOKUP_HASH_OLD_PEPPER`, then `TENANT_DATA_ENCRYPTION_OLD_KEY`; neither is accepted as a flag. Null source clears a stale hash. Missing lookup secret refuses before writing; new ordinary writers leave module-owned hashes null in that case. Every writer and reader of the new SSO/sender columns uses this same normalization. Unit tests cover every form, absent secret, stale non-null hashes, null source, ciphertext under the wrong key, normalization, preview, rerun and collisions; the database cases below cover transactions and scopes.

### Coverage-owned hash refreshes

The [content-ai coverage spec](2026-11-16-privacy-coverage-content-ai.md), Schema changes, the [communication coverage spec](2026-11-16-privacy-coverage-communication.md), Inbox lookup and processing barrier / Schema and behaviour changes / API Contracts, and the [commerce coverage spec](2026-11-16-privacy-coverage-commerce.md), API Contracts, add these fills (R5-7). They extend Phase D's maintenance coordination under DEC-F — The B1 hand-offs; they do not rename or replace the three R3-12 — Fill commands for module-written hashes above. An additional fill is required when its hash columns are deployed in an enabled module; an enabled module with no such columns yet needs no speculative fill.

| Owning command | Hash columns | Normalization and delivery |
|---|---|---|
| `mercato forms fill-privacy-hashes --tenant <id> [--apply]` | `forms_invitation.recipient_email_hash` | Trimmed lower-case email, `hashForLookup` without context; content-ai coverage owns delivery with the invitation hash |
| `mercato inbox_ops fill-privacy-lookups --tenant <id> [--apply]` | `inbox_email_privacy_participants.email_hash` | Trimmed lower-case email, `hashForLookup` without context; communication coverage Phase 2 owns delivery with parsed/extracted typed contact matches |
| `mercato messages fill-privacy-hashes --tenant <id> [--apply]` | `messages.external_email_hash` | The contract's normalized email, `hashForLookup` without context; communication coverage Phase 1 |
| `mercato phone_calls fill-privacy-hashes --tenant <id> [--apply]` | `phone_call_participants.phone_number_hash`, `email_hash` | `normalizePhoneDigits` for phone and normalized email for email, `hashForLookup` without context; communication coverage Phase 3 |
| `mercato {sales,cart,checkout,warranty_claims} fill-privacy-hashes --tenant <id> [--after <id>] [--batch-size <1..100>] [--apply]` | `sales_orders.customer_email_hash`, `sales_quotes.customer_email_hash`, `carts.email_hash`, `checkout_transactions.email_hash`, `warranty_claims.contact_email_hash` | The contract's normalized no-context email form; commerce coverage owns delivery and R5-7 requires old/current-form recognition and stale non-null hash refresh; a retained row whose email was cleared has its hash cleared under the null-source rule and counted as `cleared`, not incomplete (commerce coverage, **Source-less retained hashes**) |

**Lookup-key readiness publication.** B1 owns the planned shared encryption DI service `lookupKeyReadiness.verify({ tenantId, purpose }): Promise<{ verified: true; epoch: string }>`. The service loads the authoritative scoped epoch itself; callers cannot supply or establish it. `purpose` is an allowlisted owner-defined lookup family, never a raw identifier. The `entities` maintenance owner persists the tenant/purpose epoch, `pending | verified` state, owner-inventory revision and a domain-separated current-key check through its scoped module configuration. It returns no hash or key bytes. A missing/unknown owner, missing epoch, pending fill, changed inventory or current-process key mismatch throws `LOOKUP_KEY_UNVERIFIED`; it never certifies zero matches.

Before any lookup-secret rotation/fill writes, maintenance marks affected purposes pending with a fresh opaque epoch under a tenant-scoped maintenance lock. Keep ordinary lookup writers stopped throughout the runbook. Freeze the effective secret in the maintenance process; every participating owner fills and independently verifies all of its scoped hash rows against verified plaintext under that key, with no unreadable or unprocessed rows. Only the final full owner reports for the same epoch/inventory allow publication of verified state. The key check is computed internally using C1's `deriveLookupPurposeKey("lookup-readiness:" + purpose)` followed by HMAC-SHA-256 over the length-prefixed tenant UUID and epoch, with no raw key export; pin this composition in known-answer tests. An existing epoch is never overwritten by an ordinary verifier, including the first process started with the wrong secret. Loss of maintenance ownership, partial fill or verification failure leaves pending state. A resumed run revalidates every owner before publishing. Runtime verification computes the check with its own resolved current key and compares it to the trusted published check; scope and purpose bind the result. Communication-owned email/phone families consume this seam as specified in their carrier; unrelated secret purposes do not inherit its readiness.

Acceptance: complete fill and independent verification permit lookup; wrong-key-first startup, missing proof, crash between fills, incomplete owner inventory and cross-tenant/purpose substitution all refuse with `LOOKUP_KEY_UNVERIFIED`, including a lookup that would otherwise return zero rows. Reference these cases from Phase D and the communication carrier's matching tests.

After a secret change, run every enabled delivered owner's fill for each tenant. The communication spec's API Contracts defines `mercato communication_channels fill-privacy-hashes` as an additive wrapper delegating sender-hash work to the canonical R3-12 `mercato communication_channels fill-lookup-hashes` above; the rotation runbook runs the canonical command. Under R5-7, the commerce commands above also run after a lookup-secret change and refresh stale non-null old-secret hashes rather than only filling empty hashes. Each fill recomputes from verified decrypted source under the current secret, including stale non-null and old-key hashes; filling only empty hashes cannot complete migration. Forms uses the invitation address; inbox_ops decrypts the owning emails/proposals and refreshes the participant lookup without changing proposal status. Missing secret, unreadable source, collision, concurrent change or an unavailable required fill leaves maintenance incomplete and traffic stopped. Apply the maintenance safety rule below and verify a repeat report from the beginning. The fill implementations and their migrations remain with their coverage owners. Fixtures for forms/inbox and each commerce fill in those owners' hash tests change the secret with a non-null old hash present, verify the new no-context hash and alias match, and prove preview/rerun/scoping behavior (R5-7).

### Maintenance write safety

`backfill-encryption`, all three `fill-lookup-hashes` commands, the coverage-owned hash refreshes, `rehash-lookups` and the system backfill/reseal share this rule. Each conditional `UPDATE` includes primary key, the exact tenant and organization (using null-safe comparison), and `IS NOT DISTINCT FROM` for every read source and existing target/hash column, adapting rotation's `updateEncryptionColumns` (`entities/cli.ts:504-521`). System-scoped records use the system map plus each row's actual nullable tenant and organization; a null-tenant run never means all tenants. A missed comparison is `changed_concurrently`: leave the row, list its opaque id, continue, and exit non-zero. Do not bump `updated_at`; this storage rewrite does not change the user-visible entity version. Hash-only updates protect source columns too. Unique-index errors use per-row savepoints, including in the fill and system commands. A ciphertext-shaped value left after decryption is never re-encrypted or hashed as plaintext. System wrong-key failures abort their batch before any write as specified above; other commands skip that row. These internal maintenance operations write no command snapshots containing the protected values.

The runbook keeps traffic and every ordinary application, queue, scheduler and token writer stopped for rotation and secret changes. Only the named maintenance passes and their dedicated reindex workers may write during maintenance; live producers and general workers remain stopped. Its order is: preview each pass; rotate ORM data with the new current key and the old key in the environment; complete the search-owned vector step through `searchVectorDisplayMaintenance.run` and its full `VectorDisplayMaintenanceReport` gate above; backfill newly mapped tenant rows with `backfill-encryption --apply`; run `rehash-lookups --apply` for every tenant and for `none`; run the three R3-12 fills and every enabled coverage-owned hash refresh with `--apply`, including `mercato sales fill-privacy-hashes`, `mercato cart fill-privacy-hashes`, `mercato checkout fill-privacy-hashes` and `mercato warranty_claims fill-privacy-hashes`, each with `--tenant <id> --apply`, under R5-7; rotate/refresh system records with `backfill-system-encryption`; if the effective lookup secret changed and the installed release has B4’s keyed token writers, complete B4’s forced token rebuild and purge/report below; verify all incomplete counts are zero, then restore traffic. Do not retire the old key before the ORM, system, vector and required token gates all verify. The legacy `mercato auth rotate-encryption-key`, which rotates only `User` from a flag-supplied key, is not part of this order and is never a substitute for it.

The [search-index spec](2026-11-16-search-index-pii-protection.md), Proposed Solution → 1. Keyed token hashes → Reindex / Purge and report / Secret change, owns the exact token procedure. After the hash passes in a release with keyed token writers, run `mercato query_index reindex --tenant <id> --entity <module:entity> --force` for every enabled entity in every tenant. Rebuild each tenantless catalogue scope with `mercato query_index reindex --entity <catalogue:entity> --force` without a tenant flag; for tenantless rows of a tenant-capable entity run `mercato query_index reindex --entity <module:entity> --force` without a tenant flag. After the query-index rebuilds, run `mercato search reindex-tokens --tenant <id|none>` for the same tenant and tenantless scopes, so the search token strategy's own rows are rewritten keyed. Then run the report-only `mercato query_index purge-legacy-tokens --tenant <id|none>` for every tenant and tenantless scope, optionally per entity; use `--apply` to remove only obsolete absent-source rows and run a fresh report from the beginning. Require `legacyRows: 0`, zero `fingerprintRows` for every non-current fingerprint, `done: true`, `blockedRows: 0` and no incomplete source or writer work before traffic resumes. Earlier releases with unkeyed token writers have no keyed-token rebuild or purge requirement. Present or unknown sources are never purged to force a clean report: repair/rebuild their owning writer instead. This procedure also applies when rotating the encryption fallback key changes the effective lookup secret. The stop-writers requirement lasts through the final report; Search/query_index own these procedures, not the ORM backfill.

### Recorded as not encrypted

| Column | Reason | Bounded by |
|---|---|---|
| Document content, comments, versions | Server-side merge and full-text search need plaintext | Document access control |
| Attachment `file_name`, staff `display_name`, warranty `customer_name` | Searched and sorted in SQL; assumption 2 | Access control; each owning coverage class's export and erasure |
| SSO `idp_subject`, `external_id` | Provider join key; assumption 5 | Access control; enterprise SSO coverage deletes the identity on erasure |
| Interaction `participants`, `linked_entities` | Queried by the erasure run; assumption 6 | Erasure |
| Forms access audit `ip`, `ua` | No tenant column | Retention |
| Indexer error `payload` | Diagnostic raw-write/read path needs its own design; tenant-bearing rows are not exempt merely by nullability | Operational-pruners spec: 30-day target once history deletion is enabled and its counting period passes (DEC-H — The counting-period bridge); report mode alone does not bound rows |
| Rows with no tenant in `sso_identities` | No tenant key applies | Enterprise SSO coverage deletes them on erasure after the auth owner confirms tenant membership ([enterprise coverage](../enterprise/GDPR/2026-11-16-privacy-coverage-enterprise.md), resolved assumption 7) |
| Rows with no tenant in `attachments` | No tenant key applies | Deliberate residual under the program's B2 disposition *minimize*: the upload route requires a tenant (`attachments/api/route.ts:292`), so no new tenantless row is created through it; existing ones come from legacy data or non-route writers. each `backfill-encryption` run also prints the installation-wide count of tenantless rows for every mapped entity it visits as `no_tenant`, informational with exit 0 and no further read, so operators can see and remove them; no system-scoped map is declared for attachment content |
| `channel_metadata`, notification `group_key` and source columns | Queried by value | — |

### Design decisions

| Decision | Rationale |
|---|---|
| Frozen field names in each backfill migration | A migration that reads the live map would change meaning when the map changes. PR #9011 does this. |
| Readers move to the decrypting helpers in the same step as the map | A plain find can return ciphertext when the row is already in memory (#5447). |
| A hash column for every value query, written by the owning module's own code | Ciphertext is not deterministic, and the hash the encrypt step writes is null whenever encryption did not run. |
| A separate backfill command | Rotation must refuse to start on any doubt; backfill must get as far as it can and say what it skipped. One command cannot do both. |
| Nothing new on the map rule | A tenant's map is rebuilt from two keys in five places; a third would be lost on the first edit. |
| The "not encrypted" list is data in a test | It turns two module comments into something a reviewer sees change. |
| The `customers` hashes are written by the module, not declared as `hashField` | The phone hash is over digits only, which the encrypt step cannot express, and the encrypt step writes a hash only when it encrypts. |
| One rehash command for mapped hash columns; module-written hashes refreshed by their own fill command | A map rule says which column hashes which field and how; a module-written hash has a normalization only its module knows. |
| System-scope rotation extends `backfill-system-encryption` | That command already walks system-scoped maps in batches; the rotation command walks `encryption_maps`, where they are not. |
| Old secrets from the environment only | A flag exposes the secret in process listings, which the entities rotation command already refuses by default. The legacy `mercato auth rotate-encryption-key --old-key` is named in the runbook as unsupported for these procedures. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Encrypt rows inside the migration | Migrations have no access to tenant keys. |
| Map everything in one change | Thirty columns, fourteen modules, each with its own readers. |
| Add a tenant column to the forms audit and the indexer log | A schema and writer change for two diagnostic tables that retention already bounds. |
| Encrypt the SQL-searched names now | See assumption 2. |
| Hash the SSO subject and SCIM external id | It changes two unique constraints and every provider join for a value that is usually an opaque provider id; see assumption 5. |
| Gate the SCIM doctor check on an issued SCIM token, through the database tier | R5-4 places the check in the configuration tier, and a token can be issued at any time without a restart, so the secret must be in place before SCIM is switched on. |
| Make the rotation command skip and continue | It would report success while leaving a map's data under the old key. |
| Freeze existing maps as exceptions to the backfill guard | Most existing fields would remain outside the guard. |
| A case-preserving hash selected on the map rule | Needed only for the SSO subject, which stays in clear; and the rule cannot carry it. |
| Make the rotation command rehash lookups and rotate system-scoped maps | It is owned by the enterprise rotation spec, must refuse on any doubt, and recomputes a hash only for a field it reseals. |
| Add the old keyed form to `lookupHashCandidates` | Every lookup would carry a third form for as long as the old secret is set. The runbook keeps the installation in maintenance until hashes are refreshed. |

## 📝 Delta

### Capability: field-encryption-coverage

#### MODIFIED Requirement: Storage of the listed columns
The system SHALL store each column this spec maps as ciphertext for tenants with encryption on, and SHALL return the same values through its APIs as before.

##### Scenario: New row
- WHEN a webhook delivery is recorded after the upgrade
- THEN its stored payload is ciphertext and the deliveries API returns the payload

##### Scenario: Existing tenant
- WHEN the upgrade's migrations have run for a tenant created earlier
- THEN that tenant's effective map includes the new columns

##### Scenario: Existing row
- WHEN the row backfill has run for the tenant
- THEN rows written before the upgrade are ciphertext

##### Scenario: Older tenant, field declared later
- WHEN a tenant was created before a field was added to a module's map and the catch-up migration has run
- THEN that tenant's effective map includes the field

##### Scenario: Value lookup
- WHEN a SCIM client filters users by email with a configured lookup secret and completed fill, or with no secret where the stored email is plaintext or at most 100 identities in the scoped configuration hold ciphertext
- THEN the user is found, whether or not encryption is on for the tenant

##### Scenario: SCIM email filter without a lookup secret above the bound
- WHEN the bounded reader is activated in no-secret mode and a SCIM `userName` or email filter’s exact configuration contains more than 100 ciphertext email values
- THEN it returns the standard SCIM Error at 400 with `scimFilter.lookupSecretRequired`, no partial matches, and remediation to configure the secret before the fill (R5-4)

##### Scenario: SCIM lookup-secret diagnostic
- WHEN the `sso` module, which carries SCIM, is enabled, tenant data encryption is enabled and no lookup secret is configured, whether or not a SCIM token has been issued yet
- THEN from minor N configuration-tier doctor check `sso.scim_lookup_secret_missing` reports an error with remediation to configure the secret before enabling SCIM at scale (R5-4)

##### Scenario: SCIM email filter with encryption off and no lookup secret
- WHEN encryption is off, no lookup secret is configured and a scoped configuration holds more than 100 identities
- THEN a `userName` filter matches by SQL equality on the plaintext email, as today, with no limit, and the doctor does not raise `sso.scim_lookup_secret_missing`

##### Scenario: SCIM warning minor
- WHEN minor N is installed, tenant data encryption is enabled, no lookup secret is configured and a SCIM `userName` or email filter runs
- THEN the filter behaves as today, the runtime warning `sso.scim_lookup_secret_missing` is logged once per process, and neither the new 400 nor the new 503 is reachable through minor N’s unchanged route, including when a custom map has already encrypted those columns

Frozen by: `packages/webhooks/src/modules/webhooks/__tests__/delivery-storage.characterization.test.ts`, `packages/enterprise/src/modules/sso/__tests__/identity-lookup.characterization.test.ts`

#### ADDED Requirement: Coverage guards
The system's test suite SHALL fail when an encryption map ships without a backfill, when a column with a personal-data name has neither a map nor an entry in the reviewed list, or when a table with a map gains an unlisted raw write.

##### Scenario: New map without backfill
- WHEN a module adds a field to its map and no migration backfills it
- THEN the suite fails and names the field

#### ADDED Requirement: Row backfill
The system SHALL provide a preview-by-default command that encrypts existing ORM-mapped rows with `--apply` in bounded batches, continues past a map it cannot process, distinguishes store-owned delegated work, and reports all incomplete work.

##### Scenario: Unresolvable map
- WHEN one map cannot be resolved to a table
- THEN the other maps are processed, the skipped one is listed, and the command exits non-zero

##### Scenario: Store-owned vector map
- WHEN `backfill-encryption` encounters `vector:vector_search`
- THEN it reports delegated search work separately, names `mercato search encrypt-vector-display`, and never counts the map as an unknown-map skip or claims the store is complete

##### Scenario: Concurrent edit
- WHEN a user changes a source column between maintenance read and conditional write
- THEN the edit and `updated_at` survive, the row is reported `changed_concurrently`, and later rows continue

##### Scenario: Rotation still refuses unknown maps
- WHEN the rotation command meets a map it cannot resolve, other than `vector:vector_search`
- THEN it still refuses to start

##### Scenario: Rotation with search enabled
- WHEN `rotate-encryption-key` runs for a tenant whose maps include `vector:vector_search`
- THEN it rotates the ORM maps, lists the vector map as delegated with `complete: false`, names `mercato search encrypt-vector-display` with the old key in `TENANT_DATA_ENCRYPTION_OLD_KEY`, and exits 2 until a fresh target-bound full owner report also verifies the vector store; a rerun after vector reseal exits 0 only when both stores verify; `decrypt-database` refuses before any write with a store-owned reason

Frozen by: `packages/core/src/modules/entities/__tests__/cli-rotate-encryption-key.characterization.test.ts` (today's refusal on the vector map, characterized before the classifier changes)

#### ADDED Requirement: Lookup-hash refresh and system-scope rotation
The system SHALL write a lookup hash for a CRM person's email and phone when a lookup secret is configured, whether encryption is on or off, SHALL leave those hashes null without a secret, SHALL provide a command that brings every mapped lookup hash to the current secret, and SHALL rotate system-scoped records from an old root.

##### Scenario: CRM person by email
- WHEN a person is saved with an email and a configured lookup secret, with encryption on or off
- THEN `primary_email_hash` equals the lookup hash of that email

##### Scenario: Phone spacing
- WHEN a person's phone is saved as `+48 600 100 200`
- THEN `primary_phone_hash` equals `hashForLookup('48600100200')`, using `normalizePhoneDigits`, and equals the privacy phone alias

##### Scenario: No lookup secret
- WHEN a CRM contact is created or edited without a configured lookup secret
- THEN its module-owned hashes are null, scoped readers use their null-hash fallback, and the fill command refuses rather than writing an unkeyed digest

##### Scenario: Unreadable source
- WHEN a fill or rehash cannot decrypt a ciphertext-shaped source
- THEN it preserves the existing hash and source, lists `unreadable_source`, continues and exits non-zero

##### Scenario: Secret changed
- WHEN the lookup secret has changed and `rehash-lookups --apply` has run for a tenant
- THEN every mapped hash of that tenant is in the current form, and a re-run changes nothing

##### Scenario: Unique collision
- WHEN a rewrite would duplicate a hash under a unique index
- THEN that row is left unchanged and listed, and the command exits non-zero

##### Scenario: System-scoped rotation
- WHEN `backfill-system-encryption` runs with the old root in `TENANT_DATA_ENCRYPTION_OLD_KEY`
- THEN values sealed under the old system DEK are resealed under the current one, and a value that decrypts under neither stops its batch

Frozen by: `packages/core/src/modules/entities/__tests__/cli-backfill-system-encryption.characterization.test.ts`

The collision scenario includes valid/colliding/valid rows in one batch: the savepoint preserves the two valid rewrites. Catch-up scenarios execute the real migration SQL twice against old scoped maps; source-list unit assertions alone do not cover them.

## 📝 Architecture

- **Guards** in `packages/core/src/__tests__/`, beside the optimistic-lock coverage test: `encryption-map-backfill-coverage.test.ts`, `personal-data-column-coverage.test.ts`, `mapped-table-raw-write-coverage.test.ts`, each with a data file for its reviewed list.
- **Row backfill**: a new command in `packages/core/src/modules/entities/cli.ts`, sharing rotation's scope resolution and conditional writes, replacing its abort-on-skip rule with the maintenance safety contract.
- **Backfill parsing**: the guard reads migration source for the helper's calls; it does not import the check in `packages/cli`, which core does not depend on.
- **Per module**: `encryption.ts`, one migration, reader changes, and where needed an entity column for a hash.
- **Phase D**: the hash columns and their fill command in `packages/core/src/modules/customers/` (entity hooks, shared module-local helper, commands, `cli.ts`); `rehash-lookups` and the extended `backfill-system-encryption` in `packages/core/src/modules/entities/cli.ts`, sharing the rotation command's scope resolution. **Shared prerequisite before Phase C items 3 and 4**: two additive exports in `packages/shared/src/lib/encryption/aes.ts`: `hashForLookupWithSecret(value, secret, context?)` for old-form comparison and `hasLookupSecret()` to check the existing private resolver without exposing secret material.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Module → encryption | Its own map and the shared helpers | Encryption off: columns stay plaintext |
| Guards → modules | File globbing in tests; no runtime coupling | — |
| Enterprise modules | Same pattern, separate PRs | — |

## 📝 Data Models

Additive columns and indexes, each with its migration and module snapshot:

| Table | Change |
|---|---|
| `external_messages` | `sender_identifier_hash`, partial index with the tenant, built concurrently |
| `sso_identities` | `idp_email_hash`, `idp_name_hash`, each with a partial index with the configuration, built concurrently |
| `customer_entities` (Phase D) | `primary_email_hash`, `primary_phone_hash`, nullable text, each with a partial index with `tenant_id` and `organization_id`, built concurrently |

**Index builds.** `customer_entities`, `external_messages` and `sso_identities` take writes on every CRM edit, inbound message and sign-in, and a plain `CREATE INDEX` holds a SHARE lock that blocks those writes for the whole build. Each table's hash columns are therefore added by an ordinary migration, and their indexes by a separate migration per table with `isTransactional()` returning `false`, following `attachments/migrations/Migration20261009120000_attachments.ts`: `drop index concurrently if exists`, so a retried build removes PostgreSQL's invalid stub, then `create index concurrently` as a partial index `WHERE <hash column> IS NOT NULL`, since null-hash rows are found by the scoped fallback, not the index. A migration test asserts each index is valid after a run and after a rerun. The upgrade note says the builds run without blocking writes and that their duration grows with table size.

No index or constraint is removed. Migrations add or extend maps in tenant scopes with active maps, as `buildEncryptionMapBackfillSql` selects them; tenant scopes without active maps are not silently enabled. System-scoped maps are resolved from module code, never inserted by that helper. Existing entity versions and optimistic locking remain unchanged; the new hash columns are internal derived fields, not user-editable entities. The Phase A inventory and readiness evidence distinguish effective required maps, intentional exceptions with a recorded authoritative disposition, and missing required policy. Preserve the migration’s existing eligibility rule. Record the disposition, owner and follow-up gate for missing required maps including scopes with no active maps, coordinated with A3 and the program readiness assessment. A missing map never completes required protection evidence.

## 📝 API Contracts

- **Route values and successful response shapes stay the same.** Minor N and configurations without activation use the legacy reader. After keyed activation, when null-hash identities exceed assumption 10’s 100-candidate fallback bound, `GET /api/sso/scim/v2/Users` returns the standard SCIM Error envelope at 503, built with `buildScimError`, until the fill has run. This 503 is transient and is the only 503 these filters return; it differs from the R5-4 400 below, which arises only without a secret and which no fill can clear. Under R5-4, without a lookup secret a `userName` or email filter matches plaintext stored values by SQL equality with no limit and uses a bounded decrypting scan of at most 100 scoped identities holding ciphertext; above that it returns the standard SCIM Error envelope at 400 with localized detail `scimFilter.lookupSecretRequired`. The 400 is reachable only after explicit scoped no-secret activation in minor N+1 at the earliest. It never returns an incomplete ListResponse as success. No-secret `displayName` filters follow the same rule on `idp_name`: unlimited equality on plaintext, a bounded scan of at most 100 ciphertext identities, then the same 400; they never return 503. Assumption 10 fixes the configured-secret fallback; R5-4 fixes the no-secret `userName`/email behavior.
- **R5-4 doctor check:** enterprise SSO declares `sso.scim_lookup_secret_missing` in its `privacy.ts` `doctorChecks`, with `needs: 'configuration'` and error severity. It reads only the existing context and fires, from minor N, only when all three hold: `moduleIds` includes `sso`; tenant data encryption is enabled, read from `context.env.TENANT_DATA_ENCRYPTION` with the rule of `isTenantDataEncryptionEnabled()` (`packages/shared/src/lib/encryption/toggles.ts`: unset, empty or unparseable means on), the toggle behind the doctor's `encryption.disabled` check; and `hasLookupSecret()` is false. With encryption off, the check is not raised. Previously or independently encrypted values still follow the activated reader’s ciphertext rule. Minor N precedes the N+1 refusal, so the doctor is the operator's gate before it. SCIM is switched on at runtime by issuing a SCIM token to an SSO configuration, with no restart, so an installation running the `sso` module is SCIM-capable and the configuration tier treats it as SCIM enabled. It exposes no secret material, tells operators to configure the secret before enabling SCIM at scale, and follows DEC-I/R3-2 discovery. No database access or new context member is introduced.
- **`mercato entities backfill-encryption --tenant <id> [--entity <id>] [--batch-size <n>] [--max-batch-bytes <n>] [--apply]`** — new, preview by default; batch size 1–100 (default 100, or 10 for the large-text entities named in Phase A item 5); byte budget 1–64 MiB, default 8 MiB, measured with `octet_length` before contents are fetched; rows above the budget are processed alone and listed as `oversized`. Exit 0 for a complete ORM pass; list `store-owned` delegations separately with `complete: false` until their search-owned verification. Exit non-zero on unknown maps, unreadable rows or concurrent edits.
- **`mercato entities verify-encryption --tenant <uuid> | --system`** — new Phase A read-only command. Exactly one selector per invocation. It runs the persisted upgrade verification above independently of the backfill invocation. An unverified scope exits non-zero. Output is aggregate only and preserves the difference between complete ORM evidence and the delegated store's unanswered result.
- **`entities.encryption_backfill_pending` / `entities.encryption_backfill_unverified`** — Phase A optional database-tier owner declarations under DEC-I/R3-4. Bind their transaction-bound counts to the same required-map inventory/classification for the requested tenant batches. Aggregate only the recorded `plaintext` and `unverifiable`/`missing_policy` counts respectively as errors. If the statement/scan budget is exhausted or a check cannot safely use the current keys without full bootstrap or provisioning, surface `entities.encryption_backfill_unverified` and never return a clean zero. The direct scoped command and separate owner reports supply rollout evidence. Doctor’s default config-only path does not query rows.
- **`mercato customers fill-lookup-hashes --tenant <id> [--apply]`** — new (Phase D). Uses the R3-12 contract above. The SSO and communication-channels commands have the same flags, form counts and exits.
- **`mercato entities rehash-lookups --tenant <id> [--apply]`** — new (Phase D). `<id>` may be `none` for rows with no tenant. Reads `LOOKUP_HASH_OLD_PEPPER` or `TENANT_DATA_ENCRYPTION_OLD_KEY` from the environment. Prints counts per entity and form: current, old, legacy, null, unrecognised. Exit 0 when every row is current or was rewritten; non-zero on a collision, concurrent change, unreadable source or missing lookup secret; batch size defaults to 100 and is capped at 100.
- **`mercato entities backfill-system-encryption`** — existing flags unchanged (Phase D). It refreshes stale hashes, and with `TENANT_DATA_ENCRYPTION_OLD_KEY` set it also rotates; exit non-zero when a value decrypts under neither key, when rotation is asked of a Vault-backed KMS, on a concurrent change or collision, or when hash refresh lacks a lookup secret.
- **`LOOKUP_HASH_OLD_PEPPER`** — new environment variable, read only by the mapped rehash, R3-12 fills, coverage-owned hash fills and system hash refresh during maintenance. Documented in the runbook, not in `.env.example`: it is set only for the maintenance run.
- **Map rule type and rotation CLI flags stay unchanged.** Phase A item 7 gives the Core rotation and decryption classifier the explicit store-owned vector delegation, which the enterprise rotation spec reuses: `rotate-encryption-key` rotates ORM data and reports delegated vector work with `complete: false`, `decrypt-database` refuses with a store-owned reason, and unknown maps still block before writing. Phase D adds `hashForLookupWithSecret(value: string, secret: string, context?: string): string` and `hasLookupSecret(): boolean` to the shared hash helpers. The latter delegates to the existing private `resolveLookupPepper`, preserving precedence and normalization; no existing helper signature or unkeyed legacy behavior changes. The shared `normalizePhoneDigits(value: string): string` contract and first-landing rule remain owned by C1 Phase 1.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Tenant with encryption off | Maps are added; values stay plaintext |
| Row with no tenant | Stays plaintext; listed as `no_tenant`; bounded as recorded under Recorded as not encrypted |
| Reader not yet moved to the decrypting helper | Caught by the step's tests; the mixed-state tolerance means plaintext rows still read |
| JSON column read through a query builder | Must parse the decrypted string; each such reader is fixed in its module's step |
| Backfill interrupted | Batches are independent; a re-run skips rows that are already ciphertext |
| SSO identity created before the hash columns existed, with a configured lookup secret | Existing matching stays available until a verified keyed activation. Run `mercato sso fill-lookup-hashes --tenant <id> --apply` and verify scoped readiness before enabling the reader. After activation, a subsequent null-hash residual uses the bounded fallback and can return 503 above 100, with the fill remedy and no partial results. |
| SCIM `userName`, email or `displayName` filter without a lookup secret | After explicit no-secret activation, plaintext stored values match by SQL equality with no limit. Identities holding ciphertext within the tenant/organization/configuration are decrypted when at most 100, regardless of existing hashes; above 100 return 400 with `scimFilter.lookupSecretRequired` (R5-4). Configure the secret before SCIM at scale, then fill; the limit on ciphertext persists while no secret is configured |
| Encryption off, no lookup secret, 101 plaintext SSO identities | Unlimited equality during the bridge and after no-secret activation. No doctor error or runtime warning. Existing ciphertext, if present, remains subject to the post-activation ciphertext rule. |
| `sso` module enabled with tenant data encryption on and without a lookup secret | Configuration-tier error `sso.scim_lookup_secret_missing` (R5-4) from minor N, even before any SCIM token is issued, because a token can be issued without a restart; setting a lookup secret clears it. No database read in that tier |
| Large extracted text or webhook payload | Encrypted like any string; no size cap exists in the pipeline. The backfill's byte budget keeps a batch near 8 MiB; a single larger row is processed alone and listed as `oversized` |
| An older tenant after the catch-up migration | New writes to added fields are encrypted. Old rows stay readable and can remain plaintext until backfill. Verify the persisted scope before calling the rollout complete. |
| A tenant that removed a field from its map on purpose | The catch-up migration adds it back. The upgrade note says so and names the admin page where it can be removed again |
| Webhook retry of a delivery stored before the upgrade | Reads plaintext; unchanged |
| A person with no email or phone | Both hashes stay null; the fill command leaves the row |
| A person saved by an older process during the rollout | During rollout stop old writers before the fill: a new row may have null hashes and an old writer can leave a stale non-null hash. New entity hooks cover ORM writes; the fill repairs stale rows before traffic returns |
| `rehash-lookups` interrupted | Committed batches stay; a re-run skips current rows and continues |
| `rehash-lookups` with no lookup secret configured | Refuses; nothing is written |
| Two live rows of one tenant hold the same email, one under the legacy form | Rewriting the second collides on the unique index; it is left unchanged and listed |
| A stored hash in no recognised form | Recomputed only from verified plaintext and listed as unrecognised; an unreadable envelope is skipped unchanged with non-zero exit |
| No lookup secret in a module writer or maintenance shell | Ordinary module writes clear their new hashes to null; fill and mapped rehash refuse; system refresh preserves hashes and reports incomplete work |
| User edits during any maintenance pass | Conditional source-and-target comparison fails; row left untouched and listed; later rows continue; `updated_at` unchanged |
| Unique violation in a batch | Roll back to the row savepoint, release it, record collision and process the next row |
| `backfill-system-encryption` with the wrong old key | Values decrypt under neither key; their batches are not written; exit non-zero |
| System-scoped rotation under a Vault-backed KMS | Refused; the runbook's assisted path applies |

## 📝 Migration & Backward Compatibility

| Change | Class |
|---|---|
| Columns stored as ciphertext | Storage only; successful response shapes unchanged |
| SCIM legacy fallback cap | STABLE route behavior change on `GET /api/sso/scim/v2/Users`, ordinary protocol (program DEC-5). Minor N preserves existing matching even for preexisting ciphertext and introduces neither the 503 nor the 400. Minor N+1 at the earliest introduces the bounded reader, after explicit scoped activation under the readiness rules above. Add the dated `BACKWARD_COMPATIBILITY.md` entry and document fill and activation before adding the map or running row backfill on an upgraded configuration. |
| `sso.scim_lookup_secret_missing` doctor check | R5-4 adds, from minor N, a configuration-tier error when the `sso` module is enabled, tenant data encryption is enabled and no lookup secret is set; not raised with encryption off; no data read, mutation or context member is added to that tier |
| Catch-up migrations | Older tenants start encrypting fields their module already declares. Storage only; called out in the upgrade note |
| New hash columns and indexes | Additive schema; indexes built concurrently in non-transactional migrations, so writes are not blocked during the build |
| New row-backfill command | Additive |
| `rotate-encryption-key` and `decrypt-database` classify `vector:vector_search` as store-owned | `rotate-encryption-key` now runs, instead of refusing, for tenants with the vector map, and reports delegated work with `complete: false`; `decrypt-database` still refuses, with a clearer reason. Exit meanings for every other map are unchanged. Behaviour fix with a dated entry; the upgrade note gives the store step and says to keep the old key until its report verifies |
| New `fill-lookup-hashes` and `rehash-lookups` commands, `LOOKUP_HASH_OLD_PEPPER` | Additive |
| `backfill-system-encryption` rotates when `TENANT_DATA_ENCRYPTION_OLD_KEY` is set, and refreshes stale hashes | Rotation is additive behind a variable the command did not read before. The hash refresh is a defect fix: a stale hash matches nothing, and the dry run lists every row it would rewrite |
| Two exports in the shared hash helpers | Additive |

`UPGRADE_NOTES.md`, per phase: which columns are now mapped; the row-backfill command to run per tenant and how long it may take; that rows stay readable in the meantime; that a field a tenant removed from its map is added back. For Phase D: the new `customers` fill command to run per tenant; that after any lookup-secret change, including a rotated encryption fallback, `rehash-lookups` runs per tenant and for `none`, followed by the exact three R3-12 fills and enabled coverage-owned fills, including forms, inbox_ops and the R5-7 `sales`, `cart`, `checkout` and `warranty_claims` `fill-privacy-hashes` commands, refreshing stale non-null hashes too; then, once the deployed release contains B4’s keyed token writers, B4's forced query-index rebuild for every tenant/entity and tenantless scope, `mercato search reindex-tokens --tenant <id|none>` for the same scopes, and `mercato query_index purge-legacy-tokens` apply/report with zero legacy and old-key residuals, before traffic returns. Keep all writers stopped throughout. Document that `backfill-system-encryption` now rotates when the old root is set and link the complete Maintenance write safety order. For Phase C, minor N documents unchanged matching, both later refusal conditions, and the warning without relying on whether tenant-authored maps exist. Minor N+1 at the earliest documents exact scoped activation, keyed fill verification, and explicit no-secret acknowledgement. After activation the 503 is cleared by filling under the configured secret, and the 400 requires configuring the secret before the fill. Document the read-only verify command and safe preconditions per scope, where to record its aggregate evidence, and the independent B4 completion check. State which release keeps mixed-state reads and which downstream activation gates wait for the verified result.

## 📋 Phasing

| Phase | Outcome | Shippable alone |
|---|---|---|
| A | Store-owned rotation classifier, catch-up migrations, three guards, row-backfill and independent persisted verification commands | Yes |
| B | Safe columns, one module per PR | Yes, each |
| C | Columns needing a writer or lookup change | Yes, each |
| D | `customers` lookup hashes, `rehash-lookups`, system-scope rotation | Yes, each of its three items |

## 📋 Implementation Plan

### Phase A
1. **Characterize** the rotation command's refusal on an unresolvable map, and today's refusal of `rotate-encryption-key` and `decrypt-database` on `vector:vector_search`, so the new commands cannot weaken the unknown-map refusal by accident. Commit alone.
1a. **Core classifier** (Proposed Solution item 7), before any catch-up migration: `store-owned` for exactly `vector:vector_search` in `classifyEncryptionMap`; `rotate-encryption-key` rotates ORM maps, reports pending delegated vector work with `complete: false`, the store command and exit 2; after the store step, only current full target-bound verification plus complete ORM verification permits exit 0; `decrypt-database` refuses before any write with a store-owned reason. Unit tests: exit-code-only automation retains the old key after delegated exit 2; missing/stale/wrong-target owner proof cannot return 0; a rerun after the verified vector step returns 0 without rewriting current ORM rows. Rotation with an ORM map and the vector map rotates the ORM rows, writes nothing to search tables and prints the store step; an unknown non-ORM map beside the vector map still refuses before any write; `decrypt-database` refuses with the store-owned reason and changes nothing. Update the characterization test to the new scenarios in the same commit.
2. Catch-up migrations, one PR per package, each with its module snapshot untouched and a unit test that the literal list equals the module's map. Add `encryption-map-catch-up.database.test.ts`: seed old customer, staff and search maps in a dedicated database schema, an extra custom rule, a missing map in another active scope, an already-current scope, and an unrelated entity/tenant control; execute the real migration SQL twice, assert missing rules added for eligible tenant scopes, custom rules preserved, rerun idempotent and unrelated entity rules untouched. The migrations are installation-wide, so other tenants' eligible maps are expected to gain fields too; assert each updated row keeps its own tenant/organization. Drop the schema in `finally`.
3. The backfill guard, parsing the helper's calls. It must pass with no exception list.
4. The personal-data column guard with its pattern and data file; the initial unreviewed count is recorded here when the step runs.
5. The raw-write guard with its reviewed and capped-unreviewed data file; record the initial mapped-table count when implementing, and require review for any new call site.
6. The row-backfill command: keyset batches bounded by rows and bytes, preview and `--apply`, conditional updates, store-owned classification and exit code. Database-backed oversized fixtures: a batch of rows whose sum exceeds the budget splits at the budget; a single 20 MiB attachment `content` row is processed alone and listed `oversized`; large-text entities use their smaller default. Unit tests pin the delegated classification shared with step 1a, without weakening unknown-map rotation refusal. Database-backed tests seed plaintext rows and interleave edits; no stale write or version bump is allowed.
6a. Deliver `verify-encryption` and owner doctor checks. Unit and database cases cover valid active ciphertext, stored plaintext after a map migration and before backfill, stale/unknown key, malformed envelope, unknown map, foreign tenant and null-organization rows, system rows, no provisioning or writes, known empty versus unknown scope, bounded reads, no values/identifiers in reports and delegated-but-unverified store. TC-ENCRYPTION-BACKFILL-VERIFY-001 drives the actual commands: seed a populated pre-upgrade tenant and a separate control scope, run the map migration, assert new writes are sealed and verification still fails on old plaintext, apply backfill, rerun independently to get zero for that scope, and show a corrupt or incomplete scope still refuses. Run the database-tier doctor with selected tenants against the same fixtures and check aggregate-only output. Own and remove each database fixture.

### Phase B — one step per module
`webhooks` (including the error message; lease raw write is null-only), `notifications`, `attachments` (content), `communication_channels`, `checkout`, `staff` (all but display name), `workflows` (all but form data), `integrations`, `customers` (loss notes, location), `shipping_carriers`, enterprise `record_locks`. Each step: characterize storage where the Delta names a test; add map entries; add the migration with literal names; move plain finds to the decrypting helpers; fix any query-builder reader of a JSON column; one integration test.

### Phase C

Shared prerequisite before items 3 and 4: publish the additive `hashForLookupWithSecret` and `hasLookupSecret` exports in `aes.ts`. Unit tests compare explicit-secret hashing with `hashForLookup` under the same and different secrets, and verify effective-secret precedence and quote trimming without returning key material. Include both exports in the prerelease package consumed by the first Phase C writer.
1. `workflows`: write `form_data` through the entity; then map it.
2. `push_notifications`: encrypt the payload explicitly in the insert path, listed in the raw-write guard; then map it.
3. `communication_channels`: sender hash on every write with a configured secret, otherwise null; `mercato communication_channels fill-lookup-hashes` with the R3-12 contract and its unit/database tests; then map `sender_identifier`; run `yarn generate` after adding the new `cli.ts` discovery file.
4. Enterprise `sso`: add the hash columns, all owning writers, `mercato sso fill-lookup-hashes`, and the `idp_groups` map in minor N, alongside the warning and environment-only doctor check. Declare the check through `privacy.ts.doctorChecks` under DEC-I/R3-2. It fires when `moduleIds` includes `sso`, tenant data encryption is enabled and `hasLookupSecret()` is false. Keep the existing SCIM route’s matching in N. In N+1 at the earliest, deliver scoped readiness, the bounded reader and the new product maps in the stated rollout order. Test each release/readiness combination, existing tenant-authored ciphertext, a fill with stale/unreadable rows, keyed and no-secret bound responses after activation, unlimited plaintext equality and once-per-process warnings. Verify doctor controls without database access. Run `yarn generate` when introducing the CLI discovery file. Track configured-secret fallback removal with its zero-null gate.

### Phase D — Lookup hashes and system-scope rotation
1. **Characterize** that `backfill-system-encryption` leaves a value sealed under another root unchanged and accepts no old key, and that a `users.email_hash` written under one lookup secret no longer matches after the secret changes. Commit alone.
2. Phase D consumes the additive `hashForLookupWithSecret` and `hasLookupSecret` exports already shipped ahead of Phase C. Use that contract in item 4, including characterization of effective-secret selection.
3. `customers`: the two columns, their concurrently built partial indexes in a separate non-transactional migration, migration and snapshot; the entity hooks and raw-writer coverage; the fill command. Add or reuse C1 Phase 1's identical `normalizePhoneDigits` at `@open-mercato/shared/lib/privacy/identifier`. Unit tests: create and update set both hashes with encryption on and off; with no secret both hashes stay null; a cleared value clears its hash; ORM update outside commands refreshes both; two spellings of one phone give the same digits-only hash as the privacy alias and the existing `extractPhoneDigits`; the fill command fills null hashes, rewrites stale ones, writes nothing without `--apply` and is idempotent.
4. `rehash-lookups`. Unit tests: each stored form is classified and rewritten or skipped as specified; the old secret is taken from `LOOKUP_HASH_OLD_PEPPER`, then from `TENANT_DATA_ENCRYPTION_OLD_KEY`; a rule declared in code but missing from the stored map is covered; `--tenant none` reads rows with no tenant; a unique collision leaves the row and exits non-zero; a re-run after an interruption changes only the rest; refusal with no lookup secret; no write without `--apply`. One database-backed test seeds each form, an undecryptable envelope, and valid/colliding/valid rows in one batch; later valid rows commit after a row-savepoint rollback. Interleave an edit after read for each writer and assert both data and `updated_at` survive; scope controls must remain untouched.
5. `backfill-system-encryption` rotation. A database-backed test with two roots seeds onboarding rows sealed under the old root, under the current one, in clear, and under a third root: the first are resealed and their `email_hash` refreshed, the second and third kinds behave as specified, and the third root's batch is not written. Unit tests: without the old key, plaintext is encrypted, a stale `email_hash` is refreshed and old-root ciphertext is left as it is; rotation is refused under Vault; no-secret refresh preserves existing keyed hashes and reports incomplete work; unreadable sources are never hashed; conditional writes and savepoints follow Maintenance write safety.
6. The runbook: the full ordered procedure under Maintenance write safety, including all three exact R3-12 fill names, enabled coverage-owned fills (forms invitation and inbox participant hashes, plus all four R5-7 commerce `fill-privacy-hashes` commands included), search-owned vector work, then when the release contains keyed token writers, B4’s forced query-index token rebuild for every tenant/entity plus tenantless scopes, `mercato search reindex-tokens --tenant <id|none>` for the same scopes and `mercato query_index purge-legacy-tokens` apply/report. A populated secret-change rehearsal must show zero legacy rows, zero non-current fingerprint rows, zero blocked rows and no incomplete work before any writer or traffic resumes; include a fallback-key rotation. The runbook states that `mercato auth rotate-encryption-key` is not a supported path for this procedure and must not be run. Document `LOOKUP_HASH_OLD_PEPPER` and system-scope rotation in `UPGRADE_NOTES.md` and `apps/docs/docs/user-guide/encryption.mdx`.
7. Integration tests TC-CUSTOMERS-LOOKUP-HASH-001 and TC-ENCRYPTION-REHASH-001.
8. Archive this Delta into `.ai/specs/capabilities/field-encryption-coverage.md` if that directory has been adopted by then.

### File manifest

| File | Action |
|---|---|
| `packages/core/src/__tests__/{encryption-map-backfill-coverage,personal-data-column-coverage,mapped-table-raw-write-coverage}.test.ts` and their data files | Create |
| One catch-up migration in each module whose map has none | Create |
| `packages/core/src/modules/entities/cli.ts` and a backfill service | Modify / create |
| For each module in Phases B and C: `encryption.ts`, a migration and snapshot, readers, tests | Create / modify |
| `packages/enterprise/src/modules/{sso,record_locks}/…` | Create / modify — separate PRs |
| `<module>/__integration__/TC-*-ENCRYPTION-*.spec.ts`, one per module | Create |
| `packages/core/src/modules/customers/{data/entities.ts,commands/people.ts,commands/companies.ts,cli.ts}`, a migration and snapshot | Modify / create — Phase D item 1 |
| `packages/core/src/modules/entities/cli.ts` | Modify — `rehash-lookups`; rotation in `backfill-system-encryption` |
| `packages/shared/src/lib/encryption/aes.ts` | Modify — two additive exports for explicit-secret hashes and presence checking |
| `packages/shared/src/lib/privacy/identifier.ts` | Add or reuse C1 Phase 1's identical `normalizePhoneDigits`; first landing owns the file addition, both callers share it |
| `packages/core/src/modules/entities/__tests__/{cli-rotate-encryption-key,cli-backfill-system-encryption}.characterization.test.ts`, `packages/webhooks/src/modules/webhooks/__tests__/delivery-storage.characterization.test.ts`, `packages/enterprise/src/modules/sso/__tests__/identity-lookup.characterization.test.ts` | Create — all Delta characterization tests |
| `packages/core/src/__tests__/encryption-map-catch-up.database.test.ts`, `packages/core/src/modules/entities/__tests__/encryption-maintenance.database.test.ts` | Create — real migration SQL, conditional writes and savepoints |
| `packages/core/src/modules/customers/lib/lookup-hashes.ts` and unit tests; `data/entities.ts` hooks | Create / modify — all ORM and raw writers share one normalizer |
| `packages/enterprise/src/modules/sso/cli.ts`, `privacy.ts`, module-local hash helper, SCIM filters/response handling and i18n, unit/database and integration tests | Create in enterprise PR — new CLI default export for the SSO fill, discovery generation, gated SCIM reader, additive scoped readiness setting and R5-4 configuration-tier doctor declaration |
| `packages/core/src/modules/communication_channels/cli.ts`, module-local hash helper, unit/database and integration tests | Create — new CLI default export for the sender fill and discovery generation |
| `packages/core/src/modules/customers/__integration__/TC-CUSTOMERS-LOOKUP-HASH-001.spec.ts`, `packages/core/src/modules/entities/__integration__/TC-ENCRYPTION-REHASH-001.spec.ts` | Create |
| `UPGRADE_NOTES.md`, `apps/docs/docs/user-guide/encryption.mdx`, `starters/docker/encryption-migration.md` | Modify |

## 🧪 Integration Coverage

The integration app runs with tenant encryption on. Every case owns its tenant/organization, users, credentials, provider stubs and records, creates them through APIs where available and cleans them up in `finally`. Storage assertions require a valid envelope and successful decrypt, not merely inequality. Readback uses the real scoped API or owning service. Key UI paths use `apiCall` through the existing page. Direct database checks belong to the owning module's test, never production cross-module table access. Existing update/delete requests include that record's `updatedAt`.

| Module | Path exercised |
|---|---|
| Search-enabled protected rotation, Enterprise V13 | Supply R4-10's frozen-target `pin` with R5-3's `providerIdentity` and `wrappedDekFingerprint` to `searchVectorDisplayMaintenance.run`; verify the identity source and SHA-256 of the provider key check read through `readTenantKeyPin`. Matching members permit the existing verification gates; provider-only or fingerprint-only mismatch returns `pin_mismatch` and cannot complete rotation or permit key retirement; calls without a pin retain existing behavior |
| `webhooks` | Create a webhook with a custom header; trigger a delivery; deliveries list and retry |
| `notifications` | Create a notification; the bell list |
| `attachments` | Upload a text file; the library list |
| `communication_channels` | Ingest an inbound message; the conversation view |
| `staff` | Team member with an address and a comment |
| `workflows` | Start an instance; complete a user task with form data |
| `customers` | An interaction with a location; a lost deal with notes |
| enterprise `sso` | Sign in through the test identity provider twice; SCIM filter by email and by name |
| `checkout`, TC-CHECKOUT-ENCRYPTION-001 | Create own template/link and stub gateway; `POST /api/checkout/pay/[slug]/submit` with a sentinel user agent writes `checkout_transactions.user_agent` as ciphertext; owning service `findOneWithDecryption` reads the sentinel (public payment response need not expose it); clean transaction/link/template and gateway fixtures |
| `integrations`, TC-INTEGRATIONS-ENCRYPTION-001 | Resolve `integrationLogService` and call `write` with sentinel `message` and JSON `payload`; inspect owned `integration_logs` ciphertext; `GET /api/integrations/logs` and its log viewer return parsed plaintext to an authorized scoped user; clean log and integration fixtures |
| `shipping_carriers`, TC-SHIPPING-ENCRYPTION-001 | Own shipment and stub carrier; create through `POST /api/shipping-carriers/shipments`, then refresh tracking through `POST /api/shipping-carriers/tracking/refresh`; inspect `carrier_shipments.label_data` and `tracking_events` ciphertext, and assert the owning decrypted service returns label and parsed events; clean shipment, event and idempotency fixtures |
| enterprise `record_locks`, TC-RECORD-LOCK-ENCRYPTION-001 | Own editable record and actor; `POST /api/record_locks/acquire` with sentinel client IP writes `record_locks.locked_by_ip` as ciphertext; owning `recordLockService` decrypted read returns the IP internally; do not add it to public DTOs; release through `POST /api/record_locks/release`, clean lock/conflict and record fixtures |
| `push_notifications`, TC-PUSH-ENCRYPTION-001 | Own device, channel and stub adapter; `fanOutPushDeliveries` performs the real query-builder insert; stored `push_notification_deliveries.payload` is ciphertext; invoke the real delivery worker with the stub provider and assert its send envelope holds the plaintext title/body; clean delivery, notification/device/channel and queue fixtures |
| enterprise `sso`, TC-SSO-LOOKUP-HASH-001 | In an upgraded scoped configuration seed 101 existing plaintext identities with null hashes under a configured secret, plus a separate configuration with tenant-authored ciphertext. In minor N and N+1 before activation assert existing matching and neither new refusal. In N+1 at the earliest verify preview/apply/rerun and refuse keyed activation with missing, stale or unreadable required hashes. Fill and verify, activate and show results above 100. After activation seed an artificial null-hash residual at 100 and at 101 and verify the 503/fill remedy with no partial results. Explicitly activate a no-secret configuration and test each email/name filter at 100 and 101 ciphertext identities (including previously hashed rows), unlimited plaintext equality, and refusal to fill without a secret. Confirm exact scope, warning and cleanup. |
| enterprise `sso`, R5-4 doctor unit coverage | `sso.scim_lookup_secret_missing` emits a configuration-tier error only when `moduleIds` includes `sso`, `TENANT_DATA_ENCRYPTION` evaluates to enabled (including unset) and no lookup secret is set; `sso`-absent, encryption-off (`TENANT_DATA_ENCRYPTION=false`) and configured-secret controls do not emit it. No database connection or secret material appears in output |
| Commerce coverage-owned hash refreshes, R5-7 | Each of `sales`, `cart`, `checkout` and `warranty_claims` fills is rehearsed by its owner with current and stale non-null old-secret hashes; preview preserves data, apply refreshes stale hashes, clears the hash of a retained row whose email was cleared and counts it as `cleared`, rerun leaves current hashes unchanged, and tenant/organization controls and concurrent edits survive |
| `communication_channels`, TC-SENDER-LOOKUP-HASH-001 | Dedicated tenant/channel; ingest messages with sender identifiers, seed old/legacy/stale/null forms, run the sender fill in preview/apply/rerun modes; owning sender resolver finds the same messages from plaintext input; unreadable source untouched; clean messages, conversations, links, channel and tenant fixtures |
| `customers` (Phase D), TC-CUSTOMERS-LOOKUP-HASH-001 | `POST` and `PUT /api/customers/people`: a person created with an email and the phone `+48 600 100 200`, then updated to `+48600100200` and to a new email. The stored hashes equal the hashes computed in the test process, the phone hash is unchanged by the respacing, and the email hash follows the new email. Also exercise an ORM edit outside commands, repair a deliberately stale non-null hash through the fill command, and compare the digits-only hash to the privacy alias; teardown deletes the person and all fixtures |
| `entities` (Phase D), TC-ENCRYPTION-REHASH-001 | A dedicated tenant and organization created for this case only, never the shared integration tenant; one user created through `POST /api/auth/users`; its `email_hash` set to the legacy unkeyed form by a direct query; the built CLI's `rehash-lookups --tenant <id>` reports one legacy row and writes nothing; with `--apply` the stored hash is current again and a re-run reports no change. Teardown deletes the user and all fixtures, then removes the dedicated tenant/organization in `finally`; assertions target only owned rows |

The guards and all command classifiers are unit-tested; catch-up SQL and every maintenance writer have the database-backed cases above. Module unit suites name `lookup-hashes.test.ts` and `fill-lookup-hashes.test.ts`; `encryption-maintenance.database.test.ts` covers source-and-target compare-and-set, savepoints and unreadable envelopes. The two Phase D tests compute hashes in the test process, so they need the app's lookup secret: the ephemeral environment gives both processes the same one, and against an external `BASE_URL` they skip with that reason. They run the CLI as `TC-AUTH-033` does. System-scope rotation needs two roots, which the integration app cannot change while running, so it is covered by the database-backed test in Phase D step 5.

## 📝 Risks & Impact Review

#### A reader returns ciphertext to a user
- **Scenario**: A plain find or query-builder reader was missed when its column was mapped.
- **Severity**: High
- **Affected area**: any list or detail view of a mapped entity
- **Mitigation**: Readers move in the same step; one integration test per module asserts the API value; the mixed-state tolerance keeps plaintext rows readable.
- **Residual risk**: The identity-map behaviour in #5447, which the decrypting helpers avoid and plain finds do not.

#### SCIM filtering breaks
- **Scenario**: The filter moves to a hash while some identities have none, or SCIM is enabled without a lookup secret in a configuration with more than 100 identities.
- **Severity**: High
- **Affected area**: enterprise provisioning
- **Mitigation**: All owning writers maintain hashes when a secret resolves. Preserve existing matching through the warning minor even when tenant-authored maps predate this program. Activate the bounded reader only under the scoped release and readiness rules above. Verify that every configuration affected by the map rollout can already read its resulting data. After activation, the configured-secret fallback returns 503 above 100 null-hash candidates and is cleared by the fill. The no-secret bounds retain unlimited plaintext matching and return the named 400 above the ciphertext limit. The doctor error fires only with the SSO module enabled and tenant data encryption on without a lookup secret. TC-SSO-LOOKUP-HASH-001 covers the bridge and both activation modes.
- **Residual risk**: Without a secret, on an installation that encrypts these columns, the 100-identity limit on ciphertext persists and the fill refuses; configuring the secret and filling is required. The doctor error also fires for an encrypted `sso` installation that has not issued a SCIM token yet; setting a lookup secret clears it. The configured-secret fallback-removal task stays gated on zero missing hashes everywhere; no unbounded scan is allowed.

#### An older tenant starts encrypting and a reader was never fixed
- **Scenario**: A catch-up migration turns on a field for old tenants, and some reader of it only ever worked because those tenants stored plaintext.
- **Severity**: High
- **Affected area**: any module with a catch-up migration
- **Mitigation**: Newer tenants have had the field encrypted all along, so a broken reader would already be a reported defect; one PR per package, each run against the integration suite.
- **Residual risk**: A reader exercised only by old tenants' data shapes.

#### Existing rows stay in clear
- **Scenario**: An operator upgrades and never runs the row backfill.
- **Severity**: High
- **Affected area**: every newly mapped column
- **Mitigation**: The upgrade note, bounded backfill and independent persisted verification gate. The owner’s optional database-tier doctor checks report scoped residual counts or unverified coverage.
- **Residual risk**: An operator can run a legacy deployment outside the managed gate. A fresh verified result covers its observed release, scope and maps, and a later unsafe writer invalidates that evidence.

#### The row backfill overloads the database
- **Scenario**: Encrypting millions of delivery payloads.
- **Severity**: Medium
- **Affected area**: upgrade operations
- **Mitigation**: Keyset batches bounded by rows and by encoded bytes, with smaller defaults for large-text entities; resumable; run per tenant.
- **Residual risk**: Hours of runtime on large tables.

#### A lookup-secret change empties lookups
- **Scenario**: An operator changes the lookup secret, or rotates the encryption key it fell back to, and logins and other hash lookups stop matching.
- **Severity**: High
- **Affected area**: login, portal accounts, onboarding, every module that finds rows by a hash
- **Mitigation**: `rehash-lookups` per tenant and for `none`, the three R3-12 fills, enabled coverage-owned fills (forms invitation, inbox participant and all four R5-7 commerce hash fills included), and system-scope rotation refresh the lookup hashes. Then B4 forces `query_index reindex` for every tenant/entity and tenantless scope, runs `search reindex-tokens` for the same scopes so the token strategy's own rows are keyed, and requires `query_index purge-legacy-tokens` apply/report to show zero legacy and old-key rows. All writers stay stopped until every report is complete; refusal with no secret prevents a downgrade.
- **Residual risk**: Hashes a third-party module writes itself, which only its own command can refresh.

#### A rehash collides on a unique hash index
- **Scenario**: Two live rows of one tenant hold the same value, one under the legacy form; rewriting both to the current form violates `users_tenant_email_hash_uniq`.
- **Severity**: Medium
- **Affected area**: login and portal lookups for those rows
- **Mitigation**: The row savepoint is rolled back, later valid rows in the batch commit, and the command exits non-zero; the runbook says to resolve collisions before traffic returns.
- **Residual risk**: The duplicate is a data problem the operator resolves by hand.

#### System-scope rotation runs with the wrong old key
- **Scenario**: The old root in `TENANT_DATA_ENCRYPTION_OLD_KEY` is not the one that sealed the records.
- **Severity**: High
- **Affected area**: system-scoped records such as onboarding requests
- **Mitigation**: A value that decrypts under neither key stops its batch before it is written; the dry run reports the classification first; the command never re-encrypts a value it could not decrypt.
- **Residual risk**: Vault-backed installations keep the runbook's assisted path.

#### CRM lookups miss people saved before the fill
- **Scenario**: The fill command has not run for a tenant, and a reader trusts the hash alone.
- **Severity**: Medium
- **Affected area**: privacy export and erasure by email or phone
- **Mitigation**: Readers fall back to the decrypting scan for rows whose hash is null, as the data-class contract spec requires; the upgrade note names the command.
- **Residual risk**: Minutes of scan time on a large tenant until the command has run.

#### The guards give false comfort
- **Scenario**: A personal-data column has a name the pattern does not match, or is free text.
- **Severity**: Medium
- **Affected area**: future modules
- **Mitigation**: The limit is stated; the privacy coverage check classifies whole tables and is the second net.
- **Residual risk**: A free-text column in a table already classified.

#### Maintenance races or hashes an unreadable envelope
- **Scenario**: A user edits after a batch read, or a wrong-key envelope is treated as plaintext.
- **Severity**: High
- **Affected area**: maintenance writes and every derived lookup hash
- **Mitigation**: Conditional source-and-target updates, no version bump, unreadable-source refusal, row savepoints and interleaving database tests.
- **Residual risk**: Incomplete rows require a rerun under the correct key after stopping writers; collisions need operator repair.

#### A maintenance shell has no lookup secret
- **Scenario**: A Vault-only deployment or operator shell has no lookup pepper or fallback encryption secret and would otherwise write reversible dictionary hashes of phone numbers.
- **Severity**: High
- **Affected area**: new CRM, SSO and inbound-sender hashes, plus system hash refresh
- **Mitigation**: Module writers leave their new hashes null; fill and mapped rehash refuse; system refresh preserves existing hashes and reports incomplete work. Test no-secret writes and maintenance explicitly.
- **Residual risk**: Scoped null-hash readers can be slower, and unrelated pre-existing unkeyed hash columns are not removed by this change.

#### A store-owned vector step is omitted or uses another target
- **Scenario**: ORM maintenance succeeds while vector display rows remain plaintext, under the old key or maintained against a different active provider identity/key-check fingerprint.
- **Severity**: High
- **Affected area**: search display storage and key retirement
- **Mitigation**: Explicit delegated summary with `complete: false` from both `rotate-encryption-key` and `backfill-encryption`, named B4 remedy, R4-10's frozen-target `pin` using R5-3's provider identity and provider key-check fingerprint with `pin_mismatch` refusal for Enterprise callers, and an A1 gate on the OSS path (Phase A items 5 and 7, Phase D items 2 and 3, plus B4's reseal and full report) verified with search enabled.
- **Residual risk**: This spec delivers only the Core classification; it does not deliver the search reseal or the enterprise rotation implementation. Pinned runs refuse until B4 Phase 2 delivers `readTenantKeyCheck`; the existing unsupported-coverage preflight remains a gate and the key stays until their verification passes.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/core/AGENTS.md` → Encryption, `BACKWARD_COMPATIBILITY.md` §8 and §13. Not reviewed: each module's guide; each module step reads its own.

| Rule | Status | Notes |
|---|---|---|
| Declare sensitive columns in `encryption.ts` with a backfill migration | Compliant | The subject of the spec, and now enforced by a test |
| Read through the decrypting helpers | Compliant | Per-module step |
| Never hand-roll crypto | Compliant | Existing service; hashes through `hashForLookup`, plus the additive explicit-secret and secret-presence helpers; old DEKs through `DerivedKeyKmsService` |
| Additive-only schema | Compliant | New columns and indexes only; nothing removed |
| Tenant scoping | Compliant | Fill commands take a real tenant; only `rehash-lookups` accepts `none`; conditional writes retain each row's organization and scope |
| Never pass secrets as flags | Compliant | Old secrets come from the environment only |
| Ask before touching multiple modules | Process gate | The program and this spec cover the fourteen modules; each module step ships as its own PR under ordinary maintainer review |
| No enterprise-only scope in the OSS directory | Compliant | Two enterprise modules are rows in a shared plan and ship separately |
| Integration coverage | Specified, not run | Every changed module has a named case, owning fixtures and cleanup; migration SQL and maintenance concurrency have database-backed cases |
| Maintenance concurrency | Compliant by design | Compare source and target values, preserve `updated_at`, savepoint on collisions, never hash unreadable envelopes |
| No unkeyed new CRM hashes | Compliant by design | Missing secret leaves module-written hashes null; fill refuses; system refresh preserves existing hashes |
| SCIM no-secret filtering, R5-4 | Specified | Existing matching during warning minor N, including preexisting ciphertext. N+1 at the earliest activates by configuration. Activated no-secret plaintext equality is unlimited, ciphertext is bounded at 100 and 400 uses `scimFilter.lookupSecretRequired`. Only the activated keyed null-hash fallback can return 503. TC-SSO-LOOKUP-HASH-001 covers both modes. |
| SCIM configuration-tier doctor, R5-4 | Specified | SSO declares error `sso.scim_lookup_secret_missing` through DEC-I/R3-2; it fires from minor N when `moduleIds` includes `sso`, tenant data encryption is enabled and no lookup secret is set, using only the existing `env`/`moduleIds` context and no database read; not raised with encryption off |
| Commerce hash rotation, R5-7 | Coordinated; owner implementation required | B1 lists all four commerce fills, refreshes stale non-null hashes after a secret change, and requires owner tests, preview/rerun and scoped conditional writes |
| Vector rotation completion | Core classifier owned here; reseal is a cross-owner dependency | Phase A item 7 makes Core `rotate-encryption-key` delegate `vector:vector_search` with `complete: false`, and that OSS path, with Phase A item 5's `backfill-encryption`, Phase D items 2 and 3 and B4's old-key reseal and full report, is A1's search-enabled exit. B4 owns R4-10's optional `pin` with R5-3's `providerIdentity`/`wrappedDekFingerprint` and `pin_mismatch`; Enterprise binds the facade to its frozen target and adds independent both-store verification, which is not an A1 gate; pinned runs refuse until B4 Phase 2 delivers the provider key-check read, and no search runtime implementation is claimed |

**Verdict:** design ready for Phase A. Under program DEC-2, work proposed for OSS requires written upstream maintainer approval naming the carrier before implementation. An independent security fix may proceed on its own named, explicitly approved carrier. The design verdict and ordinary PR review do not grant that approval. Phases B and C follow module by module; Phase D item by item. Every assumption is decided: the columns under assumptions 2, 5 and 6 stay in clear with recorded reasons, and assumption 10 preserves legacy SCIM matching through the warning minor and activates the bounded reader only through scoped readiness in N+1 at the earliest. Removal of the activated keyed fallback has a zero-missing-hash gate. R5-4 fixes the no-secret response and persistent limit on ciphertext identities, bridged by one warning minor, and its doctor check fires on the `sso` module with tenant data encryption enabled and no lookup secret. Pinned vector rotation waits only on B4 Phase 2 delivering `readTenantKeyCheck`, and A1 stays gated on the verified OSS search-enabled rotation of Phase A items 5 and 7, Phase D items 2 and 3, plus B4's reseal.

## Changelog

### 2026-11-19

- Separate effective-map readiness from persisted plaintext verification. Require scoped aggregate evidence after backfill and before protection is claimed.

### 2026-11-18 — Review corrections

- Separate the tenant-wide OSS vector report from protected exact-scope rotation evidence.

### 2026-11-18 — Spec review

- Preserve the SCIM route through the warning minor and gate activation per scoped configuration. Land the shared secret helpers before either Phase C consumer and record how missing required encryption maps block coverage evidence.

### 2026-11-16
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): apply R5-4's bounded no-secret SCIM scan, 400 response/key, named configuration-tier doctor error and configure-secret-first remediation with tests/risks/compliance, recording the unresolved activation input; correct the communication wrapper hand-off; add R5-7's commerce hash refreshes to Phase D; cite R5-3's corrected rotation pin and record the missing derived-provider source.
- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): cite R4-10's additive frozen-target `pin` and `pin_mismatch` in B4's facade hand-off, with matching/mismatched provider and DEK-version coverage, risk and completion gates.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): cited B4's now-specified `SearchVectorDisplayMaintenance` adapter, exact export and methods alongside its `run` facade; retained implementation/capability preflight, independent both-store verification and search-enabled A1 release gates.
- Council round two fixes, pass three (GPT-6.1 Sol workers): adopted B4's exact `searchVectorDisplayMaintenance.run` / `VectorDisplayMaintenanceReport` hand-off and full target-key report gate, retaining the Enterprise baseline/read dependency and ORM/system/vector/token key-retirement gates; removed the undeclared second sender-fill command; confirmed C1 phone normalization, coverage-owned forms/inbox refreshes and query_index-owned forced rebuild/report/apply/zero-residual order.
- Written autonomously with resolved assumptions.
- Revised after independent review. The rotation command is left alone and a separate backfill command added, because rotation must refuse on any unresolvable map. Maps that never had a backfill get catch-up migrations instead of an exception list. The three guards are defined: parsed helper calls, a stated column-name pattern with a capped backlog, and a per-table list of raw writes. The SSO subject, the SCIM external id, CRM participants and the three SQL-searched names stay in clear with recorded reasons; no unique index is moved; the case-preserving hash and the map-rule option are dropped. Hash columns are written by the owning module, not by the encrypt step.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g1-04 — added "Phase D — Lookup hashes and system-scope rotation" for the three items the program hands to B1: `customers` `primary_email_hash` and `primary_phone_hash`, written by the module whatever the encryption state and filled by `mercato customers fill-lookup-hashes`; `mercato entities rehash-lookups --tenant <id> [--apply]`, scoped and resumable, which recognises the current, old and legacy forms and covers every mapped `hashField`; and rotation of system-scoped records in `mercato entities backfill-system-encryption` when the old root is set. Problem statement, a Delta requirement, design decisions, alternatives, data models, API contracts, edge cases, compatibility rows, phasing, implementation steps, file manifest, two integration tests, four risks and compliance rows updated. The search module's catch-up migration is the one the search-index spec adds with `presenter`.
- Fix verification follow-up: Phase A writes the `search` module's catch-up migration itself, with the nine current `vector:vector_search` fields. It no longer relies on the search-index spec's later `presenter` migration, so Phase A's guard can pass when the program ships B1 before B4.
- Council round two fixes (GPT-6.1 Sol workers): r1kk-01 store-owned vector path; r1kk-02 and R3-12 named fill commands; r1kk-07 keyed-only CRM hashes; r1kk-08 phone digits; r1kk-10 conditional writes; r1kk-11 row savepoints; r1kk-13 unreadable sources; r1kk-14 module coverage; r1kk-16 entity writer coverage; r1kk-17 real catch-up SQL; r1kk-20 no-secret system refresh; r1kk-27 preview convention; r1kk-28 capped raw-write backlog; r1kk-29 isolated rehash tenant; g1-13 webhook error in Phase B; g1-22 bounded SCIM fallback; g1-28 nullable-tenant rule; g1-29 tenant map scopes; F-44 guard and characterization manifest; F-56 map-count wording.
- Council round two fixes, pass two (GPT-6.1 Sol workers): kept R3-12's customers command and columns explicitly new and gated A2 on their delivery; shared C1's first-landing `normalizePhoneDigits`; coordinated coverage-owned forms, inbox, messages, channels and call hashes without renaming the R3-12 commands; corrected token maintenance to query_index-owned forced rebuilds and zero-residual purge/reports across tenant and tenantless scopes with writers stopped; aligned rotation ownership and the still-missing B4 reseal service; removed the promised-but-undeclared doctor plaintext check and stated the pruner's history bridge.

### 2026-11-17
- Phase A item 7 lands the store-owned `vector:vector_search` classification in the Core `rotate-encryption-key` (delegated, `complete: false`, store command named) and `decrypt-database` (refuses with a store-owned reason) before the search catch-up migration; that OSS path plus B4's reseal is A1's search-enabled exit.
- R5-4's no-secret SCIM limit applies only to ciphertext identities: plaintext values keep unlimited SQL equality, and the 400 is reachable only after one warning minor in which `idp_email`/`idp_name` stay unmapped (ordinary protocol, DEC-5).
- Hash-column indexes are built concurrently as partial indexes in non-transactional migrations; the row backfill is bounded by bytes as well as rows, with smaller defaults for large-text entities.
- Tenantless SSO and attachment rows now name their bound; the baseline counts three backfill-helper modules; the legacy `mercato auth rotate-encryption-key` is named as unsupported.
- Correction to the pass-six entry above: B4's **Rotation pin source** covers both built-in providers, so no derived-provider pin source is missing.
- The secret-change runbook adds `mercato search reindex-tokens --tenant <id|none>` after the forced query-index rebuilds, so the search token strategy's own rows are rewritten keyed before the purge report.
- The `sso.scim_lookup_secret_missing` doctor error and runtime warning are raised only with tenant data encryption enabled; `displayName` filters follow the same no-secret rule as `userName`/email, and the only 503 is the configured-secret null-hash fallback, which the fill clears.
- A1's release gate is stated here as the key guard states it: Phase A items 5 and 7, Phase D items 2 and 3, and B4's reseal, verified with search enabled; the Enterprise baseline/read hand-off is not an A1 gate.

### Spec review corrections — 2026-11-19

- Keep default key rotation non-zero while delegated stores remain unverified; define target-bound owner verification and safe rerun/exit-code acceptance (F08).
