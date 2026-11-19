# Search-index protection for encrypted fields

> **Program:** package B4 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). Related: #8134, #7872, #5712, #8135; PR #8410 (merged as `68902bd1cc`, part of this spec's baseline).
> **Verified at** `main` @ `08dada9624` by reading code, with the PR #8410 seam and test references checked against the branch head that includes `68902bd1cc`; nothing was run. No application, database or provider was run for this design revision.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-07-24-search-architecture-clarification-and-evolution.md

## 📝 TLDR

A person's name, email and phone are encrypted in the CRM tables and then copied into search stores in forms that undo the encryption. The token index hashes every word, and every prefix of it from three characters up, with plain SHA-256 and no key; anyone holding the database can recover the words by trying a few tens of thousands of guesses. The vector index keeps each record's display name and subtitle in clear on the path the product actually uses. **Proposed (future):** token hashes are keyed with a secret derived per tenant from the installation's lookup secret, and the vector index encrypts what it shows and stops embedding encrypted fields.

**Not in this spec:** Meilisearch, which is split into [`2026-11-16-fulltext-encrypted-field-exclusion.md`](2026-11-16-fulltext-encrypted-field-exclusion.md) because it shares no reindex with these two; the ciphertext-derived `search_text` column, tracked by #5712; encrypted custom fields in build contexts, which PR #8410 already keeps out of plaintext fulltext/vector fields through `IndexableRecord.plaintextExcludedCustomFields` and `plaintextSearchFields` (`packages/search/src/lib/plaintext-fields.ts`); what the embedding provider retains.

## 📝 Overview

> **Market reference.** Rails' Active Record Encryption supports search on an encrypted column only through *deterministic* encryption with a key — an exact-match lookup, never a prefix index. CipherStash and similar "searchable encryption" products get prefix and fuzzy search by storing keyed, truncated term hashes. Adopted: keyed term hashes, which keep today's prefix search and make the index useless without the key. Rejected: dropping prefix tokens for encrypted fields, which would end list search by partial name; and unkeyed hashing, which is what ships today.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Key scope for token hashes | A key per tenant, derived from the installation's lookup secret and the tenant id. Rows with no tenant use the tenantless key derived from the installation token key (the "installation-key form"; see the keyed-token construction) | Decided. One installation-wide key would let any account in any tenant write chosen words and, with read access to the database, build a dictionary that works against every tenant. A derived key needs no storage or rotation of its own. It is settled before Phase 1 because changing it later costs a second full reindex. |
| 2 | Search during the switch | Reads always ask for both the keyed and the legacy hash, for one minor | No state to track. Matching a legacy row is harmless; its existence is the leak, and that is handled by the purge. |
| 3 | When legacy rows go | A forced query-index reindex replaces them field by field; a report-first purge deletes obsolete legacy/old-key rows only when their authoritative source record is absent | Missing index documents never prove deletion. Unknown source state keeps the rows. |
| 4 | Existing vector rows | Encrypted in place by a batch job, without re-embedding | Re-embedding costs provider calls and sends the text out again. |
| 5 | Installations with no lookup secret and no encryption key | Hashes stay unkeyed; reported; the purge refuses to run | There is nothing to key with, and on such an installation the unkeyed form is the live one. The key-guard spec covers that configuration. |
| 6 | Lookups that name no tenant | Hashed under the key of every tenant that holds rows of the entity type, plus the tenantless key (the installation-key form) | A superadmin with no tenant selected searches users of every tenant today. Requiring a tenant would end that; one key per candidate costs a larger array on those lookups only; the bind-parameter count stays bounded. |
| 7 | The existing `hashToken` and `tokenizeText` | Keep today's unkeyed output for one minor, deprecated; keyed hashing is reached only through new functions | A stable export that silently changed its result would break callers that still compile. |

## 📝 Problem Statement

| Store | What it holds | Who can read it outside the app |
|---|---|---|
| Token index (`search_tokens`) | Unkeyed token digests, field names, record ids and scope. `packages/shared/src/lib/search/tokenize.ts` expands lower-cased words into prefixes; `config.ts` selects sha256, sha1 or md5 and defaults to sha256. `packages/core/src/modules/query_index/lib/search-tokens.ts` writes from decrypted documents | Anyone with the database |
| Vector index (`vector_search`) | Embeddings, display columns, `presenter`, `links` and `payload`; see `packages/search/src/vector/drivers/pgvector/index.ts` | Anyone with the database |

- **Unkeyed tokens permit offline guessing.** The normalizer emits ASCII letters and digits. There are 36³ possible three-character tokens; hashing those candidates can recover short prefixes without a secret. Identical input and configuration produce the same digest in every tenant.
- **Matching counts hashes today.** `packages/shared/src/lib/search/tokenLookup.ts` and the token subqueries in both query engines require all distinct query hashes. `packages/search/src/strategies/token.strategy.ts` instead preserves its configured minimum match ratio, default 0.5, and scores hits. These semantics stay distinct.
- **One record can have mixed forms.** `replaceSearchTokensForRecord` preserves ciphertext-shaped fields, compares unchanged rows and replaces only the document's `(entity_id, field)` pairs. The token strategy also calls that writer with its own document. A migration cannot assume one form per record.
- **Scope is meaningful.** `findEntityIdsBySearchTokens` omits a tenant predicate for `undefined` and matches tenantless rows for `null`. The token strategy widens only declared platform catalogue types. Both query engines supply their query scope. `packages/core/src/modules/customer_accounts/api/admin/users.ts` also builds a bespoke token query; it must move to the shared helper.
- **The old hash functions are public.** `hashToken` and `tokenizeText` are exported; first-party writers, lookup paths, storefront search and integration fixtures call them. Their signatures and unkeyed output need a deprecation bridge.
- **The lookup secret has fallbacks.** `packages/shared/src/lib/encryption/aes.ts`, `resolveLookupPepper`, chooses `LOOKUP_HASH_PEPPER`, then `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`, then `TENANT_DATA_ENCRYPTION_KEY`. Setting the pepper or rotating a fallback changes keyed tokens too.
- **The active vector strategy writes clear display values.** `VectorSearchStrategy.index` passes them to the driver without column encryption. `search()` returns driver presenters and `listEntries()` returns the driver's listing; `packages/search/src/modules/search/api/index/route.ts` sends that listing to the admin client. All three paths need the tenant encryption service.
- **The vector map lacks `presenter`.** `packages/search/src/modules/search/encryption.ts` declares nine display fields. Tenant defaults are not merged automatically: `TenantDataEncryptionService.applySystemDefault` merges only system-scoped maps.
- **Generic embedding text includes display data.** `VectorSearchStrategy.buildTextContent` appends the presenter and the string fields returned by `plaintextSearchFields(record)` (`vector.strategy.ts:196`). Since PR #8410 that seam drops encrypted custom fields, but the indexer supplies no mapped base-field exclusions. Custom text builders need a separate inventory against their maps.
- **The rebuilds differ.** `mercato query_index reindex` accepts `--force`; `mercato search reindex-help` says its command also schedules vector jobs and does not populate Meilisearch. This spec uses the query-index command explicitly for token repair.

## 📝 Proposed Solution

### 1. Keyed token hashes

Two new functions, `hashSearchToken` and `tokenizeSearchText`, compute an HMAC over the token. The key is derived from the installation's lookup secret, a fixed context string and the tenant id. Use C1's new `deriveLookupPurposeKey(purpose: string): Buffer | null` from `aes.ts`, owned by [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md), “A subject that is only an identifier”. If B4 lands first, it adds that identical export for C1 to reuse. Search owns the purpose label `search-token-v1` and the construction below; never substitute C1's `privacy-subject-id` purpose. The lookup secret remains private, and fingerprints are computed from the derived token key within search code.

**Keyed-token construction (fixed before Phase 1).** All strings are UTF-8, `‖` is concatenation, `0x00` is one NUL byte, and every HMAC is HMAC-SHA-256 with full 32-byte output.

| Value | Construction |
|---|---|
| Purpose key (C1 seam) | `deriveLookupPurposeKey(purpose) = HMAC(key, msg = "om:lookup-purpose:v1" ‖ 0x00 ‖ purpose)`, where `key` is the UTF-8 bytes of the value `resolveLookupPepper` returns, as `hashForLookup` keys its HMAC today; `null` when `resolveLookupPepper` finds no secret |
| Installation token key `K_inst` | `deriveLookupPurposeKey("search-token-v1")` |
| Tenant token key | `HMAC(K_inst, "tenant" ‖ 0x00 ‖ tenantId)`, where `tenantId` is the stored UUID in lower-case hyphenated form |
| Tenantless token key (`tenantId: null`, the "installation-key form") | `HMAC(K_inst, "tenantless")`; the different label means no tenant id can produce it |
| Token digest | lower-case hex of `HMAC(scope key, "token" ‖ 0x00 ‖ token)`, where `token` is the normalized token exactly as `tokenizeSearchText` emits it, prefixes included |
| Fingerprint | first 8 lower-case hex characters of `HMAC(K_inst, "fingerprint")` |
| Stored form | `k1.` ‖ fingerprint ‖ `.` ‖ token digest |

`tokenize.test.ts` pins this with known-answer vectors for a fixed secret, two tenant ids, `null`, a full token and one of its prefixes, and the fingerprint; any change to a label or byte layout fails them and requires a new version prefix plus a full reindex. `hashToken` and `tokenizeText` keep returning today's unkeyed digest for one minor, deprecated (see API Contracts).

- **Stored form.** `k1.<fingerprint>.<hash>`, with `k1` fixed as HMAC-SHA-256. `OM_SEARCH_HASH_ALGO` affects only the deprecated unkeyed functions and legacy candidates; it never changes `k1`. The fingerprint is the eight hex characters defined in the construction table, the same for every tenant. It is a diagnostic, never an authorization check.
- **Lookups.** Assign each distinct expanded query token an ordinal. Join `(hash, ordinal)` candidates containing its keyed and legacy forms, then count distinct matched ordinals across the fields that the existing predicate allows. A query-engine single-field predicate stays single-field; the shared helper/strategy may combine their existing allowed field set. Never widen a field filter during this change. Two forms of one token count once. List lookups and both engines require all ordinals; the token strategy keeps its existing minimum ratio and scores `matchedOrdinals / queryOrdinals`, at most 1. A legacy first-name field and a keyed last-name field therefore satisfy a two-word query together.
- **Reindex.** Run `mercato query_index reindex --tenant <id> --entity <module:entity> --force` for each enabled entity in each tenant, and explicitly rebuild tenantless catalogue scopes with `mercato query_index reindex --entity <catalogue:entity> --force` and no tenant flag; declared catalogue types are tenantless by definition. For tenantless rows of a tenant-capable entity, run `mercato query_index reindex --entity <module:entity> --force` without a tenant filter; it may also revisit that entity’s tenant scopes. The maintenance scope stored on each resulting record must be exact, including explicit null tenant. Force visits unchanged records and every field owned by the query-index writer. The keyed digest defeats a legacy-row equality skip. `search_tokens` has a second writer, `TokenSearchStrategy.index` (`packages/search/src/strategies/token.strategy.ts:243-259`), which writes the search builder's `fields` under its own spellings (`query_index/lib/stale.ts:104-110`); the query-index rebuild never runs it. After the query-index rebuild, run the search-owned `mercato search reindex-tokens --tenant <id|none> [--entity <module:entity>]` for the same scopes (arguments, `none` semantics, resume and exit codes under API Contracts → Token rebuild CLI). It loads each record fresh through the search indexer, exactly as fulltext reindexing does, and indexes it with the token strategy only, so every field that strategy owns is rewritten in keyed form; `none` covers the declared tenantless catalogue types, the only rows that strategy writes with no tenant. Ciphertext-preserved or absent fields remain visible in the report until the owning writer supplies plaintext and replaces them. Finish both writer passes with the authoritative token reconciliation below. Per-field writes can leave fields that neither writer emits today.
- **Purge and report.** The command is `mercato query_index purge-legacy-tokens`, owned by `query_index`. It reports by default and writes only with `--apply`. Per tenant and entity it counts legacy rows, each stored keyed fingerprint and obsolete rows whose authoritative source is absent, present or unknown. Missing `entity_indexes` documents are never proof of absence. Apply deletes obsolete rows (legacy or a non-current keyed fingerprint) only for absent sources, keeps every present or unknown source, and refuses without a configured key. This also removes old-key orphans that no source rebuild can reach. The report inventories every residual scope, including disabled, removed and unsupported source groups. No enabled-entity filter hides them. Active sources and unknown scopes are never eligible for the absent-source purge.
- **Fingerprint diagnostics.** No process writes an authoritative first-use baseline and no module-config row is needed. At startup the query-index diagnostic logs the configured fingerprint; a read-only grouped probe logs an error for other keyed fingerprints when the database is available. If that probe cannot run, it reports unavailable instead of declaring a match. The report command lists every fingerprint with its row count against the configured one. A wrong worker cannot invert a baseline by starting first.
- **Secret change.** There is no old-key token read. Before serving traffic under a new effective lookup secret, stop all token writers, change the secret, run B1 Phase D's `rehash-lookups` and module fill commands (DEC-F and R3-12), rebuild tokens with the exact command above for every scope, then complete authoritative reconciliation and report zero old-key, legacy and blocked rows before traffic resumes. A changed encryption fallback key has the same requirement. This is a required handoff to B1's runbook, not a second definition of its commands.
- **Code on the old functions.** Rows written through `tokenizeText` are legacy-form and remain searchable through shared lookups for the bridge minor. Its own SQL finds only legacy rows; `findEntityIdsBySearchTokens` is the named replacement. No legacy-reading bridge can match rows keyed under a different secret.

