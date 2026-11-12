# Protected tenant-key rotation

This commercial Enterprise capability wraps `mercato entities rotate-encryption-key`
with a quiesced encrypted recovery backup, an encrypted logical baseline, committed
batch checkpoints and a complete persisted-data comparison. It does not retire keys,
release the maintenance fence or promote a restored database.

## Prepare access and custody

Enable the `backups` Enterprise module in the application's module configuration
and generate its registry before the maintenance window. The commercial package
and operator rights are required; module flags alone do not grant a license. Set:

| Setting | Required configuration |
| --- | --- |
| `OM_ENABLE_ENTERPRISE_MODULES` | `true` |
| `OM_ENABLE_ENTERPRISE_MODULES_BACKUPS` | `true` |
| `OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED` | `true`, only when the operator has those rights |
| `TENANT_DATA_ENCRYPTION` | Enabled using the existing application configuration |
| `TENANT_DATA_ENCRYPTION_OLD_KEY` | Original derived root, injected through the existing secret manager |
| `OM_ROTATION_KMS_PROVIDER` | Explicitly `derived` or `vault`; no provider fallback |
| `DB_POOL_MIN` / `DB_POOL_MAX` | `0` / `1` for this dedicated maintenance invocation |

The supported source adapter uses the existing previous derived root. The target
uses the configured `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`/`TENANT_DATA_ENCRYPTION_KEY`,
or explicit `VAULT_ADDR`, `VAULT_TOKEN` and optional `VAULT_KV_PATH`. A Vault-only
historical source inventory without the supported original derived binding refuses;
do not substitute a different key to force progress. Source and target concrete DEKs
must differ. Retain every original key in approved external custody. Do not pass
keys in command-line arguments, shell history, reports or support screenshots.

Configure absolute, owner-controlled paths:

| Setting | Purpose |
| --- | --- |
| `OM_ROTATION_RECIPIENTS_FILE` | Approved age recipients |
| `OM_ROTATION_IDENTITIES_FILE` | Identities authorized to decrypt and verify recovery/baseline artifacts |
| `OM_ROTATION_ARTIFACT_ROOT` | Encrypted baseline, journal and timestamp-intent artifacts |
| `OM_ROTATION_TRUST_ROOT` | Separate trusted owner-only run records, anchors and receipts |
| `OM_ROTATION_BACKUP_OUTPUT` | Encrypted recovery archives |
| `OM_ROTATION_BACKUP_WORKSPACE` | Bounded native archive inspection/staging workspace |
| `OM_BACKUP_BINARIES_DIR` | Matching PostgreSQL `pg_dump`, `pg_restore` and `psql` directory |
| `PGSERVICEFILE` / `PGPASSFILE` | Explicit private libpq service/password files |
| `OM_ROTATION_BACKUP_SOURCE_SERVICE` | Service entry for the exact application source database |

Use private files (`0600`) and directories (`0700`). Artifact and trust roots must
be physically separate, without equal, nested, ancestor or symlink aliases. Keep
trusted anchors outside the mutable artifact location. Keep escrow identities and
original application keys independently recoverable. Provision enough storage for
the complete encrypted archive and native staging. The backup database identity
must match the ORM source; a matching database name alone is insufficient. Native
client/server majors must match. Protected v1 requires UTF8 server and client
encoding. Authenticated plaintext bytes must also be valid UTF8 before logical
decoding; valid replacement characters, BOMs, empty strings and non-BMP text remain
supported. Acceptance measurements currently use PostgreSQL 16.

Text projection requires ISO `DateStyle` and `extra_float_digits >= 1` so
timestamps and floating-point values retain their exact distinctions. The
verification binding includes `DateStyle`, `TimeZone`, `IntervalStyle`,
`extra_float_digits`, `bytea_output` and `array_nulls`; changing any of these
requires restoring the original configuration before resuming. Supported column
types are the built-in boolean, bytea, smallint/integer/bigint, text/varchar/char,
oid, real/double precision, numeric, uuid, json/jsonb, date, time, timetz,
timestamp, timestamptz and interval types, including their built-in arrays.
Domains, enums, composite types and extension/user-defined output functions
refuse before mutation. Earlier codec bindings cannot resume under this stronger
projection proof.

## Establish the offline window

An authorized DBA must record the existing connection limit, role configuration and
service state before making maintenance changes. Stop application replicas, workers,
schedulers, external writers and logical replication. Resolve prepared transactions
and drain existing source-database clients. Disable subscriptions and wait for their
workers to exit; changing the enabled flag alone is insufficient.

Use an already-authorized dedicated superuser maintenance principal. Close ordinary
connection admission with `ALTER DATABASE "your_database" CONNECTION LIMIT 0` before
starting the CLI. This limit does not constrain superusers: other privileged
operators, tools and schedulers must remain stopped. The command also checks table,
column and schema writer/DDL privileges. It does not revoke privileges itself.

