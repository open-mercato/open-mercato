# Search-index protection for encrypted fields

> **Program:** package B4 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). Related: #8134, #7872, #5712, #8135; open PR #8410.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run. Two findings below are marked as read from code and not confirmed at run time.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-07-24-search-architecture-clarification-and-evolution.md

## 📝 TLDR

A person's name, email and phone are encrypted in the CRM tables and then copied into search stores in forms that undo the encryption. The token index hashes every word, and every prefix of it from three characters up, with plain SHA-256 and no key; anyone holding the database can recover the words by trying a few tens of thousands of guesses. The vector index keeps each record's display name and subtitle in clear on the path the product actually uses. **Proposed (future):** token hashes are keyed with a secret derived per tenant from the installation's lookup secret, and the vector index encrypts what it shows and stops embedding encrypted fields.

**Not in this spec:** Meilisearch, which is split into [`2026-11-16-fulltext-encrypted-field-exclusion.md`](2026-11-16-fulltext-encrypted-field-exclusion.md) because it shares no reindex with these two; the ciphertext-derived `search_text` column, tracked by #5712; encrypted custom fields in build contexts, which PR #8410 removes; what the embedding provider retains.

## 📝 Overview

> **Market reference.** Rails' Active Record Encryption supports search on an encrypted column only through *deterministic* encryption with a key — an exact-match lookup, never a prefix index. CipherStash and similar "searchable encryption" products get prefix and fuzzy search by storing keyed, truncated term hashes. Adopted: keyed term hashes, which keep today's prefix search and make the index useless without the key. Rejected: dropping prefix tokens for encrypted fields, which would end list search by partial name; and unkeyed hashing, which is what ships today.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Key scope for token hashes | A key per tenant, derived from the installation's lookup secret and the tenant id. Rows with no tenant use the installation key | ⚠ NEEDS HUMAN CONFIRMATION. One installation-wide key would let any account in any tenant write chosen words and, with read access to the database, build a dictionary that works against every tenant. A derived key needs no storage or rotation of its own. Changing this later costs a second full reindex. |
| 2 | Search during the switch | Reads always ask for both the keyed and the legacy hash, for one minor | No state to track. Matching a legacy row is harmless; its existence is the leak, and that is handled by the purge. |
| 3 | When legacy rows go | An ordinary reindex replaces them record by record; a purge command removes the rest and never deletes the tokens of a live record that has not been reindexed | So that no operator action can blank search. |
| 4 | Existing vector rows | Encrypted in place by a batch job, without re-embedding | Re-embedding costs provider calls and sends the text out again. |
| 5 | Installations with no lookup secret and no encryption key | Hashes stay unkeyed; reported; the purge refuses to run | There is nothing to key with, and on such an installation the unkeyed form is the live one. The key-guard spec covers that configuration. |

## 📝 Problem Statement

| Store | What it holds | Who can read it outside the app |
|---|---|---|
| Token index (`search_tokens`) | `sha256(token)` in full, unkeyed and unsalted, with the field name, entity id and tenant in clear. Tokens are lower-cased words of three characters or more and, by default, every prefix of each word (`packages/shared/src/lib/search/tokenize.ts:75-114`; `config.ts:56, 92-97, 150`). It covers every string field of the decrypted document, encrypted fields included by design (`packages/core/src/modules/query_index/lib/search-tokens.ts:105-172`) | Anyone with the database |
| Vector index (`vector_search`) | The embedding; a presenter with title, subtitle and badge; link labels (`packages/search/src/vector/drivers/pgvector/index.ts:201-220`). For a person the presenter carries display name, job title, department and a description snippet | Anyone with the database |