#### Lookups across tenants

A lookup computes one keyed form per tenant whose rows it may match, plus the legacy form.

| Lookup scope | Hash list | Callers |
|---|---|---|
| One tenant | That tenant's keyed form and the legacy form | Most list routes; both query engines when the query names a tenant |
| No tenant (`null`) | The installation-key form and the legacy form | Both query engines when the query names none |
| A tenant and the tenantless catalogue rows | The tenant's keyed form, the installation-key form and the legacy form, in one list | The token strategy |
| Unscoped (`undefined`) | One keyed form for each tenant that holds rows of the entity type, the installation-key form when tenantless rows exist, and the legacy form | `findEntityIdsBySearchTokens` with no tenant, as for a superadmin with no tenant selected |

- The existing tenant predicates are unchanged. The candidate tenants decide which hashes are computed, never which rows the caller may see.
- Every candidate carries its query ordinal and tenant scope. Join with null-safe tenant equality for keyed candidates; legacy candidates retain the existing row-scope predicates. Count ordinals across forms, never candidate hashes. Group by record identity and scope so candidates cannot combine evidence across tenants or organizations.
- For an unscoped lookup the candidates are read first. PostgreSQL 16/17 (the integration image is `pgvector/pgvector:pg16`) has no skip scan, so a plain `SELECT DISTINCT tenant_id` would walk every token row of the entity type. The candidate read is therefore a loose index scan on `search_tokens_presence_idx` (`entity_type`, `tenant_id`, `organization_id`): a recursive CTE that seeks the smallest non-null `tenant_id` for the entity type, then repeatedly the smallest `tenant_id` greater than the previous one, plus one `tenant_id is null` existence probe. Each step is one index seek, so the read costs one seek per candidate tenant regardless of row count. The candidate data grows with tenants × tokens. Supply parallel `text[]` hashes, `int[]` ordinals and tenant-scope arrays to `unnest`, each as one bound array, never one SQL parameter per element. Batch candidate tenants in groups of 100 and merge scoped record identities. Each complete tenant batch carries every query token, so all-token matching stays correct. Cap query expansion at 5,000 distinct tokens, including prefixes, and reject overflow with a localized query-too-large error; do not silently weaken the query. Existing stricter configured limits still apply. The SQL bind count is independent of candidate count; a regression uses over 65,535 candidate hashes.
- The customer-accounts admin users route moves from its own token query to `findEntityIdsBySearchTokens`, so the shared helper, the two engines and the token strategy are the only places that build a hash list.

### 2. Vector index

- The map gains the `presenter` column. Existing tenants receive it through a migration in the search module that calls `buildEncryptionMapBackfillSql` for `vector:vector_search` with the map's full field list written as literals. The tenant encryption service merges declared defaults only for system-scoped maps (`packages/shared/src/lib/encryption/tenantDataEncryptionService.ts`), and this map is tenant-scoped, so without the migration a tenant's stored map keeps lacking the column and `encryptEntityPayload` leaves it in clear.
- The strategy encrypts the display columns before handing the row to the driver and decrypts them in both `search()` and `listEntries()` before building their return values. Its real `encryptEntityPayload` call follows A3's `resolveUnavailableWrite` in [`2026-11-16-kms-fail-closed.md`](2026-11-16-kms-fail-closed.md), Architecture: resolve toggle and map, then a matching command-local pin, then the unexpired shared key in the same backend/tenant namespace, before backend health and get/provision. Only after those key paths fail does the live strategy's encryption call invoke `resolveUnavailableWrite` with the reason and whether a non-null mapped value changed. In production `fail`, a changed non-null mapped value without a key rejects before driver upsert; `plaintext` permits the write with A3's counter/reporting, and encryption explicitly off stays unchanged. Do not gate a pin/cache hit on health-dependent `service.isEnabled()`, add an earlier health gate, or swallow the typed `KMS_UNAVAILABLE` failure. Apply this to the actual `VectorSearchStrategy.index` path, not an unused `VectorIndexService` alternative. The dependency runs one way: A3 Phases 1–3 ship the decision function, the backend-scoped cache and the `fail` setting with the command pin; B4 Phase 2 consumes them; A3 claims active-vector `fail` coverage only after B4 Phase 2 lands.
- **Admin listing scope.** `GET /api/search/index` today rejects only an empty organization allowlist and then passes `organizationId = scope.selectedId || undefined` (`packages/search/src/modules/search/api/index/route.ts:79-91`), so a user restricted to some organizations with "All organizations" selected lists every organization's entries; the query route already passes the allowlist (`api/search/route.ts:114-116,152`). Because this spec makes `listEntries()` decrypt, Phase 2 fixes that first: `VectorDriverListParams` and `listEntries` options gain `organizationIds?: string[] | null` with the same semantics as `VectorDriverQuery.filter.organizationIds` (`null`/absent = no organization restriction, empty array = return nothing, otherwise only those organizations; an explicit `organizationId` still wins), the pgvector `list` applies it, and the route passes `organizationIds: scope.filterIds` alongside `selectedId`. The driver filter is not the only guard: a third-party driver written before the optional member ignores it. `VectorSearchStrategy.listEntries` therefore drops every returned entry whose `organizationId` is outside a non-null allowlist (or differs from an explicit `organizationId`) before it decrypts anything, so such a driver can return a shorter page but never another organization's presenter; the response carries no total, so its shape is unchanged. Only then does the route receive decrypted presenters, and only for the caller's organizations. `presenter`, `links` and `payload` are `jsonb`, so their decrypted strings are parsed with `parseDecryptedFieldValue`. The driver stays container-free. Map storage column names to the existing camelCase display properties explicitly; use the additive opaque JSON transport in API Contracts so ciphertext is never cast into a presenter-object type.
- Base-field exclusion extends the PR #8410 seam rather than adding a parallel mechanism. `IndexableRecord` gains optional `embeddingExcludedFields?: readonly string[]`, which the indexer fills with the entity's mapped base-field names next to `plaintextExcludedCustomFields` (`search-indexer.ts:456`, `:1379`). The vector strategy's generic text builder applies `plaintextSearchFields(record)` and then drops `embeddingExcludedFields`, and also leaves the presenter out when any field is mapped. The fulltext strategy keeps consuming only `plaintextSearchFields`; its base-field exclusion stays with the driver-level setting owned by the fulltext spec, so this change does not pre-empt that spec's opt-in and flip.
- `mercato search encrypt-vector-display --tenant <id>` reports display storage per tenant and mapped column by default; `--apply` encrypts plaintext and reseals old-key envelopes in keyset batches of at most 100 with one commit per batch. Search owns DI service `searchVectorDisplayMaintenance: SearchVectorDisplayMaintenance` with the typed adapter under API Contracts, shared by this CLI, B1 Phase A's store-owned delegation and the enterprise rotation coordinator in [`enterprise/2026-11-12-key-rotation-data-verification.md`](../enterprise/2026-11-12-key-rotation-data-verification.md), Architecture and Phase 2; callers never query the vector table themselves or spawn a CLI subprocess. The current target key comes from the tenant encryption service. Under R4-10 as revised by R5-3, `run` accepts optional `pin: { providerIdentity: string; wrappedDekFingerprint: string }`; when supplied, it refuses with `pin_mismatch` if the active provider or wrapped-DEK fingerprint differs, before any maintenance write. Enterprise rotation supplies its frozen target through this pin. `TENANT_DATA_ENCRYPTION_OLD_KEY` is accepted only from the maintenance process environment, never CLI arguments, reports or runtime search reads. Use the existing maintenance key resolution and AES/encryption helpers, without a new cipher or a raw installation key used as a tenant key. Verify all current-key envelopes, open old-key envelopes with the old key and reseal under the target key, preserving each logical text/JSON value; never skip a row solely because it looks encrypted. No embedding call is made.
- The adapter's bounded baseline reads include every selected logical column, embeddings and user-visible versions, before either store mutates. Its fresh target-only persisted reads are separate from resealing and never reuse the write result or a source-key fallback. The operation is resumable with `--after <id>` and idempotent. Updates compare the id, exact tenant/organization and all read display values, as in B1's “Maintenance write safety”; they do not bump `updated_at` or write value-bearing history. An unreadable/malformed envelope aborts its batch before any write, returns the previous committed cursor and exits non-zero with `complete: false`; concurrent changes and unavailable encryption/missing map rules are likewise incomplete, never plaintext success under the maintenance command. Already committed batches remain resumable. Final verification starts from the beginning after every writer upgrades, counts zero plaintext, old-key, unreadable and blocked values, and decrypts all non-null mapped values with the target key. A successful resumed suffix is not full-store verification. Keep the old key until the ORM/system passes and every search-owned scope verify. The enterprise owner must include vector display rows in its baseline, logical-equivalence coverage and independent pinned-target verification; this service's successful return is not that verifier's proof.
- Each first-party module's own text builder is checked against its encryption map. Any that embeds a mapped field is fixed, and that entity type is reindexed for vector search by a named command in the upgrade note: nothing on this path compares a stored checksum, so a fix alone re-embeds nothing.

### Design decisions

| Decision | Rationale |
|---|---|
| Derive the token key from the lookup secret with its own context string | One secret to manage; the context keeps token hashes and lookup hashes from being interchangeable. |
| A key fingerprint in the stored form | A changed key is otherwise indistinguishable from a normal row, and search would return nothing with no explanation. |
| State is read from the rows, not from a flag | Reindex runs per entity, tenant and partition; a single "done" flag would be wrong for most of them. |
| Dual-read is unconditional for one minor, then removed | It combines candidates through ordinal matching; record fields may be in different forms. |
| Keyed hashing under new function names; the old ones unchanged | A deprecation bridge keeps the old result; only a new name may return a new one. |
| One keyed form per candidate tenant | The per-tenant key gives a word a different hash in each tenant, so a lookup spanning tenants must ask in each tenant's form. |
| Encrypt vector rows in the strategy | The driver has no container and no tenant service. |
| A backfill migration for the `presenter` map entry | Declared defaults reach a tenant's stored map only through a migration; the merge at resolution covers system-scoped maps alone. |
| A provider key check as the rotation pin's source | Neither built-in provider stores a wrapped DEK. A check keyed by the DEK changes with every rotation and confirms nothing without the key. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| One installation-wide token key | See assumption 1. |
| Make `hashToken` and `tokenizeText` hash under the installation key | Neither today's digest nor the per-tenant form: an unchanged caller would write rows no tenant lookup computes. |
| Require a tenant for every token lookup | Ends superadmin search across tenants. |
| A per-tenant key stored in the key service | Key storage and rotation for a value that can be derived. |
| Stop tokenizing encrypted fields | Ends list search for people by partial name, email or phone. |
| Drop prefix tokens | Same loss, slightly smaller. |
| Delete legacy rows when a reindex "completes" | Completion is not defined across entities and tenants; deleting early blanks search. |
| Re-embed everything | See assumption 4. |
| Encrypt `search_text` | It holds ciphertext for mapped fields already; #5712 proposes dropping it. |
| Hash stored wrapped-DEK bytes for the rotation pin | Neither built-in provider stores any. Vault's record is the DEK itself, so its hash would be an unkeyed DEK hash, and the derived provider stores nothing. |
| A Vault KV version or a timestamp for the rotation pin | The derived provider has neither, and neither proves which key is active. |

