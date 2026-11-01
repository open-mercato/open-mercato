# Production Compose encryption configuration and migration (#7231)

Production Compose no longer supplies a tenant encryption key. This applies to
`starters/docker/compose.fullapp.yml`, its root compatibility copy, and the
create-app template's `docker-compose.fullapp.yml`.

The `encryption-preflight` service must exit successfully before app initialization,
MCP, or Documents collaboration starts. It rejects missing configuration, keys
shorter than 32 UTF-8 bytes, and the formerly published production/example key.
`docker compose config` can render an incomplete configuration; startup fails
before the dependent application processes start. `TENANT_DATA_ENCRYPTION=false`
does not bypass this production deployment check. Development stacks remain
intended for local disposable data, with development credentials.

The preflight checks configuration, not Vault connectivity, token policy, or the
randomness of an operator's secret. Verify those operational properties before
opening traffic. Do not use `--no-deps` to start application services, or remove
the preflight dependency in deployment overlays. Recreate the stack when changing
secrets; restarting an existing container does not update its environment.

## New installation with no existing encrypted data

Choose one configuration and inject it securely at runtime into Compose. Do not
commit secret files, put secrets in command arguments, print a rendered Compose
model to CI logs, or generate a new key on every container boot.

- Generate at least 32 random bytes once (`openssl rand -hex 32`) and persist the
  result as `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` in your secret manager. The legacy
  `TENANT_DATA_ENCRYPTION_KEY` is also supported when the preferred key is empty.
  Use the same value for every replica; keep a protected recovery copy.
- Or configure the supported HashiCorp Vault KV v2 KMS using both `VAULT_ADDR` and
  `VAULT_TOKEN`, optionally `VAULT_KV_PATH` (default `secret/data`). Verify read and
  create permissions for the correct tenant and system key paths. Use TLS for a
  remote Vault. The Compose files forward Vault settings and request/recovery
  timeouts consistently to app and sidecars. Vault credentials are never substituted
  into a derived encryption key. With no explicit fallback, a Vault outage has no
  derived fallback; provision and verify keys and monitor availability.

For a new Vault-only installation, also provision a separate high-entropy
`LOOKUP_HASH_PEPPER`; otherwise the unchanged runtime uses legacy unkeyed lookup
hashes. Compose now forwards an explicitly configured pepper to all consumers.
Setting a pepper on an existing installation requires the lookup migration below.

If both key variables are set, the preferred fallback wins. With Vault configured,
the existing runtime prefers Vault and can fall back to an explicitly supplied key.
Do not invent a new fallback for an existing Vault installation: a different DEK
cannot decrypt ciphertext written with the previous provider. Preserve the effective
key material and provider selection across every process.

## Existing installation: inventory before changing anything

**Do not replace a key and restart against the live database.** Changing a derived
root changes every tenant DEK and every `system:<entityId>` DEK. Changing the effective
lookup pepper changes keyed `v2:` hashes. Both can break login, uniqueness checks,
lookups and decrypting records. A stronger setting alone does not migrate data.

1. Identify the actual effective settings from the deployed configuration through
   your secret-management process. Do not copy them into issues or logs. Previously,
   the injected preferred default could mask an operator's legacy key. The env
   examples also contained a reusable key. Treat those published values as
   compromised, even when explicitly configured; the new preflight rejects them.
2. Preserve the original root(s), Vault tenant/system DEKs and KV mount versions,
   and the effective lookup pepper. Lookup hashing uses `LOOKUP_HASH_PEPPER`, then
   the preferred fallback, then the legacy key; auth/session secrets are unrelated.
3. Back up the database, attachments, encrypted exports, encrypted job payloads and
   KMS/secrets separately under restricted access. Prove a restore can decrypt data
   and perform login/lookups using the old configuration in an isolated environment.
   A database backup without its sealing keys is insufficient. Inventory soft-deleted
   rows, inactive tenants, null organization scopes, custom fields/documents, disabled
   module data, and module-specific/service-level envelopes as well as ORM maps.
4. An installation already using a unique strong key can keep it unchanged. A
   Vault-backed installation can keep the same Vault DEKs unchanged. Preserve its
   effective lookup pepper too. Verify whether forwarding an already-set pepper
   changes behavior compared to the older Compose files, which omitted that variable.
5. For a deployment using a published/weak root, stop traffic and **all writers**:
   app replicas, workers, scheduler, MCP, collaboration and external jobs. Work on a
   restored copy first. Do not bring a server up with the exposed key to preserve
   compatibility. Use an isolated administrative migration process with no public
   ports, and arrange an application/data owner to verify the complete inventory.

## Rotate derived tenant data in maintenance

Inject the target strong root (or configured target Vault), the original root via
`TENANT_DATA_ENCRYPTION_OLD_KEY`, and the intended target lookup pepper through the
secret manager into the maintenance process. Keep encryption enabled. Do not set
the old root as the new process's active fallback. Old and target keys must coexist
only in this restricted migration process, not a public application server.

For **each tenant** and its organization scopes, the existing mapped-entity/custom
entity command can preview and re-encrypt from a previous **derived root**:

```bash
yarn mercato entities rotate-encryption-key --tenant <tenant-uuid> --dry-run
yarn mercato entities rotate-encryption-key --tenant <tenant-uuid>
```

`--org <organization-uuid>` narrows a pass; without it the command visits the
tenant's organizations and its null-organization scope. Review the dry-run and real
summaries and every skip; require a successful exit and reconciliation of expected
row/field counts. A dry-run does not provision Vault keys. This CLI is not a general
Vault key-version rotation tool: its old-key input derives DEKs from a root, and
cannot stand in for a saved arbitrary Vault DEK. Do not overwrite a Vault DEK in
place and assume the CLI can recover its previous ciphertext.

Run these commands in the application image as a dedicated, offline maintenance
job, not through a service command that also starts a server or automatic migrations.
For example, with the target configuration supplied to Compose and the old root
securely exported only to the maintenance shell:

```bash
docker compose --project-directory . -f starters/docker/compose.fullapp.yml run \
  --rm --no-deps -e TENANT_DATA_ENCRYPTION_OLD_KEY app \
  yarn mercato entities rotate-encryption-key --tenant <tenant-uuid> --dry-run
```

Here `--no-deps` deliberately avoids starting other application services; the
explicit CLI command replaces `app`'s startup command. Remove `--dry-run` only
after validating the restored-copy run. For a scaffolded app use its root Compose
path. Do not use `--old-key <secret>`: it exposes secrets in process listings and
shell history. No database schema migration is required by this Compose fix.

## Coverage that requires additional migration work

**The commands above do not constitute a complete installation rotation.** If any
of these cases applies, keep the deployment in maintenance until an audited,
installation-specific migration is rehearsed and verified. Do not delete old keys
or bypass startup safety to get traffic flowing.

- **Lookup hashes:** entity rotation recomputes a declared `hashField` when it
  decrypts and reseals that field. Inventory and recompute every keyed hash from
  verified plaintext under the intended target pepper and original field/context
  convention. This includes login email hashes, portal/customer hashes, system
  records, non-mapped fields and custom module hashes. Current lookup candidates
  cover the current keyed hash and legacy unkeyed hash, **not an old keyed pepper**.
  There is no universal pepper-rotation/backfill CLI. A same-key rerun may skip
  already-current ciphertext and does not prove hashes were refreshed. Preserve
  contexts, normalization, tenant/org isolation and unique indexes; resolve collisions
  before enabling traffic. Do not temporarily preserve the publicly known pepper
  as the long-term fix. Do not alter unrelated API-key hashing as part of this runbook.
- **System-scoped maps:** `entities rotate-encryption-key` skips these. The current
  `backfill-system-encryption` command encrypts plaintext; it has no old-root input
  and is **not** a general rotation command. Existing `system:<entityId>` ciphertext
  needs a separately reviewed migration that decrypts under the saved old system
  DEK, reseals under the target system DEK and refreshes its hashes. Alternatively,
  a data owner may approve deletion of expendable expired onboarding records under
  the applicable retention policy; never silently discard records. Keep backups
  and the original keys until the approved path is complete.
- **Service-level envelopes:** integration credentials, OAuth grant blobs and other
  module-specific sealed values can sit inside a mapped JSON column. Rotating the
  outer column does not migrate the inner blob. Re-authorize/re-enter credentials
  with the target key through the supported owner workflow, or have the owning
  module supply a verified migration before reopening service. Revoke and reissue
  ephemeral MCP/AI session secrets; wait for or clear old encrypted jobs/caches.
- **Removed modules and non-mapped data:** re-enable the owning module for an audited
  pass or arrange an owner-assisted migration. A command reporting no maps is not
  evidence that no ciphertext exists.

## Verify cutover and retain a recoverable rollback

On the restored copy, then the stopped production dataset, verify decryption and
hash equality across the inventory under the **target-only** configuration: admin
and portal login, encrypted CRUD reads/writes, exact lookups and uniqueness,
custom entity documents, system onboarding, integration/OAuth credentials, MCP and
collaboration. Verify every tenant and organization, not just one seeded example.
Rebuild affected query/search indexes from successfully decrypted plaintext using
the documented module reindex commands. Do not index ciphertext.

Require successful restart of all replicas with consistent target keys/pepper and
Vault settings, no wrong-key/partial-rotation warnings, and no remaining old-root
ciphertext or old-pepper hashes in the verified inventory before admitting traffic.
No production data, rotation or migration is performed automatically by this fix.

A partial or failed pass stays in maintenance. Preserve both configurations for
recovery; never roll back just the secret against partially rotated data. Restore
an internally consistent database/attachments/KMS snapshot and matching old keys
in an isolated recovery environment, or complete the audited forward migration.
Account for writes after cutover before restoring a backup. Never restore the old
published-default server configuration to public service. Retain old key versions
under restricted access as long as retained backups require them; delete only under
an approved retention/recovery policy. Treat historical dumps sealed with the
published key as exposed: rotation cannot retroactively secure copies already taken.