- **The token index is reversible.** A three-character token has 36³ = 46,656 possible values; each longer prefix adds 36 guesses. A word is recovered with under fifty thousand hashes, and the row says which field it came from. Hashes are identical across tenants and installations.
- **Every lookup requires all tokens to match.** The three lookup paths count distinct matching hashes against the number of searched tokens (`tokenLookup.ts:107`; `packages/shared/src/lib/query/engine.ts:1938-1940`; `query_index/lib/engine.ts:1759-1761, 2005-2007`), and the token strategy scores against the same number (`token.strategy.ts:139, 231`).
- **The lookup secret has fallbacks.** It falls back to the two encryption-key variables (`packages/shared/src/lib/encryption/aes.ts:191-203`). Setting the lookup secret for the first time, or rotating an encryption key it fell back to, changes every derived value silently.
- **The vector presenter is in clear on the active path** (read from code, not run). The `vector:vector_search` encryption map is applied only inside the legacy `VectorIndexService`, which search no longer registers (`packages/search/src/modules/search/di.ts:134`). The path in use, strategy to `pgvector/index.ts:305-330`, has no encryption call. The map also has no entry for the `presenter` column the driver writes (`modules/search/encryption.ts:5-17`; `pgvector/index.ts:211`). `packages/core/AGENTS.md` says these columns are encrypted at rest.
- **The driver cannot encrypt.** It is a process singleton built without a container (`modules/search/di.ts:122-145`).
- **Embedding text.** Customer entities already exclude encrypted fields. The generic fallback embeds the presenter plus every string field, excluding only custom fields (`packages/search/src/strategies/vector.strategy.ts:141-203`); the strategy has no access to an encryption map. Other modules' own text builders were not audited.
- **What search on encrypted values serves today** (read from code). People list search by name, email and phone uses tokens only. Global search by email or phone uses tokens only.
- **Portal display names are indexed** (`customer_accounts/search.ts:56`), so a portal user can put chosen text into the token index.
- **No client hashes tokens.** Clients import only the minimum token length, so changing the hash needs no client change.

## 📝 Proposed Solution

### 1. Keyed token hashes

`hashToken` becomes an HMAC over the token. The key is derived from the installation's lookup secret, a fixed context string and the tenant id.

- **Stored form.** `k1.<fingerprint>.<hash>`. The fingerprint is eight hex characters derived from the installation token key, the same for every tenant. It says which key wrote the row, which a bare version number cannot.
- **Lookups** ask for the keyed and the legacy form of each token. A record holds one form only, so the "all tokens" test is applied per form: the record matches when either form reaches the count. The score uses the larger of the two.
- **Reindex.** The ordinary token reindex rewrites each record's rows, which replaces legacy rows with keyed ones.
- **Purge.** `mercato search purge-legacy-tokens` deletes rows that are not in the current keyed form and whose record has no index document — rows left behind by deleted records, which no reindex will ever touch. It reports, per tenant and entity type, how many such rows belong to live records and therefore still need a reindex. It refuses to run when no key is configured.
- **Key change.** The current fingerprint is recorded at first use. When the configured key yields a different one, startup logs an error and the doctor reports it, with the number of rows under the old fingerprint. Those rows cannot be matched; a reindex is the only repair.

### 2. Vector index

- The map gains the `presenter` column. Declared defaults are merged when a tenant's map is resolved, so existing tenants need no backfill of the map.
- The strategy encrypts the display columns before handing the row to the driver and decrypts them on read. The driver stays as it is.
- The indexer passes the entity's mapped field names to the generic text builder, which leaves them out and also leaves the presenter out when any field is mapped.
- A batch job encrypts existing rows in place.
- Each first-party module's own text builder is checked against its encryption map. Any that embeds a mapped field is fixed, and that entity type is reindexed for vector search by a named command in the upgrade note: nothing on this path compares a stored checksum, so a fix alone re-embeds nothing.

### Design decisions

| Decision | Rationale |
|---|---|
| Derive the token key from the lookup secret with its own context string | One secret to manage; the context keeps token hashes and lookup hashes from being interchangeable. |
| A key fingerprint in the stored form | A changed key is otherwise indistinguishable from a normal row, and search would return nothing with no explanation. |
| State is read from the rows, not from a flag | Reindex runs per entity, tenant and partition; a single "done" flag would be wrong for most of them. |
| Dual-read is unconditional for one minor, then removed | It costs a longer `IN` list and removes every way to get the state wrong. |
| Encrypt vector rows in the strategy | The driver has no container and no tenant service. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| One installation-wide token key | See assumption 1. |
| A per-tenant key stored in the key service | Key storage and rotation for a value that can be derived. |
| Stop tokenizing encrypted fields | Ends list search for people by partial name, email or phone. |
| Drop prefix tokens | Same loss, slightly smaller. |
| Delete legacy rows when a reindex "completes" | Completion is not defined across entities and tenants; deleting early blanks search. |
| Re-embed everything | See assumption 4. |
| Encrypt `search_text` | It holds ciphertext for mapped fields already; #5712 proposes dropping it. |