### Known limits

- A keyed hash protects against a disclosed database, not against someone who also holds the installation's secrets.
- Someone with an account in a tenant and continuing read access to the database can write chosen words and read back their hashes, and so build a dictionary for that tenant. The per-tenant key stops this crossing tenants; nothing here stops it inside one.
- Token rows still reveal which records share a word, how many words a field has, and — through the chain of prefixes — how long each word is.
- The user's search text is sent to the embedding provider when vector search is used. That is a third-party data flow and belongs on the sub-processor page.
- With `OM_SEARCH_STORE_RAW_TOKENS` on, the plaintext token is stored beside its hash. It stays an explicit diagnostic setting; the search module owns the environment-only `search.raw_tokens_stored` check through DEC-I/R3-2, after C1 Phase 1 and doctor Phase 3. The report commands remain the detailed token/vector evidence. Under R3-4, query_index owns the two opt-in token-count checks in Architecture → Doctor database counts; no vector database check is declared here. No configuration finding proves a completed rebuild. G6's search-owned current-key calibration remains separate from these report commands.

## 📝 Delta

### Capability: search-index-protection

#### MODIFIED Requirement: Token hashing
The system SHALL store search tokens as a keyed hash when an installation secret is configured, and SHALL keep search over encrypted fields working while existing rows are being replaced.

##### Scenario: New row
- WHEN a person is saved on an installation with a secret
- THEN no stored token hash equals the unkeyed SHA-256 of any word in their name

##### Scenario: During the switch
- WHEN a list is searched for a person indexed before the upgrade and not yet reindexed
- THEN the person is found

##### Scenario: Two words
- WHEN one searched word appears only in a legacy field and another only in a keyed field of the same scoped record
- THEN the list lookup finds the record, and duplicate forms of a word do not inflate matching or score

##### Scenario: After reindex and purge
- WHEN the entity has been reindexed and the purge has run
- THEN no legacy-form row remains and the same search still finds the person

##### Scenario: Purge before reindex
- WHEN the purge runs while a live record has legacy rows and no index document
- THEN report-only changes nothing, apply keeps those rows using source liveness, and search still finds the record

##### Scenario: Purge interrupted
- WHEN an apply run stops after a committed keyset batch
- THEN its cursor resumes at the next row and rerunning from the beginning is safe

##### Scenario: Secret changed
- WHEN the effective lookup secret changes
- THEN the report identifies old fingerprints and traffic stays closed until forced token reindexing and the zero-residual report complete

##### Scenario: Another tenant
- WHEN the same word is indexed in two tenants
- THEN the stored hashes differ

##### Scenario: Code on the deprecated functions
- WHEN code that still calls `tokenizeText` writes token rows for a record of a tenant, and the record is searched through `findEntityIdsBySearchTokens` in that tenant
- THEN the record is found, and the written hashes equal today's unkeyed digest

##### Scenario: No tenant selected
- WHEN a superadmin with no tenant selected searches the users list for an email word shared by users of two tenants
- THEN both users are found

##### Scenario: Platform catalogue
- WHEN global search runs in a tenant and a platform-wide catalogue record indexed with no tenant matches
- THEN the record is found

Frozen by: `packages/shared/src/lib/search/__tests__/tokenize.test.ts`

#### MODIFIED Requirement: Vector index contents
The system SHALL encrypt the display fields of a vector index row at rest and SHALL NOT include an encrypted field in the text sent for embedding.

##### Scenario: Stored row
- WHEN a person is indexed for vector search
- THEN the stored title, subtitle and presenter are ciphertext, and search results still show the name

##### Scenario: Admin vector listing
- WHEN an authorized administrator opens the vector index listing after encryption
- THEN `listEntries()` decrypts the presenter and the page shows the name
- WHEN a user restricted to organization A of a tenant with organizations A and B has "All organizations" selected
- THEN the listing returns only A's entries, and none of B's presenters is decrypted or returned, even when the vector driver ignores the organization allowlist

##### Scenario: Rollout convergence
- WHEN every vector writer is upgraded and the in-place apply job and subsequent report finish
- THEN a full report counts zero plaintext, old-key, unreadable and blocked mapped display values under the target key, or explicitly reports incomplete work

##### Scenario: Active strategy during a key outage
- WHEN production vector indexing has no usable key and A3 is set to `fail`
- THEN it rejects before driver upsert; with an unexpired matching cached key it encrypts, and `plaintext` follows A3's reported fallback

##### Scenario: Display-key rotation
- WHEN maintenance receives the old key through `TENANT_DATA_ENCRYPTION_OLD_KEY` and finds plaintext, current-key and old-key display values
- THEN apply preserves logical values, reseals old-key values and a full target-key verification gates retirement; an unreadable envelope aborts its batch and prevents completion

##### Scenario: Rotation target pin
- WHEN `searchVectorDisplayMaintenance.run` receives `pin: { providerIdentity, wrappedDekFingerprint }` for a rotation's frozen target
- THEN report and apply refuse with `pin_mismatch` if either the active provider or wrapped-DEK fingerprint differs; a matching pin permits the existing maintenance and verification flow, and omitting the pin preserves existing behavior

##### Scenario: Tenant created before the upgrade
- WHEN the upgrade's migrations have run and a person of a tenant created earlier is indexed for vector search
- THEN the stored presenter is ciphertext

##### Scenario: Embedding text
- WHEN an entity with an encrypted field is indexed through the generic builder
- THEN that field's value is not part of the embedded text

Frozen by: `packages/search/src/__tests__/vector-index-security.test.ts` (existing suite, extended in Phase 2 with characterization of the active write and both read paths; its existing cases stay)

## 📝 Architecture

- **`packages/shared/src/lib/search/tokenize.ts`**: new `hashSearchToken` and `tokenizeSearchText` take the tenant id, required and nullable, and return the keyed form with the legacy form beside it. `hashToken` and `tokenizeText` keep today's signature and output, deprecated.
- **`packages/shared/src/lib/encryption/aes.ts`**: add or reuse C1's exact `deriveLookupPurposeKey(purpose: string): Buffer | null` export; no parallel secret resolver or differently named purpose-key API. Search keeps its `search-token-v1` purpose, tenant derivation and fingerprint exactly as the keyed-token construction table defines them; the secret stays private.
- **Lookups**: `tokenLookup.ts`, both query engines' token subqueries and the token strategy match query ordinals across forms, with array-bound candidates and the keys chosen by the lookup's tenant scope (see Lookups across tenants). The customer-accounts admin users route moves to `tokenLookup.ts`.
- **Purge and fingerprint report**: in `query_index`, which owns `search_tokens`. A new framework DI service, `searchRecordLiveness`, in `packages/shared/src/lib/search/record-liveness.ts`, is an id-only existence probe. For one entity type and at most 100 scoped ids it calls the DI `queryEngine` exactly as the query index already reads every entity generically: `queryEngine.query(entityType, { tenantId, organizationIds, filters: { id: { $in: ids } }, fields: ['id'], withDeleted: true, decryptEncryptedFields: false, skipAutoReindex: true })`, and returns `present`, `absent` or `unknown` per id. An entity type is *registered* when the query engine resolves it to an ORM-backed table or custom-entity storage; anything else is `unknown`. It reads no field value, so it is not a value-bearing reader: DEC-9's module-owned reader rule governs the C8/G6 export and scan readers that return values, and this probe uses the same framework data layer as the query index instead of another module's tables. Unregistered/custom sources it cannot resolve are `unknown` and kept. The command rechecks liveness in each apply batch and requires writers paused during apply. Cursor order is `search_tokens.id` within `(entity_type, tenant_id)`; emit the next cursor only after commit, never use offset pagination.
- **Present-source reconciliation.** During the paused-writer maintenance, the query-index and search owners provide their complete current token-producing fields and keyed rows for the exact record and scope, using their normal builders. Require an explicit authoritative empty contribution from an owner whose strategy is disabled for that record. Preserve records if an owner or source cannot be proven complete, including an unreadable encrypted value or a field the existing ciphertext guard would preserve. Once both contributions and a current key verify, the query_index storage owner replaces the record’s exact scoped token set in one transaction with the deduplicated keyed union. This removes retired field names no builder emits and preserves fields still emitted by either owner. It leaves the live per-writer replacement contracts untouched. Any source/key/read/write ambiguity leaves rows unchanged, reports incomplete work and prevents a successful maintenance exit. For records that the search CLI deliberately excludes, the report identifies the exact tenant/entity group as blocked until the source and token owners provide an authoritative disposition and a scoped repair through their reviewed maintenance path. A missing source may be purged only after the existing liveness check proves absence. A null-tenant repair requires an exact null scope and never treats no tenant filter as proof of scope. Removed/unknown sources with no approved ownership remain blocked rather than being guessed absent.
- **Vector**: the active strategy follows A3's toggle/map → matching pin → unexpired backend-scoped key → health/get/provision order and calls `resolveUnavailableWrite` only without a usable key; both readers decrypt. `searchVectorDisplayMaintenance: SearchVectorDisplayMaintenance` owns scope enumeration, bounded baseline reads, conditional resealing and independent target-only persisted reads for the CLI, B1 Phase A steps 5/6 and enterprise rotation; the indexer supplies mapped field names. Its typed contract below is search-owned; consumers neither query the table nor define a competing adapter.
- **Doctor declaration prerequisites**: C1 Phase 1 delivers R3-2's full-object registry and member validation; doctor Phase 3 delivers DEC-I's `doctorChecks` collector. Both precede search's environment-only `search.raw_tokens_stored` declaration and query_index's two `needs: 'database'` token-count declarations below. The latter also require R3-4's database runner. Token/vector report commands and G6 calibration remain separate from these checks.
- **Vector map backfill**: the search module gains a `migrations` directory with one forward-only migration. The module has no entities; `db:migrate` runs a module's migrations directory without them (`packages/cli/src/lib/db/commands.ts:460-462`).

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Tokenizer → secret | Shared encryption library | No secret: unkeyed hashing, reported once |
| Search → tenant encryption | `tenantEncryptionService` by DI key, with A3 `resolveUnavailableWrite` | Explicit off: plaintext; unavailable key: A3 fail/plaintext decision, with memory-first cache lookup |
| Source liveness | Framework `searchRecordLiveness` DI service | Unknown or failed read: keep rows and report unresolved; no projection inference |
| Fingerprint probe | Query-index-owned grouped counts, read-only | Database unavailable: diagnostic unavailable; the command must be run later |

### Doctor database counts

Under R3-4, `query_index` declares `query_index.legacy_tokens_stored` and `query_index.noncurrent_token_keys` in its `privacy.ts` full default object's `doctorChecks`, preserving `dataClasses` and every other member under R3-2. Both use `needs: 'database'`. Each check supplies its own lazy `countServices['query_index.token_counts']` factory, receiving only `{ em }` from the doctor spec's transaction-bound read-only manager and returning its exact `PrivacyDoctorCountingService` from `@open-mercato/shared/modules/privacy`: `count(input: { tenantId: string | null; counter: string }): Promise<number>`. The doctor creates a separate restricted container per selected check, so both declarations may carry that same service key; neither depends on the other check running.

