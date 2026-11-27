# Offline protected-rotation preflight

Use this contract for preparation, preview and protected execution. Preparation
may inspect nonsecret configuration/file metadata and read-only database metadata;
it must not create a database, stop processes, change grants/admission/timeouts or
rewrite data. The real protected command performs authoritative checks before
mutation; do not claim a dry-run or a partial checklist proves all admission rules.

## Authorization and custody

Resolve the selected application/database, tenant and optional organization,
target provider/key selection and authorization to perform offline maintenance.
Reuse concrete authorization already provided. Ask only about missing required
facts, such as an unspecified tenant, ambiguous target or absent offline approval.
Read-only preparation/reporting does not require authorization to mutate data.

Confirm previous and distinct target keys, recovery identities and tested backup
custody are independently retained. Do not request key bytes in chat. Check
presence/readability without printing values; never use environment dumps,
credential-file output, command substitution of secrets into argv, or key hashes
as public evidence. Do not generate/replace tenant DEKs to make rotation proceed.

## Required fence

- The operator has stopped all application replicas, workers, schedulers,
  integrations and independent administrative writers.
- The selected source database already has `CONNECTION LIMIT 0`, with its original
  value recorded by the operator for a later separately authorized release.
- Vault DEK provisioning/rotation automation is paused from target staging through
  verification and controlled app cutover; the DB fence does not freeze Vault.
- The CLI uses its own dedicated superuser maintenance connection. No other client
  sessions or prepared transactions remain; enabled logical subscriptions refuse.
- Non-superuser roles have no effective write/ownership route to selected data or
  encryption-control tables. PostgreSQL superusers and the host operator remain
  trusted; no concurrent administrative writes are permitted.
- Server-provisioned `statement_timeout` is nonzero and at most 15 minutes;
  `lock_timeout` is nonzero and at most 30 seconds. The tool does not set them.
- UTF-8 server/client encoding, catalog resolution, declared schema/codec and
  supported relation coverage must satisfy real protected preflight. Inherited
  and partitioned relations are currently refused.

Use only an already authorized read-only maintenance connection for metadata
inspection. Close it before the CLI opens its dedicated connection, or the extra
session itself can invalidate admission. On any missing fence, report exactly what
the operator must provision; never terminate sessions, alter a limit or timeout,
revoke grants, disable subscriptions or bypass the check on the user's behalf.

## Runtime settings

Check settings without exposing their contents. Existing authorization must cover
the commercially licensed Enterprise package and installed version. The flags
`OM_ENABLE_ENTERPRISE_MODULES=true`, `OM_ENABLE_ENTERPRISE_MODULES_BACKUPS=true`
and `OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED=true` declare enabled capabilities
and existing rights. Never set the attestation without that authorization.
`TENANT_DATA_ENCRYPTION` must be enabled before CLI bootstrap.

Defaults are OS-aware and do not require this checkout. Native macOS uses
`~/Library/Application Support/Open Mercato/recovery`; Linux uses
`$XDG_STATE_HOME/open-mercato/recovery` or `~/.local/state/open-mercato/recovery`.
Containers use `/var/lib/open-mercato/recovery` and require a real persistent mount;
never accept overlay/tmpfs or temporary paths as durable recovery. A private
`OM_RECOVERY_ROOT` overrides the base, including for app-specific separation.
Explicit overrides win; explicit empty/invalid values refuse. Preparation may
inspect resolution but does not create custody files or change configuration.

| Setting | Resolved purpose |
| --- | --- |
| `PGSERVICEFILE`, `PGPASSFILE` | Private libpq files; default native home files or container custody/pg_service.conf and custody/pgpass |
| `OM_ROTATION_BACKUP_SOURCE_SERVICE` | Explicit reviewed service matching the application's real cluster/database identity |
| `OM_BACKUP_BINARIES_DIR` | Optional override; otherwise discover a trusted matching PostgreSQL 16/17/18 client trio via PATH/OS locations |
| `OM_ROTATION_RECIPIENTS_FILE`, `OM_ROTATION_IDENTITIES_FILE` | Reviewed custody, default base/custody/recipients.txt and identity.txt; never generated automatically |
| `OM_ROTATION_BACKUP_OUTPUT`, `OM_ROTATION_BACKUP_WORKSPACE` | Defaults base/backups and base/workspace |
| `OM_ROTATION_ARTIFACT_ROOT`, `OM_ROTATION_TRUST_ROOT` | Defaults base/rotation-artifacts and base/rotation-trust, physically separate |
| Source/target Vault version files | Role overrides from provider selection, or base/custody/rotation-source-vault-versions.json and rotation-target-vault-versions.json |

Read [provider selection](providers.md) before mutation. Derived and Vault source
and target profiles have different custody and application cutover requirements;
OS detection supplies no keys, version selections, rights or database fence.

Check path type, ownership, permissions, independent recovery custody and available
space without reading private file contents into logs. Trust/artifact/workspace
files must not be symlink substitutions. Capacity depends on source/ciphertext,
replacement rows, WAL and recovery data; never reduce coverage or safeguards to
fit. The default run deadline is six hours; `OM_ROTATION_DEADLINE_SECONDS` may be
configured within supported limits, at most 24 hours, without weakening statement
or lock-timeout admission bounds.

## Readiness result

Report the concrete scope, discovered CLI version/capabilities, custody checks,
observed fence metadata and blockers. Distinguish "ready for the protected command
to perform authoritative admission" from "rotation verified". Do not invent a
standalone `rotation preflight` CLI command. Rehearse on disposable synthetic data
under its own authorization; preparation itself does not authorize provisioning
or copying production data/keys into a test fixture.