### Known limits

- A keyed hash protects against a disclosed database, not against someone who also holds the installation's secrets.
- Someone with an account in a tenant and continuing read access to the database can write chosen words and read back their hashes, and so build a dictionary for that tenant. The per-tenant key stops this crossing tenants; nothing here stops it inside one.
- Token rows still reveal which records share a word, how many words a field has, and — through the chain of prefixes — how long each word is.
- The user's search text is sent to the embedding provider when vector search is used. That is a third-party data flow and belongs on the sub-processor page.
- With `OM_SEARCH_STORE_RAW_TOKENS` on, the plaintext token is stored beside its hash. It stays an explicit diagnostic setting; the doctor reports it.

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
- WHEN a search has two words and the record's rows are all in one form
- THEN the record is found

##### Scenario: After reindex and purge
- WHEN the entity has been reindexed and the purge has run
- THEN no legacy-form row remains and the same search still finds the person

##### Scenario: Purge before reindex
- WHEN the purge runs while a live record still has only legacy rows
- THEN those rows are kept and reported, and the record is still found

##### Scenario: Another tenant
- WHEN the same word is indexed in two tenants
- THEN the stored hashes differ

Frozen by: `packages/shared/src/lib/search/__tests__/tokenize.test.ts`

#### MODIFIED Requirement: Vector index contents
The system SHALL encrypt the display fields of a vector index row at rest and SHALL NOT include an encrypted field in the text sent for embedding.

##### Scenario: Stored row
- WHEN a person is indexed for vector search
- THEN the stored title and subtitle are ciphertext, and search results still show the name

##### Scenario: Embedding text
- WHEN an entity with an encrypted field is indexed through the generic builder
- THEN that field's value is not part of the embedded text

Frozen by: `packages/search/src/__tests__/vector-index-security.test.ts`

## 📝 Architecture

- **`packages/shared/src/lib/search/tokenize.ts`**: `hashToken` and `tokenizeText` take the tenant id, required and nullable; they return the keyed form and, on request, the legacy form.
- **`packages/shared/src/lib/encryption/aes.ts`**: exports a derivation of a context-bound key from the lookup secret, and its fingerprint. The secret itself stays private.
- **Lookups**: `tokenLookup.ts`, both query engines' token subqueries and the token strategy match either form, with the count taken per form.
- **Purge and fingerprint record**: in the `query_index` module, which owns both the token table and the index documents.
- **Vector**: the strategy calls the tenant encryption service for the mapped columns on write and read; a `search` CLI job encrypts existing rows in keyset batches; the indexer supplies the mapped field names.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Tokenizer → secret | Shared encryption library | No secret: unkeyed hashing, reported once |
| Search → tenant encryption | `tenantEncryptionService` by DI key | Encryption off: columns stay plaintext, as for any mapped column |
| Fingerprint record | Module configuration, instance-scoped, resolved softly | No record: the comparison is skipped and the doctor says so |

## 📝 Data Models

No schema change. `search_tokens.token_hash` values gain a prefix; the column is text. `vector_search` display columns, the presenter included, hold ciphertext. One instance-scoped module-configuration key records the token key's fingerprint.

## 📝 API Contracts