The factory counts only query_index's own `search_tokens`, with an exact non-null tenant predicate including that tenant's organizations. It rejects null tenants and unknown counters before querying; the doctor's resolver rejects tenants outside its supplied `tenantIds`. Resolve the configured token-key fingerprint through the keyed token helpers above; missing lookup material fails the check rather than counting zero or adopting a stored fingerprint. No factory runs without `--database`, and no application bootstrap, general `di.ts`, cache or independent connection/transaction is used.

| Counter | Counted rows |
|---|---|
| `legacyRows` | Rows in the requested tenant with legacy unkeyed token hashes |
| `nonCurrentKeyRows` | Rows in that tenant with keyed hashes whose stored fingerprint differs from the configured token-key fingerprint |
| `currentKeyRows` | Rows in that tenant with keyed hashes whose stored fingerprint matches the configured token-key fingerprint |

Each check sums counts across only the supplied tenants and returns aggregate findings through the doctor's existing finding shape, never rows, record/tenant ids, token values or fingerprints. `query_index.legacy_tokens_stored` warns for legacy rows; `query_index.noncurrent_token_keys` errors for non-current keyed rows. Factory/query failures become `doctor.check_failed`; unavailable storage never becomes a clean result. `currentKeyRows` is an available counter, not a third check or positive proof that the configured key is correct. Explicit tenantless reports remain with `mercato query_index purge-legacy-tokens --tenant none`, and G6's independent positive current-key calibration remains required.

### Shared decisions consumed

| Decision | Owning design |
|---|---|
| DEC-F — The B1 hand-offs | [`encryption-map-coverage-and-backfill`](2026-11-16-encryption-map-coverage-and-backfill.md), “Phase D — Lookup hashes and system-scope rotation” |
| R3-12 — Fill commands for module-written hashes | Same Phase D; all three fills are new, including `mercato customers fill-lookup-hashes` |
| R3-2 — The registry carries the whole `privacy.ts` default export | [`privacy-data-class-contract`](2026-11-16-privacy-data-class-contract.md), “Export shape” |
| DEC-I — The doctor's extension point | [`privacy-doctor-cli`](2026-11-16-privacy-doctor-cli.md), collector/API Contracts |
| R3-4 — An opt-in database tier for the doctor | Same doctor spec, Architecture; query_index supplies the two opt-in token checks in Doctor database counts, while the configuration check and search report/scan commands remain separate |
| R4-10, R5-3 | This spec, API Contracts → Vector CLI / service and Search-owned vector maintenance adapter; R5-3 names the optional pin's `providerIdentity` and `wrappedDekFingerprint`, and this spec defines their source under Rotation pin source |

## 📝 Data Models

No new table or user-editable entity; optimistic locking is not applicable. `search_tokens.token_hash` values gain a prefix; the column is text. `vector_search` display columns, the presenter included, hold ciphertext. Fingerprint state is read from token rows; there is no baseline row to claim. One migration in the search module adds `presenter` to every existing scope's `vector:vector_search` row in `encryption_maps`; its `down()` has no SQL, as the helper recommends.

## 📝 API Contracts

- **New, additive** — `hashSearchToken(token, { tenantId, config? }): string` and `tokenizeSearchText(text, { tenantId, config? }): { tokens, hashes, legacyHashes }`, where `tenantId` is `string | null` and required. `hashes` is the keyed form, a `null` `tenantId` meaning the tenantless key (the installation-key form in the keyed-token construction table); with no secret configured it equals the unkeyed digest.
- **`hashToken` and `tokenizeText`** keep their signatures and return exactly today's unkeyed digest for one minor, with `@deprecated` naming the replacements. First-party callers move to the new functions in the same change. Both old functions are removed with dual-read in the following minor.
- **`findEntityIdsBySearchTokens`** keeps its signature. A `scope.tenantId` of `undefined` still adds no tenant predicate, and now hashes for each candidate tenant (see Lookups across tenants).
- **The vector encryption map** gains `presenter`, delivered to existing tenants by a migration.
- **Vector JSON transport** — existing `VectorDriverDocument` fields and `upsert(doc)` calls stay valid. Add optional `supportsEncryptedDisplay?: true` on `VectorDriver` and `encryptedDisplay?: Partial<Record<'presenter' | 'links' | 'payload', string>>` on write documents and hit/list storage records. The pgvector serializer stores each supplied ciphertext as a JSON string in its existing jsonb column; the legacy object/array member is omitted when its encrypted carrier is present. Text display members already accept strings and carry ciphertext under their existing camelCase names. Reads put encrypted JSON strings in the carrier and omit the legacy object member until the strategy decrypts and parses it. Never duplicate plaintext into the document beside a carrier. An encryption-required strategy refuses a driver without the optional capability rather than publishing clear values; old unencrypted callers/driver implementations remain callable. Capability enforcement follows the explicit protected-vector activation protocol below; optional typing alone is not a behavioral compatibility bridge. No shared driver captures a request service.
- **CLI** — new `mercato query_index purge-legacy-tokens --tenant <id|none> [--entity <module:entity>] [--batch <1..100>] [--after <cursor>] [--apply] [--out <file>]`. `none` explicitly selects tenantless rows. Validate arguments and cursor scope with zod. Without apply it counts only. Report per scoped entity: `legacyRows`, `fingerprintRows`, `absentRows`, `presentRows`, `unknownRows`, `deletedRows`, `blockedRows`, `next`, `done`. Apply requires a key and paused writers; it commits each keyset batch and deletes only obsolete legacy/non-current-keyed absent-source rows. Apply never deletes a live/unknown source’s tokens or any current-key row. Groups that cannot be safely reached and classified are counted in `blockedRows` and make the exit non-zero. Only exact scoped source proof permits removal. Deletion failure rolls back the batch and returns its previous committed cursor.
- **Token rebuild CLI** — new `mercato search reindex-tokens --tenant <id|none> [--entity <module:entity>] [--batch <1..100>] [--after <cursor>] [--out <file>]`, owned by `search`. Validate arguments with zod: `--tenant` is a UUID or the literal `none`; `--entity` must be enabled for search and allowed the `tokens` strategy by `isEntityIndexStrategyAllowed`; `--batch` defaults to 100; a cursor binds the tenant selector, entity and last record id, and is refused for another selector. Without `--entity` the command visits, in sorted entity-id order, every enabled entity whose strategy policy allows `tokens`. `<id>` loads that tenant's records across all its organizations (query engine `tenantId` set, no organization filter). `none` selects only the declared tenantless catalogue types that `resolveQueryIndexSearchScope()` reports as `tenantGlobalEntityTypes` — sources with neither scope column, which are the only rows the token strategy writes with a null tenant — loaded with no tenant predicate; `none` with any other `--entity` is a validation error, and tenantless rows of tenant-capable entities stay with the query-index rebuild and the purge report. A new search-indexer method reads each entity in keyset order by record id (`id > after`, ascending), builds records with `buildIndexableRecords` exactly as `reindexEntityToFulltext` does (its private tenant parameter widened to `string | null`, which the custom-field exclusion lookup already accepts), and obtains the search contribution through the token strategy’s shared builder, which also accepts a null tenant for catalogue types. The maintenance path obtains the matching query-index owner contribution without another writer racing its commit. It never recreates or deletes an index and does no fulltext, vector or queue work; rows of records it no longer finds stay for the purge, which classifies their source as absent. The pass uses the present-source reconciliation above through query_index-owned storage to atomically replace the union for each visited record. The query-index maintenance path must perform the same reconciliation for exactly scoped tenantless rows of tenant-capable entities, or mark the group as blocked when either owner lacks sufficient proof. A record with incomplete writer evidence is blocked. Rerunning from the beginning or from a cursor is idempotent. The report is counts only, per entity: `visitedRecords`, `indexedRecords`, `droppedRecords`, `failedRecords`, `blockedRecords`, `next`, `done`; no record ids, values or tokens. A failed read or write stops that entity at its previous cursor and the command continues with the next entity. Any entity with `failedRecords > 0`, `blockedRecords > 0` or `done: false` makes the command exit non-zero; only a zero exit counts as the token-strategy half of the rebuild.
- **Vector CLI / service** — new `mercato search encrypt-vector-display --tenant <id> [--batch <1..100>] [--after <id>] [--apply] [--out <file>]`. DI `searchVectorDisplayMaintenance.run(input: { tenantId: string; mode: 'report' | 'apply'; batchSize?: number; after?: string; pin?: { providerIdentity: string; wrappedDekFingerprint: string } }): Promise<VectorDisplayMaintenanceReport>`, with `batchSize` default 100 and range 1..100. In both modes, a supplied `pin` requires the active provider and wrapped-DEK fingerprint to match `providerIdentity` and `wrappedDekFingerprint`; either mismatch refuses with `pin_mismatch` before any maintenance write. This additive option lets a tenant-wide facade caller bind its operation to a frozen target; calls without a pin retain their behavior. Protected Enterprise rotation supplies its frozen target through exact-scope `prepare`. The report has `tenantId`, per-column `plaintext`, `currentKey`, `oldKey`, `unreadable`, `blocked` and `changed` counts, plus `next`, `done`, `complete` and `verification: 'full' | 'suffix' | 'unavailable'`; no values or keys. Only a full report from the beginning with zero unsafe counts may set complete. Apply preserves current values, encrypts plaintext, reseals old-key values and verifies the target key. The old key is environment-only; unreadable rows fail the batch. CLI argument/report validation uses zod; incomplete work exits non-zero.
- **Doctor** — after C1 Phase 1/R3-2 and doctor Phase 3/DEC-I, search declares `search.raw_tokens_stored` in its `privacy.ts` full default object with `dataClasses: []` and `doctorChecks`, preserving other members. It reads `OM_SEARCH_STORE_RAW_TOKENS` only; it never reads token/vector rows or claims a completed purge/rebuild. Query_index separately declares `query_index.legacy_tokens_stored` and `query_index.noncurrent_token_keys` with `needs: 'database'` and their own lazy `query_index.token_counts` factories, exactly as Architecture → Doctor database counts specifies under R3-4. These do not replace report commands, explicit tenantless reporting or G6's search-owned `privacySearchScan.scanTokenValues` calibration.
- **Verification consumer** — [`2026-11-16-privacy-verification-suite.md`](2026-11-16-privacy-verification-suite.md), “Token calibration”, owns `privacySearchScan.scanTokenValues`. It consumes these package-owned `hashSearchToken` / `tokenizeSearchText` current/legacy candidates and `resolveSearchConfig`, requiring a positive current-key hit on the exact tenant/entity/record/field of a separate indexed control. Legacy-only hits, wrong lookup material, no usable witness or decryption failure are not clean results. This adds no competing scan service or deprecated-unkeyed-only proof.
- Existing search routes, feature guards and response contracts stay; query overflow is a localized validation error. The customer-accounts admin route uses the unchanged shared token helper signature.

### Search-owned vector maintenance adapter

Export these additive internal types from `@open-mercato/search/modules/search/lib/vector-display-maintenance`; register the implementation under the exact DI key `searchVectorDisplayMaintenance`. The `run` method above is the planned CLI/report facade over this adapter. B1 Phase A and Enterprise's “Store-owned vector rotation” consume this contract; the latter owns fence, encrypted baseline, canonical digests and the combined completion decision.