Configure the maintenance role's `statement_timeout` to a nonzero value no greater
than 15 minutes and `lock_timeout` to a nonzero value no greater than 30 seconds,
before opening the CLI connection. Keep `pg_catalog` first in the effective schema
search path; do not reuse a session with temporary/catalog-shadow relations. The
three unqualified control/storage relations must resolve to their `public` tables.
Protected mapped maintenance qualifies an unspecified schema as `public`.

The fence is checked before scope discovery and at phase boundaries. Native backup
quiescence can conservatively refuse an uncertain transaction horizon; resolve the
reported condition in the DBA maintenance window and retry without weakening proof.
No application hooks, queues or application bootstrap migrations are part of rotation.

## Execute and inspect

Use the original command and its existing tenant/organization options:

```sh
mercato entities rotate-encryption-key --tenant '<tenant-uuid>' --dry-run
mercato entities rotate-encryption-key --tenant '<tenant-uuid>'
```

A dry run performs no writes and does not certify recovery prerequisites. A mutating
protected invocation first verifies the recovery archive and complete baseline,
then rotates committed batches and verifies every declared persisted row with the
pinned target keys. It prints the coordinator run identifier on stderr. Retain it,
the trusted records and the owner-only JSON receipt. Existing Core stdout summaries
remain unchanged; `OM_ROTATION_PROGRESS=none` suppresses detailed progress, and
`json` selects the existing progress renderer's stderr protocol. `NO_COLOR` and
non-terminal output avoid terminal color in error presentation.

Default total deadline is six hours; `OM_ROTATION_DEADLINE_SECONDS` may specify
1–86400 seconds. Cancellation, loss of rights/fence/key binding, an unsupported scope,
corruption or incomplete verification exits nonzero. Keep writers stopped and all
keys/artifacts retained. A successful encryption helper alone is not a verified result.

## Resume and recovery

For an interrupted or failed admitted run, retain the same database process lifetime,
original keys/provider bindings, scope, configuration, artifact roots and trusted run
identifier. Set `OM_ROTATION_RESUME_ID` to that identifier and repeat the same command.
The coordinator authenticates the original baseline and journal before further
writes, reconciles committed batches and performs a complete final comparison.
Never create a replacement baseline from partially rotated data or edit checkpoints.
A PostgreSQL restart/replacement changes the incarnation binding and refuses v1 resume.
The authenticated coverage binding includes the codec version; an older prepared
run cannot silently resume under changed decoding rules. Retain its keys and backup
and use the quarantined recovery workflow when the original binding cannot be proven.

A terminal `passed` run is immutable. Attempting to resume it returns
`ROTATION_ALREADY_COMPLETED`; its trusted state and existing success receipt remain
unchanged and no new failed-run receipt is published. A crash after a durable receipt
but before trusted terminal publication resumes the original run, repeats final
verification and validates the existing receipt idempotently.

A failed report names a sanitized failure code, known aggregate counts/bytes and
recovery action; unknown aggregates remain absent. It includes no plaintext, row
identifiers, key material or PII-derived row digests. Keep its recovery archive and
trusted manifest reference. Restore through the Enterprise backup restore workflow
to an explicitly confirmed, separate quarantined target, verify content and retained-key
canaries, and obtain separate approval for any cutover. Do not overwrite the source or
reverse rotation automatically.

Only after the complete declared-scope receipt says `passed` and the operator has
reviewed recovery/custody should the DBA restore the previously recorded admission
and service settings. Key retirement and fence release remain separate operator actions.

## Supported scope and measurements

The verifier covers executable mapped tenant-key fields and custom documents,
including historical definitions, soft deletes, untouched columns and authenticated
lookup/timestamp transitions. System-key stores and independently encrypted inner
credentials retain their existing owners and are not certified for root-key retirement.
Unsupported or ambiguous global policies, inheritance/partitions, identity/scope-key
encryption rules, oversized rows and unbounded inventories refuse before mutation.
Current bounds include 1 MiB wire rows, 500 custom definitions per selected
inventory, 5,000 maps, 1,000 selected organizations, and a 10,000-record/4 MiB binding
projection. Unsupported data must be resolved explicitly; no success flag bypasses it.
Known lookup, ciphertext-padding and timestamp growth is budgeted before mutation.
Every final reader freshly checks actual persisted row sizes before transferring
contents, so a trigger or generated value cannot bypass the wire allocation cap.

Benchmark artifacts under `.ai/qa/2026-11-12-key-rotation-verification` distinguish
exploration, interruption/recovery evidence and release acceptance. The measured
memory scope is the standalone coordinator plus native children on a pinned runner,
with its disclosed Node heap flags. Actual Core CLI/ORM/DI integration is separately
tested; whole-application bootstrap memory is not inferred from the standalone result.