- **`tokenizeText` and `hashToken`** gain a required tenant argument. Both are exported from the shared package; first-party callers are updated in the same change, and the old signatures stay for one minor as deprecated wrappers that hash under the installation key.
- **The vector encryption map** gains `presenter`.
- **CLI** — `mercato search purge-legacy-tokens [--tenant] [--entity] [--dry-run]` and `mercato search encrypt-vector-display` (new), and the existing reindex commands.
- **Doctor checks** — legacy token rows present; token key fingerprint changed; raw token storage on.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| No lookup secret and no encryption key | Unkeyed hashes, as today; reported; the purge refuses |
| The lookup secret is set for the first time, or a key it fell back to is rotated | The fingerprint differs from the recorded one: error at startup, doctor finding, reindex required. Rows under the old key match nothing until then |
| A worker or shell runs with a different secret | It writes rows under another fingerprint; the same check reports it |
| Reindex interrupted | Rows are a mix; search works |
| A tenant never reindexed | Its searches keep matching legacy rows, and its legacy rows keep the leak. The doctor reports the count |
| Dual-read removed in the next minor with legacy rows still present | Those records stop matching. The release note and the doctor finding say so in advance |
| A caller hashes without a tenant | Does not compile; the deprecated wrapper hashes under the installation key and matches only rows with no tenant |
| Hash algorithm downgraded by environment | Applies inside the HMAC; no longer a meaningful weakening |
| Vector row written by an older process during rollout | Plaintext until the batch job runs again; the job is idempotent |
| A tenant's stored map lacks the vector entries | The declared defaults are merged in; a tenant cannot remove them |

## 📝 Migration & Backward Compatibility

| Change | Route |
|---|---|
| Token hashes keyed, read in both forms | Internal storage form; no behaviour change. Dated entry and an upgrade note with the reindex and purge steps |
| `tokenizeText` and `hashToken` signatures | Deprecation protocol: wrappers for one minor |
| Vector display fields encrypted | Restores documented behaviour |
| Generic embedding text excludes encrypted fields and the presenter | Defect fix; affected entity types are reindexed for vector search |

`UPGRADE_NOTES.md`: reindex tokens; run the purge; run the vector display job; reindex the listed entity types for vector search; how to see what remains; that the next minor stops matching legacy rows; and that setting or changing the lookup secret requires a token reindex.

## 📋 Phasing

| Phase | Outcome | Behaviour change |
|---|---|---|
| 1 | Keyed token hashes read in both forms; purge; fingerprint check | None visible |
| 2 | Vector display encryption; embedding text; in-place job | None visible; some entity types reindexed |

Removing dual-read is a tracked release task for the following minor.

## 📋 Implementation Plan

### Phase 1 — Tokens
1. **Characterize** in the tokenizer test that today's hash is the plain digest. Commit alone.
2. Export the context-bound key derivation and the fingerprint. Unit tests: stable for one secret, different for another, different per tenant, absent without a secret.
3. Key `hashToken` with the stored form above; return the legacy form on request; add the deprecated wrappers. Update the characterization test.
4. Match either form in the four lookup paths, counting per form. Unit tests for each: one word, two words in one form, a record with rows in both forms.
5. Confirm that the token reindex rewrites every record whether or not its document changed; if it skips unchanged ones, add a forced mode. Record the answer here.
6. The purge command and the fingerprint record and check. Unit tests: orphan row deleted; live record's row kept and counted; refusal without a key; changed fingerprint reported.
7. Integration tests TC-SEARCH-TOKENS-001 and 002; the doctor checks.