```ts
type VectorDisplayMaintenanceScope = { tenantId: string; organizationId: string | null }
type VectorDisplayMaintenanceCursor = string
type VectorDisplayMaintenanceKeyPin = {
  readonly providerIdentity: string
  readonly scope: VectorDisplayMaintenanceScope
  withKeyBytes<Result>(consume: (bytes: Readonly<Uint8Array>) => Result): Result
}
type VectorDisplayMaintenanceSession = {
  readonly scope: VectorDisplayMaintenanceScope
  readonly mappedColumns: readonly string[]
  readonly sourceKey: VectorDisplayMaintenanceKeyPin | null
  readonly targetKey: VectorDisplayMaintenanceKeyPin
  close(): Promise<void>
}
type VectorDisplayMaintenanceColumn = {
  name: string
  databaseType: string
  format: 'sql-null' | 'text' | 'binary'
  bytes: Uint8Array | null
}
type VectorDisplayMaintenanceRow = {
  id: string
  columns: readonly VectorDisplayMaintenanceColumn[]
  writeToken?: symbol
}
type VectorDisplayMaintenancePage = {
  rows: readonly VectorDisplayMaintenanceRow[]
  next: VectorDisplayMaintenanceCursor | null
  done: boolean
  encodedBytes: number
}
type VectorDisplayMaintenanceRead = {
  session: VectorDisplayMaintenanceSession
  after?: VectorDisplayMaintenanceCursor
  batchSize?: number
  maxBytes?: number
}
type VectorDisplayMaintenanceReport = {
  tenantId: string
  columns: Record<string, {
    plaintext: number; currentKey: number; oldKey: number
    unreadable: number; blocked: number; changed: number
  }>
  next: string | null
  done: boolean
  complete: boolean
  verification: 'full' | 'suffix' | 'unavailable'
}
type SearchVectorDisplayMaintenance = {
  enumerateScopes(input: { tenantId: string; after?: string; batchSize?: number }): Promise<{
    scopes: VectorDisplayMaintenanceScope[]; next: string | null; done: boolean
  }>
  prepare(input: { scope: VectorDisplayMaintenanceScope; pin?: { providerIdentity: string; wrappedDekFingerprint: string } }): Promise<VectorDisplayMaintenanceSession>
  readBaselinePage(input: VectorDisplayMaintenanceRead): Promise<VectorDisplayMaintenancePage>
  resealPage(input: { session: VectorDisplayMaintenanceSession; page: VectorDisplayMaintenancePage }): Promise<{
    changedRows: number; next: VectorDisplayMaintenanceCursor | null; done: boolean
  }>
  readTargetPage(input: VectorDisplayMaintenanceRead): Promise<VectorDisplayMaintenancePage>
  run(input: { tenantId: string; mode: 'report' | 'apply'; batchSize?: number; after?: string; pin?: { providerIdentity: string; wrappedDekFingerprint: string } }): Promise<VectorDisplayMaintenanceReport>
}
```

Under R5-3, `run` applies the optional `pin` check in both report and apply modes. `providerIdentity` is the B4-specified `VectorDisplayMaintenanceKeyPin.providerIdentity` of the prepared target session. `wrappedDekFingerprint` is the lowercase hex SHA-256 of the provider key check defined under Rotation pin source; it changes on every rotation. These fields replace R4-10's earlier provider/version fields because `TenantDek` has no version. For each pinned call, including resume and the fresh full report, read the pin afresh through `readTenantKeyPin` on the explicitly selected target provider, without cached key material or provider fallback, and compare both members against the supplied frozen target before any maintenance write. Either mismatch refuses with `pin_mismatch`. Never use raw DEK bytes, an unkeyed DEK hash, a timestamp, a Vault KV version or the enterprise run-keyed concrete-DEK fingerprint as the fingerprint. The session's concrete key pins and independent full verification remain required. Omitting `pin` leaves the existing facade behavior unchanged.

**Rotation pin source.** Neither built-in provider stores a wrapped DEK: Vault's `data.key` is the base64 DEK and the derived provider stores nothing. The source is therefore a provider key check, read through one additive optional member, `KmsService.readTenantKeyCheck?(tenantId: string): Promise<{ providerIdentity: string; keyCheck: Uint8Array } | null>`, in `packages/shared/src/lib/encryption/kms.ts`. The field name `wrappedDekFingerprint` does not mean a wrapped DEK is stored; the value is the key-check digest.
- **The check.** The provider reads the tenant DEK afresh from its own storage and returns `keyCheck` = HMAC-SHA-256 keyed by the DEK bytes over `om:tenant-dek-pin:v1`, `providerIdentity` and the tenant id, NUL-separated. The caller never receives key bytes. The check is a PRF output under a 256-bit key, so it confirms nothing without the DEK. It stays in memory and in Enterprise's encrypted run header, never in reports or logs.
- **The identity.** `providerIdentity` uses the same normalized parts as A3's backend namespace in [`2026-11-16-kms-fail-closed.md`](2026-11-16-kms-fail-closed.md), Architecture → Backend-scoped process cache, without its credential fingerprint: KMS mode plus normalized Vault address and mount, or the derived-root fingerprint. A renewed or replaced Vault token therefore does not break a running rotation. A3 Phase 2 adds that normalizer, and B4 Phase 2, which requires A3 Phases 1–3, reuses it. The session's `targetKey.providerIdentity` takes the same value.
- **Providers.** Vault reads `tenant_key_<tenantId>` over HTTP, bypassing its instance cache and A3's shared key context, and never creates a DEK. The derived provider derives from its configured root. `FallbackKmsService` asks only its primary and returns `null` when the primary cannot answer. `NoopKmsService` and custom providers without the member supply no check.
- **The helper.** Shared `readTenantKeyPin(kms: KmsService, tenantId: string): Promise<{ providerIdentity: string; wrappedDekFingerprint: string } | null>` in the same file is the only place that turns a check into a pin. Enterprise freezes its target with it; `run` re-reads it for each pinned call.
- **Session binding.** After `prepare`, a pinned `run` recomputes the check from the session's target key through `targetKey.withKeyBytes` and refuses with `pin_mismatch` if it differs, so a stale cached DEK cannot pass.
- **No source.** A `null` read refuses preparation under the existing missing/unsupported-key-provenance rule, which Enterprise reports as `ROTATION_COVERAGE_UNSUPPORTED`. A successful unpinned call cannot satisfy a pinned rotation gate.

`enumerateScopes` keysets every exact organization scope present for the tenant, including null-organization and historical rows; it never depends on an ORM entity projection. `prepare` freezes effective field/schema/codec metadata and pins concrete source/target DEKs using existing maintenance key resolution. The target is the explicitly selected tenant provider key; the old root is read only from `TENANT_DATA_ENCRYPTION_OLD_KEY` in this maintenance process and resolved to the scoped source DEK. No caller-supplied old-key argument, runtime search fallback or raw root used as a tenant DEK is allowed. Missing/unsupported key provenance or map rules refuses preparation. When `prepare` receives a frozen target pin, read provider provenance fresh and check the session's concrete target under the same R4-10/R5-3 rule used by the CLI facade. Bind the pin to the exact scope session and repeat the provider-binding check before reseal and final target reads. Refuse `pin_mismatch` before the operation on mismatch. Enterprise derives its scoped counts and completeness from those exact-scope reads and does not issue the tenant-wide `run` as proof of an organization-only plan. Key pins are memory-only, never JSON/report fields; the trusted coordinator uses `withKeyBytes` only to bind actual DEKs under its run key, as its baseline algorithm requires, and never persists/logs those bytes. It verifies the original bindings on resume and before final reads; close every session in `finally`.

Both read methods keyset by stable row id within the exact tenant/organization, with batch size default/cap 100. Cursors bind that scope and the frozen coverage/key bindings; cross-scope or changed-binding cursors refuse. `maxBytes` defaults to and cannot exceed 8 MiB. Before fetching contents, server-side size probes bound wire, decoded and ciphertext expansion; a row over 1 MiB or an unprovable bound refuses before mutation. Pages include every selected logical column in stable schema order: decrypted mapped text/JSON plus unchanged embeddings, scope/id, timestamps, versions and other columns. Preserve database type and lossless bytes, distinguish SQL NULL from JSON null, and refuse unsupported codecs; never coerce precise numerics/timestamps through JavaScript number/date or return ciphertext as baseline plaintext. These pages are internal in-memory input to Enterprise's encrypted baseline, never CLI reports or plaintext scratch files.

`readBaselinePage` authenticates mapped envelopes with pinned target/source keys using existing encryption helpers, accepts genuine plaintext for backfill, and refuses unreadable/malformed envelopes. Each baseline row's opaque `writeToken` binds the session, exact scope, id and stored display values. `resealPage` accepts only pages read by that session, encrypts plaintext and reseals old-key values, leaving target-key values idempotent. One page commits atomically after id/scope/source-and-target compare-and-set; a mismatch rolls back the whole page and cannot advance the committed cursor. It changes no logical values, embeddings, `updated_at` or other user-visible versions and emits no business hooks/value-bearing history. Release page tokens after commit/failure to keep memory bounded.

`readTargetPage` uses a fresh persisted read/fork, the same frozen coverage, and **only** the pinned target DEK, bypassing source-key fallback and cached decrypted/write results. Plaintext, old-key-only, unreadable or missing required mapped values fail verification; baseline SQL NULL/missing values must remain exactly so. It scans unchanged/already-target rows too. A returned reseal cursor is not verification: Enterprise independently compares the full target stream's identities/counts/types/logical values against its original baseline for both stores before success. CLI completion likewise requires a fresh full target read from the beginning; suffix, conditional-write, unreadable, key-binding or target-key failures remain incomplete with non-zero exit, retaining old keys until all stores verify.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| No lookup secret and no encryption key | Unkeyed hashes, as today; reported; the purge refuses |
| The lookup secret is set or an encryption fallback rotates | Startup logs the current fingerprint and other stored fingerprints when the probe is available; report lists exact counts. Stop writers and traffic until the B1 Phase D handoff and forced token rebuild finish |
| A worker or shell has a different secret | No baseline is claimed. Every fingerprint is counted separately; logs label the current process's configuration |
| Reindex interrupted within a record | Ordinals matched across keyed and legacy fields keep the record searchable under the same secret |
| A tenant never reindexed | Legacy rows remain readable during the bridge and keep the leak; the report command counts them |
| Dual-read removed with legacy rows present | Those records stop matching. The release task requires zero legacy and blocked rows. The scoped owner reconciliation removes retired fields on present records. Disabled, removed, unknown or unsupported groups remain blocked until their owners can verify and repair them. |
| Deprecated tokenizer writes after reindex | Those live legacy rows are kept and reported regardless of index-document presence; its own SQL finds only legacy rows |
| Unscoped lookup has thousands of tenants | Candidate batches and array parameters avoid the PostgreSQL parameter ceiling; query tokens are capped |
| A tenant's first rows land after candidate enumeration | That lookup may miss them; the next includes the tenant |
| `OM_SEARCH_HASH_ALGO` changes | It changes legacy candidates only. Keyed `k1` is always HMAC-SHA-256 and its fingerprint is unchanged |
| Vector rows written by an old process | They remain plaintext until apply runs after the last old writer stops; report must then reach zero |
| Encryption is off or a stored vector map omits a field | Maintenance reports blocked and refuses completion; normal strategy writes follow explicit-off/A3 policy. Restore encryption and the required map before verification |
| KMS outage with/without an unexpired matching cached key | Active strategy uses the valid key first; without it production fail refuses driver writes, plaintext reports fallback, and expired/wrong-backend keys are not reused |
| Vector envelope needs the old key or cannot be opened | Environment-only old key enables value-preserving reseal; unreadable values fail before that batch writes and prevent key retirement |
| `run` receives a pin for a different active provider or wrapped-DEK fingerprint | Report and apply refuse with `pin_mismatch` before any maintenance write; a matching pin proceeds through existing verification gates |
| The target provider supplies no key check (custom or noop KMS, unreachable Vault primary) | Pinned preparation refuses under the missing/unsupported-key-provenance rule and Enterprise reports `ROTATION_COVERAGE_UNSUPPORTED`; the fallback provider is never asked; unpinned calls are unchanged |
| The Vault DEK is overwritten or the derived root changes during a rotation | The fresh key check differs and the run refuses with `pin_mismatch`; a Vault token change alone keeps the same `providerIdentity` |
| Tenant map predates `presenter` | The migration seeds all ten literal fields for missing maps and appends missing rules to active maps; removed fields can be re-added. The upgrade note states this |

