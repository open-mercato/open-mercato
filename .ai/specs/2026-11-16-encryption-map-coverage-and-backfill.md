# Encryption-map coverage and backfill

> **Program:** packages B1 and B2 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). Related: #3854, #7593, #7644; open PRs #8987, #9011.
> **Verified at** `main` @ `08dada9624` by reading every column's writers, readers and value queries; nothing was run. Two points are marked as inferred.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-10-04-encryption-map-scope-uniqueness.md

> **Coordinates with** `.ai/specs/enterprise/2026-11-12-key-rotation-data-verification.md`, which owns the rotation command, requires it to block before any write, and already plans to batch it. This spec does not change that command.

## 📝 TLDR

About thirty columns that hold personal data are stored in clear because no encryption map names them: webhook payloads sent to third parties, notification text, extracted attachment text, single-sign-on emails and names, inbound message senders, HR notes, workflow form data. Adding a map does not help an existing installation by itself. The tenant's maps are copied at tenant creation, so an older tenant never receives a field added later unless a migration adds it; about 195 of the 208 mapped fields have no such migration. And existing rows are only encrypted when an operator runs the key-rotation command without an old key, which reads a whole tenant's table into memory and, by design, refuses to start if any map cannot be resolved. **Proposed (future):** first make the path trustworthy — catch-up migrations for the maps that never had one, three guards in the test suite, and a separate row-backfill command that works in batches and reports what it skipped. Then bring the columns under maps module by module, each with its migration and its reader fixes.