### Phase 2 — Vector
1. **Characterize** that the active write path stores the presenter in clear. Commit alone.
2. Add `presenter` to the map. Encrypt on write and decrypt on read in the strategy. Unit tests with encryption on and off, and for a tenant whose stored map predates the entry.
3. Pass mapped field names from the indexer; exclude them and the presenter from the generic embedding text. Unit test.
4. Audit each first-party text builder against its module's map; fix, and list here the entity types to reindex.
5. The in-place job, with unit tests for idempotence and for a row that is already ciphertext.
6. `UPGRADE_NOTES.md`, the dated compatibility entry, the search docs page, `packages/core/AGENTS.md`, and the tracking issue for removing dual-read.
7. Archive this Delta into `.ai/specs/capabilities/search-index-protection.md` if that directory has been adopted by then.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/lib/search/{tokenize,tokenLookup,config}.ts`, `packages/shared/src/lib/encryption/aes.ts` | Modify |
| `packages/core/src/modules/query_index/lib/{search-tokens,engine}.ts`, `packages/core/src/modules/query_index/cli.ts`, `packages/shared/src/lib/query/engine.ts`, `packages/search/src/strategies/token.strategy.ts` | Modify |
| `packages/search/src/strategies/vector.strategy.ts`, `packages/search/src/indexer/search-indexer.ts`, `packages/search/src/modules/search/{encryption.ts,cli.ts}` | Modify |
| Characterization and unit tests named above; `TC-SEARCH-TOKENS-00{1,2}.spec.ts` | Create |
| `packages/core/AGENTS.md` (vector statement), `UPGRADE_NOTES.md`, `BACKWARD_COMPATIBILITY.md`, search docs | Modify |

## 🧪 Integration Coverage

| Test | Paths | Covers |
|---|---|---|
| TC-SEARCH-TOKENS-001 | `GET /api/customers/people?search=`, direct query on `search_tokens` | A person created through the API is found by a name prefix, by two words, by email and by phone; none of their stored hashes equals the plain digest of a searched word |
| TC-SEARCH-TOKENS-002 | Same, plus the purge command | A live person whose rows are replaced by legacy-form rows is still found, and the purge keeps them; a legacy row for a record that does not exist is deleted by the purge |
| Existing `TC-SEARCH-014` | Palette and list search | Must pass unchanged |

Both new tests compute hashes in the test process, as `TC-QIDX-4731` does, so they need the app's key. The ephemeral environment gives both processes the same one; against an external `BASE_URL` the tests skip with that reason. Vector behaviour is covered by unit tests: the suite has no embedding provider.

## 📝 Risks & Impact Review

#### Search returns nothing after upgrade
- **Scenario**: Lookups use keyed hashes against rows that still hold legacy ones.
- **Severity**: High
- **Affected area**: every list and global search over encrypted fields
- **Mitigation**: Both forms are always read, counted per form; integration test for the mixed state and for two words.
- **Residual risk**: An installation whose lookup secret changes without a reindex. The fingerprint check reports it; nothing can match the old rows.

#### The leak outlives the fix
- **Scenario**: An installation upgrades and never reindexes; legacy rows remain.
- **Severity**: High
- **Affected area**: the token index
- **Mitigation**: The upgrade note; the doctor reports the number of legacy rows.
- **Residual risk**: Backups taken before the reindex hold the legacy rows.

#### A call site hashes under the wrong key
- **Scenario**: One of the lookup or write paths passes no tenant, or the wrong one.
- **Severity**: High
- **Affected area**: search on that path returns nothing
- **Mitigation**: The tenant argument is required by the type; each path has a unit test; the existing search integration test runs unchanged.
- **Residual risk**: Third-party code on the deprecated wrapper, which matches only rows with no tenant.

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
- **Mitigation**: The job detects ciphertext and skips; idempotence is unit-tested.
- **Residual risk**: Low.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/core/AGENTS.md` → Encryption, the standing decisions on the token index, `BACKWARD_COMPATIBILITY.md` for the two exported signatures. Not reviewed in full: `packages/search/AGENTS.md`; the research read it and the implementer must.

| Rule | Status | Notes |
|---|---|---|
| Never hand-roll crypto | Compliant | HMAC through the shared encryption library; column encryption through the tenant service |
| Vector display fields encrypted at rest | Compliant | Restores the documented rule |
| Client tokenizer mirrors the server's minimum length | Compliant | Unchanged; no client hashing exists |
| One shared blocklist decision for per-field tokens and `search_text` | Compliant | Untouched |
| Changed exported signatures follow the deprecation protocol | Compliant | Wrappers for one minor |
| Integration coverage | Partly | Token paths covered; vector unit-tested for the reason given |

**Verdict:** approved for both phases, subject to assumption 1.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. Reading both hash forms with one combined count would have returned nothing for every search, so the count is now per form. The key is derived per tenant. The stored form carries a key fingerprint, so a changed secret is reported instead of silently emptying search. The "reindex completed" flag is gone: state is read from the rows, and a purge removes only rows no reindex can reach. The vector map gains the presenter column and encryption moves to the strategy. Meilisearch moved to its own spec.