## 📝 Migration & Backward Compatibility

| Change | Route |
|---|---|
| Token hashes keyed, read in both forms | Internal storage form; no behaviour change. Dated entry and an upgrade note with the reindex and purge steps |
| `tokenizeText` and `hashToken` | Deprecation protocol: unchanged signature and output for one minor, `@deprecated` naming `hashSearchToken` and `tokenizeSearchText`; removed with dual-read |
| New `hashSearchToken` and `tokenizeSearchText` | Additive exports |
| `searchVectorDisplayMaintenance.run` gains optional `pin` | Additive input member; calls without it preserve existing behavior, while supplied provider/wrapped-DEK-fingerprint mismatches refuse with `pin_mismatch` |
| `KmsService` gains optional `readTenantKeyCheck`; new `readTenantKeyPin` export | Additive optional interface member and export; custom providers without the member keep working and cannot be pinned |
| Vector display fields encrypted / driver capability enforced | Explicit protected activation during minor N; unsupported custom drivers keep their documented unprotected bridge with a readiness gap. N+1 default enforcement follows the migration and compatibility protocol below |
| `vector:vector_search` map gains `presenter` | One forward-only migration in the search module; storage only |
| Generic embedding text excludes encrypted fields and the presenter | Defect fix; affected entity types are reindexed for vector search |
| `IndexableRecord.embeddingExcludedFields`, `VectorDriverListParams.organizationIds`, `listEntries` `organizationIds` option | Additive optional members; omitted values keep today's behavior for third-party callers and drivers. A driver that ignores `organizationIds` still lists only allowed organizations, because the strategy filters returned entries before decrypting |
| `GET /api/search/index` applies the organization allowlist | Defect fix: a restricted user with no organization selected no longer lists other organizations' entries; response shape unchanged |
| New `mercato search reindex-tokens` | Additive CLI command |

`UPGRADE_NOTES.md` and the search docs require a traffic-stopped cutover: stop ingress, schedulers and every web/worker/CLI writer, drain accepted work, verify no old reader or writer remains, then upgrade every process before permitting new token or encrypted-display writes. Keep ordinary traffic stopped while the complete evidence and replacement pass runs; run `mercato query_index reindex --tenant <id> --entity <module:entity> --force` across every enabled entity and tenant plus explicit tenantless catalogue scopes, then `mercato search reindex-tokens --tenant <id|none>` for the same scopes, rerunning from its reported cursor until it exits zero; run `mercato query_index purge-legacy-tokens --tenant <id|none>` as a report, then `--apply` with writers paused to delete confirmed absent-source obsolete rows; repeat the report from the beginning until no legacy, old-key or blocked rows remain. Require a reviewed owner and scoped disposition for residual groups outside the normal token rebuild. Do not retire legacy reading or restore post-rotation traffic while a group is blocked. Run `mercato search encrypt-vector-display --tenant <id> --apply` after the last old vector writer stops, supplying `TENANT_DATA_ENCRYPTION_OLD_KEY` only in the maintenance environment for rotation, then its report-only form from the beginning until plaintext/old-key/unreadable/blocked counts are zero and every mapped value opens under the target key. Reindex the audited vector entity types with `mercato search reindex --tenant <id> --entity <module:entity>`.

The notes state that the full ten-field vector map migration re-adds fields a tenant removed in the map editor; it cannot infer whether an omission was deliberate. They also state what happens to deprecated hash callers in the next minor. Secret rotation is a traffic gate: follow B1 Phase D's lookup rehash and module fills (DEC-F, R3-12), then the forced token rebuild and zero-residual report before traffic. B1's “Phase D — Lookup hashes and system-scope rotation” runbook and the key guard's remediation list cite this order with the exact owner `mercato query_index purge-legacy-tokens`; neither may substitute `mercato search purge-legacy-tokens`. DEC-F/R3-12 introduce `mercato customers fill-lookup-hashes` and its columns in B1 Phase D; that command does not exist in today's code. Old-key retirement waits for ORM/system and vector target-key verification plus token rebuild/purge evidence for every scope. These commands do not rebuild Meilisearch.

### Protected vector-driver activation and compatibility

In bridge minor N, introduce optional `supportsEncryptedDisplay` and the encrypted carriers, characterize an unchanged old custom driver through the ordinary unprotected path, and warn once when it cannot support protected display. The planned search-owned setting `encryptedDisplayRequired` defaults off in N for existing custom drivers. Explicit activation requires a capable driver, all-reader maintenance cutover and zero-unsafe owner verification; an incapable driver is refused before any mutation. The default pgvector adapter ships capability support in N and can activate during that cutover. This bridge never permits an incapable driver to claim A1/B4 protected readiness or to receive clear values after protected activation. The setting cannot downgrade an activated store while encrypted records exist; keep protected mode or disable vector serving/writes.

No earlier than N+1, a separately tracked default-enforcement release may require capability after the documented migration window, dated compatibility entry, `UPGRADE_NOTES.md` and consuming-driver tests. Existing custom drivers must add the carrier or operators must disable their vector strategy before that release. Do not use a security exception merely because optional typing compiles. If a specific legacy surface itself qualifies as the vulnerability, its narrow removal instead needs the full named Emergency Security Exception approval; this spec grants none. Program/A1 acceptance requires protected activation and verified capable drivers, not bridge-mode success.

## 📋 Phasing

| Phase | Outcome | Behaviour change |
|---|---|---|
| 1 | Keyed token hashes read in both forms; purge; fingerprint report | Maintenance cutover required; no old reader or writer may serve while keyed writes or rebuilds start |
| 2 | Vector display encryption; embedding text; in-place job | Maintenance cutover and protected-driver activation required; every reader understands ciphertext before encrypted writes; affected entities reindexed |

| Phase | Prerequisites |
|---|---|
| 1 | C1's `deriveLookupPurposeKey` seam, or B4 adds it (see Keyed token hashes) |
| 2 | A3 Phases 1–3 ([`2026-11-16-kms-fail-closed.md`](2026-11-16-kms-fail-closed.md)): the decision function, the backend-scoped key cache and the `fail` setting with the command pin, all available from A3 before Phase 2, independently of A1 refusal, and consumed by the vector strategy and its Phase 2 tests |

B4 Phase 2 verifies the active vector write path under A3 fail mode and delivers the OSS reseal required by A1 release. A3 may ship its earlier opt-in without this coverage and waits for this milestone before the protected default flip.

Mixed-version serving is unsupported and is a failed readiness condition. Reopen only after fleet identity/drain evidence, forced rebuilds, vector reseal and full owner verification succeed. On rollback stop traffic again; an old reader must never receive keyed-only rows or encrypted display. Keep the new compatible readers deployed until an explicitly verified storage rollback exists; this carrier supplies no automatic decrypt/downgrade path.

Removing dual-read, together with `hashToken`, `tokenizeText` and the two integration tests' use of them, is a tracked release task for the following minor.

## 📋 Implementation Plan

### Phase 1 — Tokens
1. **Characterize** today's unkeyed digest, field-scoped writer replacement, all-token list lookup and the token strategy's ratio. Keep those tests with the compatibility bridge.
2. Add or reuse C1's exact `deriveLookupPurposeKey` contract with the `search-token-v1` purpose and the keyed-token construction table, and fixed HMAC-SHA-256 `k1`. In `tokenize.test.ts`, add the known-answer vectors and test stable fingerprints, tenant separation, `null`, no secret, all legacy algorithms, and that changing `OM_SEARCH_HASH_ALGO` does not change keyed tokens.
3. Add the new token functions, deprecate the old ones without changing their output, and move first-party callers. Leave `TC-INBOX-010` and `TC-QIDX-4731` as bridge fixtures.
4. Change the helper, both engines and token strategy to the ordinal join with bound arrays and tenant batches. Move customer-accounts admin users to the helper. `tokenLookup.mixed-form.test.ts` and each engine/strategy test require mixed-form rows to count correctly: legacy first name plus keyed last name for multi-field helpers, and both forms within the constrained field for a query-engine field predicate; duplicate forms count once, existing ratio/score behavior, tenantless catalogue hits, and no cross-tenant or organization combination. `tokenLookup.parameter-budget.pg.test.ts` executes over 65,535 candidates and asserts bounded SQL parameters and overflow validation; it also seeds many rows per tenant for few tenants and asserts, through `EXPLAIN (ANALYZE, FORMAT JSON)`, that the candidate-tenant read uses `search_tokens_presence_idx` and reads at most one index row per candidate tenant plus one. A source guard inventories production `search_tokens` match queries and rejects new bespoke lookups outside these four shared paths, including regression coverage for customer accounts.
5. Verify `query_index`'s existing `--force` path visits unchanged records and replaces every field the query-index writer owns; add forced token rewrite only where equality/ciphertext preservation prevents convergence. Add `mercato search reindex-tokens` (search CLI, a search-indexer method that loads records like `reindexEntityToFulltext` and calls only the token strategy, no fulltext or vector work), exactly as API Contracts → Token rebuild CLI defines it. `search-reindex-tokens.test.ts` covers zod refusal of a bad tenant, a non-token entity, `none` with a non-catalogue entity and a foreign cursor; the default entity set; `none` writing only catalogue rows with a null tenant; keyset resume from a cursor without skipped or repeated records; counts-only output; and a non-zero exit when a batch fails or an entity is left `done: false`. `token-writer-coverage.test.ts` builds, for every enabled first-party entity, the field set each writer produces for the same record and asserts that after both rebuild commands no legacy row remains for any field either writer owns. A test shows a stale ciphertext-preserved field stays reported until its owner can emit tokens from verified plaintext. Add the maintenance-only full-set replacement through query_index-owned storage. Tests seed a retired field on a present record, distinct fields still emitted by each writer, a renamed field and an ambiguous contribution. Assert atomic replacement removes retired fields, preserves both live fields and leaves every ambiguous record unchanged and blocked.
6. Add `searchRecordLiveness` and the report/apply purge. `legacy-token-purge.test.ts` tests report-only default, paused-writer apply, live source with no projection, soft-deleted-but-present source kept, unknown source kept, old-key orphan removed while old-key live rows stay, no key, scoped cursor rejection, per-batch rollback and resumed deletion. `token-fingerprint-report.test.ts` starts a wrong-key process first and proves it establishes no baseline; count every fingerprint and unavailable probe explicitly. Test disabled and removed entities, undeclared tenantless scopes, exact null comparisons and same-record controls elsewhere. Missing authoritative owner evidence makes the group blocked and non-zero with every row kept.
7. After C1 Phase 1/R3-2 and doctor Phase 3/DEC-I, declare search's environment-only `search.raw_tokens_stored` check in its full `privacy.ts` default object. Test on/off/unset and that default/`--only` runs require no application bootstrap or storage read. Declare query_index's `query_index.legacy_tokens_stored` and `query_index.noncurrent_token_keys` with `needs: 'database'` and a lazy `query_index.token_counts` factory on each, following Doctor database counts. Extend `token-fingerprint-report.test.ts` and the doctor's TC-PRIVACY-DOCTOR-003 fixtures: default runs construct no factory/database connection; each isolated `--only <id> --database` works; both selected checks may carry the same service key; all three counters count only their exact tenant across organizations; null/foreign tenants, unknown counters, missing lookup material and factory/query failures refuse. Test warning/error severities and aggregate-only findings with two tenants, current/legacy/non-current fixtures and cleanup; retain separate explicit tenantless reporting. G6's separate search-owned scan tests require a positive current-key probe against current/legacy candidates, with wrong/missing key and no eligible witness incomplete. Ship TC-SEARCH-TOKENS-001 to 003 with fixtures and cleanup.