**Not in this spec:** MFA secrets (PR #8987) and assistant maps (PR #9011), which are in flight; vector display fields (the search-index spec); document content, which stays in clear by design; the three names that lists search and sort in SQL, and the CRM `participants` column, which are recorded with a reason and left for a decision; the rotation command; reads that bypass decryption in general (#2115, #5447, #7048).

## 📝 Overview

> **Market reference.** Rails' Active Record Encryption migrates an existing column by declaring it encrypted with `support_unencrypted_data` on, re-saving rows in batches, then turning the option off; it documents that a deterministic key is needed for any column queried by value. Adopted: read-tolerant mixed state (which this codebase already has), batched re-encryption, a lookup hash for value queries. Rejected: its per-model switch for tolerating plaintext — here tolerance is permanent and silent, so the guard tests are what tell an author a column was missed.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Order | Catch-up migrations, guards and the row-backfill command first; columns after | Each column added before the guards repeats the defect in #7644. |
| 2 | Columns searched or sorted by value in SQL — attachment file name, staff display name, warranty customer name | Left in clear, with the reason recorded | ⚠ NEEDS HUMAN CONFIRMATION. Encrypted sort is capped or declined by the query engine, and the attachments library is a hand-written query with no search configuration, so encrypting these means rewriting one list and losing substring search and full sorting on three. That is a product decision. |
| 3 | Columns on tables with no tenant, or a nullable tenant | Not encrypted here; recorded with a reason and bounded by retention | The tenant key cannot apply to a row with no tenant. |
| 4 | Document content | Stays in clear, with its reason recorded | Server-side merge and full-text search need plaintext; the module says so. |
| 5 | The SSO subject and SCIM external id | Left in clear, with the reason recorded | ⚠ NEEDS HUMAN CONFIRMATION. They are the join key with the identity provider, unique, queried by value, and for SCIM users the two columns hold the same value. Where a provider uses an email as the subject, that email stays readable. Hashing both is the alternative and changes two unique constraints. |
| 6 | CRM interaction `participants` and `linked_entities` | Left in clear, with the reason recorded | The erasure spec finds a person inside them with a bounded query. Encrypted, that becomes decrypting every interaction in the tenant for each erased person. The two specs must change together or not at all. |
| 7 | Who runs the row backfill | The operator, per tenant, with the new command; the doctor reports mapped columns that still hold plaintext once it can read the database | A migration cannot encrypt rows: it has no tenant keys. |
| 8 | Old tenants whose maps lack fields the code already declares | Brought up to date by one catch-up migration per module | Freezing them as known exceptions would leave about 95% of mapped fields outside the guard. |

## 📝 Problem Statement

**How coverage works today**

- A module's `encryption.ts` holds defaults. A tenant's *effective* maps live in the `encryption_maps` table and are copied from the defaults at tenant creation or by `seed-encryption`. With no row for an entity, writes go out in clear, silently (`packages/shared/src/lib/encryption/tenantDataEncryptionService.ts:359-432, 619-622`).
- `buildEncryptionMapBackfillSql` adds or extends those table rows for existing tenants. It never touches data rows, and it throws for a system-scoped map (`packages/shared/src/lib/encryption/migration-backfill.ts:8-89`). Two modules use it.
- Existing data rows are encrypted only by `mercato entities rotate-encryption-key` run without an old key, or by re-saving. One command serves both rotation and backfill (`packages/core/src/modules/entities/cli.ts:552`). It reads each scope with one unbatched select, skips rows with no tenant and system-scoped maps, and — deliberately, before any write — lists every map it cannot resolve and refuses to run (`cli.ts:409-412, 428-491`). For rotation that is right: a skipped map would leave data under a key about to be retired.
- About 208 fields are declared across 25 maps. Only the `staff` and `checkout` migrations use the backfill helper.
- Inferred, not run: the vector index's map has no ORM metadata, so the command would treat it as unresolvable and refuse to run at all.
- A table with plaintext and ciphertext rows reads correctly: a value that fails to decrypt is returned as it is.
- A JSON column decrypts to a string. Only the ORM hook parses it back; query-builder and raw readers must call `parseDecryptedFieldValue`.
- `db:generate` prints a warning when a map lacks a backfill (`packages/cli/src/lib/db/encryption-backfill-check.ts:81`). It needs a connected database, is satisfied by any migration that mentions the names — which `title`, `data` or `payload` always are — and can be silenced. Nothing fails.
- The stored map rule is rebuilt as `{ field, hashField }` in five places, the admin editor included, so any other key on a rule is dropped when a tenant edits its map.
- A lookup hash is written only inside the encrypt step. With encryption off, no map row, or a row with no tenant, it stays null.
- About 236 call sites write through `nativeUpdate` or the query builder, many with a variable payload.

**The columns.** Verdicts come from reading each one's writers, readers and queries.

| Module | Columns | State |
|---|---|---|
| `webhooks` | `custom_headers`; delivery `payload`, `response_body` | Safe to map. The worker and retry route read with a plain find |
| `webhooks` | delivery `error_message` | Written with a raw update (`packages/webhooks/src/modules/webhooks/lib/delivery.ts:326-339`), which bypasses encryption |
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
| `query_index` | indexer error `payload` | Query-builder writer and reader; tenant nullable |
| `documents` | content, comments, versions | In clear by design |

## 📝 Proposed Solution

### Phase A — make the path trustworthy

1. **Catch-up migrations.** One per module whose map predates the helper. Each calls `buildEncryptionMapBackfillSql` with the module's current fields, written out as literals. For a tenant created after a field was declared it changes nothing; for an older tenant it adds the missing fields, and that tenant's new writes to them are encrypted from then on.
2. **Guard: a map needs a backfill.** A test with no database reads every module's `encryption.ts` and every migration, finds the `buildEncryptionMapBackfillSql` calls and their literal field lists, and fails when a tenant-scoped field appears in none. After step 1 it starts with no exceptions.
3. **Guard: a personal-data column needs a decision.** A test reads each module's migration snapshot and looks for columns whose name contains, as a whole word, one of: `email`, `phone`, `first_name`, `last_name`, `full_name`, `display_name`, `address`, `street`, `postal`, `ip`, `user_agent`, `birth`, `recipient`, `sender`. Each match must be in a map or in the test's data file. The data file has two kinds of entry: *reviewed*, with a reason from a fixed list, and *unreviewed*, the initial backlog, whose count the test caps so it can only shrink. The pattern finds about 120 columns. It does not find free text or JSON — `payload`, `body`, `content`, `form_data` — which reach this spec through the table above and the program's coverage specs.
4. **Guard: raw writes to a mapped table are listed.** Column-level detection is unsound when the payload is a variable, so the rule is per table: any `nativeUpdate` or query-builder insert or update against a table with a map must appear in the test's data file with the columns it writes and, where one is mapped, the explicit encrypt call it makes.
5. **Row backfill.** A new command, `mercato entities backfill-encryption`, encrypts existing rows of mapped columns in keyset batches. It skips and lists a map it cannot process, and exits non-zero when anything was skipped. The rotation command is not touched.

### Phase B — columns that are safe once mapped

One step per module. Each adds the map entries, the migration, and switches plain finds on the entity to the decrypting helpers.

### Phase C — columns that need a code change first

- `user_tasks.form_data`, push delivery `payload` and webhook delivery `error_message` get a writer that goes through encryption. Until its step, the push payload copy stays in clear.
- SSO `idp_email` and `idp_name` get hash columns that the SSO service writes itself on every write, whether or not encryption is on, so the hash is never null for a new row. SCIM filters move to the hash, with a comparison of the decrypted value afterwards. No index is dropped.
- Inbound message `sender_identifier` gets a hash column the same way.

### Recorded as not encrypted

| Column | Reason | Bounded by |
|---|---|---|
| Document content, comments, versions | Server-side merge and full-text search need plaintext | Document access control |
| Attachment `file_name`, staff `display_name`, warranty `customer_name` | Searched and sorted in SQL; assumption 2 | — |
| SSO `idp_subject`, `external_id` | Provider join key; assumption 5 | — |
| Interaction `participants`, `linked_entities` | Queried by the erasure run; assumption 6 | Erasure |
| Forms access audit `ip`, `ua` | No tenant column | Retention |
| Indexer error `payload` | Nullable tenant; diagnostic | Retention (30 days in the pruner spec) |
| Rows with no tenant in `attachments` and `sso_identities` | No tenant key applies | — |
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

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Encrypt rows inside the migration | Migrations have no access to tenant keys. |
| Map everything in one change | Thirty columns, fourteen modules, each with its own readers. |
| Add a tenant column to the forms audit and the indexer log | A schema and writer change for two diagnostic tables that retention already bounds. |
| Encrypt the SQL-searched names now | See assumption 2. |
| Make the rotation command skip and continue | It would report success while leaving a map's data under the old key. |
| Freeze existing maps as exceptions to the backfill guard | About 195 fields; the guard would cover almost nothing. |
| A case-preserving hash selected on the map rule | Needed only for the SSO subject, which stays in clear; and the rule cannot carry it. |

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
- WHEN a SCIM client filters users by email after the upgrade
- THEN the user is found, whether or not encryption is on for the tenant

Frozen by: `packages/webhooks/src/modules/webhooks/__tests__/delivery-storage.characterization.test.ts`, `packages/enterprise/src/modules/sso/__tests__/identity-lookup.characterization.test.ts`

#### ADDED Requirement: Coverage guards
The system's test suite SHALL fail when an encryption map ships without a backfill, when a column with a personal-data name has neither a map nor an entry in the reviewed list, or when a table with a map gains an unlisted raw write.

##### Scenario: New map without backfill
- WHEN a module adds a field to its map and no migration backfills it
- THEN the suite fails and names the field

#### ADDED Requirement: Row backfill
The system SHALL provide a command that encrypts existing rows of mapped columns in bounded batches, continues past a map it cannot process, and reports what it skipped.

##### Scenario: Unresolvable map
- WHEN one map cannot be resolved to a table
- THEN the other maps are processed, the skipped one is listed, and the command exits non-zero

##### Scenario: Rotation is unchanged
- WHEN the rotation command meets a map it cannot resolve
- THEN it still refuses to start

Frozen by: `packages/core/src/modules/entities/__tests__/cli-rotate-encryption-key.characterization.test.ts`

## 📝 Architecture

- **Guards** in `packages/core/src/__tests__/`, beside the optimistic-lock coverage test: `encryption-map-backfill-coverage.test.ts`, `personal-data-column-coverage.test.ts`, `mapped-column-writer-coverage.test.ts`, each with a data file for its reviewed list.
- **Row backfill**: a new command in `packages/core/src/modules/entities/cli.ts`, sharing the scope resolution of the rotation command and none of its abort rule.
- **Backfill parsing**: the guard reads migration source for the helper's calls; it does not import the check in `packages/cli`, which core does not depend on.
- **Per module**: `encryption.ts`, one migration, reader changes, and where needed an entity column for a hash.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Module → encryption | Its own map and the shared helpers | Encryption off: columns stay plaintext |
| Guards → modules | File globbing in tests; no runtime coupling | — |
| Enterprise modules | Same pattern, separate PRs | — |

## 📝 Data Models

Additive columns and indexes, each with its migration and module snapshot:

| Table | Change |
|---|---|
| `external_messages` | `sender_identifier_hash`, indexed with the tenant |
| `sso_identities` | `idp_email_hash`, `idp_name_hash`, each indexed with the configuration |

No index or constraint is removed. `encryption_maps` rows are added or extended for every existing scope by the migrations.

## 📝 API Contracts

- **No route changes shape.** Responses carry the same values.
- **`mercato entities backfill-encryption --tenant <id> [--entity <id>] [--batch-size <n>] [--dry-run]`** — new. Exit 0 when every map was processed, non-zero when one was skipped.
- **No change** to the map rule type, to the shared hash helpers, or to `rotate-encryption-key`.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Tenant with encryption off | Maps are added; values stay plaintext |
| Row with no tenant | Stays plaintext; listed |
| Reader not yet moved to the decrypting helper | Caught by the step's tests; the mixed-state tolerance means plaintext rows still read |
| JSON column read through a query builder | Must parse the decrypted string; each such reader is fixed in its module's step |
| Backfill interrupted | Batches are independent; a re-run skips rows that are already ciphertext |
| SSO identity created before the hash columns existed | A data migration cannot fill the hash for an encrypted value; the SSO module's own one-off command fills it, and until then the SCIM filter also compares rows whose hash is null |
| Large extracted text | Encrypted like any string; no size cap exists in the pipeline |
| An older tenant after the catch-up migration | New writes to the added fields are encrypted; old rows stay plaintext and readable until the row backfill runs |
| A tenant that removed a field from its map on purpose | The catch-up migration adds it back. The upgrade note says so and names the admin page where it can be removed again |
| Webhook retry of a delivery stored before the upgrade | Reads plaintext; unchanged |

## 📝 Migration & Backward Compatibility

| Change | Class |
|---|---|
| Columns stored as ciphertext | Storage only; no API change |
| Catch-up migrations | Older tenants start encrypting fields their module already declares. Storage only; called out in the upgrade note |
| New hash columns and indexes | Additive schema |
| New row-backfill command | Additive |

`UPGRADE_NOTES.md`, per phase: which columns are now mapped; the row-backfill command to run per tenant and how long it may take; that rows stay readable in the meantime; that a field a tenant removed from its map is added back.

## 📋 Phasing

| Phase | Outcome | Shippable alone |
|---|---|---|
| A | Catch-up migrations, three guards, row-backfill command | Yes |
| B | Safe columns, one module per PR | Yes, each |
| C | Columns needing a writer or lookup change | Yes, each |

## 📋 Implementation Plan

### Phase A
1. **Characterize** the rotation command's refusal on an unresolvable map, so the new command cannot weaken it by accident. Commit alone.
2. Catch-up migrations, one PR per package, each with its module snapshot untouched and a unit test that the literal list equals the module's map.
3. The backfill guard, parsing the helper's calls. It must pass with no exception list.
4. The personal-data column guard with its pattern and data file; the initial unreviewed count is recorded here when the step runs.
5. The raw-write guard with its data file.
6. The row-backfill command: keyset batches, skip and report, dry run, exit code. Unit tests; one database-backed test that seeds plaintext rows. Confirm or refute the inferred vector-map refusal and record the result here.

### Phase B — one step per module
`webhooks` (all but the error message), `notifications`, `attachments` (content), `communication_channels`, `checkout`, `staff` (all but display name), `workflows` (all but form data), `integrations`, `customers` (loss notes, location), `shipping_carriers`, enterprise `record_locks`. Each step: characterize storage where the Delta names a test; add map entries; add the migration with literal names; move plain finds to the decrypting helpers; fix any query-builder reader of a JSON column; one integration test.

### Phase C
1. `workflows`: write `form_data` through the entity; then map it.
2. `push_notifications`: encrypt the payload explicitly in the insert path, listed in the raw-write guard; then map it.
3. `webhooks`: the same for the delivery error message.
4. `communication_channels`: the sender hash, written by the module; then map `sender_identifier`.
5. Enterprise `sso`: the two hash columns written by the service on every write; the one-off command for existing rows; SCIM filters by hash with the null-hash fallback; then map `idp_email`, `idp_name`, `idp_groups`.
6. Archive this Delta into `.ai/specs/capabilities/field-encryption-coverage.md` if that directory has been adopted by then.

### File manifest

| File | Action |
|---|---|
| `packages/core/src/__tests__/{encryption-map-backfill-coverage,personal-data-column-coverage,mapped-table-raw-write-coverage}.test.ts` and their data files | Create |
| One catch-up migration in each module whose map has none | Create |
| `packages/core/src/modules/entities/cli.ts` and a backfill service | Modify / create |
| For each module in Phases B and C: `encryption.ts`, a migration and snapshot, readers, tests | Create / modify |
| `packages/enterprise/src/modules/{sso,record_locks}/…` | Create / modify — separate PRs |
| `<module>/__integration__/TC-*-ENCRYPTION-*.spec.ts`, one per module | Create |
| `UPGRADE_NOTES.md`, `apps/docs/docs/user-guide/encryption.mdx` | Modify |

## 🧪 Integration Coverage

The integration app runs with tenant encryption on, so each module's test creates a record through the API, reads the stored column with a direct query, and asserts two things: the stored value is not the plaintext, and the API returns the plaintext. Each test removes what it creates.

| Module | Path exercised |
|---|---|
| `webhooks` | Create a webhook with a custom header; trigger a delivery; deliveries list and retry |
| `notifications` | Create a notification; the bell list |
| `attachments` | Upload a text file; the library list |
| `communication_channels` | Ingest an inbound message; the conversation view |
| `staff` | Team member with an address and a comment |
| `workflows` | Start an instance; complete a user task with form data |
| `customers` | An interaction with a location; a lost deal with notes |
| enterprise `sso` | Sign in through the test identity provider twice; SCIM filter by email and by name |

The guards and the row backfill are unit-tested; the backfill also has one database-backed test that seeds plaintext rows.

## 📝 Risks & Impact Review

#### A reader returns ciphertext to a user
- **Scenario**: A plain find or query-builder reader was missed when its column was mapped.
- **Severity**: High
- **Affected area**: any list or detail view of a mapped entity
- **Mitigation**: Readers move in the same step; one integration test per module asserts the API value; the mixed-state tolerance keeps plaintext rows readable.
- **Residual risk**: The identity-map behaviour in #5447, which the decrypting helpers avoid and plain finds do not.

#### SCIM filtering breaks
- **Scenario**: The filter moves to a hash while some identities have none.
- **Severity**: High
- **Affected area**: enterprise provisioning
- **Mitigation**: The service writes the hash on every write regardless of encryption; rows with a null hash are still compared; a characterization test first. Login by subject is not touched.
- **Residual risk**: The null-hash fallback must be removed once the one-off command has run everywhere.

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
- **Mitigation**: The upgrade note; a later doctor check.
- **Residual risk**: Undetected until that check exists.

#### The row backfill overloads the database
- **Scenario**: Encrypting millions of delivery payloads.
- **Severity**: Medium
- **Affected area**: upgrade operations
- **Mitigation**: Keyset batches with a configurable size; resumable; run per tenant.
- **Residual risk**: Hours of runtime on large tables.

#### The guards give false comfort
- **Scenario**: A personal-data column has a name the pattern does not match, or is free text.
- **Severity**: Medium
- **Affected area**: future modules
- **Mitigation**: The limit is stated; the privacy coverage check classifies whole tables and is the second net.
- **Residual risk**: A free-text column in a table already classified.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/core/AGENTS.md` → Encryption, `BACKWARD_COMPATIBILITY.md` §8 and §13. Not reviewed: each module's guide; each module step reads its own.

| Rule | Status | Notes |
|---|---|---|
| Declare sensitive columns in `encryption.ts` with a backfill migration | Compliant | The subject of the spec, and now enforced by a test |
| Read through the decrypting helpers | Compliant | Per-module step |
| Never hand-roll crypto | Compliant | Existing service and one new hash in the shared library |
| Additive-only schema | Compliant | New columns and indexes only; nothing removed |
| Ask before touching multiple modules | Needs approval | Fourteen modules |
| No enterprise-only scope in the OSS directory | Compliant | Two enterprise modules are rows in a shared plan and ship separately |
| Integration coverage | Compliant | One test per module |

**Verdict:** approved for Phase A. Phases B and C follow module by module. The columns left in clear under assumptions 2, 5 and 6 wait for a person's answer.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. The rotation command is left alone and a separate backfill command added, because rotation must refuse on any unresolvable map. Maps that never had a backfill get catch-up migrations instead of an exception list. The three guards are defined: parsed helper calls, a stated column-name pattern with a capped backlog, and a per-table list of raw writes. The SSO subject, the SCIM external id, CRM participants and the three SQL-searched names stay in clear with recorded reasons; no unique index is moved; the case-preserving hash and the map-rule option are dropped. Hash columns are written by the owning module, not by the encrypt step.
