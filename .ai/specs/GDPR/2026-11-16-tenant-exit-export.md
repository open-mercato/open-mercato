# Tenant exit export

> **Program:** package C8 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (open-mercato/open-mercato#8593).
> **Builds on:** the contract's `privacy.ts` convention, the doctor-created `privacy` module, and the snapshot reader of [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md). C5 must ship before C8, alongside the contract.
> **Reader ownership:** program DEC-9 selects module-owned DI readers using the shared DEC-G helper. No generic cross-module reader is built.
> **Code baseline:** `main` @ `08dada9624`, checked by reading. No implementation or integration tests were run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/GDPR/2026-11-16-privacy-data-class-contract.md

## 📝 TLDR

When a customer leaves, the operator must return their data. Today this means module-specific SQL, tenant attribution and decryption. **Proposed (future):** one command writes decrypted NDJSON files and attachment bytes for a tenant, with a manifest of exclusions, omissions and gaps. Module owners declare scope and redaction. A complete result excludes lookup hashes and every credential a declaration or name guard identifies, and contains no other tenant's rows.

**Not in this spec:** import, backup, deleting the tenant, a subject export, or a tenant-facing screen.

## 📝 Overview

The output is a handover, not a restorable backup. One file per table and a versioned manifest keep the format inspectable. No archive writer or production dependency is added. The operator encrypts the directory before transferring it, under the deployment procedure.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Generic reader or one handler per module | Module-owned readers through DI, using the shared helper and `PrivacyTableReader` in both modes (program DEC-9) | Decided by DEC-9. Each owning module reads only its own tables, so the no-cross-module-table-access rule holds with no exception. The cost is one registration per module, which the C5 census enumerates; the registrations land before C8 and G6. No generic reader is built. |
| 2 | What decides exclusions | A separate `tableExports` member on `privacy.ts`, keyed by table, plus `runtimeTables` for tables code creates at runtime | DEC-G owns this separation. JSON columns require reviewed decisions; lookup hashes and name-guarded secrets cannot silently export. Text columns of tables classified `credential` or `tenant_configuration` need a per-column decision. Other unremarkable scalar columns may export by default, so a secret stored under an innocuous name elsewhere remains a declared residual risk. |
| 3 | Tenant-less and nullable-tenant tables | Explicit attribution; unknown ownership is a gap that refuses by default | Guessing can leak other tenants' records. Only reviewed global tables and the CLI's migration bookkeeping tables are not applicable. |
| 4 | Output | Owner-only directory, no archive or encryption in the command | Decided: `0700` directories and `0600` files, created exclusively regardless of umask. The handover stays inspectable and the command adds no archive writer, key handling or dependency; the operator encrypts the directory before transfer under the deployment procedure. Weaker permissions are never accepted. |
| 5 | Undecryptable values | Fail, unless `--allow-undecryptable` writes null and records a gap | Never hand back ciphertext as readable data. |
| 6 | Consistency | Repeatable-read, read-only database snapshot; capture attachment references inside it | File bytes cannot share a database snapshot. Copy only captured objects and report missing or size-changed objects. |
| 7 | Derived stores | Exclude search indexes, queues and caches from handover | They can be rebuilt; scan mode still checks reachable stores through their owners. |
| 8 | Edition | OSS | Decided by program DEC-2. The readers live in the OSS modules that own the data, and every deployment must be able to return a leaving tenant's data. |
| 9 | Partial table selection | No `--tables` in this first version | Unsupported use is exit 1. Explicit file omission uses `--skip-attachments`, an incomplete result with exit 2. |
| 10 | Suppression-state portability | R4-9 redacts both `forms_invitation_suppressions.recipient_hash` and `key_id` as `key_material`, exports the remaining metadata and records the row count | Binding decision: no SUPPRESSION-EXPORT reviewed-checksum exception or suppression handover in this version. A receiving system cannot rebuild opt-outs from the artifact. |
| 11 | Tenant-export evidence age | Default 365 days after terminal completion, floor 30, through the dedicated expiry below | Decided: the program's evidence lifetime, as action-log-retention assumption 9 and C1's EVIDENCE-AGE. It is an accountability choice, not a statutory period. Active holds and unresolved publication/reconciliation preserve the evidence. Under R4-3 every `privacy.tenant_export` entry carries the exported tenant, so tenant-scoped runs reach all of it, including evidence about a soft-deleted tenant (**Evidence about a soft-deleted tenant** below). |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| A generic cross-module tenant reader (assumption 1) | Rejected (DEC-9): it needs an architecture exception to the no-cross-module-table-access rule; module-owned readers need none. |
| An archive or encrypted bundle written by the command (assumption 4) | It adds an archive writer or key handling to the command and hides the inspectable format; the operator's transfer encryption already protects transport. |
| Enterprise-only placement (assumption 8) | Rejected (DEC-2): enterprise code would have to read OSS core tables directly, and a tenant's handover would become paid-only. |

## 📝 Problem Statement

- No tenant-wide handover command exists in today's CLI. A whole-database backup cannot isolate a tenant or decrypt its fields for a recipient.
- Migration snapshots contain tenant-less tables: auth `sessions`, `password_resets` and `user_roles` reach a tenant through a user; `customer_deal_people` through a deal; legacy forms tables such as `forms_form_attachment` and `forms_encryption_key` use organization ownership; `feature_toggles` is global.
- Other tables allow null `tenant_id`, including `users`, `attachments`, `action_logs`, `api_keys`, `module_configs` and `scheduled_jobs`. Null is not a tenant predicate.
- Loaded ORM metadata omits disabled modules, whose physical tables and old tenant records may remain.
- `decryptEntityPayload` in `packages/shared/src/lib/encryption/tenantDataEncryptionService.ts` returns input unchanged when encryption is disabled, no mapped fields exist or no DEK is available. Ciphertext must be detected after reading. Use its `options.em` for the snapshot manager; resolve system-scoped maps through the existing service.
- JSON needs `parseDecryptedFieldValue`. Custom fields use `decryptCustomFieldValue` in `packages/shared/src/lib/encryption/customFieldValues.ts`; forms owns its own encrypted-table reader. Column-name patterns cannot see a token inside provider-state JSON.
- `StorageDriver` in `attachments/lib/drivers/types.ts` has `read` and `toLocalPath`, but no object-listing operation. `sanitizeUploadedFileName` in `attachments/lib/security.ts` produces safe file-name components; stored client names must never be paths.
- `privacy.ts`, its shared collectors and owner readers are future work. R3-2, “The registry carries the whole `privacy.ts` default export”, in the contract spec, Export shape, owns the generated `module.privacy` object. This spec adds no second generator change.

## 📝 Proposed Solution

### The command

`mercato privacy export-tenant --tenant <id> --out <directory> --reference <text> [--skip-attachments] [--allow-missing-attachments] [--allow-undecryptable] [--allow-unexported-tables] [--dry-run]`

1. Validate arguments with zod and load the enabled declarations. Any schema inventory before the audit is advisory only and cannot decide inclusion, absence or emptiness. The authoritative catalogue inventory in step 3 covers ordinary and partitioned base tables in the connection's application schema, excluding PostgreSQL and extension catalogs, views and foreign tables; a partition is inventoried under its parent. Join them to installed canonical migration snapshots and declared `runtimeTables`, not loaded metadata alone. Load enabled declarations with `getTableExports` and `getRuntimeTables` under R3-2. The CLI's per-module migration bookkeeping tables, `mikro_orm_migrations_<sanitized module id>` (`packages/cli/src/lib/db/commands.ts`), are classified by the orchestrator's single built-in internal rule: it accepts exactly that name pattern, checks in the live catalogue that the table has neither `tenant_id` nor `organization_id`, and records it `not_applicable` with reason `migration_bookkeeping`. Any other table no declaration claims is unknown. Include disabled and unknown tables and snapshot tables absent from the database. Every catalogue table gets a plan status; absence of a loaded module is never evidence of absence of data. For a table with no loaded owner, only the audited snapshot may test whether the table holds any row at all (`EXISTS`, no column read, no tenant predicate): an entirely empty table is `empty`; otherwise it is a gap with count null, because no owner can attribute its rows.
2. Write a `started` entry with `actionLogService.log` before reading any tenant row, including counts. An absent audit service or failed write refuses in every environment. Record the actor, tenant, reference and the requested all-application-tables scope, with any preliminary table list explicitly labelled advisory. Record no data.
3. Before establishing its snapshot, acquire a shared application-schema advisory lock on the same dedicated connection. The CLI migration and runtime table/partition creation, alteration and removal paths take the corresponding exclusive lock before DDL. Use a stable key derived from the current database and application schema, shared by the audit/export, migration and runtime DDL callers. Use a bounded acquire attempt, and release only after snapshot close in `finally` on that same connection. Session loss releases the lock and aborts the read. Treat unsupported direct SQL DDL, role configuration or privileged activity outside this protocol as an explicit deployment limitation. The readiness check for a complete export verifies that the required registered DDL paths participate and that the schema is protected by the documented exclusive ownership/maintenance policy; unknown protection refuses completeness. Do not treat a successful lock acquire alone as proof. The installation must restrict application-schema DDL to those fenced paths during a complete export; when that protection cannot be established or any catalogue, relation, partition or column mismatch is observed, refuse or record a named `schema_unstable` gap under `--allow-unexported-tables`. Never claim completeness from an unfenced schema. Open one repeatable-read, read-only transaction on that connection. Its first query inventories the application schema under step 1. Its catalogue, absent decisions, whole-table `EXISTS` probes on unknown/disabled tables, scoped counts and row reads all use the same snapshot. Then resolve the tenant through the directory reader's `count` for the scope-root `tenants` table, which includes a soft-deleted tenant: no row refuses with `TENANT_NOT_FOUND`, appends a refused audit outcome and exits 1, so an unknown UUID never yields an empty handover. Then count planned tenant rows through each owner reader's `count`, with the same attribution used for export: tenant predicate, `via`, organization membership and `nullTenant`. Counting reads no column values and decrypts nothing. Do not issue unscoped content queries. An unknown or disabled relation is empty only when the snapshot-wide probe proves it has no row. Otherwise it has count null and refuses with `ownership_unknown` or `module_disabled`, respectively. `--allow-unexported-tables` acknowledges these named gaps; it does not enable reading unscoped rows. A table proven empty for the tenant is recorded as empty. Absent physical tables are recorded as absent.
4. For a real export, prepare `--out`. Create it with `0700`, or accept an existing empty directory only when owned by the effective user with no group/other permissions. Refuse a symlink, unsafe owner/mode or non-empty root. Children use `0700`. Every table file, attachment and manifest uses `0600`, `O_EXCL` and no-follow creation regardless of umask. Verify parents without following links and refuse replacement links; every resolved path stays under the verified root. Catalogue table names are encoded as safe single path components.
5. Read rows in keyset batches, decrypt, check for residual ciphertext, apply redaction, and append NDJSON. Capture exactly the attachment ids and storage references from rows read inside this snapshot, through the attachments owner. Never list attachments again after the snapshot. Append each captured reference (id, tenant/organization, partition, storage path, original name and expected size) to an owner-only `0600` staging file, created exclusively and without following links under the verified root but outside the published layout, so memory stays bounded by one batch.
6. Close the read snapshot after all row reads and attachment-reference capture, then stream the staging file and copy only captured attachments through the owner service. Remove the staging file after the last copy; handled failure removes it with the other partial output, and it never appears in the manifest. Use `attachments/<uuid>/<safe name>` with a validated UUID and `sanitizeUploadedFileName`, never the original name as a path. The writer owns the exclusive destination descriptor; the service streams the driver's `toLocalPath` source into it and releases its cleanup callback. Check captured tenant/organization and expected size. Later additions are not copied. A removed or size-changed object is missing/inconsistent and fails unless explicitly allowed, then is a manifest gap. `StorageDriver` (`attachments/lib/drivers/types.ts`) exposes no etag or version and the attachments table has no checksum, so a same-size replacement is undetected; a driver that later exposes a version is compared too. Byte equality at the database snapshot cannot be guaranteed without storage versioning.
7. Encode the final validated manifest in a private `0600` exclusive no-follow staging file in the verified output root. Flush and fsync each artifact file and its containing directories and the staging file. Append the completed outcome through the audit owner’s separate writable transaction with the started entry’s id as its lifecycle correlation, `publicationStatus: 'pending'` and the SHA-256 of the exact staged manifest encoding. A failed completion writes no final manifest and triggers cleanup. Publish the staged bytes atomically as `manifest.json` in the same directory using a no-replace hard link or an equivalent supported no-replace primitive, then unlink the staging name and fsync the root and, when it was newly created, its containing parent before acknowledging `published`. Fail closed when safe publication or durability is unavailable. A crash before publication can only expose a staging name. A failed acknowledgement preserves the private artifact and leaves unresolved evidence. Only a durable artifact with an acknowledged publication can exit 0 for a complete export or 2 for allowed gaps.

`--dry-run` performs steps 1–3, then closes the read snapshot and appends the completed audit outcome on the separate writable audit service with counts, `dryRun: true` and `publicationStatus: 'not_required'`. Counting is an explicit read step in the snapshot, using the same reader predicates. It opens no output directory or data file. For an unchanged database, its counts equal the export's row counts. Failed audit completion is exit 1; allowed inventory gaps produce exit 2.

`--tables` is unsupported and exits 1 before reading. `--skip-attachments` retains table rows but records omitted file ids, `complete: false` and exit 2, even if the snapshot has no files. Allowed missing attachments, undecryptable values and unexported tables likewise make the result incomplete. Derived, authentication, runtime-state and global exclusions, and internal migration bookkeeping, are expected exclusions, not omissions; the manifest lists each with its reason.

On handled failure before manifest publication, remove only files and directories this run created; preserve a pre-existing empty root. If cleanup fails, print the remaining path and tell the operator to delete the decrypted partial output. Unhandled crashes can leave an owner-only partial directory. The docs require deleting it; a directory without a manifest is incomplete. A crash after manifest publication still has a completed audit entry, but evidence remains unresolved until its publication acknowledgement or explicit reconciliation. Once the atomic publication may have happened, preserve the artifact and route ambiguous outcomes to reconciliation.

### Declarations

DEC-G, “The tenant-export reader and its declarations”, puts `tableExports` beside the coverage `tables` map in the default export. A table can have an export declaration whether coverage puts it in a class, in the coverage map or on the baseline. An export declaration never counts as coverage.

| Member | Meaning |
|---|---|
| absent | No reader can exist, so the table is a named `reader_unavailable` gap: export refuses unless `--allow-unexported-tables` acknowledges it, then `complete: false`, exit 2. Absence never authorizes generic reads |
| `exclude` | Never export the table; reason `authentication`, `runtime_state`, `derived` or `global`. `global` also requires a one-line `rationale`, equal to C5's reviewed-list reason (R5-8) |
| `redact` | Write named columns as null; an array of `{ columns, reason }` groups with disjoint columns, reason `credential`, `token`, `key_material` or `may_embed_secrets`, so one table can redact a password as `credential` and a lookup hash as `key_material` |
| `via` | Scope through a parent and explicit joining columns; the parent needs a valid scope plan, even if excluded from output |
| `nullTenant` | `global` omits null-tenant rows; `shared` exports reviewed non-personal definitions separately; `organization` or a declared `via` attributes rows through their owner |
| `reader` | DI key resolving to the owning module's `PrivacyTableReader`, required for every non-global table. The key must begin with the declaring module id in camel case (for example `customersPrivacyTableReader`, `queryIndexPrivacyScanReader`); export-plan validation rejects any other key as a `reader_unavailable` gap for that table before resolving it |
| `scanReader` | Same owner, type and module-prefix rule, used instead of `reader` for special scan decryption; ignored by export |
| `reviewedChecksums` | Explicit scalar checksum column/rationale exceptions only; never mapped/module-written lookup hashes or identifier-purpose digests |
| `reviewedScalars` | Column/rationale decisions that a scalar grants no access: required for every text column of a table classified `credential` or `tenant_configuration` that is not redacted, and the only way to export a column caught by the extended name tokens below; never accepted for the original secret and hash names, nor for a `token` name except a numeric unit count under the secret-name guard below |
| `json` | Per-JSON-column reviewed decision, `export` with rationale or `redact` with reason and rationale |

`entities` supplies readers for custom fields and custom-entity records; `forms` for its encrypted tables. `audit_logs` redacts change-history snapshots and replay input as `may_embed_secrets`. `auth` excludes `sessions` and `password_resets` as `authentication`, but still declares their `via` joins through `users`; `users` redacts `password_hash` as `credential` and `email_hash` as `key_material` in two groups. `directory` declares `tenants`, the scope-root table, with a scoped reader that filters `id = tenantId`; it is never `global`. The same requirement applies to tenant-less portal sessions/reset/verification tables and message-access tokens: each owner supplies attribution, not a scan waiver.

All lookup hashes redact as `key_material`, including mapped `hashField` siblings and module-written address hashes. They never enter a reviewed-safe list. Reviewed-safe scalar checksums use `reviewedChecksums`, with a column and rationale. Validation refuses a mapped lookup `hashField` or module-declared lookup column in that list. A coverage entry classified `credential` must be excluded or redacted in `tableExports`, as coverage-helper rule 6 requires.

**Forms suppression metadata.** R4-9 — “Suppression state in a tenant export”: The forms-owned `tableExports.forms_invitation_suppressions` entry SHALL use its registered reader and `redact: [{ columns: ['recipient_hash', 'key_id'], reason: 'key_material' }]`. Scoped `id`, `tenant_id`, `organization_id`, `source`, `created_at` and `updated_at` export under normal scalar guards. Both redacted columns are null; the manifest names both columns, their `key_material` reason and the row count. No raw address is exported. Neither the purpose-bound recipient digest nor its fixed key-check identifier qualifies for `reviewedChecksums`; R4-9 removes the SUPPRESSION-EXPORT exception and its full-state fallback. There is no suppression handover in this version: a receiving system cannot rebuild opt-outs, even with the original suppression key. Table coverage, content-ai and unsubscribe cite this export contract; their previous key-id export text is superseded by R4-9. Suppression digests use the forms purpose key and remain outside B1 Phase D / R3-12. Subject erasure keeps this objection state under the unsubscribe spec's assumption 8; its indefinite, unmatched retention remains a declared limit.

R3-12 — “Fill commands for module-written hashes” and DEC-F — “The B1 hand-offs” belong to the encryption-map spec's “Phase D — Lookup hashes and system-scope rotation”. In particular, `mercato customers fill-lookup-hashes` is introduced there; it does not exist in today's code. This export neither invokes it nor treats purpose-bound suppression digests as its lookup columns.

`nullTenant: 'shared'` is permitted only when the coverage entry is `none` or `tenant_configuration` and no data class lists the table. Review must establish that null-tenant rows are non-personal shared definitions. Choosing the flag cannot make `users`, `action_logs`, `api_keys` or `user_consents` shared. The export guard and C5 failure rule 7 enforce this restriction beside credential rule 6.

**Runtime tables.** Some tables are created by code at runtime and have no canonical snapshot, so C5 rule 2 cannot accept a `tableExports` key for them. Their owner declares them in the separate `runtimeTables` member: the default table name, the exact columns its DDL creates and a `TableExportEntry`. C5 rule 13 validates them statically; runtime plan validation compares the declared columns with the live catalogue, and a mismatch is the named `schema_unstable` plan gap. Search declares `vector_search` (`tenant_id` not null, `organization_id`, `presenter`/`links`/`payload` JSON and result text columns) as `exclude: { reason: 'derived' }` with a scoped owner reader and `scanReader`, so scan still reaches it, and `vector_search_migrations` (`id`, `applied_at`) as `exclude: { reason: 'global', rationale }` (`packages/search/src/vector/drivers/pgvector/index.ts`). A deployment that configures a non-default pgvector table name has an unknown table, a named gap, until it uses the default name. Migration bookkeeping tables are classified by the built-in rule in step 1, never declared by a module.

### The declaration guards

Per-package tests reuse C5's snapshot reader. Runtime export-plan validation enforces the same rules.

- R5-8 accepts `exclude: { reason: 'global', rationale }` only when the module's canonical migration snapshot (or, for a runtime table, its declared columns) has neither `tenant_id` nor `organization_id`, the table is not the scope-root `tenants`, and the table appears on C5's test-reviewed list with a one-line reason equal to `rationale`. Runtime plan validation checks the snapshot columns and a non-empty single-line rationale; the static test also checks list membership and equality. Otherwise validation fails, naming the table; the exclusion cannot waive export attribution or scanning. Consume this check through C5's failure rule 10 alongside the other declaration guards.
- Every non-global table needs a `tableExports` (or `runtimeTables`) entry with an owner-registered `reader`; tenant-less tables, including excluded ones, additionally need explicit owner attribution through `via` or that scoped reader. `scanReader` alone does not establish attribution. One rule covers every phase: at runtime a table with no entry, or an entry whose reader is not registered, is a named `reader_unavailable` gap that refuses unless `--allow-unexported-tables` acknowledges it, never a generic read. The static guard (C5) applies to declared entries, so tables awaiting their owner's registration fail nothing before “Reader delivery” closes them.
- Every nullable-tenant table has `nullTenant`; `shared` satisfies the non-personal coverage rule above.
- Every column whose name contains `password`, `secret`, `token`, `credential`, `private_key`, `hash`, `otp`, `wrapped` or `signature` is redacted, in a wholly excluded table, or a reviewed-safe scalar checksum. Lookup hashes and identifier-purpose digests must redact or belong to an excluded table; they cannot be safe-listed. One exception keeps usage counts: a column whose name contains `token` and none of the other names above, and whose type is `smallint`, `integer`, `bigint` or `numeric` in its module's canonical migration snapshot and in the live catalogue, may instead be listed by name in `reviewedScalars` as a unit count, such as `ai_token_usage_events.input_tokens` or `inbox_proposals.llm_tokens_used`. A text, `varchar`, `uuid` or JSON `token` column, such as `attachment_quota_reservations.lease_token`, and a runtime-table column never qualify.
- Every column whose name contains the token `session` or `nonce`, or the phrase `api_key`, `access_key`, `verification_code`, `reset_code`, `invite_code`, `invitation_code`, `recovery_code` or `auth_code`, is redacted, in a wholly excluded table, or listed in `reviewedScalars` with why it grants no access. This catches provider capabilities such as `carts.checkout_session_id`, `gateway_transactions.provider_session_id` and `api_keys.opencode_session_id`.
- In a table that C5 classifies `credential` or `tenant_configuration`, every text column is redacted, in a wholly excluded table, or listed in `reviewedScalars`; an innocuous name never exports by default there.
- Every JSON/jsonb column has a reviewed `json` decision or belongs to a wholly excluded table. This includes provider state and module configs, even when keys look harmless. Mixed configuration/secret JSON defaults to whole-column redaction; no recursive key-name guessing. An explicit JSON export must also pass the secret-name guard; contradictory decisions fail.

An entry for a table absent from its module's snapshots fails C5 failure rule 2, and a `runtimeTables` entry follows rule 13 instead; rule 3 validates referenced classes, seams, sets and entities. A whole-table exclusion satisfies column guards, so `sessions.token` needs no redundant redaction, but it still needs tenant attribution for scanning. Reviewed-safe scalar checksum entries record a rationale and exact column; a recipient digest cannot enter that list.

### The reader and scan mode

DEC-G requires `mode: 'export' | 'scan'`. Export applies redaction. Scan ignores `exclude` and `redact`, decrypts in memory and writes no values. It keeps identical tenant/organization and null-tenant attribution.

`exclude: global`, only after R5-8's snapshot and reviewed-list checks above pass, and step 1's built-in migration bookkeeping rule are the only table-level `not_applicable` statuses. For a global table: do not read the table; include its validated declaration, snapshot column check and reviewed reason in the result. An invalid global declaration fails validation, never producing `not_applicable`. Other excluded tenant-less tables require a scoped join or reader. Missing attribution, missing/throwing readers and unreadable columns are `not_scanned`, with a reason, and scanning continues. Ciphertext is a column gap, never a clean read or a substituted null. Each owner reader's `count` also reports tenant-less rows whose attribution parent is missing as `orphaned`, without exposing their contents; globally ambiguous orphans are reported as not scanned rather than silently omitted by an inner join. Disabled/unknown physical tables remain inventory entries: any row in them produces a named scan gap with count null, because no loaded owner can attribute it; only an entirely empty table is recorded as empty.

`query_index` registers both an attribution `reader` for counts and a `scanReader` for `entity_indexes` on `tableExports`, using the same exact tenant/organization binding. Scan decrypts `doc` through `decryptIndexDocForSearch` in `packages/shared/src/lib/encryption/indexDoc.ts` using the row’s entity type. The export uses the owner’s scoped counts and always excludes the row values as `derived`. The default composition’s derived-table decision must remain a complete export, including when the tenant owns index rows.

Under program DEC-9, each owning module SHALL register its readers in DI and call the shared DEC-G helper only for its own allowlisted tables, with the same transaction, tenant checks and gap events in both modes. `privacy` orchestrates readers and never issues their content/count queries; its only direct table access is step 3's audited snapshot whole-table `EXISTS` probe on a table with no loaded owner, which reads no column and attributes nothing. A `via` parent in another module is reached through that parent's owning reader/service, including when excluded from output; it is never permission for a foreign-table join. Missing owner registration or parent scope capability is a gap. No generic fallback runs on a missing reader.

**Reader delivery.** Readers ship with the carrier that owns each module, never in one slice. Phase 2 delivers the shared helper, the orchestrator and readers for the modules whose C5 closure carrier is C1/C4, a shared-store seam or a C5 classification pass: `auth`, `customers`, `customer_accounts`, `directory`, `attachments`, `audit_logs`, `entities`, `forms`, `configs`, the `query_index` scan reader, search's runtime tables, the operational-pruner modules `scheduler` and `webhooks`, every module marked “C5 final inventory pass” and the two app example modules. Each domain coverage carrier (commerce, communication, content-ai, people-ops) registers its modules' readers in its own phase with its owner tests. Enterprise readers ship in the Enterprise package with Enterprise tests, never imported by OSS tests. Until a module's readers ship, its tables are named `reader_unavailable` gaps, so a complete handover (exit 0) needs readers for every enabled module. G6's closure needs the same full set.

## 📝 Delta

### Capability: tenant-exit-export

#### ADDED Requirement: Scoped, explicit handover
The system SHALL export one tenant's readable data without another tenant's rows, without lookup hashes, and without credentials identified by a declaration or a name guard, and SHALL state every omission and gap.

##### Scenario: Export and child rows
- WHEN a tenant has ordinary, tenant-less child, organization-only and encrypted custom-field rows
- THEN each output row belongs to the tenant under the declared predicate, decryption succeeds, and manifest counts/checksums match

##### Scenario: Excluded and global tables
- WHEN authentication tables are excluded and `feature_toggles` is declared global with no tenant/organization columns in its canonical migration snapshot, a one-line reason on C5's reviewed list and the same `rationale` in its declaration
- THEN authentication tables still have scoped readers for scanning; the validated global table is not applicable under R5-8
- WHEN a global declaration names a table with either tenant/organization column, names `tenants`, lacks reviewed-list membership or has no one-line rationale
- THEN static coverage and runtime plan validation fail, naming the table; neither export nor scan accepts the exclusion

##### Scenario: Unknown tenant
- WHEN `--tenant` is a well-formed UUID with no `tenants` row, soft-deleted or not
- THEN the command refuses with `TENANT_NOT_FOUND` and exit 1 before counting, and writes no output; a soft-deleted tenant still exports

##### Scenario: Runtime and bookkeeping tables
- WHEN pgvector search is enabled and the catalogue holds `vector_search`, `vector_search_migrations` and one `mikro_orm_migrations_<module>` table per module
- THEN search's `runtimeTables` declarations make the vector tables expected exclusions with a scoped scan reader, the bookkeeping tables are `not_applicable`, and an otherwise complete export exits 0

##### Scenario: Disabled module or unknown table
- WHEN the catalogue contains a non-empty disabled-module table, a table with unknown ownership or an enabled module's table without a registered reader
- THEN export refuses unless `--allow-unexported-tables` acknowledges the named gap, and an allowed result has `complete: false` and exit 2; an entirely empty disabled table is recorded empty

##### Scenario: Secret/JSON/shared declaration
- WHEN an unreviewed JSON column, unredacted lookup hash, unreviewed `*_session_id` column, undecided text column of a credential table, non-numeric `token` column listed in `reviewedScalars` or shared personal table is planned
- THEN guards and export-plan validation refuse it

##### Scenario: Dry-run counts
- WHEN dry run is requested
- THEN each owner reader's `count`, with the export's attribution, counts inside the snapshot without decrypting, audit records completion and no output directory/file is made

##### Scenario: Incomplete file export
- WHEN attachments are skipped or a permitted missing or size-changed object is encountered
- THEN omissions/gaps are in the manifest, `complete` is false and exit is 2; unsupported `--tables` is exit 1

##### Scenario: Output permissions
- WHEN umask is permissive, the root is a symlink or an existing empty directory has unsafe permissions
- THEN new output is still `0700`/`0600`; unsafe roots refuse and no link is followed

##### Scenario: Audit failure or copy interruption
- WHEN the started audit write fails
- THEN no tenant row is read
- WHEN pre-publication audit completion or copying fails
- THEN no manifest is published, exit is 1, partial output is removed or its remaining path is reported for deletion

##### Scenario: Terminal evidence expires
- WHEN settled tenant-export evidence is older than the effective finite age, with a runner and no hold or unresolved publication
- THEN the audit owner deletes the whole lifecycle group and retains only aggregate counts/dates; holds and unresolved publication defer expiry

##### Scenario: Evidence about a soft-deleted tenant
- WHEN the exported tenant has since been soft-deleted and its settled evidence passes the age
- THEN a tenant-scoped run naming that tenant id expires it exactly as for an active tenant; every `privacy.tenant_export` entry is written with the exported tenant, so no null-tenant evidence exists

##### Scenario: Suppression metadata export
- WHEN `forms_invitation_suppressions` rows belong to the exported tenant
- THEN `recipient_hash` and `key_id` are null, the manifest names both redactions and the row count, and the artifact makes no claim to rebuild recipient opt-outs (R4-9)

##### Scenario: Scan mode
- WHEN scan reads an excluded table or redacted column
- THEN only tenant-attributed values reach its in-memory caller, no file is opened, and unreadable tables/columns are explicit gaps

## 📝 Architecture

- `packages/shared/src/modules/privacy.ts`: declaration schemas, `PrivacyTableReader` and result type; `registry.ts`: `getTableExports` and `getRuntimeTables` from R3-2's `module.privacy`.
- `privacy/lib/tenantExport/`: catalogue/snapshot inventory, plan, counting, reader orchestration, safe writer and audit/manifest lifecycle.
- Each table owner registers `reader` and, when needed, `scanReader`; `entities`, `forms` and `query_index` supply special decryption. `attachments` captures snapshot references and copies exactly those objects through its own service. No ORM relationships are added.
- Owner `privacy.ts` files declare scope and secret/JSON decisions. The shared helper lives in `packages/shared/src/lib/privacy/tableReader.ts`; each owner binds its own table allowlist before DI registration. Program DEC-9 selects this module-owned design; the orchestrator cannot use the helper to read foreign tables.

| Touchpoint | Mechanism | Absent or failed |
|---|---|---|
| Exporter to declarations | Shared collector under R3-2 | Invalid/unknown attribution refuses; scalar defaults still must pass all guards |
| Exporter to keys | Existing encryption service with transaction manager | Unreadable ciphertext refuses or becomes an explicit permitted gap |
| Exporter to owner readers | Module-owned typed DI registrations; shared DEC-G helper runs inside that owner only | Missing reader is a gap, never empty success |
| Exporter to files | Attachment capture inside snapshot, byte copy outside | Missing service/objects fail unless explicitly allowed; skip means incomplete |
| Exporter to audit | `actionLogService.log`, started/completed | Refusal before reading, or cleanup with no manifest on completion failure |

## 📝 Data Models

No entity or migration. Row files use database column names, JSON as JSON, timestamps as ISO strings and binary values as base64. The manifest carries `formatVersion: '1'`, application version, tenant id, reference, time, enabled module ids, inventory source, export `runId`, started audit id and `complete`. It lists row counts, SHA-256 and redacted columns with each column's reason per file; attachment ids, original names, safe relative paths, sizes and SHA-256; expected exclusions with their reasons, including runtime tables and `not_applicable` migration bookkeeping; the limit that same-size object replacement is undetected; intentional omissions; unreadable/null values; disabled/unknown tables and counts or null. Shared definitions are in separately labelled files.

## 📝 API Contracts

### Declarations — `@open-mercato/shared/modules/privacy`

```ts
type TableExportVia = { parent: string; on: Array<[column: string, parentColumn: string]> }
type RedactReason = 'credential' | 'token' | 'key_material' | 'may_embed_secrets'
type TableExportEntry = {
  exclude?:
    | { reason: 'authentication' | 'runtime_state' | 'derived' }
    | { reason: 'global'; rationale: string }
  redact?: Array<{ columns: string[]; reason: RedactReason }>
  via?: TableExportVia
  nullTenant?: 'global' | 'shared' | 'organization' | { via: TableExportVia }
  reader?: string
  scanReader?: string
  reviewedChecksums?: Array<{ column: string; rationale: string }>
  reviewedScalars?: Array<{ column: string; rationale: string }>
  json?: Record<string, { decision: 'export'; rationale: string } | { decision: 'redact'; reason: RedactReason; rationale: string }>
}
type RuntimeTableDeclaration = {
  table: string
  columns: string[]
  export: TableExportEntry
}
```

The default export gains `tableExports?: Record<string, TableExportEntry>` and `runtimeTables?: RuntimeTableDeclaration[]`, independently validated by `getTableExports` and `getRuntimeTables`. R3-2 owns registry generation; DEC-G owns the declaration location. No export-only entry changes coverage. `redact` groups need non-empty, existing columns and are pairwise disjoint; a column cannot be both redacted and in `reviewedScalars`, `reviewedChecksums` or a `json` export decision. A global `rationale` is one non-empty line. A `runtimeTables` name is unique across modules and absent from every canonical snapshot (C5 rule 13).

### Shared owner-reader contract

```ts
export type PrivacyTableReadResult = {
  row: Record<string, unknown> | null
  rowId: string | null
  after?: string
  notScannedColumns?: string[]
  undecryptable?: string[]
  notScannedReason?: 'reader_unavailable' | 'reader_failed' | 'ownership_unknown'
}

export type PrivacyTableCount =
  | { status: 'counted'; attributed: number; orphaned: number }
  | { status: 'unknown'; reason: 'reader_unavailable' | 'reader_failed' | 'ownership_unknown' }

export type PrivacyTableReader = ((input: {
  tenantId: string
  table: string
  trx: EntityManager
  mode: 'export' | 'scan'
  batchSize: number
  after?: string
}) => AsyncIterable<PrivacyTableReadResult>) & {
  count: (input: { tenantId: string; table: string; trx: EntityManager }) => Promise<PrivacyTableCount>
}
```

`EntityManager` is a type-only import from `@mikro-orm/postgresql`, bound to the shared read-only snapshot. `batchSize` is zod-validated from 1 to 100. The iterable streams all rows after an optional opaque keyset cursor in bounded batches. Every row carries a stable primary-key encoding and continuation cursor; composite keys use a deterministic JSON tuple. An unreadable table yields `row: null`, null row id and a reason even if no rows are available. Column gaps name columns, never failed values. The orchestrator records an installation-level or table-level `schema_unstable` gap in the manifest when snapshot schema evidence is unavailable, with a named relation only when known. It is outside owner-reader results and always forces incomplete/exit 2 if allowed.

Owner readers enforce tenant attribution, including all organizations of this tenant, and reject a `table` outside their module's allowlist before querying. They decrypt through existing helpers, never apply export redaction, open output files or log rows. The orchestrator applies redaction/JSON decisions only in export mode. Undecryptable fields fail or become declared null gaps there; scan mode reports them as gaps without hiding the evidence. Both `reader` and `scanReader` DI keys resolve to this exact type. Reader errors become explicit gaps, never an empty successful table. `count` applies exactly the iterable's attribution, reads no column values and never decrypts; `attributed` counts rows the tenant owns and `orphaned` tenant-less rows whose attribution parent is missing. The shared helper builds both members from one owner binding, so an owner cannot register a reader whose count disagrees with its rows. Disabled-module declarations/registrations cannot be assumed loaded: such a table is always a named `module_disabled` gap with count null, unless step 3’s audited snapshot whole-table probe found it entirely empty. The operator either re-enables the module for the export, so its readers load, or acknowledges the gap with `--allow-unexported-tables`.

### CLI, audit and output

Flags and declaration/result shapes use zod in `privacy/data/validators.ts` and the shared privacy module; operator messages use translation keys through the CLI resolver; tenant is a UUID that must resolve to a `tenants` row, soft-deleted included (step 3), reference is required and bounded to the contract's 120 characters. `--reference` must be a non-personal case or ticket id, never a name or address: it is otherwise kept only in encrypted audit context and the manifest, so `SENSITIVE_MODULE_CLI_OPTIONS_BY_COMMAND` in `packages/cli/src/mercato.ts` gains `['privacy:export-tenant', ['--reference']]` and the dispatcher banner redacts it. No HTTP route or UI is added. The tenant-wide CLI covers every organization in that tenant and never other tenants.

| Exit | Meaning |
|---|---|
| 0 | Complete export, or successful gap-free dry run |
| 1 | Usage/refused plan, audit or other failure; unsupported `--tables` included |
| 2 | Completed with an explicit omission or allowed gap; manifest `complete: false` |

Audit uses resource kind `privacy.tenant_export`, command id `privacy.tenant.export`, resource id tenant UUID and actor `system:privacy-cli`. Start precedes all tenant reads; completion precedes manifest publication. Append-only context carries a generated export `runId`, reference, status, publication state, counts and no exported data or paths. The manifest's audit id and this run id correlate the lifecycle. No manifest means incomplete output; publication acknowledgement settles its evidence without mutating an earlier entry. The audit owner recognizes the reconciliation protocol below.

**Audit reconciliation.** An authorized deployment operator runs `mercato privacy reconcile-tenant-export --tenant <uuid> --list-unresolved` to obtain only scoped run ids and bounded lifecycle statuses. To settle a run, use `mercato privacy reconcile-tenant-export --tenant <uuid> --run <uuid> --outcome published --artifact <private-local-dir> --reference <case>`, or `--outcome cleaned --reference <case>` after verifying the failed process has stopped and all partial copies were removed. Validate the exact tenant, immutable run and reconciler’s authority through the audit owner. The export and reconciliation share a tenant/run fence. Require an inactive export under the fence. Return the existing identical settlement on retry and refuse a conflicting terminal outcome before evaluating new evidence. A new settlement requires an unresolved lifecycle. For `published`, validate the private root and manifest by no-follow descriptors, strict schema, exact tenant/run/started audit id and recorded byte digest; stream every listed file through its no-follow descriptor and verify its expected path, size and SHA-256. Flush the root and its containing parent before append. Missing or invalid evidence refuses. `cleaned` requires a case reference supporting the operator’s verified cleanup; the entry records an attestation. Append exactly one terminal settlement. The redact map includes this command’s `--reference` and `--artifact`; audit evidence contains the safe outcome, time and case correlation, and never file paths or contents. Unknown or unverified outcomes stay unresolved; cleaned interrupted runs are settled at the appended terminal timestamp, subject to holds.

**Tenant-export evidence expiry.** Action-log-retention's assumption 9 and “Evidence outside the generic sets” require this dedicated finite bound. Declare `retention.privacy.tenantExportEvidenceAgeDays` in `privacy.ts.settings`: integer days, minimum 30, default 365 (assumption 11). Resolve it through R3-3 — “Tenant privacy settings live in `module_configs`”, owned by C1. Declare `privacy.tenant_export_evidence` with `targets: ['records']`, `minimumDays: 30`, `excludableSubjectKinds: []`, `unmatchedHoldsOptOut: 'forbidden'`, locale-key `title`/`ageBasis`, `handlerService: 'privacyTenantExportEvidenceRetentionHandler'`, and `runEvidence: 'aggregate'`, using record retention's existing “Aggregate evidence for expiry runs” contract. The DSR engine's policy validation refuses `allowUnmatchedHolds` for this set and `privacyRetentionService.run` refuses it with `unmatched_holds_forbidden`; an opt-out that still reaches the handler skips the whole set with `hold_not_honourable`, because tenant-wide lifecycle groups cannot honour one. Run it only through `privacyRetentionService.run` under DEC-C — “Retention sets and holds”, owned by record retention; a shorter caller window refuses. The shared driver writes its strict `PrivacyRetentionAggregateSummary`; neither the handler nor the CLI/engine writes a second identifying run summary. Tenant export is tenant-wide, so organization narrowing refuses. Any active Enterprise hold in the tenant or explicit subject exclusion skips the whole set with `hold_not_honourable`; a failed registered guard refuses. R3-5 — “Holds, honestly”, in the program, limits OSS to explicit exclusions.

The handler calls the audit-owned `actionLogService.expireTenantExportEvidence({ scope, olderThan, limit, after?, dryRun })`, returning `{ matched, changed, skipped, next?, done }`. The cutoff is the retention runner's fixed cutoff. In pages of at most 100, the audit service validates and rechecks its own exact `privacy.tenant_export` lifecycle groups under a run lock, then deletes only groups older than that cutoff whose publication is `published`, dry-run `not_required`, or explicitly `reconciled`. Open starts, unknown/failed publication, invalid context and unresolved reconciliation are preserved and reported, never deleted by age alone. Delete the entire settled group, including actor, tenant resource id, reference and context. Keep only the shared driver's allowed set id, aggregate counts and run dates in the expiry summary; copy no old actor/reference/run or tenant-resource identifiers. Privacy never queries audit tables, and general history's `privacy.` exclusion and DEC-B — “The audit-history strip routine”, owned by C4, remain unchanged.

**Evidence about a soft-deleted tenant — R4-3.** Every `privacy.tenant_export` entry carries the exported tenant: the command requires `--tenant`, writes its started, completed, acknowledgement and reconciliation entries with that `tenant_id`, and a unit test asserts that no lifecycle entry is written without it. `action_logs` has no foreign key to `tenants`, and tenant deletion is a soft delete (`directory/commands/tenants.ts`), so `tenant_id` is never nulled afterwards. No null-tenant tenant-export evidence exists, and this spec defines no installation-scope path, setting or audit method for it. Evidence about a soft-deleted tenant expires through the same tenant-scoped run: `privacyRetentionService.run` takes the tenant UUID without requiring an active tenant, the tenant's `module_configs` age remains readable, and the operator keeps the run scheduled for that tenant id until its evidence is gone. An unexpected null-tenant row of this kind is invalid evidence that no tenant run can select.

The 365-day rule is enforced only with a scheduled OSS command or Enterprise record policy, including for soft-deleted tenants. With no runner, active holds or unresolved publication, report the actual unenforced/deferred state; the configured age alone is no deletion proof. This expiry follows C1 Phase 7 and record retention, without delaying the base export reader.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Existing root | Accept only empty, owned, private directory; never a symlink |
| Traversal name, NUL/control characters or invalid attachment id | Sanitize the name, require UUID id, confine every destination and refuse unsafe paths before writing |
| Root/child link replaced during writing | Refuse; use verified directory handles/no-follow checks, not a one-time lexical path test |
| Added/removed file during export | Copy captured snapshot rows only; missing or size-changed objects are gaps; no promise of storage-level snapshot bytes |
| Start/pre-publication completion audit fails | Initial reads nothing; final writes no manifest; exit 1 and cleanup partial output |
| Publication acknowledgement fails after manifest | Exit 1, preserve the private artifact and completed audit; report unresolved evidence until reconciliation |
| Unhandled crash | Started audit remains; owner-only decrypted partial output may need manual deletion |
| Cleanup failure | Print remaining path and deletion instruction; never label output complete |
| Disabled module or unknown physical table | Any row in the table (count null, found by the whole-table `EXISTS` probe) or unknown ownership refuses by default; allowed export records the gap; scan reports not scanned |
| Tenant-less table whose parent is excluded | Use validated parent scope plan without exporting its values; absent attribution refuses |
| Null tenant with personal data | Never `shared`; omit as global or attribute through organization/parent as declared |
| Global table | R5-8 requires neither tenant nor organization columns in the canonical snapshot, a table other than `tenants`, and reviewed-list membership with a one-line reason equal to the declaration's `rationale`; otherwise fail naming the table, never waive scanning |
| Unknown tenant id | `TENANT_NOT_FOUND`, exit 1, no output; a soft-deleted tenant still exports |
| Runtime or bookkeeping table | Declared `runtimeTables` follow their entries; `mikro_orm_migrations_<module>` is `not_applicable`; an undeclared runtime table, including a renamed pgvector table, is an unknown-table gap |
| Enabled module without registered readers | Named `reader_unavailable` gap; refuses by default, exit 2 when allowed |
| Disabled module's table | Empty table recorded empty; otherwise a gap with count null until the module is re-enabled for the export or the gap is acknowledged |
| Millions of attachment references | Spooled to the owner-only staging file, streamed during copy and removed afterwards; memory stays bounded by one batch |
| Same-size replacement of a captured object | Undetected without a driver version; removed or size-changed objects are gaps |
| Soft-deleted records | Included under the same ownership rules |
| Large tenant | Bounded batches; long read snapshot, run at a quiet hour; use a supported replica only when audit writes use the writable service connection |
| Undecryptable value or owner reader failure | Export fails unless applicable allow-gap flag; scan records explicit column/table gap |
| `--skip-attachments` | Record intentional omission, incomplete manifest and exit 2 |
| Old evidence is held or unresolved | Preserve held/unresolved groups; never strip evidence into actor-only fragments |
| Exported tenant later soft-deleted | Its evidence keeps `tenant_id`; the tenant-scoped run for that id expires it at the same age |

## 📝 Migration & Backward Compatibility

Additive unreleased declaration, shared reader/result types, DI registrations with module-prefixed keys, CLI and its `--reference` dispatcher redaction entry, attachment service members, evidence setting/set and audit-owner expiry/aggregate methods. These become STABLE type/import/DI/CLI contracts on release. No existing surface is removed or narrowed; R3-2 preserves legacy `privacyDataClasses`. No new editable entity or migration; the evidence setting uses C1's shared versioned settings contract. `UPGRADE_NOTES.md` documents the audit requirement, private output, incomplete exit 2, gap flags, storage snapshot limits, crash cleanup, publication reconciliation, the finite tenant evidence age and its scheduled run (kept running for soft-deleted tenants), the disabled-module and reader-delivery gaps, and the R4-9 suppression handover limit. `PrivacyTableReader` gains its required `count` member, `TableExportEntry.redact` is an array of reason groups, `exclude` gains `rationale` and `reviewedScalars` and `runtimeTables` are added; all are unreleased, so no bridge is needed before the first release. `PrivacyScope` stays tenant-required; no installation-scope surface is added. Implementations must use the ordinary deprecation bridge for later incompatible changes.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | Declarations/guards, catalogue inventory and non-reading plan construction | C5 snapshot reader, R5-8 reviewed-list/check delivery and R3-2 contract support; program Phase 2 must place C5 before C8 |
| 2 | Shared helper with `count`, readers for the modules listed under “Reader delivery”, search runtime-table declarations, audited counting dry run, safe writer and manifest; other modules are named gaps until their carriers ship readers | Phase 1; domain and Enterprise readers ship with their own carriers; G6 closure needs all |
| 3 | Snapshot attachment capture/copy and documentation | Phase 2 |
| 4 | Dedicated terminal tenant-export evidence expiry, including soft-deleted tenants | C1 Phase 7 settings and the record-retention service; unresolved evidence is preserved |

## 📋 Implementation Plan

### Phase 1 — Inventory and declarations
1. Add `tableExports` and `runtimeTables`, their zod schemas and collectors under R3-2. `tenantExportDeclarations.test.ts`: entries work for class-covered, coverage-map and baseline tables without counting as coverage; invalid reasons refuse; overlapping `redact` groups, a column both redacted and reviewed, a global exclusion without a one-line `rationale` and a `runtimeTables` name found in a snapshot refuse.
2. Add guards and owner declarations. Same unit suite: excluded `sessions.token` needs no redundant redaction but needs scope; `feature_toggles` is global only with neither tenant/organization column in its canonical snapshot and reviewed-list membership with a one-line reason (R5-8). Reject global declarations for a tenant-column table, an organization-column table and a class-covered tenant table, plus an otherwise eligible table absent from the reviewed list, missing its reason, or whose declaration `rationale` is missing or differs, and `tenants` declared global; each failure names the table and prevents export/scan waiver. Run these cases through static coverage and runtime plan validation, consuming C5 failure rule 10. JSON secret under an innocuous key refuses until redacted; a reviewed scalar checksum exception validates at plan time while lookup hashes/recipient digests never safe-list; `shared` personal or class-covered tables refuse. Consume C5's existing failure rule 7 for the shared-row restriction.
3. Implement catalogue/snapshot inventory and non-reading plan validation. Tenant row counts/dry-run execution wait for Phase 2 readers and pre-read audit; no tenant data is read in Phase 1. `tenantExportPlan.test.ts`: disabled table with rows refuses then records a gap with allow, and an entirely empty disabled table is empty; unknown ownership refuses; an enabled table without an entry or registered reader is a `reader_unavailable` gap, and so is a `reader` or `scanReader` key carrying another module's camel-case prefix, rejected before the key is resolved; scope metadata for disabled tables is retained; excluded parent still supplies an attribution plan; `--tables` refuses. The application-table filter excludes views, foreign tables and extension catalogs; `mikro_orm_migrations_<module>` tables are `not_applicable` only with neither scope column, and any other unclaimed table is unknown. `runtimeTables` declarations validate against declared and live columns; a mismatch is a gap. Database count assertions follow in Phase 2.

### Phase 2 — Reader and auditable output
1. Implement `PrivacyTableReader` with its `count`, the shared helper and orchestration under DEC-9. `privacyTableReaderContract.test.ts`: `count` returns attributed and orphaned counts with the same predicates as the iterable and never decrypts or returns rows, and an unreadable table yields `unknown`; transaction propagation, batches/cursors, stable row ids, tenant/organization/via/null ownership, owner allowlist rejects foreign tables, cross-owner parent attribution through sanctioned services, mapped/system-scope/custom-field decryption, JSON parsing, orchestrator-only redaction, reader errors and ciphertext as gaps. `exclude: global` is not applicable; excluded non-global tables remain scoped and scannable.
2. Register readers in DI and `tableExports` for the modules listed under “Reader delivery”, including `entities`, `forms`, `directory`'s scope-root `tenants` reader filtering `id = tenantId`, the `query_index` scan reader and search's `runtimeTables` entries with their DDL-parity test. Run the same contract tests in both modes. Domain coverage carriers and the Enterprise package register theirs with their own tests; until then those tables are named gaps. Add `auth.users`' two redaction groups and a contract test that `password_hash` reports `credential` and `email_hash` `key_material`, and that overlapping groups fail. Add guard tests for `*_session_id` columns, an innocuous-name secret column in a `credential`-classified fixture table that fails until redacted or listed in `reviewedScalars`, and a `reviewedScalars` entry that cannot clear an original secret name. The same suite exports a numeric `token` counter listed in `reviewedScalars` and refuses a text or `uuid` `token` column, a numeric column whose name also contains `hash`, `secret` or `password`, and a live column whose type differs from its snapshot, each listed there. Ship the generic redaction and count contract against a C8-owned synthetic table with two key-material columns and minimal scalar metadata. Assert both redactions, both manifest reasons, the row count and refusal to override those redactions through `reviewedChecksums`. E3 Phase 2 alone ships the real suppression table, declaration, owner reader registration or extension, and actual row test under R4-9.
3. Add the `privacy:export-tenant` `--reference` entry to the dispatcher redaction map; the existing redaction unit test in `packages/cli/src/__tests__/mercato.test.ts` asserts that the echoed line masks the reference. Implement private writer and started/completed/publication audit lifecycle. `tenantExportWriter.test.ts`: permissive umask yields `0700`/`0600`, unsafe/symlink roots and children refuse, all file kinds are exclusive, checksums/counts match, initial audit failure reads nothing, completion failure publishes no manifest and cleans output, cleanup failure names path, audit completion precedes manifest and acknowledgement follows it; acknowledgement failure preserves the private artifact but exits 1 with unresolved evidence; omission sets incomplete/exit 2. Add a writer fault sequence for a short write, crash before link, crash after link, unsupported no-replace publication and failed root fsync; no partial manifest can be parsed at the final path. Add a complete default-composition export test with attributed `entity_indexes` rows and derived values excluded.
4. Deliver the database/schema fence in the CLI migration entry point and applicable runtime DDL paths before enabling counting dry run or export. Use the same snapshot/fence for scan mode inventory and emptiness decisions; report unfenced or mismatched tables as not scanned. Enable counting dry run only after the readers and started/completed audit exist. Unit tests cover the `TENANT_NOT_FOUND` refusal for an unknown UUID beside a real empty tenant and a soft-deleted tenant that still counts, disabled rows refusing/allowing gaps, scoped empty tables and dry-run/export counts with identical tenant/null/organization predicates. Use two DB connections to commit into a previously empty disabled table after advisory discovery but before the read snapshot, and to create an unknown table in that interval; both remain visible as gaps. Verify DDL waits on the schema fence until snapshot release, concurrent row commits after the snapshot stay outside it and an unfenced schema never yields complete output. Run attachment-free integration subsets at this phase; full TC-TENANT-EXPORT-001/002 wait for Phase 3.

### Phase 3 — Files and docs
1. Add attachment capture inside the snapshot and exact-reference copying through the owner service. `tenantExportAttachments.test.ts`: later insertion not copied, removed or size-changed captured file is a gap, a same-size replacement is reported as undetected in the manifest's limits, references are spooled to the `0600` staging file and removed on success and failure (a large-reference fixture keeps memory bounded), failed copy cleans partial output, original-name traversal cannot escape, pre-existing/link destinations and invalid ids refuse. Test empty names, slash/backslash, NUL and control characters.
2. Run the full TC-TENANT-EXPORT-001/002 with snapshot attachment capture/copy implemented, all own fixtures and cleanup.
3. Document format, handover, schema fencing and deployment ownership verification, incomplete output, private permissions and mandatory partial-output cleanup in the deployment page and `UPGRADE_NOTES.md`.
4. Archive the Delta into a capability file only if that repository convention exists when implemented.

### Phase 4 — Evidence lifecycle
1. Declare the setting and records set after C1 Phase 7 and record retention, selecting the owner's existing `runEvidence: 'aggregate'` driver projection. Implement audit-owned expiry, with no privacy-side table reads. `tenantExportEvidenceRetention.test.ts` covers the declaration including `unmatchedHoldsOptOut: 'forbidden'`, an unmatched-hold opt-out reaching the handler skipping the whole set, default/override/floor, fixed cutoff and repeated batches, whole-entry deletion, hold/exclusion skip and guard failure, no runner, published/dry-run/reconciled outcomes, unresolved crash/publication preservation, expiry for a soft-deleted tenant, and declaration-selected summaries containing only the driver's allowed aggregate counts/dates/set id, without a duplicate identifying CLI/engine summary. `tenantExportAudit.test.ts` asserts the R4-3 invariant: every lifecycle entry, including refusals, acknowledgements and reconciliations, carries the exported tenant id.
2. Extend TC-TENANT-EXPORT-002 with aged/recent settled and unresolved own export evidence, a held tenant and a soft-deleted tenant; assert tenant holds/unresolved deferral and that a run naming the soft-deleted tenant expires its settled evidence. Clean every fixture through the audit owner. Document the tenant runner requirement, including soft-deleted tenants, and the reconciliation procedure before program closure. Add the operator reconciliation command and audit tests for simultaneous attempts, exact tenant scope, idempotent retry, conflicting outcome, missing or partial artifact and same-size modified file, and cleaned-run expiry with an unresolved control that remains held.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/modules/{privacy.ts,registry.ts}` | Modify — future declaration and shared reader/result types/collector |
| `packages/core/src/modules/privacy/{cli.ts,data/validators.ts,lib/tenantExport/*}` and named unit suites | Create/modify — module was created by doctor spec |
| `packages/cli/src/mercato.ts`, `packages/cli/src/__tests__/mercato.test.ts` | Modify — `--reference` redaction for `privacy:export-tenant` and its echoed-line assertion |
| Owner `privacy.ts` files and one `tenant-export-coverage.test.ts` per package | Create/modify — scope, JSON and redaction decisions |
| `packages/shared/src/lib/privacy/tableReader.ts`; the Phase 2 modules' readers and DI registrations, including `entities`, `forms`, `query_index` | Create/modify — shared helper bound to own-table allowlists, with `count`, and both-mode owner implementations; domain and Enterprise readers ship with their carriers |
| `packages/core/src/modules/attachments/lib/attachment-service.ts` and tests | Modify — snapshot capture and copy members |
| `packages/core/src/modules/privacy/{privacy.ts,di.ts,lib/tenantExport/evidenceRetention.ts}` and `tenantExportEvidenceRetention.test.ts`, `tenantExportAudit.test.ts`; `audit_logs/services/actionLogService.ts` and owner tests | Declare evidence setting/set; audit-owned terminal-group expiry and publication/reconciliation validation; R4-3 tenant-carrying evidence invariant |
| `packages/core/src/modules/directory/{privacy.ts,di.ts,lib/privacy/*}`; `packages/search/src/modules/search/privacy.ts` and its reader/DDL-parity tests | Create/modify — scope-root `tenants` reader; pgvector `runtimeTables` declarations |
| `packages/core/src/modules/privacy/__integration__/TC-TENANT-EXPORT-00{1,2}.spec.ts` | Create |
| `packages/core/AGENTS.md`, contract spec | Unchanged — DEC-9 keeps the no-cross-module-table-access rule with no exception, so neither needs an exception entry |
| `apps/docs/docs/deployment/gdpr/tenant-exit-export.mdx`, `UPGRADE_NOTES.md` | Create/modify |

## 🧪 Integration Coverage

No new HTTP/UI path. Test-only module-owned row probes can inspect captured fixture row ids even after an attribution parent is gone; production scans never gain an unscoped row-id read. All fixtures are owned by each test, created by APIs where possible and owner-service setup for unsupported cases, removed in `finally` together with directories and overrides.

| Test | Covers |
|---|---|
| TC-TENANT-EXPORT-001 | Own two tenants, staff users, people, deals, encrypted custom fields and attachments; seed maps and assert raw ciphertext first. Also create a tenant-less installation user, global row, reviewed safe shared definition, organization-only forms and scoped suppression rows in both tenants, and a second-tenant custom-field value/attachment. Assert no second-tenant or installation-person sentinel; global row absent; only safe non-personal shared definition in labelled file; forms/fields readable, child links scoped, password/lookup hashes null with their `credential`/`key_material` reasons in the manifest, sessions excluded, the tenant's own `tenants` row exported and no other tenant row, and attachments/checksums/counts/modes correct; the attachment staging file is absent from the published output. Suppression recipient_hash and key_id are null and the manifest names both columns, the key_material reason and the row count; minimal metadata exports normally, without raw address or reusable recipient state, and a reviewed-checksum entry cannot bypass either redaction. Assert that the receiving system cannot rebuild opt-outs. Test the owner's key-mismatch send refusal separately through its service fixture. Unchanged dry-run/export counts agree. Remove all own rows, secrets/overrides and output. |
| TC-TENANT-EXPORT-002 | Own tenant/attachment, a fixture disabled-module table with tenant rows, an empty fixture disabled-module table and an unknown-attribution table. Default refuses; allowed run lists exact gaps, complete false/exit 2, and the empty disabled table is recorded empty; skip-attachments records omission/exit 2; --tables exits 1. A well-formed unknown tenant UUID exits 1 with `TENANT_NOT_FOUND` and no output, while the own real empty tenant and a soft-deleted own tenant still export. Scoped authentication exclusions remain scannable; standard global feature_toggles is not applicable; `attachment_pending_deletions` is listed as a `runtime_state` expected exclusion, not an omission. Inject start/completion failures: no unaudited manifest; a separate post-publication acknowledgement failure exits 1 with preserved private output and unresolved evidence. Phase 4 adds aged/recent settled groups, held/unresolved evidence and a soft-deleted own tenant: only eligible whole groups expire through the audit owner, including the soft-deleted tenant's through a run naming it; summaries are aggregate-only and every evidence row carries its tenant. Remove all fixture tables/rows/audits, setting overrides and output. |
| TC-TENANT-EXPORT-003 | pgvector search enabled with own indexed records, so the catalogue holds `vector_search`, `vector_search_migrations` and every `mikro_orm_migrations_<module>` table. Assert the plan has no unknown table and no `ownership_unknown`: the vector tables are expected `derived`/`global` exclusions with the scoped scan reader confirming only own-tenant vector rows, and the bookkeeping tables are `not_applicable`. Before every enabled module's carrier has shipped readers, the only gaps are named `reader_unavailable` entries for those modules' tables, for example the commerce tables that [commerce coverage](2026-11-16-privacy-coverage-commerce.md)'s “Tenant-export readers” row lists per phase (`sales_*`, the `carrier_*` tables, the `cart*` tables, `checkout_*`, `gateway_*`, `warranty_claim*`, the promotion tables and `customer_group*`); once they all have, an export with no other gap is `complete: true` and exits 0, which is the program-closure form of this test. Remove own records, vectors and output. |

## 📝 Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Wrong join or null-tenant sharing exports another tenant/person | Critical | Every tenant | Scoped owner readers, shared-only non-personal rule, two-tenant/installation-user/organization/custom-field integration fixtures | Later declaration can still be wrong; each join needs owner review |
| Secret leaves in innocuous JSON, scalar or lookup hashes | High | Recipient and account credentials | Every JSON column reviewed; lookup hashes redact; secret-name guard extended to session/nonce/key/code tokens, with `token` safe-listed only for reviewed numeric unit counts; per-column decisions for every text column of credential and configuration tables; whole-table exclusions | Incorrect reviewed decision, or a secret under an innocuous name in another table, remains possible; export stays sensitive and the Delta claims only declared or name-guarded credentials |
| Disabled/unknown tables silently missing | High | Leaving tenant | Live catalogue inventory, owner-reader counts for loaded modules, whole-table `EXISTS` probes with count-null gaps for disabled and unknown tables, default refusal and explicit incomplete manifest | Stores unknown to the product remain outside this handover |
| Scan caller logs decrypted excluded values | High | Operator output | Reader writes nothing; verifier prints locations only; same tenant predicate | A future caller can still misuse in-memory rows |
| Copy/audit failure or crash leaves decrypted output | High | Operator host and accountability | Private modes, exclusive no-follow files, start before reads, complete before manifest, handled cleanup and remaining-path instruction | Unhandled crash needs manual cleanup; bytes lack a database snapshot |
| Tenant-supplied name or swapped link redirects write | Critical | Operator host | Sanitized component under UUID, verified directory handles, exclusive no-follow creation | Contents remain tenant-supplied; do not execute exported files |
| Long read snapshot loads primary | Medium | Other tenants | Bounded batches and quiet-hour/compatible-replica procedure | Rare operator run can still hold a long snapshot |
| Redacted suppression metadata is treated as a usable opt-out list | High | Leaving tenant and recipients | R4-9 nulls recipient_hash/key_id, records row count and documents that opt-outs cannot be rebuilt; no checksum exception | This version supplies no suppression handover |
| Evidence about a soft-deleted tenant is never expired | Medium | Tenant-export evidence | R4-3 invariant that every entry carries its tenant; tenant-scoped runs accept a soft-deleted tenant id; docs require keeping the run scheduled for it | An operator who stops scheduling runs for a deleted tenant leaves its evidence until the next run |
| A complete handover is unreachable or claimed too early | High | Leaving tenant and operator | Runtime tables declared by their owner, a built-in rule only for migration bookkeeping, readers delivered per carrier with named `reader_unavailable` gaps, unknown tenants refused, TC-TENANT-EXPORT-003 | Exit 0 waits until every enabled module's carrier ships readers; a renamed pgvector table is a gap |
| Attachment references exhaust memory | Medium | Operator host | Owner-only `0600` staging file streamed during copy and removed on success or failure | A crash can leave the staging file inside the private partial directory, which the docs already require deleting |

## Final Compliance Report — 2026-11-16

Fresh-context review corrected dry-run/reader/audit and attachment-test ordering and made the checksum exception expressible in the declaration contract.

Reviewed root/spec rules, backward-compatibility surfaces, shared encryption/boundaries, core Encryption/Cross-Module Coupling, CLI boundaries, create-app sync, queue/search boundaries and QA fixture rules. No code was changed or validation environment started.

| Rule | Status | Evidence or remaining gate |
|---|---|---|
| Tenant/organization isolation | Designed | Scoped joins/readers and two-tenant/null/organization integration sentinels; scope-root `tenants` read by `id = tenantId`; unknown tenants refused; R5-8 global exclusions require the canonical snapshot column check and the reviewed reason carried as `rationale` |
| Module table boundaries | Designed under DEC-9 | Owners call the helper only for their own allowlisted tables; readers ship per carrier with named gaps meanwhile; the orchestrator's only direct access is the owner-less whole-table `EXISTS` probe; no generic reader |
| Encryption helpers | Designed | Existing mapped/custom-field/index-doc helpers; owner forms reader |
| Zod and pageSize <= 100 | Designed | CLI/declaration/result validation; batches 1–100 |
| Additive shared types/DI/CLI | Designed | `PrivacyTableReader` defined here; no frozen surface removed; upgrade documentation planned |
| Optimistic locking | Not applicable | No new editable entity/form |
| Integration fixtures and cleanup | Designed | Three named tests own all records, tables, files and overrides |
| Inventory/scheduling consistency | Aligned for export | Program places C5 before C8; C5 failure rule 7 now enforces shared rows. G6's operational-bound projection remains a separate owner handoff |
| Dedicated export-evidence age | Designed | Tenant setting, default 365/floor 30, same lifecycle preservation; R4-3 invariant keeps every entry tenant-scoped, so soft-deleted tenants expire through tenant runs and no installation path exists |
| Suppression export | R4-9 aligned | recipient_hash/key_id redacted as key_material; manifest redactions and row count; no SUPPRESSION-EXPORT checksum exception or opt-out reconstruction claim |

**Verdict:** Design ready for phased delivery with DEC-9’s module-owned readers. Written upstream approval must name this proposed OSS carrier under [DEC-2](2026-11-15-gdpr-ready-deployments-program.md#decisions) before implementation or OSS submission. Readers ship with their owning carriers; a complete handover needs all of them, and runtime and bookkeeping tables no longer block it. Output and audit guarantees are explicit; file bytes are not transactionally snapshotted. Tenant-export evidence always carries its tenant and expires through tenant-scoped runs, including for soft-deleted tenants.

## Changelog

### 2026-11-18

- Bound catalogue inventory, emptiness and tenant reads to one audited, schema-fenced snapshot. Made E3 the sole delivery owner of the production suppression declaration.

- Specified atomic manifest publication, operator reconciliation of interrupted audit groups, and an owner-scoped derived-index attribution reader.

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. Forty-three tables whose tenant may be empty were unguarded; each must now declare what an empty tenant means. Decryption is specified in its four forms, with custom-field values and forms data read by their owning modules. The generic read is put to a maintainer as a blocking question, with a per-module fallback, because the contract spec rejected the same idea for one person's export and the cited precedents are narrower than claimed. Declarations became a facet of the shared per-table entry in the default export, which is all the registry loads. Module readers share the export's transaction. Attachments are copied by path. The change history's snapshot columns are redacted by declaration. The integration test seeds encryption maps first.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), critical fix: attachment files were written to `attachments/<id>/<file name>` from the stored, tenant-controlled name, which three upload paths keep as sent, so a crafted name could write outside `--out`. Files are now written under a UUID-checked id with a sanitized name. Every target is resolved against `--out` and created exclusively. The original name lives only in the manifest. Added the edge cases, unit tests and a risk entry.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g3-12 — export declarations moved from an `export` facet on the coverage `tables` entry, which `users`, `sessions`, `customer_users` and every baselined table cannot have, to a separate `tableExports` member keyed by table, which any table may have and which the table-coverage rule does not count as coverage. The reader gained `mode: 'export' | 'scan'`; `scan` reads excluded tables and redacted columns in memory under the export's tenant predicate and attribution rules, writes nothing, reports each table it cannot read and each column that stays ciphertext as not scanned, and uses a `scanReader` where an entry declares one (`query_index` for `entity_indexes.doc`), which the export ignores. Updated assumption 2, the declarations, guards, reader, design decisions, Delta scenarios, architecture, API contracts with the entry type, edge cases, unit tests, the integration test, a risk entry and the compliance table.

- Council round two fixes (GPT-6.1 Sol workers): r4-01 — scoped tenant-less exclusions and global not-applicable status; r4-10 — disabled/unknown table inventory; r4-11 — remove undefined --tables, incomplete attachment omissions; r4-25 — review all JSON; r4-31 — private exclusive output; r4-32 — non-personal shared rows only; r4-33 — PrivacyTableReader contract; r4-34 — C5-before-C8 prerequisite and program handoff; r4-38 — started/completed audit; r4-55 — scan-capable fallback; r4-56 — snapshot counting; r4-57 — lookup-hash redaction; g3-37 — null/shared/organization test sentinels; g3-50 — snapshot attachment capture and cleanup; R2 nits — whole-table secret exclusions accepted and assumption 4 reference clarified.
- Council round two fixes, pass two (GPT-6.1 Sol workers): program DEC-9 activates module-owned DI readers and own-table helper allowlists before G6; correct C5 failure-rule numbering and resolved program scheduling; add the exact forms suppression hash/key-id export exception and original-key handover limit under DEC-G/R3-2, without widening mapped lookup-hash exports.

- Council round two fixes, pass three (GPT-6.1 Sol workers): retain the already-correct DEC-9 reader default and C5 rule 2; reconcile SUPPRESSION-EXPORT to recipient-hash redaction without a checksum exception; consume C5 rule 7; add finite tenant-export evidence setting/set, audit-owner whole-group expiry, publication acknowledgement/reconciliation, hold preservation and an explicit null-tenant assessment gap under action-log assumption 9.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): select record retention's existing aggregate evidence projection for the dedicated expiry, name suppression redaction reasons in the manifest and keep C5's conflicting exact-table proposal only as an unactivated separately reviewed fallback; preserve held/unresolved evidence and the explicit null-tenant design gap.

- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): R4-3 defines the same-set finite installation evidence age and both environment-example entries, replacing the unbounded-age gap while recording the still-undefined installation invocation; R4-9 redacts suppression recipient_hash/key_id with a row count, removes the checksum fallback and states that opt-outs cannot be rebuilt, with tests, risks and compliance aligned.
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): R5-8 validates global exclusions against canonical snapshot tenant/organization columns and C5's reviewed list with a one-line reason before export or scan waiver; align scenarios, failure evidence and static/runtime rejection tests.

### 2026-11-17
- A complete handover is reachable: the inventory filter is defined, search declares its pgvector tables in a new `runtimeTables` member, migration bookkeeping tables are classified by one built-in rule, entirely empty owner-less tables count as empty, and readers ship per owning carrier (Enterprise in Enterprise) with named `reader_unavailable` gaps meanwhile; TC-TENANT-EXPORT-003 proves exit 0 with pgvector enabled.
- R4-3 is now an invariant: every tenant-export entry carries its tenant, so the installation-scope expiry path, its setting and audit methods are removed and soft-deleted tenants expire through tenant runs.
- `PrivacyTableReader` gains `count` for decryption-free dry runs; redaction takes per-column reason groups; global exclusions carry their reviewed rationale and `directory.tenants` is read as the scope-root row; unknown tenants refuse; name guards cover session/nonce/key/code columns and credential/configuration tables need per-column decisions; a numeric `token`-named unit count, such as an LLM usage counter, may be listed by name in `reviewedScalars` instead of being redacted; attachment references spool to a private staging file; wording fixes for size-only change detection, runtime-state exclusions and the C5 rule 10 citation.
- Reader and scan-reader DI keys carry the declaring module's camel-case prefix, enforced by export-plan validation; `--reference` is a non-personal case id that the dispatcher redacts for `export-tenant`.
- `privacy.tenant_export_evidence` declares `unmatchedHoldsOptOut: 'forbidden'`; disabled and unknown tables are described consistently as count-null gaps found by the whole-table `EXISTS` probe; TC-TENANT-EXPORT-003 names the commerce tables among the expected `reader_unavailable` gaps.