### Phase 2 — Vector
1. **Characterize** active vector writes and the `search()` and `listEntries()` read paths in the existing `vector-index-security.test.ts`. Add the `organizationIds` allowlist to `VectorDriverListParams`, `listEntries` and the pgvector `list`, and pass `scope.filterIds` from `api/index/route.ts`; `vector-index-listing-scope.test.ts` covers unrestricted, selected, restricted multi-organization with none selected, and empty allowlist, plus a driver whose `list` ignores `organizationIds` and returns every organization's rows: `listEntries` returns only the allowed organizations' entries and never calls decryption for the others.
2. Add `presenter` to the map and a forward-only `buildEncryptionMapBackfillSql` migration with all ten literal fields. It follows B1 Phase A's nine-field catch-up migration and the protected-driver activation gate; installing a map alone does not activate a custom driver's new required transport. Unit-test map insertion, append/idempotence and restoration of a previously removed field. Encrypt on write and decrypt in both read methods through DI; parse decrypted `jsonb` strings with `parseDecryptedFieldValue`. `vector-index-security.test.ts` spies on the real active strategy's A3 `resolveUnavailableWrite` call and pins the complete lookup order: matching command pin, unexpired matching backend-scoped cache, then health/get/provision. Test both `fail` and `plaintext` for thrown/unavailable KMS, null key, valid pin/cached-key outages, expired/wrong-backend/wrong-tenant entries, recovery and no driver write after refusal. A valid pin/cache must encrypt without health/get/provision or invoking the unavailable decision. Also test encryption on/off for both readers, the opaque JSON carrier without plaintext duplicates, old unencrypted document compatibility and refusal of an explicitly activated encryption-required driver without that capability; characterize the unchanged unprotected custom-driver bridge and require capability before protected activation.
3. Pass mapped field names to generic embedding extraction. Audit each first-party builder against its own and related maps, fix mapped-field embedding and record every affected entity type in the upgrade note. A unit test per builder pins the exclusion.
4. Add DI `searchVectorDisplayMaintenance: SearchVectorDisplayMaintenance`, its exact bounded adapter from API Contracts and report/apply CLI with `vector-display-backfill.test.ts`: report-only, plaintext/current-key/old-key mixtures, environment-only old key, unchanged logical text/JSON, target-key verification, no embedding calls, idempotent current-key rows, unreadable-envelope batch rollback/non-zero exit, compare-and-set conflicts, interrupted keyset resume, full versus suffix verification, blocked scope and a final old writer converging after a second run. In both report and apply, test a matching R5-3 `pin`, provider-only and wrapped-DEK-fingerprint-only mismatches refusing with `pin_mismatch` without writes, and omitted-pin compatibility. Verify `providerIdentity` equals the prepared target key pin and the fingerprint equals SHA-256 of the provider key check. Cover a changed check after a Vault DEK overwrite or derived-root change, uncached provider reads on resume/full report, a stale cached session DEK refusing with `pin_mismatch`, fallback never satisfying the pin and a provider with no check refusing preparation. Add `readTenantKeyCheck` to the Vault, derived and fallback providers and `readTenantKeyPin` in `kms.ts`, with `kms-tenant-key-check.test.ts`: the same DEK gives the same check, tenants and rotations give different checks, the check never equals an unkeyed DEK hash, Vault reads bypass both caches and never create a DEK, a Vault token change keeps `providerIdentity`, and the fallback wrapper never asks its fallback. Exercise scope enumeration, pre-allocation byte bounds, complete logical baseline rows (including embeddings/versions), scope-bound cursor rejection, pinned-key material binding and fresh target-only persisted reads. In `vector-display-rotation.database.test.ts`, run a search-enabled combined rotation and freeze both store baselines before either writes, inject a vector compare-and-set conflict/unreadable source/target-key mismatch, and require incomplete status with old keys retained; only independent full ORM/system and vector identity/count/logical/target-key verification permits retirement. Bind facade calls to the rotation's frozen target with `pin`, and prove that changing either active provider or wrapped-DEK fingerprint refuses with `pin_mismatch` and cannot permit completion or old-key retirement. Core/enterprise consume the same DI adapter without table reads or CLI subprocesses.
5. Ship TC-SEARCH-VECTOR-001 against real pgvector with a deterministic fake embedding service injected through real DI. No external embedding provider is required.
6. Add `search-protected-cutover.test.ts`: an old reader/worker presence or undrained CLI prevents activation; no new keyed/encrypted write occurs during mixed-version serving; a fully drained upgraded fleet can rebuild, verify and reopen; rollback refuses an incompatible reader. Add custom-driver consumer tests for unchanged bridge behavior, warning, explicit activation refusal before writes, capable-driver activation and blocked downgrade. Update upgrade notes, compatibility entry and search docs, including B1's required runbook handoff, exact token/purge commands and map restoration warning. Track removal of dual-read only after residual and blocked counts reach zero across all observed tenant and entity groups. Run `yarn generate` for the new discovery file; no generated file is edited by hand.
7. Archive this Delta if the capabilities directory has been adopted by then.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/lib/search/{tokenize,tokenLookup,config,record-liveness}.ts`, shared DI registration, `packages/shared/src/lib/encryption/{aes,kms}.ts` | Modify / create shared liveness and crypto helpers and the provider key check; no domain dependency |
| `packages/core/src/modules/query_index/lib/{search-tokens,engine,legacy-token-purge,token-fingerprint-report}.ts`, `packages/core/src/modules/query_index/{cli.ts,privacy.ts}`, `packages/shared/src/lib/query/engine.ts`, `packages/search/src/strategies/token.strategy.ts` | Modify / create purge and diagnostics under their real CLI owner; add the two query_index-owned doctor declarations and lazy token counter |
| `packages/core/src/modules/customer_accounts/api/admin/users.ts`, `packages/core/src/modules/ecommerce/lib/storefrontSearch.ts` | Modify — use shared lookup and new hash functions |
| `packages/search/src/strategies/{vector,token}.strategy.ts`, `packages/search/src/vector/{types.ts,drivers/pgvector/index.ts}`, `packages/search/src/indexer/search-indexer.ts`, `packages/shared/src/modules/search.ts` (`IndexableRecord.embeddingExcludedFields`), `packages/search/src/modules/search/{encryption.ts,cli.ts,privacy.ts,di.ts,lib/vector-display-maintenance.ts,api/index/route.ts}` | Modify / add doctor member to the full privacy default object under R3-2; vector batch command; `reindex-tokens` command; listing organization allowlist; `embeddingExcludedFields` on the #8410 seam |
| `packages/search/src/modules/search/migrations/Migration<timestamp>_search.ts` | Create — full vector map backfill |
| Unit/PG tests named in the plan; `TC-SEARCH-TOKENS-00{1,2,3}.spec.ts`, `TC-SEARCH-VECTOR-001.spec.ts` | Create in owning package/module test directories |
| `UPGRADE_NOTES.md`, `BACKWARD_COMPATIBILITY.md`, search docs | Modify at implementation; B1 runbook update belongs to its spec owner |

## 🧪 Integration Coverage

Every new test creates its tenant/organization, records and map fixtures, uses no demo data, and deletes its own source records, index rows, maps and scopes in `finally`. API checks use existing feature guards and test cross-tenant and cross-organization denial. Browser paths use existing data-call helpers and locale strings.

| Test | Paths | Covers |
|---|---|---|
| TC-SEARCH-TOKENS-001 | `GET /api/customers/people?search=`, `GET /api/customer_accounts/admin/users?search=`, `GET /api/search/search`, backend people/customer-user list and search palette | API-created person and portal user match prefix/email/phone and mixed-field two-word queries; stored keyed hashes differ from plain digests; key UI search still renders names |
| TC-SEARCH-TOKENS-002 | Same people list; `mercato query_index reindex --tenant <id> --entity customers:customer_entity --force`; `mercato search reindex-tokens --tenant <id> --entity customers:customer_entity`; `mercato query_index purge-legacy-tokens --tenant <id>` with/without `--apply` | Seed legacy rows for a field only the token strategy writes (the search builder's own field spelling): assert the query-index rebuild alone cannot satisfy the two-writer acceptance check. After `reindex-tokens` exits zero, both owners’ active fields still match and the report shows zero legacy rows for those fields; live source with no document is preserved by purge; default writes nothing; confirmed absent source's legacy and old-key rows deleted only with apply; interrupt after a committed batch, resume from its cursor and verify no skipped rows; report counts legacy and each fingerprint. A present-source retired field disappears after verified two-writer reconciliation while both live fields still match. Rows in a disabled or unsupported tenantless entity are reported as blocked without deletion and prevent completion |
| TC-SEARCH-TOKENS-003 | `POST /api/directory/tenants`, `GET /api/auth/users?search=` and superadmin users list | Two owned tenant/org/user fixtures share a word; unscoped search returns both, selected scope returns only its own; the separate real-PostgreSQL parameter-budget test covers the 65,535-candidate threshold without requiring thousands of application tenants |
| TC-SEARCH-VECTOR-001 | Real pgvector; `GET /api/search/search` with vector strategy, `GET /api/search/index`, backend vector index listing; `mercato search encrypt-vector-display --tenant <id>` with/without apply | Inject deterministic fake embeddings through the real request/worker DI seam; seed an old map row, run map migration, index an API-created person, inspect every non-null mapped display column including `presenter` for ciphertext, assert embedding input excludes mapped values, and verify both API readers/UI display the name; with records in two owned organizations, a user restricted to one organization and no organization selected sees only that organization's entries in `GET /api/search/index`; post-rollout unsafe counts reach zero after apply; mixed current/old/plaintext rows preserve logical values, wrong-key rows prevent completion and A3 fail/cached-key outages exercise the active strategy |
| `vector-display-rotation.database.test.ts` | Real PostgreSQL/pgvector, B1 Phase A adapter preflight and Enterprise Phase 2 protected coordinator in the enterprise lane | Own tenant/org, ORM and plaintext/current/old-key vector fixtures plus source/target roots supplied only to the maintenance process. Freeze both baselines before writes, bind exact-scope protected sessions to the frozen target with `pin` and prove a second organization and null-organization rows are neither read nor written, and require provider-only or wrapped-DEK-fingerprint-only mismatches to refuse with `pin_mismatch` without writes. Compare all logical columns including embeddings/versions through fresh target-only reads, inject unreadable/conditional-write/target-key failures and require incomplete status with old keys retained. Only both full-store verifications permit completion; remove fixtures, close sessions and restore keys/fence in finally |
| TC-PRIVACY-DOCTOR-003 (doctor-owned fixture suite) | `mercato privacy doctor` and each isolated query_index `--only <id> --database` | Own two tenants and current/legacy/non-current token fixtures; assert all three scoped counters, legacy warning/non-current error, no factory or database by default, missing-key/query failures and null/foreign tenant refusal, aggregate-only output and cleanup; no tenantless or positive-key-calibration claim |
| Existing `TC-INBOX-010`, `TC-QIDX-4731`, `TC-SEARCH-014` | Legacy token fixtures and palette/list search | Compatibility callers stay unchanged and still match during the bridge minor |

Token-hash tests need the app key and run in the controlled ephemeral environment; external `BASE_URL` runs report the missing-key prerequisite explicitly. The vector test uses the existing pgvector-capable integration database (`packages/cli/src/lib/testing/integration.ts`) and a deterministic embedding replacement, never a live provider. A controlled test profile supplies the replacement to both API and worker processes and restores it in teardown.

## 📝 Risks & Impact Review

#### Search returns nothing after upgrade
- **Scenario**: Lookups use keyed hashes against rows that still hold legacy ones.
- **Severity**: High
- **Affected area**: every list and global search over encrypted fields
- **Mitigation**: Both forms are read by query ordinal across fields; integration tests require mixed-field two-word matching and no duplicate score inflation.
- **Residual risk**: An installation whose lookup secret changes without a reindex. Grouped fingerprint counts report it; no old-key read exists. B1 must gate traffic on token rebuild completion; that runbook handoff remains outside this file.

#### The leak outlives the fix
- **Scenario**: An installation upgrades and never reindexes; legacy rows remain.
- **Severity**: High
- **Affected area**: the token index Require complete source-and-writer reconciliation for live records and record unresolved disabled or unsupported groups as blockers.
- **Mitigation**: The named forced reindex and report/apply purge; reports count legacy and every fingerprint independently of doctor configuration checks; the two R3-4 database checks supply aggregate warnings/errors for selected tenants without replacing report or current-key calibration evidence.
- **Residual risk**: Backups taken before the reindex hold the legacy rows.

#### A call site hashes under the wrong key
- **Scenario**: One of the lookup or write paths passes no tenant, the wrong one, or spans tenants with one tenant's key.
- **Severity**: High
- **Affected area**: search on that path returns nothing
- **Mitigation**: The tenant argument of the new functions is required by the type. The keys follow the lookup's tenant scope, and each path has unit tests for one tenant, `null`, `undefined` and the catalogue widening. TC-SEARCH-TOKENS-003 covers the superadmin list; the existing search integration tests run unchanged.
- **Residual risk**: Third-party code that runs its own SQL over `tokenizeText` hashes finds only legacy rows during the bridge minor, and nothing after it. The upgrade note names the replacement.

#### Code on the deprecated functions breaks
- **Scenario**: A module still calls `hashToken` or `tokenizeText` after the upgrade.
- **Severity**: Medium
- **Affected area**: third-party search on the token index
- **Mitigation**: Both keep today's output for one minor, so the rows such code writes are legacy-form and every lookup finds them; `TC-INBOX-010` and `TC-QIDX-4731` stay on the old functions as bridge tests.
- **Residual risk**: Those rows keep the unkeyed leak until the module moves, and stop matching when dual-read is removed.

#### Unscoped lookups exhaust SQL parameters
- **Scenario**: A superadmin searches with no tenant selected on an installation with many tenants.
- **Severity**: Medium
- **Affected area**: the superadmin users list and other unscoped lookups
- **Mitigation**: Array-bound candidates, tenant batches of 100 and at most 5,000 query ordinals; a test exceeds 65,535 hash candidates and executes the query.
- **Residual risk**: Slower cross-tenant search, bounded by one index seek per candidate tenant for the candidate read; selecting a tenant avoids it.

#### Existing tenants keep the presenter in clear
- **Scenario**: A tenant created before the upgrade has a stored vector map without `presenter`.
- **Severity**: High
- **Affected area**: vector display data at rest
- **Mitigation**: The map migration, post-rollout in-place apply, report-only plaintext counts and a real pgvector integration test with an old map row.
- **Residual risk**: A scope with no active maps, which the helper skips as `seed-encryption` does, and a tenant that removes the field in the map editor.

#### A text builder still embeds a mapped field
- **Scenario**: A module's own builder was missed in the audit.
- **Severity**: Medium
- **Affected area**: text sent to the embedding provider
- **Mitigation**: The audit is a named step with its results recorded in this spec; a unit test asserts each first-party builder against its module's map.
- **Residual risk**: Third-party modules' builders.

#### In-place encryption corrupts display fields
- **Scenario**: The job encrypts a value that is already ciphertext.
- **Severity**: Medium
- **Affected area**: search result display
- **Mitigation**: The job authenticates current/old envelopes, reseals only old-key values, verifies the target key and preserves logical values; idempotence and unreadable-batch refusal are unit-tested.
- **Residual risk**: Malformed historical values are reported as blocked and need operator repair; they are never silently double-encrypted.

#### Vector maintenance uses a different rotation target
- **Scenario**: The active provider or wrapped-DEK fingerprint differs from Enterprise rotation's frozen target during an exact-scope protected operation.
- **Severity**: High
- **Affected area**: vector display resealing and combined rotation completion
- **Mitigation**: R5-3 binds `providerIdentity` to the B4-specified session target pin and `wrappedDekFingerprint` to SHA-256 of the provider key check, read afresh without cache or fallback and rechecked against the session's target key. The coordinator supplies that pair; `run` refuses either mismatch with `pin_mismatch` before writing. Tests cover derivation, matching, provider-only mismatch, wrapped-DEK-fingerprint-only mismatch, resume/full-report refresh and omitted-pin calls in both modes.
- **Residual risk**: A custom KMS without `readTenantKeyCheck` cannot be pinned, so protected rotation refuses on it. Unpinned calls retain existing behavior; a matching pin still requires concrete key binding and independent full-store verification before old-key retirement.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root and specs rules; search guidelines; shared search-token/encryption rules; core encryption and module-boundary rules; `BACKWARD_COMPATIBILITY.md`; DEC-F, DEC-I, R3-2, R3-4, R3-12, R4-10 and R5-3. This is a design revision; implementation tests are specified, not run.

| Rule | Status | Notes |
|---|---|---|
| Never hand-roll crypto | Compliant | HMAC through the shared encryption library; column encryption through the tenant service |
| Vector display fields encrypted at rest | Compliant | Restores the documented rule |
| A map entry ships with a backfill migration | Compliant | `presenter` reaches existing tenants through `buildEncryptionMapBackfillSql` |
| Client tokenizer mirrors the server's minimum length | Compliant | Unchanged; no client hashing exists |
| One shared blocklist decision for per-field tokens and `search_text` | Compliant | Untouched |
| Changed exported signatures follow the deprecation protocol | Compliant | `hashToken` and `tokenizeText` keep signature and output for one minor; the keyed form is a new export |
| Tenant scoping | Compliant | The candidate tenants choose hashes only; every tenant predicate is unchanged |
| Integration coverage | Specified | Self-contained token, customer-account, unscoped, real-pgvector and key UI paths; deterministic embeddings |
| Operator signals have an owner | Specified | Query-index reports, search vector report, environment-only raw-token check and the two query_index-owned R3-4 database declarations after C1 Phase 1/doctor Phase 3; G6 calibration stays separate |
| R3-4 token-count ownership | Specified | Both query_index checks carry their own lazy `query_index.token_counts` factory and the doctor-owned counters; read-only exact-tenant counts, isolated selection and failure tests specified |
| R4-10 / R5-3 rotation target binding | Specified | Both `run` declarations use optional `pin: { providerIdentity: string; wrappedDekFingerprint: string }`; the uncached provider key check and `readTenantKeyPin` are its source, with `pin_mismatch` and provider tests |

**Verdict:** design ready for Phases 1 and 2. Under program DEC-2, work proposed for OSS requires written upstream maintainer approval naming the carrier before implementation. An independent security fix may proceed on its own named, explicitly approved carrier. The design verdict and ordinary PR review do not grant that approval. Assumption 1's per-tenant key is decided, and the provider key check is the source of the rotation pin. Independent full-store verification is still required before old-key retirement.

## Changelog

### 2026-11-18 — Review corrections

- Sequence active-vector coverage after A3 opt-in and bind protected vector verification to exact scoped adapter sessions.

### 2026-11-18 — Spec review

- Reconcile the complete scoped set of both token writers for live records so retired fields are removed and unresolved scope groups block completion.

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. The initial revision counted per form; council round two replaces that with distinct query ordinals across forms and fields. The key is derived per tenant. The stored form carries a key fingerprint, so a changed secret is reported instead of silently emptying search. The "reindex completed" flag is gone: state is read from the rows, and a purge removes only rows no reindex can reach. The vector map gains the presenter column and encryption moves to the strategy. Meilisearch moved to its own spec.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g1-01 — `hashToken` and `tokenizeText` keep today's unkeyed output for one minor instead of hashing under the installation key; keyed hashing is reached only through the new `hashSearchToken` and `tokenizeSearchText`, the "does not compile" claim is gone, and `TC-INBOX-010` and `TC-QIDX-4731` stay on the old functions as bridge tests. g1-02 — `presenter` reaches existing tenants through a `buildEncryptionMapBackfillSql` migration in the search module, not a default-map merge, which exists only for system-scoped maps; a database-backed test seeds an old map row. g1-06 — the hash list follows the lookup's tenant scope: one tenant, none, a tenant plus the tenantless catalogue rows, or every tenant holding rows when unscoped, with the count taken against the searched tokens; the customer-accounts admin route moves to the shared helper; unit tests per path and TC-SEARCH-TOKENS-003 for the superadmin users list. Assumptions 6 and 7, Delta scenarios, edge cases, risks and compliance rows updated.
- Fix verification follow-up: the `presenter` migration is a second migration after the encryption-map spec's Phase A catch-up, which writes the nine current fields. B1 therefore does not wait for this spec.
- Council round two fixes (GPT-6.1 Sol workers): r2iqa-02 — report-owned database diagnostics; r2iqa-04 — mixed-field ordinal matching; r2iqa-05 — source-safe report/apply keyset purge; r2iqa-10 — post-rollout vector counts; r2iqa-11 — B1 token-rebuild handoff; r2iqa-20 — array parameters and query cap; r2iqa-29 — fixed k1 algorithm; r2iqa-30 — admin-list decryption; r2iqa-31 — map restoration note; r2iqa-32 — exact query_index commands; g1-18 — complete admin-user regression coverage; g1-20 — real pgvector integration; g1-27 — no first-writer baseline.

- Council round two fixes, pass two (GPT-6.1 Sol workers): Reuse C1's exact purpose-key export; route active vector writes through A3; add search-owned old-key reseal/verification and complete rotation gates; declare R3-4 query_index token-count factories and consume the verifier's current-key probe; correct B1/key-guard purge-owner handoffs and cite exact shared-decision names.

- Council round two fixes, pass three (GPT-6.1 Sol workers): Specify the search-owned bounded baseline/reseal/independent target-read DI adapter, concrete key binding and combined rotation gates; pin A3 live-strategy lookup order and outage tests; require C1 Phase 1 and doctor Phase 3 before the environment-only check, remove speculative database-count declarations and keep G6 calibration separate.

- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): R4-10 adds the optional provider/DEK-version pin to both vector-maintenance `run` declarations, refuses mismatches with `pin_mismatch`, preserves unpinned calls, and aligns rotation scenarios, tests, risks, compatibility and compliance.

- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): Restore the doctor-owned R3-4 query_index token checks, lazy factory/counters and scoped failure tests; apply R5-3 to both rotation-pin declarations and all scenarios, tests, risks and compliance, with the stored-wrapped-DEK provider read recorded as an unresolved delivery dependency.

### 2026-11-17
- PR #8410 is recorded as landed baseline: base-field embedding exclusion extends its `plaintextExcludedCustomFields` / `plaintextSearchFields` seam with `embeddingExcludedFields`, and the existing `vector-index-security.test.ts` is extended rather than replaced.
- The admin vector listing gains an organization allowlist (`organizationIds`) before it decrypts presenters; restricted multi-organization regressions added.
- The keyed-token construction is pinned (purpose `search-token-v1`, tenant and tenantless derivation, token message, fingerprint) with known-answer vectors; the unscoped candidate-tenant read is a loose index scan with a plan assertion.
- The token strategy's own rows are rebuilt by the new `mercato search reindex-tokens`, added to the upgrade order; `searchRecordLiveness` is an id-only query-engine probe outside DEC-9's value readers; the rolling-deploy window and the Phase 2 prerequisite on A3 Phases 1–3 are stated.
- Closing note on earlier entries: the provider key check under **Rotation pin source** settles the stored-wrapped-DEK dependency that the pass-six entry recorded as unresolved.
- `VectorDisplayMaintenanceKeyPin` is named as specified here, not as an existing code type, and the `wrappedDekFingerprint` name is stated to carry the key-check digest, not a stored wrapped DEK.
- `mercato search reindex-tokens` gets its own API contract (zod arguments, `none` limited to declared tenantless catalogue types, default entity set, keyset resume, counts-only report, non-zero exit when incomplete) and TC-SEARCH-TOKENS-002 coverage. `listEntries` filters returned entries by the organization allowlist before decrypting, so a driver that ignores `organizationIds` cannot leak. The purpose-key row states the C1 key bytes verbatim, a `null` tenant names the tenantless key, and A3 Phase 2 owns the provider-identity normalizer.

### Spec review corrections — 2026-11-19

- Require a traffic-stopped, all-reader cutover and an explicit custom-driver compatibility/activation bridge; add mixed-version and rollback acceptance (F22, F23).
