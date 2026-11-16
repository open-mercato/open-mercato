# Tenant exit export

> **Program:** package C8 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Reference only:** the `tenant_exports` module and its spec on `upstream/feat/security-readiness` (PR #5557, open, conflicting).
> **Builds on:** the `privacy.ts` convention and the `privacy` module from [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md), and the per-table declarations and snapshot reader of [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md).
> **Needs a ruling first.** The command reads every module's tables generically. The contract spec rejected a central service that does that for one person's export. This spec argues the tenant case is different; a maintainer has to agree before any of it is built.
> **Verified at** `main` @ `08dada9624` and against that branch by reading; nothing was run. Entity counts come from a source scan, not from loaded ORM metadata.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md

## 📝 TLDR

When a customer leaves, the operator must hand back their data. Today that means writing SQL by hand against 345 tables — nineteen with no tenant column and forty-three where it may be empty — with encrypted columns that come out as ciphertext and secrets mixed in. **Proposed (future):** one operator command writes a tenant's data to a directory: one file per table, decrypted, with a manifest of what is in it, what was left out and why. What to leave out — sessions, password hashes, keys — and how a table without a tenant column belongs to a tenant are declared by the module that owns each table, and tests fail when a declaration is missing.

**Not in this spec:** importing the result anywhere; backups; deleting the tenant afterwards; an export for one person (the contract spec's export command); a screen for tenants to export themselves.

## 📝 Overview

> **Market reference.** GitLab's project export and Discourse's backup both produce one archive of structured files with a version manifest, and both leave out credentials and tokens by an explicit list. The GDPR's Art. 28(3)(g) asks a processor to return the data at the end of the contract; Art. 20 asks for a structured, commonly used, machine-readable format. Adopted: newline-delimited JSON per table, a manifest with checksums, an explicit list of exclusions. Rejected: a database dump, which carries ciphertext and every tenant's rows.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | A generic reader, or a handler per module | A generic reader, with module-owned declarations and module-owned readers for the tables that need them | ⚠ NEEDS HUMAN CONFIRMATION, and it blocks the spec. Rules for one person's data differ by module, which is why the contract spec rejected a central service. A tenant's export has no such rules: every row of the tenant leaves, apart from declared exclusions. If refused, the fallback is below. |
| 2 | What decides exclusions and redactions | Declarations in each module's `privacy.ts`. A table or column nobody declared is exported | The reference branch replaced its table denylist with module-owned declarations after review, but still redacted columns by a name pattern that misses `key_hash`, `code_hash`, `otp_code_hash` and `wrapped_dek`. A pattern is kept only as a test that demands a declaration. |
| 3 | Tables with no tenant column, or one that may be empty | The owning module declares how each reaches a tenant and what an empty tenant means. An undeclared one stops the export | Guessing from foreign keys silently omits a table; guessing about empty tenants either omits a tenant's rows or exports everyone's. |
| 4 | Output | A directory of files, owner-only. No archive, no encryption | ⚠ NEEDS HUMAN CONFIRMATION. The reference spawned the system `tar`. Packing and encrypting are one line for an operator and a dependency or a shell-out for the product. |
| 5 | Undecryptable values | The export fails, naming the table and column, unless the operator passes a flag that writes null and records it | An export that quietly contains ciphertext is not a return of the data. |
| 6 | Consistency | One repeatable-read transaction for the database part, used by every reader. Files are outside it | A tenant in use while it is exported would otherwise yield rows that do not agree. |
| 7 | Derived data | Not exported: search tokens, the vector index, the fulltext index, queues, caches | It can be rebuilt and holds nothing the tables do not. |
| 8 | Edition | OSS | As on the reference branch. The program's fallback keeps only a seam in OSS if maintainers decide otherwise. |
| 9 | Import | None promised | The format is documented; it is a handover, not a backup. |

**If assumption 1 is refused.** Every module exports its own tables through a handler it registers, and the reader in this spec becomes a shared helper that each handler calls for its own tables. The declarations, the manifest, the guards and the command stay as specified; the cost is a handler registration in each of about fifty modules.

## 📝 Problem Statement

- **No tenant-wide export exists** on `main`. The enterprise backup work is whole-database, excludes attachments and copies encrypted columns as ciphertext (`.ai/specs/enterprise/2026-11-06-cli-backup-restore.md:22, 29, 162`).
- **345 tables in 57 migration snapshots.** Nineteen have no tenant column: `user_roles`, `sessions`, `password_resets` reach a tenant through the user; `message_recipients` through the message; `customer_deal_people` through the deal; five forms tables carry only an organization; `feature_toggles` is global.
- **Forty-three more have a tenant column that may be empty**, among them `users`, `attachments`, `action_logs`, `access_logs`, `api_keys`, `sso_identities`, `user_consents`, `module_configs` and `scheduled_jobs`. An empty tenant means something different in each: a shared definition, an installation-wide row, or a row that belongs to a tenant through its organization.
- **Decryption has four forms, and only one is a map lookup.**
  - Mapped columns, through `decryptEntityPayload`, which returns its input unchanged when it finds no key or no map (`packages/shared/src/lib/encryption/tenantDataEncryptionService.ts:648-658`).
  - Maps scoped to the installation or to an organization instead of the tenant (`:238`).
  - Encrypted JSON, which decrypts to a string that must be parsed (`parseDecryptedFieldValue`).
  - Custom-field values, which are flagged on their definition and decrypted by their own function, outside any map (`packages/shared/src/lib/encryption/customFieldValues.ts:181-199`; `entities/lib/helpers.ts:196-256`). Forms has its own keys altogether.
- **The existing generic walkers are narrower than they look.** The key-rotation command walks only entities that have an encryption-map row (`entities/cli.ts:392-470`); the reindex command walks entity ids registered for its own index (`query_index/cli.ts:652`). Neither reads a table nobody declared.
- **Secret-looking columns are many.** A name pattern for them matches 78 columns in 53 tables, and there are 344 JSON columns that a name cannot see into. The change history's stored snapshots are a known carrier of password hashes.
- **Attachments** are rows with a storage driver and path. A driver can copy a file to a local path as well as read it into memory (`attachments/lib/drivers/types.ts:22-33`).
- **The generated registry reads only the default export of `privacy.ts`.**
- **No archive writer exists** in the workspace.

## 📝 Proposed Solution

### The command

`mercato privacy export-tenant --tenant <id> --out <directory> --reference <text> [--skip-attachments] [--allow-missing-attachments] [--allow-undecryptable] [--tables <a,b>] [--dry-run]`

1. Loads every enabled module's export declarations and checks that every table in the ORM metadata is accounted for. Stops if one is not.
2. Opens one repeatable-read transaction.
3. For each exported table, reads the tenant's rows in keyset batches, decrypts mapped fields, replaces redacted columns with null, and appends one JSON object per row to `tables/<table>.ndjson`.
4. Writes each attachment to `attachments/<id>/<file name>`.
5. Writes `manifest.json` last.
6. Records one audit entry: who, the reference, the table and row counts. No data.

`--dry-run` does steps 1 and 2 and prints the per-table row counts.

### Declarations

The `tables` map in the default export of `privacy.ts` — introduced by the table-coverage spec, one entry per table — gains an `export` member:

| Value | Meaning |
|---|---|
| absent | The table is exported whole |
| `exclude`, with a reason: `authentication`, `runtime_state`, `derived`, `global` | Never exported |
| `redact`, with columns and a reason: `credential`, `token`, `key_material`, `may_embed_secrets` | Those columns are written as null |
| `via`, with a parent table and the joining columns | For a table with no tenant column. The parent must itself be exported |
| `nullTenant`: `global`, `shared`, or a `via` | For a table whose tenant may be empty: rows with none are left out, written to a separate file of shared definitions, or attributed through a parent or organization |
| `reader`, with a service name | The module yields the table's rows itself, decrypted, using the transaction it is given |

`entities` supplies a reader for custom-field values and custom-entity records; `forms` for its encrypted tables. `audit_logs` redacts the stored snapshots and replay input of its change history as `may_embed_secrets`.

A class declared `credential` in the coverage facet must be excluded or redacted here; the coverage helper checks the two agree.

### The manifest

Format version, application version, tenant id, time, the reference, and per table: row count, SHA-256 of the file, the columns that were redacted. Then every excluded table with its reason, every attachment that was missing, and every value written as null because it could not be decrypted.

### The three guards

Tests in each package, using the snapshot reader from the table-coverage spec:

- **Every table without a tenant column** has `via`, `reader` or `exclude`.
- **Every table whose tenant column may be empty** has `nullTenant`.
- **Every column whose name contains `password`, `secret`, `token`, `credential`, `private_key`, `hash`, `otp`, `wrapped` or `signature`** is in a `redact`, or on the test's list of reviewed columns that are safe to export — a lookup hash, a checksum. The pattern matches 78 columns today.

The pattern decides nothing at run time; it only makes someone look. It cannot see inside JSON columns, which is why the change history's are declared outright.

### The reader

For each exported table without its own `reader`: raw rows in keyset batches under the tenant predicate or the declared join; then `decryptEntityPayload` with the entity id, the tenant, the row's organization and the export's transaction; then parsing of encrypted JSON; then a check of every string value for the shape of ciphertext, whatever the map says. A value that still looks like ciphertext fails the run or, with the flag, is written as null and recorded.

The verification suite's scan uses this reader.

### Design decisions

| Decision | Rationale |
|---|---|
| Declarations beside the data-class declarations | One file per module for "what this module's data is and how it leaves". |
| The export reads tables generically, from declarations | Writing an exporter per module for 345 tables would never finish, and a tenant's export has no per-module rules beyond what is declared. See assumption 1. |
| Fail on an undeclared tenant-less or empty-tenant table | The quiet alternatives are an incomplete handover, or one that contains other tenants' rows. |
| The manifest lists what is missing | The recipient, and the operator's lawyer, need to see it. |
| A directory, written owner-only | See assumption 3. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| A name pattern for secrets at run time | Misses four known columns and would redact harmless ones. |
| Discovering child tables from foreign keys | Several child tables declare no foreign key. |
| A per-module export handler for every table | See the decision above. |
| Reusing the subject export document | That is shaped by person and data class; this is by table. |
| `pg_dump` with a row filter | Ciphertext, and no decryption hook. |

## 📝 Delta

### Capability: tenant-exit-export

#### ADDED Requirement: Tenant export
The system SHALL write one tenant's data to a directory as decrypted, machine-readable files with a manifest, and SHALL NOT include another tenant's rows.

##### Scenario: Export
- WHEN the command runs for a tenant
- THEN each exported table has a file whose rows all belong to that tenant, encrypted fields are readable, and the manifest's counts and checksums match the files

##### Scenario: Child rows
- WHEN a table has no tenant column and its module declares its parent
- THEN the rows belonging to the tenant's parents are exported and no others

##### Scenario: Secrets
- WHEN a column is declared redacted
- THEN its value is null in the file and the manifest names the column

##### Scenario: Undeclared table
- WHEN a table with no tenant column, or with one that may be empty, has no declaration
- THEN the command stops before writing anything and names the table

##### Scenario: Rows with no tenant
- WHEN a table's rows with an empty tenant are declared global
- THEN none of them is exported

##### Scenario: Encrypted custom field
- WHEN the tenant has an encrypted custom-field value
- THEN it is readable in the export

##### Scenario: Undecryptable value
- WHEN a mapped field cannot be decrypted
- THEN the command fails naming the table and column, unless the operator allowed it, in which case the value is null and the manifest records it

##### Scenario: Dry run
- WHEN the dry-run flag is given
- THEN row counts are printed and no file is written

## 📝 Architecture

- **`packages/shared/src/modules/privacy.ts`**: the `export` member of a table entry. The registry already loads the default export; the generators are not touched again.
- **`privacy` module**: `lib/tenantExport/` — the plan builder, the reader, the manifest writer — and the command.
- **`entities`**: the reader for custom-field values and custom-entity records.
- **`forms`**: the reader for its encrypted tables.
- **`attachments`**: a service method that lists a tenant's attachments and copies one to a path.
- **Each module with tenant-less tables, empty-tenant tables or secret columns**: its declarations.
- **Guards**: one test per package.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Exporter → modules' declarations | The module registry | A module with none exports its tenant-scoped tables whole |
| Exporter → tenant keys | `tenantEncryptionService`, given the export's transaction | Encryption off: values are already plaintext |
| Exporter → module readers | DI key; each is handed the transaction | Module disabled: nothing to export |
| Exporter → files | The attachments service, outside the transaction | `--skip-attachments` |

## 📝 Data Models

None.

**Row file.** One JSON object per line, keys as column names, values as the database returns them after decryption; JSON columns as JSON; timestamps as ISO strings; binary columns as base64.

## 📝 API Contracts

- **`export`** on a table entry in `privacy.ts`'s default export — a convention file that is not yet released; additive.
- **CLI** as above. Exit 0 on success, 1 on a refused plan or a failure, 2 when it finished with recorded gaps under an `--allow` flag.
- **Audit entry** `privacy.tenant_export`.
- **Manifest version 1**, documented on the deployment docs page.
- No route.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| The output directory exists and is not empty | Refused |
| The run is interrupted | The directory has no manifest; the docs say a directory without one is incomplete |
| A very large tenant | Memory is bounded by the batch; the transaction is long, and the docs say to run it against a replica where one exists |
| A large attachment | Copied to its path by the driver, not held in memory |
| A file added or removed while the export runs | Files are outside the snapshot; a row whose file is gone is a missing attachment |
| A map scoped to the installation or an organization | Resolved by the encryption service from the row's own organization |
| A missing attachment file | Fails, unless allowed; then listed |
| A module is disabled | Its tables are not in the metadata and are not exported; the manifest lists the enabled modules |
| A tenant-less table whose parent is excluded | Refused when the plan is built |
| A custom entity's records | Exported from `custom_entities_storage` with their definitions |
| Rows soft-deleted | Exported; they are the tenant's data, and the row says so |
| Organization-only tables | Exported for every organization of the tenant |

## 📝 Migration & Backward Compatibility

Additive: a declaration, a command, an audit entry, a service method on attachments. Nothing changes for an installation that never runs it.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| 0 | The ruling on assumption 1, recorded in `packages/core/AGENTS.md` and in the contract spec | — |
| 1 | Declarations, the three guards, the plan builder and dry run | Table-coverage spec |
| 2 | The reader, module readers, redaction; the manifest | Phase 1 |
| 3 | Attachments; the docs page | Phase 2 |

## 📋 Implementation Plan

### Phase 1
1. Add the `export` member and validate it in the registry. Unit tests.
2. Add the three guards. Add declarations until they pass, one PR per package; record here every column placed on the reviewed-safe list.
3. The plan builder and `--dry-run`. Unit tests: an undeclared table of each kind, a child whose parent is excluded, a disabled module.

### Phase 2
1. The reader: keyset batches, tenant predicate, `via` joins, the empty-tenant rule, decryption with the transaction, JSON parsing, the ciphertext check, redaction. Unit tests for each, including a map scoped to an organization.
2. The `entities` and `forms` readers. Unit tests with an encrypted custom field.
3. The manifest writer and the audit entry. Unit tests for checksums and recorded gaps.
4. Integration test TC-TENANT-EXPORT-001.

### Phase 3
1. The attachments service method; attachment files; the two flags.
2. The docs page with the format and the handover procedure; `UPGRADE_NOTES.md`.
3. Archive this Delta into `.ai/specs/capabilities/tenant-exit-export.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts` | Modify |
| `packages/core/src/modules/privacy/{cli.ts,lib/tenantExport/*}` | Create / modify |
| `privacy.ts` in each module with tenant-less tables, empty-tenant tables or secret columns | Create / modify |
| `packages/core/src/modules/{entities,forms,attachments}/lib/*` | Modify |
| One `tenant-export-coverage.test.ts` per package with entities | Create |
| `packages/core/src/modules/privacy/__integration__/TC-TENANT-EXPORT-001.spec.ts` | Create |
| `packages/core/AGENTS.md`, `apps/docs/docs/deployment/gdpr/tenant-exit-export.mdx` | Modify / create |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-TENANT-EXPORT-001 | Two tenants are prepared through the API, each with a person, a deal linked to that person, a staff user, an encrypted custom-field value and an attachment. Encryption maps are seeded for both first, and a direct query confirms the person's stored name is ciphertext — a new tenant has no map rows, and without them "readable" would prove nothing. The command is run for the first, as existing tests run CLI commands, against the shared database and key. The person's file contains the first tenant's person with a readable name and not the second's; the deal-person link table contains only the first tenant's link; the custom-field value is readable; the users file has a null password hash and the manifest names it; the sessions table is listed as excluded; the attachment file is present with the right bytes; counts and checksums match. The test removes the directory and both tenants' records |

Undeclared tables, undecryptable values and missing attachments are unit-tested.

## 📝 Risks & Impact Review

#### A secret leaves in the export
- **Scenario**: A new column holds a token and nobody declared it.
- **Severity**: High
- **Affected area**: whoever receives the export
- **Mitigation**: The name-pattern guard fails until the column is declared or reviewed.
- **Residual risk**: A secret in a column whose name matches nothing, or inside one of the 344 JSON columns that is not declared. The docs tell the operator to treat the export as sensitive in any case.

#### Another tenant's row is exported
- **Scenario**: A `via` join is wrong, or rows with an empty tenant are mistaken for the tenant's.
- **Severity**: Critical
- **Affected area**: every tenant
- **Mitigation**: Every table with an empty-tenant possibility must declare what it means; the integration test uses two tenants and checks a child table; each `via` declaration has a unit test with rows of two tenants; shared rows are written to a separate, labelled file.
- **Residual risk**: A declaration added later without its test. The guard requires the declaration, not the test.

#### The handover is incomplete and nobody knows
- **Scenario**: A table is skipped, or values come out as ciphertext.
- **Severity**: High
- **Affected area**: the leaving customer
- **Mitigation**: The plan fails on undeclared tables; the ciphertext check fails the run; the manifest lists every gap.
- **Residual risk**: Data in a store the product does not know about.

#### The export loads the database
- **Scenario**: A long repeatable-read transaction on a busy primary.
- **Severity**: Medium
- **Affected area**: other tenants during the run
- **Mitigation**: Keyset batches; the docs recommend a replica or a quiet hour.
- **Residual risk**: Accepted for a rare, operator-run command.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/core/AGENTS.md` → Encryption. Not reviewed: the attachments and forms guides in full.

| Rule | Status | Notes |
|---|---|---|
| No cross-module ORM relationships | Compliant | None added |
| Modules do not read each other's tables | Needs a ruling | The exporter reads declared tables generically, for a read-only handover. The two existing walkers are narrower precedents than they look. Custom fields, forms data and files go through their owners. Phase 0 exists to get the answer |
| Never expose cross-tenant data | Compliant | Tenant predicate on every read; two-tenant test |
| Read through the decryption helpers | Compliant | And a check for what they return unchanged |
| No production dependency added | Compliant | No archive library |
| Integration coverage | Compliant | One test; error paths unit-tested |

**Verdict:** not approved until Phase 0's ruling. The design is otherwise ready.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. Forty-three tables whose tenant may be empty were unguarded; each must now declare what an empty tenant means. Decryption is specified in its four forms, with custom-field values and forms data read by their owning modules. The generic read is put to a maintainer as a blocking question, with a per-module fallback, because the contract spec rejected the same idea for one person's export and the cited precedents are narrower than claimed. Declarations became a facet of the shared per-table entry in the default export, which is all the registry loads. Module readers share the export's transaction. Attachments are copied by path. The change history's snapshot columns are redacted by declaration. The integration test seeds encryption maps first.
