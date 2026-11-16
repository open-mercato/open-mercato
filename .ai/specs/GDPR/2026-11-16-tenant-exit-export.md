# Tenant exit export

> **Program:** package C8 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (open-mercato/open-mercato#8593).
> **Builds on:** the contract's `privacy.ts` convention, the doctor-created `privacy` module, and the snapshot reader of [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md). C5 must ship before C8, alongside the contract.
> **Reader ownership:** program DEC-9 selects module-owned DI readers using the shared DEC-G helper. No generic cross-module reader is built.
> **Code baseline:** `main` @ `08dada9624`, checked by reading. No implementation or integration tests were run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/GDPR/2026-11-16-privacy-data-class-contract.md

## 📝 TLDR

When a customer leaves, the operator must return their data. Today this means module-specific SQL, tenant attribution and decryption. **Proposed (future):** one command writes decrypted NDJSON files and attachment bytes for a tenant, with a manifest of exclusions, omissions and gaps. Module owners declare scope and redaction. A complete result excludes credentials and lookup hashes and contains no other tenant's rows.

**Not in this spec:** import, backup, deleting the tenant, a subject export, or a tenant-facing screen.

## 📝 Overview

The output is a handover, not a restorable backup. One file per table and a versioned manifest keep the format inspectable. No archive writer or production dependency is added. The operator encrypts the directory before transferring it, under the deployment procedure.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Generic reader or one handler per module | Module-owned readers through DI, using the shared helper and `PrivacyTableReader` in both modes (program DEC-9) | Decided by DEC-9. Each owning module reads only its own tables, so the no-cross-module-table-access rule holds with no exception. The cost is one registration per module, which the C5 census enumerates; the registrations land before C8 and G6. No generic reader is built. |
| 2 | What decides exclusions | A separate `tableExports` member on `privacy.ts`, keyed by table | DEC-G owns this separation. JSON columns require reviewed decisions; lookup hashes and secrets cannot silently export. Unremarkable scalar columns may export by default. |
| 3 | Tenant-less and nullable-tenant tables | Explicit attribution; unknown ownership is a gap that refuses by default | Guessing can leak other tenants' records. Only reviewed global tables are not applicable. |
| 4 | Output | Owner-only directory, no archive or encryption in the command | Decided: `0700` directories and `0600` files, created exclusively regardless of umask. The handover stays inspectable and the command adds no archive writer, key handling or dependency; the operator encrypts the directory before transfer under the deployment procedure. Weaker permissions are never accepted. |
| 5 | Undecryptable values | Fail, unless `--allow-undecryptable` writes null and records a gap | Never hand back ciphertext as readable data. |
| 6 | Consistency | Repeatable-read, read-only database snapshot; capture attachment references inside it | File bytes cannot share a database snapshot. Copy only captured objects and report missing or changed objects. |
| 7 | Derived stores | Exclude search indexes, queues and caches from handover | They can be rebuilt; scan mode still checks reachable stores through their owners. |
| 8 | Edition | OSS | Decided by program DEC-2. The readers live in the OSS modules that own the data, and every deployment must be able to return a leaving tenant's data. |
| 9 | Partial table selection | No `--tables` in this first version | Unsupported use is exit 1. Explicit file omission uses `--skip-attachments`, an incomplete result with exit 2. |
| 10 | Suppression-state portability | R4-9 redacts both `forms_invitation_suppressions.recipient_hash` and `key_id` as `key_material`, exports the remaining metadata and records the row count | Binding decision: no SUPPRESSION-EXPORT reviewed-checksum exception or suppression handover in this version. A receiving system cannot rebuild opt-outs from the artifact. |
| 11 | Tenant-export evidence age | Default 365 days after terminal completion, floor 30, through the dedicated expiry below | Decided: the program's evidence lifetime, as action-log-retention assumption 9 and C1's EVIDENCE-AGE. It is an accountability choice, not a statutory period. Active holds and unresolved publication/reconciliation preserve the evidence. R4-3 separately fixes the installation age for null-tenant evidence: `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS`, default 365 days, floor 30, applied by the same expiry set. Its installation path runs through record retention's `privacyRetentionService.runInstallation` and `mercato privacy retention --installation`, under **Installation invocation** below. |

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

1. Validate arguments with zod. Inventory physical application tables from the live catalogue joined to installed migration snapshots, not loaded metadata alone. Load enabled declarations with `getTableExports` under R3-2. Include disabled and unknown tables, snapshot tables absent from the database, and explicitly classified internal/runtime tables. Every catalogue table gets a plan status; absence of a loaded module is never evidence of absence of data.
2. Write a `started` entry with `actionLogService.log` before reading any tenant row, including counts. An absent audit service or failed write refuses in every environment. Record the actor, tenant, reference and planned tables, never data. Catalogue/schema discovery may precede this; tenant data may not.
3. Open one repeatable-read, read-only transaction. Count planned tenant rows through the same attribution and owner readers used for export: tenant predicate, `via`, organization membership and `nullTenant`. Do not issue unscoped content queries. A disabled/unknown table with safely attributable tenant rows is a gap with its count. Unknown attribution is `ownership_unknown`, count null, and also refuses. `--allow-unexported-tables` acknowledges these named gaps; it does not enable reading unscoped rows. A table proven empty for the tenant is recorded as empty. Absent physical tables are recorded as absent.
4. For a real export, prepare `--out`. Create it with `0700`, or accept an existing empty directory only when owned by the effective user with no group/other permissions. Refuse a symlink, unsafe owner/mode or non-empty root. Children use `0700`. Every table file, attachment and manifest uses `0600`, `O_EXCL` and no-follow creation regardless of umask. Verify parents without following links and refuse replacement links; every resolved path stays under the verified root. Catalogue table names are encoded as safe single path components.
5. Read rows in keyset batches, decrypt, check for residual ciphertext, apply redaction, and append NDJSON. Capture exactly the attachment ids and storage references from rows read inside this snapshot, through the attachments owner. Never list attachments again after the snapshot. Capture tenant/organization, partition, storage path, original name and expected size in memory.
6. Close the read snapshot after all row reads and attachment-reference capture, then copy only captured attachments through the owner service. Use `attachments/<uuid>/<safe name>` with a validated UUID and `sanitizeUploadedFileName`, never the original name as a path. The writer owns the exclusive destination descriptor; the service streams the driver's `toLocalPath` source into it and releases its cleanup callback. Check captured tenant/organization and expected size. Later additions are not copied. A removed/changed object is missing/inconsistent and fails unless explicitly allowed, then is a manifest gap. Byte equality at the database snapshot cannot be guaranteed without storage versioning.
7. Append the completed audit outcome through the audit service on its separate writable transaction, never the export read-only manager, with counts/status and `publicationStatus: 'pending'` before publishing `manifest.json`. If completion fails, exit 1, publish no manifest and clean partial output. Write the manifest as the last output file, then append a publication acknowledgement with `publicationStatus: 'published'` under the same export run id. A failed acknowledgement exits 1, preserves the private artifact and marks publication reconciliation unresolved; it cannot be expired as settled evidence. Exit 0 only for a complete, audited handover, otherwise 2 for allowed gaps. A manifest-write failure is exit 1 and leaves an audit trail.

`--dry-run` performs steps 1–3, then closes the read snapshot and appends the completed audit outcome on the separate writable audit service with counts, `dryRun: true` and `publicationStatus: 'not_required'`. Counting is an explicit read step in the snapshot, using the same reader predicates. It opens no output directory or data file. For an unchanged database, its counts equal the export's row counts. Failed audit completion is exit 1; allowed inventory gaps produce exit 2.

`--tables` is unsupported and exits 1 before reading. `--skip-attachments` retains table rows but records omitted file ids, `complete: false` and exit 2, even if the snapshot has no files. Allowed missing attachments, undecryptable values and unexported tables likewise make the result incomplete. Derived/authentication/global exclusions are expected exclusions, not omissions.

On handled failure before manifest publication, remove only files and directories this run created; preserve a pre-existing empty root. If cleanup fails, print the remaining path and tell the operator to delete the decrypted partial output. Unhandled crashes can leave an owner-only partial directory. The docs require deleting it; a directory without a manifest is incomplete. A crash after manifest publication still has a completed audit entry, but evidence remains unresolved until its publication acknowledgement or explicit reconciliation.

### Declarations

DEC-G, “The tenant-export reader and its declarations”, puts `tableExports` beside the coverage `tables` map in the default export. A table can have an export declaration whether coverage puts it in a class, in the coverage map or on the baseline. An export declaration never counts as coverage.

| Member | Meaning |
|---|---|
| absent | Scalar-column defaults still pass all guards, but a non-global table needs an owning module's registered reader; absence never authorizes generic reads |
| `exclude` | Never export the table; reason `authentication`, `runtime_state`, `derived` or `global` |
| `redact` | Write named columns as null; reason `credential`, `token`, `key_material` or `may_embed_secrets` |
| `via` | Scope through a parent and explicit joining columns; the parent needs a valid scope plan, even if excluded from output |
| `nullTenant` | `global` omits null-tenant rows; `shared` exports reviewed non-personal definitions separately; `organization` or a declared `via` attributes rows through their owner |
| `reader` | DI key resolving to the owning module's `PrivacyTableReader`, required for every non-global table |
| `scanReader` | Same owner and type, used instead of `reader` for special scan decryption; ignored by export |
| `reviewedChecksums` | Explicit scalar checksum column/rationale exceptions only; never mapped/module-written lookup hashes or identifier-purpose digests |
| `json` | Per-JSON-column reviewed decision, `export` with rationale or `redact` with reason and rationale |

`entities` supplies readers for custom fields and custom-entity records; `forms` for its encrypted tables. `audit_logs` redacts change-history snapshots and replay input as `may_embed_secrets`. `auth` excludes `sessions` and `password_resets` as `authentication`, but still declares their `via` joins through `users`; `users.password_hash` redacts as `credential`. The same requirement applies to tenant-less portal sessions/reset/verification tables and message-access tokens: each owner supplies attribution, not a scan waiver.

All lookup hashes redact as `key_material`, including mapped `hashField` siblings and module-written address hashes. They never enter a reviewed-safe list. Reviewed-safe scalar checksums use `reviewedChecksums`, with a column and rationale. Validation refuses a mapped lookup `hashField` or module-declared lookup column in that list. A coverage entry classified `credential` must be excluded or redacted in `tableExports`, as coverage-helper rule 6 requires.

**Forms suppression metadata.** R4-9 — “Suppression state in a tenant export”: The forms-owned `tableExports.forms_invitation_suppressions` entry SHALL use its registered reader and `redact: { columns: ['recipient_hash', 'key_id'], reason: 'key_material' }`. Scoped `id`, `tenant_id`, `organization_id`, `source`, `created_at` and `updated_at` export under normal scalar guards. Both redacted columns are null; the manifest names both columns, their `key_material` reason and the row count. No raw address is exported. Neither the purpose-bound recipient digest nor its fixed key-check identifier qualifies for `reviewedChecksums`; R4-9 removes the SUPPRESSION-EXPORT exception and its full-state fallback. There is no suppression handover in this version: a receiving system cannot rebuild opt-outs, even with the original suppression key. Table coverage, content-ai and unsubscribe cite this export contract; their previous key-id export text is superseded by R4-9. Suppression digests use the forms purpose key and remain outside B1 Phase D / R3-12. Subject erasure keeps this objection state under the unsubscribe spec's assumption 8; its indefinite, unmatched retention remains a declared limit.

R3-12 — “Fill commands for module-written hashes” and DEC-F — “The B1 hand-offs” belong to the encryption-map spec's “Phase D — Lookup hashes and system-scope rotation”. In particular, `mercato customers fill-lookup-hashes` is introduced there; it does not exist in today's code. This export neither invokes it nor treats purpose-bound suppression digests as its lookup columns.

`nullTenant: 'shared'` is permitted only when the coverage entry is `none` or `tenant_configuration` and no data class lists the table. Review must establish that null-tenant rows are non-personal shared definitions. Choosing the flag cannot make `users`, `action_logs`, `api_keys` or `user_consents` shared. The export guard and C5 failure rule 7 enforce this restriction beside credential rule 6.

### The declaration guards

Per-package tests reuse C5's snapshot reader. Runtime export-plan validation enforces the same rules.

- R5-8 accepts `exclude: { reason: 'global' }` only when the module's canonical migration snapshot has neither `tenant_id` nor `organization_id` and the table appears on C5's test-reviewed list with a one-line reason. Otherwise validation fails, naming the table; the exclusion cannot waive export attribution or scanning. Consume this check through C5's failure rule 8 alongside the other declaration guards.
- Every non-global table has an owner-registered `reader`; tenant-less tables, including excluded ones, additionally need explicit owner attribution through `via` or that scoped reader. `scanReader` alone does not establish attribution.
- Every nullable-tenant table has `nullTenant`; `shared` satisfies the non-personal coverage rule above.
- Every column whose name contains `password`, `secret`, `token`, `credential`, `private_key`, `hash`, `otp`, `wrapped` or `signature` is redacted, in a wholly excluded table, or a reviewed-safe scalar checksum. Lookup hashes and identifier-purpose digests must redact or belong to an excluded table; they cannot be safe-listed.
- Every JSON/jsonb column has a reviewed `json` decision or belongs to a wholly excluded table. This includes provider state and module configs, even when keys look harmless. Mixed configuration/secret JSON defaults to whole-column redaction; no recursive key-name guessing. An explicit JSON export must also pass the secret-name guard; contradictory decisions fail.

An entry for a table absent from its module's snapshots fails C5 failure rule 2; rule 3 validates referenced classes, seams, sets and entities. A whole-table exclusion satisfies column guards, so `sessions.token` needs no redundant redaction, but it still needs tenant attribution for scanning. Reviewed-safe scalar checksum entries record a rationale and exact column; a recipient digest cannot enter that list.

### The reader and scan mode

DEC-G requires `mode: 'export' | 'scan'`. Export applies redaction. Scan ignores `exclude` and `redact`, decrypts in memory and writes no values. It keeps identical tenant/organization and null-tenant attribution.

`exclude: global` is the sole table-level `not_applicable` status, only after R5-8's snapshot and reviewed-list checks above pass: do not read the table; include its validated declaration, snapshot column check and reviewed reason in the result. An invalid global declaration fails validation, never producing `not_applicable`. Other excluded tenant-less tables require a scoped join or reader. Missing attribution, missing/throwing readers and unreadable columns are `not_scanned`, with a reason, and scanning continues. Ciphertext is a column gap, never a clean read or a substituted null. Owner readers also count tenant-less rows whose attribution parent is missing, without exposing their contents; globally ambiguous orphans are reported as not scanned rather than silently omitted by an inner join. Disabled/unknown physical tables remain inventory entries: tenant rows or unknown attribution produce named scan gaps; safely counted zero tenant rows are recorded as empty.

`query_index` declares its `scanReader` for `entity_indexes` on `tableExports`, decrypting `doc` through `decryptIndexDocForSearch` in `packages/shared/src/lib/encryption/indexDoc.ts` using the row's entity type. Export still excludes it as derived.

Under program DEC-9, each owning module SHALL register its readers in DI and call the shared DEC-G helper only for its own allowlisted tables, with the same transaction, tenant checks and gap events in both modes. `privacy` orchestrates readers and never issues their content/count queries. A `via` parent in another module is reached through that parent's owning reader/service, including when excluded from output; it is never permission for a foreign-table join. Missing owner registration or parent scope capability is a gap. All required registrations and both-mode contract tests ship before G6; no generic fallback runs on a missing reader.

## 📝 Delta

### Capability: tenant-exit-export

#### ADDED Requirement: Scoped, explicit handover
The system SHALL export one tenant's readable data without another tenant's rows, credentials or lookup hashes, and SHALL state every omission and gap.

##### Scenario: Export and child rows
- WHEN a tenant has ordinary, tenant-less child, organization-only and encrypted custom-field rows
- THEN each output row belongs to the tenant under the declared predicate, decryption succeeds, and manifest counts/checksums match

##### Scenario: Excluded and global tables
- WHEN authentication tables are excluded and `feature_toggles` is declared global with no tenant/organization columns in its canonical migration snapshot and a one-line reason on C5's reviewed list
- THEN authentication tables still have scoped readers for scanning; the validated global table is not applicable under R5-8
- WHEN a global declaration names a table with either tenant/organization column, lacks reviewed-list membership or has no one-line reason
- THEN static coverage and runtime plan validation fail, naming the table; neither export nor scan accepts the exclusion

##### Scenario: Disabled module or unknown table
- WHEN the catalogue contains disabled-module tenant rows or a table with unknown ownership
- THEN export refuses unless `--allow-unexported-tables` acknowledges the gap, and an allowed result has `complete: false` and exit 2

##### Scenario: Secret/JSON/shared declaration
- WHEN an unreviewed JSON column, unredacted lookup hash or shared personal table is planned
- THEN guards and export-plan validation refuse it

##### Scenario: Dry-run counts
- WHEN dry run is requested
- THEN the same attributed readers count inside the snapshot, audit records completion and no output directory/file is made

##### Scenario: Incomplete file export
- WHEN attachments are skipped or a permitted missing/changed object is encountered
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
- THEN the audit owner deletes the whole lifecycle group and retains only aggregate counts/dates; holds and unresolved publication defer expiry. R4-3 applies the same set to null-tenant groups using the installation age, never a tenant setting, only through record retention's installation run below

##### Scenario: Installation run expires null-tenant evidence
- WHEN `mercato privacy retention --installation --set privacy.tenant_export_evidence` runs with settled null-tenant groups older than the installation age and no hold in any tenant
- THEN preview counts those groups and changes nothing; apply deletes only those whole groups, keeps recent, unresolved and mixed-tenant groups and every tenant row, and writes one aggregate summary with null tenant and organization
- WHEN any tenant has an active hold, or an `--exclude-subject` value is given
- THEN the set skips with `hold_not_honourable` and nothing is deleted

##### Scenario: Suppression metadata export
- WHEN `forms_invitation_suppressions` rows belong to the exported tenant
- THEN `recipient_hash` and `key_id` are null, the manifest names both redactions and the row count, and the artifact makes no claim to rebuild recipient opt-outs (R4-9)

##### Scenario: Scan mode
- WHEN scan reads an excluded table or redacted column
- THEN only tenant-attributed values reach its in-memory caller, no file is opened, and unreadable tables/columns are explicit gaps

## 📝 Architecture

- `packages/shared/src/modules/privacy.ts`: declaration schemas, `PrivacyTableReader` and result type; `registry.ts`: `getTableExports` from R3-2's `module.privacy`.
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

No entity or migration. Row files use database column names, JSON as JSON, timestamps as ISO strings and binary values as base64. The manifest carries `formatVersion: '1'`, application version, tenant id, reference, time, enabled module ids, inventory source, audit id and `complete`. It lists row counts, SHA-256 and redacted columns/reasons per file; attachment ids, original names, safe relative paths, sizes and SHA-256; expected exclusions; intentional omissions; unreadable/null values; disabled/unknown tables and counts or null. Shared definitions are in separately labelled files.

## 📝 API Contracts

### Declarations — `@open-mercato/shared/modules/privacy`

```ts
type TableExportVia = { parent: string; on: Array<[column: string, parentColumn: string]> }
type RedactReason = 'credential' | 'token' | 'key_material' | 'may_embed_secrets'
type TableExportEntry = {
  exclude?: { reason: 'authentication' | 'runtime_state' | 'derived' | 'global' }
  redact?: { columns: string[]; reason: RedactReason }
  via?: TableExportVia
  nullTenant?: 'global' | 'shared' | 'organization' | { via: TableExportVia }
  reader?: string
  scanReader?: string
  reviewedChecksums?: Array<{ column: string; rationale: string }>
  json?: Record<string, { decision: 'export'; rationale: string } | { decision: 'redact'; reason: RedactReason; rationale: string }>
}
```

The default export gains `tableExports?: Record<string, TableExportEntry>`, independently validated by `getTableExports`. R3-2 owns registry generation; DEC-G owns the declaration location. No export-only entry changes coverage.

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

export type PrivacyTableReader = (input: {
  tenantId: string
  table: string
  trx: EntityManager
  mode: 'export' | 'scan'
  batchSize: number
  after?: string
}) => AsyncIterable<PrivacyTableReadResult>
```

`EntityManager` is a type-only import from `@mikro-orm/postgresql`, bound to the shared read-only snapshot. `batchSize` is zod-validated from 1 to 100. The iterable streams all rows after an optional opaque keyset cursor in bounded batches. Every row carries a stable primary-key encoding and continuation cursor; composite keys use a deterministic JSON tuple. An unreadable table yields `row: null`, null row id and a reason even if no rows are available. Column gaps name columns, never failed values.

Owner readers enforce tenant attribution, including all organizations of this tenant, and reject a `table` outside their module's allowlist before querying. They decrypt through existing helpers, never apply export redaction, open output files or log rows. The orchestrator applies redaction/JSON decisions only in export mode. Undecryptable fields fail or become declared null gaps there; scan mode reports them as gaps without hiding the evidence. Both `reader` and `scanReader` DI keys resolve to this exact type. Reader errors become explicit gaps, never an empty successful table. Disabled-module declarations/registrations cannot be assumed loaded; safely counted empty entries remain empty, otherwise they retain the named unavailable/ownership gap.

### CLI, audit and output

Flags and declaration/result shapes use zod in `privacy/data/validators.ts` and the shared privacy module; operator messages use translation keys through the CLI resolver; tenant is a UUID, reference is required and bounded to the contract's 120 characters. No HTTP route or UI is added. The tenant-wide CLI covers every organization in that tenant and never other tenants.

| Exit | Meaning |
|---|---|
| 0 | Complete export, or successful gap-free dry run |
| 1 | Usage/refused plan, audit or other failure; unsupported `--tables` included |
| 2 | Completed with an explicit omission or allowed gap; manifest `complete: false` |

Audit uses resource kind `privacy.tenant_export`, command id `privacy.tenant.export`, resource id tenant UUID and actor `system:privacy-cli`. Start precedes all tenant reads; completion precedes manifest publication. Append-only context carries a generated export `runId`, reference, status, publication state, counts and no exported data or paths. The manifest's audit id and this run id correlate the lifecycle. No manifest means incomplete output; publication acknowledgement settles its evidence without mutating an earlier entry. After a crash, an authorized operator can append an audit-owner-validated reconciliation outcome for that run, confirming publication or complete cleanup; an unknown outcome stays unresolved.

**Tenant-export evidence expiry.** Action-log-retention's assumption 9 and “Evidence outside the generic sets” require this dedicated finite bound. Declare `retention.privacy.tenantExportEvidenceAgeDays` in `privacy.ts.settings`: integer days, minimum 30, default 365 (assumption 11). Resolve it through R3-3 — “Tenant privacy settings live in `module_configs`”, owned by C1. Declare `privacy.tenant_export_evidence` with `targets: ['records']`, `minimumDays: 30`, `excludableSubjectKinds: []`, locale-key `title`/`ageBasis`, `handlerService: 'privacyTenantExportEvidenceRetentionHandler'`, `runEvidence: 'aggregate'` and `installationScope: true`, using record retention's existing “Aggregate evidence for expiry runs” and “Installation-scope runs” contracts; R3-2 accepts the flag because the set already declares aggregate evidence, `['records']` and `[]`. Run its tenant-scoped path only through `privacyRetentionService.run` under DEC-C — “Retention sets and holds”, owned by record retention, and its installation path only through `privacyRetentionService.runInstallation`; a shorter caller window refuses on either path. The shared driver writes its strict `PrivacyRetentionAggregateSummary`; neither the handler nor the CLI/engine writes a second identifying run summary. Tenant export is tenant-wide, so organization narrowing refuses. Any active Enterprise hold in the tenant or explicit subject exclusion skips the whole set with `hold_not_honourable`; a failed registered guard refuses. R3-5 — “Holds, honestly”, in the program, limits OSS to explicit exclusions.

The handler calls the audit-owned `actionLogService.expireTenantExportEvidence({ scope, olderThan, limit, after?, dryRun })`, returning `{ matched, changed, skipped, next?, done }`. The cutoff is the retention runner's fixed cutoff. In pages of at most 100, the audit service validates and rechecks its own exact `privacy.tenant_export` lifecycle groups under a run lock, then deletes only groups older than that cutoff whose publication is `published`, dry-run `not_required`, or explicitly `reconciled`. Open starts, unknown/failed publication, invalid context and unresolved reconciliation are preserved and reported, never deleted by age alone. Delete the entire settled group, including actor, tenant resource id, reference and context. Keep only the shared driver's allowed set id, aggregate counts and run dates in the expiry summary; copy no old actor/reference/run or tenant-resource identifiers. Privacy never queries audit tables, and general history's `privacy.` exclusion and DEC-B — “The audit-history strip routine”, owned by C4, remain unchanged.

**Installation evidence age — R4-3.** New CLI evidence always has the required tenant. For historical `privacy.tenant_export` rows with `tenant_id IS NULL`, the same `privacy.tenant_export_evidence` set SHALL apply `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS`: integer days, default 365, floor 30. List this setting in both `apps/mercato/.env.example` and `packages/create-app/template/.env.example`. No tenant `module_configs` age applies to null-tenant rows. The installation age uses the same terminal-completion clock, whole-group deletion and unresolved-publication/reconciliation preservation as tenant evidence; a value below 30 or a malformed value refuses. The audit owner's existing `countNullTenantExportEvidence(): Promise<number>` remains an exact-kind, `tenant_id IS NULL`, count-only assessment and never proves deletion. The former unbounded-age diagnostic/design gap is replaced by this finite installation rule.

**Installation invocation.** Record retention owns the caller, under its assumption 10 and “Installation-scope runs”: `privacyRetentionService.runInstallation` and `mercato privacy retention --installation --set privacy.tenant_export_evidence`. `PrivacyScope` stays tenant-required; the tenant `run`, `pruneRecords` and `expireTenantExportEvidence` never reach a null-tenant row. This spec owns the handler and audit integration. The set's handler implements `pruneInstallationRecords({ olderThanDays, target: 'records', limit, cutoff, after?, dryRun })`. On every batch it resolves `resolveInstallationEvidenceAgeDays()`; a malformed age refuses with `installation_age_invalid` and a window below the age refuses. No tenant setting applies. It then calls the audit-owned `actionLogService.expireInstallationTenantExportEvidence({ olderThan, limit, after?, dryRun })` with `olderThan` set to the runner's fixed cutoff, and reports its `changed` as `deleted`. The method returns `{ matched, changed, skipped, next?, done }`, like the tenant method. It selects exactly `privacy.tenant_export` action-log rows with `tenant_id IS NULL`, served by the existing `action_logs_resource_idx`. It applies the tenant path's whole-lifecycle-group rules: pages of at most 100; each group validated and rechecked; only settled `published`, dry-run `not_required` or explicitly `reconciled` groups older than the cutoff deleted; open starts, unknown or failed publication, invalid context and unresolved reconciliation preserved and reported. A group with any tenant row is invalid at installation scope and stays. It deletes the entire settled group and copies no old identifier into the summary. Each page runs in one `withAdvisoryXactLock` transaction (`@open-mercato/shared/lib/db/advisoryLock`) under the fixed key `audit_logs:tenant_export_evidence:installation`, distinct from every tenant run lock, so two installation runners cannot mutate the same selection. Holds come from the runner: any subject from the guard's `installationExcludedSubjects`, which covers a hold in any tenant, or any `--exclude-subject` value skips the whole set with `hold_not_honourable`; a registered guard that throws or lacks the method refuses with `hold_guard_failed`. The shared driver writes the one strict `PrivacyRetentionAggregateSummary` with null tenant and organization, and the command prints counts only. Privacy never queries audit tables, and this adds no command, runner, scheduler or nullable scope.

The tenant-scoped 365-day rule is enforced only with a scheduled OSS command or Enterprise record policy. The installation age is enforced only by a scheduled `mercato privacy retention --installation --set privacy.tenant_export_evidence --apply` run, by the operator or their scheduler; no engine policy covers it. With no runner, active holds or unresolved publication, report the actual unenforced/deferred state; the configured age alone is no deletion proof. This expiry follows C1 Phase 7 and record retention, without delaying the base export reader.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Existing root | Accept only empty, owned, private directory; never a symlink |
| Traversal name, NUL/control characters or invalid attachment id | Sanitize the name, require UUID id, confine every destination and refuse unsafe paths before writing |
| Root/child link replaced during writing | Refuse; use verified directory handles/no-follow checks, not a one-time lexical path test |
| Added/removed file during export | Copy captured snapshot rows only; missing/changed objects are gaps; no promise of storage-level snapshot bytes |
| Start/pre-publication completion audit fails | Initial reads nothing; final writes no manifest; exit 1 and cleanup partial output |
| Publication acknowledgement fails after manifest | Exit 1, preserve the private artifact and completed audit; report unresolved evidence until reconciliation |
| Unhandled crash | Started audit remains; owner-only decrypted partial output may need manual deletion |
| Cleanup failure | Print remaining path and deletion instruction; never label output complete |
| Disabled module or unknown physical table | Scoped nonzero count or unknown ownership refuses by default; allowed export records gap; scan reports not scanned |
| Tenant-less table whose parent is excluded | Use validated parent scope plan without exporting its values; absent attribution refuses |
| Null tenant with personal data | Never `shared`; omit as global or attribute through organization/parent as declared |
| Global table | R5-8 requires neither tenant nor organization columns in the canonical snapshot and reviewed-list membership with a one-line reason; otherwise fail naming the table, never waive scanning |
| Soft-deleted records | Included under the same ownership rules |
| Large tenant | Bounded batches; long read snapshot, run at a quiet hour; use a supported replica only when audit writes use the writable service connection |
| Undecryptable value or owner reader failure | Export fails unless applicable allow-gap flag; scan records explicit column/table gap |
| `--skip-attachments` | Record intentional omission, incomplete manifest and exit 2 |
| Old evidence is held, unresolved or has null tenant | Preserve held/unresolved groups; the same set uses the R4-3 installation age for null-tenant rows. Without a scheduled `--installation` run, report that age as not yet enforced; never substitute a tenant age or strip evidence into actor-only fragments |
| Installation run meets a mixed-tenant group, a hold in any tenant or a guard without `installationExcludedSubjects` | Preserve and report the mixed group; skip the set with `hold_not_honourable` or refuse with `hold_guard_failed`; never touch a tenant row |

## 📝 Migration & Backward Compatibility

Additive unreleased declaration, shared reader/result types, DI registrations, CLI, attachment service members, evidence setting/set and audit-owner expiry/aggregate methods. These become STABLE type/import/DI/CLI contracts on release. No existing surface is removed or narrowed; R3-2 preserves legacy `privacyDataClasses`. No new editable entity or migration; the evidence setting uses C1's shared versioned settings contract. `UPGRADE_NOTES.md` documents the audit requirement, private output, incomplete exit 2, gap flags, storage snapshot limits, crash cleanup, publication reconciliation, finite tenant/installation evidence ages, the scheduled `--installation` run that enforces the installation age and the R4-9 suppression handover limit. The set's `installationScope: true`, its handler's `pruneInstallationRecords` and `actionLogService.expireInstallationTenantExportEvidence` use record retention's additive installation surfaces; `PrivacyScope` and the tenant path are unchanged. Implementations must use the ordinary deprecation bridge for later incompatible changes.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | Declarations/guards, catalogue inventory and non-reading plan construction | C5 snapshot reader, R5-8 reviewed-list/check delivery and R3-2 contract support; program Phase 2 must place C5 before C8 |
| 2 | Shared helper, every owner DI reader, audited counting dry run, safe writer and manifest | Phase 1; both modes and all required owner registrations before G6 |
| 3 | Snapshot attachment capture/copy and documentation | Phase 2 |
| 4 | Dedicated terminal tenant-export evidence expiry, tenant and installation paths | C1 Phase 7 settings and the record-retention service, including `runInstallation` and `--installation`; unresolved evidence is preserved |

## 📋 Implementation Plan

### Phase 1 — Inventory and declarations
1. Add `tableExports`, its zod schema and collector under R3-2. `tenantExportDeclarations.test.ts`: entries work for class-covered, coverage-map and baseline tables without counting as coverage; invalid reasons refuse.
2. Add guards and owner declarations. Same unit suite: excluded `sessions.token` needs no redundant redaction but needs scope; `feature_toggles` is global only with neither tenant/organization column in its canonical snapshot and reviewed-list membership with a one-line reason (R5-8). Reject global declarations for a tenant-column table, an organization-column table and a class-covered tenant table, plus an otherwise eligible table absent from the reviewed list or missing its reason; each failure names the table and prevents export/scan waiver. Run these cases through static coverage and runtime plan validation, consuming C5 failure rule 8. JSON secret under an innocuous key refuses until redacted; a reviewed scalar checksum exception validates at plan time while lookup hashes/recipient digests never safe-list; `shared` personal or class-covered tables refuse. Consume C5's existing failure rule 7 for the shared-row restriction.
3. Implement catalogue/snapshot inventory and non-reading plan validation. Tenant row counts/dry-run execution wait for Phase 2 readers and pre-read audit; no tenant data is read in Phase 1. `tenantExportPlan.test.ts`: disabled table with rows refuses then records a gap with allow; unknown ownership refuses; scope metadata for disabled tables is retained; excluded parent still supplies an attribution plan; `--tables` refuses. Database count assertions follow in Phase 2.

### Phase 2 — Reader and auditable output
1. Implement `PrivacyTableReader`, the shared helper and orchestration under DEC-9. `privacyTableReaderContract.test.ts`: transaction propagation, batches/cursors, stable row ids, tenant/organization/via/null ownership, owner allowlist rejects foreign tables, cross-owner parent attribution through sanctioned services, mapped/system-scope/custom-field decryption, JSON parsing, orchestrator-only redaction, reader errors and ciphertext as gaps. `exclude: global` is not applicable; excluded non-global tables remain scoped and scannable.
2. Register a reader in every owning module's DI and `tableExports`, including `entities` and `forms`, and the `query_index` scan reader. Run the same contract tests in both modes; G6 cannot ship without these registrations. Add the forms suppression declaration and a guard test that both `recipient_hash` and `key_id` redact as `key_material`, the manifest names both columns/reasons and the row count, minimal scalar metadata exports normally and `reviewedChecksums` cannot bypass either redaction. Assert that the artifact cannot rebuild opt-outs under R4-9.
3. Implement private writer and started/completed/publication audit lifecycle. `tenantExportWriter.test.ts`: permissive umask yields `0700`/`0600`, unsafe/symlink roots and children refuse, all file kinds are exclusive, checksums/counts match, initial audit failure reads nothing, completion failure publishes no manifest and cleans output, cleanup failure names path, audit completion precedes manifest and acknowledgement follows it; acknowledgement failure preserves the private artifact but exits 1 with unresolved evidence; omission sets incomplete/exit 2.
4. Enable counting dry run only after the readers and started/completed audit exist. Unit tests cover disabled rows refusing/allowing gaps, scoped empty tables and dry-run/export counts with identical tenant/null/organization predicates. Run attachment-free integration subsets at this phase; full TC-TENANT-EXPORT-001/002 wait for Phase 3.

### Phase 3 — Files and docs
1. Add attachment capture inside the snapshot and exact-reference copying through the owner service. `tenantExportAttachments.test.ts`: later insertion not copied, removed/changed captured file is a gap, failed copy cleans partial output, original-name traversal cannot escape, pre-existing/link destinations and invalid ids refuse. Test empty names, slash/backslash, NUL and control characters.
2. Run the full TC-TENANT-EXPORT-001/002 with snapshot attachment capture/copy implemented, all own fixtures and cleanup.
3. Document format, handover, incomplete output, private permissions and mandatory partial-output cleanup in the deployment page and `UPGRADE_NOTES.md`.
4. Archive the Delta into a capability file only if that repository convention exists when implemented.

### Phase 4 — Evidence lifecycle
1. Declare the setting and records set after C1 Phase 7 and record retention, selecting the owner's existing `runEvidence: 'aggregate'` driver projection. Declare R4-3's `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS` in both `.env.example` files, default 365 and floor 30, and apply it to null-tenant rows through this same set. Implement audit-owned expiry and the exact null-tenant count, with no privacy-side table reads. Declare `installationScope: true`, implement the handler's `pruneInstallationRecords` and the audit-owned `actionLogService.expireInstallationTenantExportEvidence` under **Installation invocation** above. `tenantExportEvidenceRetention.test.ts` covers default/override/floor, fixed cutoff and repeated batches, whole-entry deletion, hold/exclusion skip and guard failure, no runner, published/dry-run/reconciled outcomes, unresolved crash/publication preservation, installation default/override/floor validation, tenant/null-tenant age isolation and the same-set null-tenant expiry obligation, and declaration-selected summaries containing only the driver's allowed aggregate counts/dates/set id, without a duplicate identifying CLI/engine summary. Its installation cases cover: R3-2 accepting the declaration; `installation_age_invalid` and a window below the installation age, checked on every batch; exact `tenant_id IS NULL` selection with every tenant row untouched; settled, recent, unresolved, invalid and mixed-tenant groups; pages of at most 100 with the fixed cutoff and keyset; the fixed installation lock key, distinct from tenant locks, serialising two runners; `changed` reported as `deleted`; `installationExcludedSubjects` holds, a throwing or missing method and `--exclude-subject`; a null tenant and organization summary; and the tenant method never reaching a null-tenant row.
2. Extend TC-TENANT-EXPORT-002 with aged/recent settled and unresolved own export evidence, a held tenant and a null-tenant fixture; assert tenant holds/unresolved deferral and R4-3 age isolation. Run `mercato privacy retention --installation --set privacy.tenant_export_evidence` in preview, then with `--apply`: settled null-tenant groups older than the installation age expire while recent/unresolved null-tenant groups and every tenant row stay, and the summary has null tenant and organization. Clean every fixture through the audit owner. Document the scheduled `--installation` run, the tenant runner requirement and the reconciliation procedure before program closure.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/modules/{privacy.ts,registry.ts}` | Modify — future declaration and shared reader/result types/collector |
| `packages/core/src/modules/privacy/{cli.ts,data/validators.ts,lib/tenantExport/*}` and named unit suites | Create/modify — module was created by doctor spec |
| Owner `privacy.ts` files and one `tenant-export-coverage.test.ts` per package | Create/modify — scope, JSON and redaction decisions |
| `packages/shared/src/lib/privacy/tableReader.ts`; each owning module's reader and DI registration, including `entities`, `forms`, `query_index` | Create/modify — shared helper bound to own-table allowlists and both-mode owner implementations before G6 |
| `packages/core/src/modules/attachments/lib/attachment-service.ts` and tests | Modify — snapshot capture and copy members |
| `packages/core/src/modules/privacy/{privacy.ts,di.ts,lib/tenantExport/evidenceRetention.ts}` and `tenantExportEvidenceRetention.test.ts`; `audit_logs/services/actionLogService.ts` and owner tests | Declare evidence setting/set; audit-owned terminal-group expiry, publication/reconciliation validation, R4-3 same-set installation age and exact null-tenant aggregate; `installationScope: true`, handler `pruneInstallationRecords` and `expireInstallationTenantExportEvidence` under the fixed installation lock |
| `apps/mercato/.env.example`, `packages/create-app/template/.env.example` | List `OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS`, default 365 days, floor 30; mirror through template sync |
| `packages/core/src/modules/privacy/__integration__/TC-TENANT-EXPORT-00{1,2}.spec.ts` | Create |
| `packages/core/AGENTS.md`, contract spec | Unchanged — DEC-9 keeps the no-cross-module-table-access rule with no exception, so neither needs an exception entry |
| `apps/docs/docs/deployment/gdpr/tenant-exit-export.mdx`, `UPGRADE_NOTES.md` | Create/modify |

## 🧪 Integration Coverage

No new HTTP/UI path. Test-only module-owned row probes can inspect captured fixture row ids even after an attribution parent is gone; production scans never gain an unscoped row-id read. All fixtures are owned by each test, created by APIs where possible and owner-service setup for unsupported cases, removed in `finally` together with directories and overrides.

| Test | Covers |
|---|---|
| TC-TENANT-EXPORT-001 | Own two tenants, staff users, people, deals, encrypted custom fields and attachments; seed maps and assert raw ciphertext first. Also create a tenant-less installation user, global row, reviewed safe shared definition, organization-only forms and scoped suppression rows in both tenants, and a second-tenant custom-field value/attachment. Assert no second-tenant or installation-person sentinel; global row absent; only safe non-personal shared definition in labelled file; forms/fields readable, child links scoped, password/lookup hashes null, sessions excluded and attachments/checksums/counts/modes correct. Suppression recipient_hash and key_id are null and the manifest names both columns, the key_material reason and the row count; minimal metadata exports normally, without raw address or reusable recipient state, and a reviewed-checksum entry cannot bypass either redaction. Assert that the receiving system cannot rebuild opt-outs. Test the owner's key-mismatch send refusal separately through its service fixture. Unchanged dry-run/export counts agree. Remove all own rows, secrets/overrides and output. |
| TC-TENANT-EXPORT-002 | Own tenant/attachment, a fixture disabled-module table with tenant rows and an unknown-attribution table. Default refuses; allowed run lists exact gaps, complete false/exit 2; skip-attachments records omission/exit 2; --tables exits 1. Scoped authentication exclusions remain scannable; standard global feature_toggles is not applicable. Inject start/completion failures: no unaudited manifest; a separate post-publication acknowledgement failure exits 1 with preserved private output and unresolved evidence. Phase 4 adds aged/recent settled groups, held/unresolved evidence and null-tenant fixtures: only eligible whole groups expire through the audit owner, summaries are aggregate-only; null-tenant ages come solely from OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS. mercato privacy retention --installation --set privacy.tenant_export_evidence previews without writing, then on apply deletes only settled null-tenant groups older than the installation age; recent, unresolved and mixed-tenant null-tenant groups and every tenant row remain, checked by direct queries. The new summary has null tenant and organization and only set id, counts and dates. --exclude-subject skips with hold_not_honourable; Enterprise lane: an active hold in another tenant skips, and a guard without installationExcludedSubjects refuses. Remove all fixture tables/rows/audits, setting and environment overrides and output. |

## 📝 Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Wrong join or null-tenant sharing exports another tenant/person | Critical | Every tenant | Scoped owner readers, shared-only non-personal rule, two-tenant/installation-user/organization/custom-field integration fixtures | Later declaration can still be wrong; each join needs owner review |
| Secret leaves in innocuous JSON or lookup hashes | High | Recipient and account credentials | Every JSON column reviewed; lookup hashes redact; secret-name guard, whole-table exclusions | Incorrect reviewed JSON decision or innocuous secret scalar remains possible; export stays sensitive |
| Disabled/unknown tables silently missing | High | Leaving tenant | Live catalogue inventory, scoped counts/unknown-ownership gaps, default refusal and explicit incomplete manifest | Stores unknown to the product remain outside this handover |
| Scan caller logs decrypted excluded values | High | Operator output | Reader writes nothing; verifier prints locations only; same tenant predicate | A future caller can still misuse in-memory rows |
| Copy/audit failure or crash leaves decrypted output | High | Operator host and accountability | Private modes, exclusive no-follow files, start before reads, complete before manifest, handled cleanup and remaining-path instruction | Unhandled crash needs manual cleanup; bytes lack a database snapshot |
| Tenant-supplied name or swapped link redirects write | Critical | Operator host | Sanitized component under UUID, verified directory handles, exclusive no-follow creation | Contents remain tenant-supplied; do not execute exported files |
| Long read snapshot loads primary | Medium | Other tenants | Bounded batches and quiet-hour/compatible-replica procedure | Rare operator run can still hold a long snapshot |
| Redacted suppression metadata is treated as a usable opt-out list | High | Leaving tenant and recipients | R4-9 nulls recipient_hash/key_id, records row count and documents that opt-outs cannot be rebuilt; no checksum exception | This version supplies no suppression handover |
| Null-tenant evidence outlives its installation age | Medium | Installation evidence | R4-3 same-set finite age, both environment examples, record retention's `--installation` run, age-isolation tests and reported skips/refusals; preview shows what is due | Until an operator schedules `--installation` runs, and while any tenant holds a subject, the age is designed but not enforced |
| An installation run deletes tenant evidence | High | Privacy evidence in every tenant | Separate `runInstallation` entry; the audit method selects exactly `tenant_id IS NULL` and preserves mixed-tenant groups; fixed installation lock; tenant method never reaches null-tenant rows; owner tests and TC-TENANT-EXPORT-002 assert tenant rows survive | An owner method that ignores the exact null-tenant predicate; owner tests are release gates |

## Final Compliance Report — 2026-11-16

Fresh-context review corrected dry-run/reader/audit and attachment-test ordering and made the checksum exception expressible in the declaration contract.

Reviewed root/spec rules, backward-compatibility surfaces, shared encryption/boundaries, core Encryption/Cross-Module Coupling, CLI boundaries, create-app sync, queue/search boundaries and QA fixture rules. No code was changed or validation environment started.

| Rule | Status | Evidence or remaining gate |
|---|---|---|
| Tenant/organization isolation | Designed | Scoped joins/readers and two-tenant/null/organization integration sentinels; R5-8 global exclusions require the canonical snapshot column check and reviewed-list reason |
| Module table boundaries | Designed under DEC-9 | Owners call the helper only for their own allowlisted tables; both-mode DI registrations precede G6; no generic reader |
| Encryption helpers | Designed | Existing mapped/custom-field/index-doc helpers; owner forms reader |
| Zod and pageSize <= 100 | Designed | CLI/declaration/result validation; batches 1–100 |
| Additive shared types/DI/CLI | Designed | `PrivacyTableReader` defined here; no frozen surface removed; upgrade documentation planned |
| Optimistic locking | Not applicable | No new editable entity/form |
| Integration fixtures and cleanup | Designed | Two named tests own all records, tables, files and overrides |
| Inventory/scheduling consistency | Aligned for export | Program places C5 before C8; C5 failure rule 7 now enforces shared rows. G6's operational-bound projection remains a separate owner handoff |
| Dedicated export-evidence age | Designed, tenant and installation paths | Same set uses tenant setting or OM_PRIVACY_INSTALLATION_EVIDENCE_AGE_DAYS, default 365/floor 30; both environment examples, same lifecycle preservation, no tenant-setting fallback for null rows; installation path through `runInstallation` / `--installation` and `expireInstallationTenantExportEvidence`; enforcement needs a scheduled `--installation` run |
| Suppression export | R4-9 aligned | recipient_hash/key_id redacted as key_material; manifest redactions and row count; no SUPPRESSION-EXPORT checksum exception or opt-out reconstruction claim |

**Verdict:** design decided; implement by phase. Every assumption is settled, with program DEC-9's module-owned readers and OSS placement under DEC-2. Both-mode owner registrations precede G6. Output and audit guarantees are explicit; file bytes are not transactionally snapshotted. Null-tenant evidence expires through record retention's installation run; it is enforced only once an operator schedules `mercato privacy retention --installation --set privacy.tenant_export_evidence --apply`.

## Changelog

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
