# Persistent Docker recovery and maintenance

The app Dockerfile's shared `recovery-tools` stage supplies Node24 and `psql`, `pg_dump` and `pg_restore`. The actual `maintenance`, `dev` and `runner` stages inherit it. PostgreSQL17 clients match the default Compose PostgreSQL17 service. Build with `--build-arg POSTGRES_CLIENT_MAJOR=16` or `18` only for a selected matching server/archive major; invalid values or unavailable packages fail the build. The selected native directory is `/usr/libexec/postgresql<major>`, exposed through `OM_BACKUP_BINARIES_DIR`.

Corporate public root CAs in `docker/certs/*.crt`/`*.pem` are trusted before client downloads; the runtime retains `NODE_EXTRA_CA_CERTS`. `ALPINE_MIRROR` selects an explicitly reviewed internal mirror. No installer runs from an operator CLI command, and no TLS checks are disabled.

## Web build memory

The separate web `builder` stage retains the application's historical 8192 MiB Node heap for Next.js and its TypeScript worker. The full monorepo type-checking program can exceed a 4096 MiB heap; a lower cap can fail with a JavaScript heap error even after frontend compilation succeeds. Provide builder memory beyond the heap for native/compiler overhead.

`--build-arg OM_BUILD_NODE_OPTIONS=--max-old-space-size=8192` explicitly selects the web-build default; an operator may choose another cap for adequately provisioned builder resources. This setting never skips type checking. The package-only `dev-build`/maintenance graph retains its existing resource settings and does not run the Next UI build, so it is unaffected by this web-stage argument.

## Select a prebuilt runtime and the correct stack

Build the self-contained operator image explicitly. The `maintenance` target compiles framework packages and generates the application CLI/DI registry without building the Next.js web UI:

```sh
docker build --target maintenance --build-arg POSTGRES_CLIENT_MAJOR=17 --build-arg OM_ENABLE_ENTERPRISE_MODULES=true --build-arg OM_ENABLE_ENTERPRISE_MODULES_BACKUPS=true -t my-reviewed-mercato:recovery .
```

The maintenance image compiles the application CLI bootstrap caches during the build by running actual application-module help (`entities --help`) as UID1001 with networking disabled. Runtime CLI commands can then validate and read these content-bound caches on the read-only image; they do not need a writable application source directory. Rebuild the reviewed image when application source or generated registries change.

Only use the Enterprise build flags above when the licensed package is already installed and the application declares the `backups` module. They default to false in every relevant Docker build/generation stage; ordinary OSS builds remain module-disabled. No commercial-rights attestation, database credentials, Vault tokens or key material is a build argument. Runtime env files alone cannot add a module omitted from generated DI/CLI registries: enable the reviewed capability during generation/build and supply the matching runtime capability/rights declarations separately. Current monorepo/template module declarations support these flags; older/custom standalone apps must first register the installed `backups` module in `src/modules.ts` through their normal reviewed workflow. Rebuild the image after changing that registration.

Set `OM_RECOVERY_IMAGE` to that exact prebuilt maintenance image for the selected deployment, including when maintaining a dev database. The regular `runner` target remains available for the web application and needs enough memory for its separate Next.js production build. A plain `dev` image expects the developer source/dependency mounts and is not a self-contained substitute; this maintenance profile does not add those mounts or run developer bootstrap. Development and production code/images remain distinct operator choices; the maintenance profile never pulls, builds or switches images automatically. A generated standalone app needs the commercially licensed Enterprise package already installed in its image for `mercato-backup` to exist. Client tools alone do not supply Enterprise capability or commercial rights.

Select exactly one existing fullapp Compose stack. In the monorepo use:

```sh
export OM_RECOVERY_IMAGE=my-reviewed-mercato:recovery
export OM_RECOVERY_ENV_FILE=/absolute/private/recovery-container.env
docker compose --project-directory . -f starters/docker/compose.fullapp.yml -f starters/docker/compose.recovery.yml --profile recovery run --rm --no-deps maintenance
```

For the dev stack replace only the first file with `starters/docker/compose.fullapp.dev.yml`. In a generated standalone app use root-level `docker-compose.fullapp.yml` (or `.dev.yml`) and `docker-compose.recovery.yml` instead. Do not mix projects, deployment environments, production and development volumes, or another checkout's PostgreSQL container.

The selected PostgreSQL service must already be running. `--no-deps` prevents this command from starting app/worker/Redis services. Maintenance overrides app startup and runs as UID/GID1001 with no privilege escalation, no published ports, a read-only image filesystem and private persistent recovery storage. It shares only the selected PostgreSQL network namespace, so PostgreSQL is reached at `127.0.0.1` rather than the Docker hostname `postgres`. Existing TLS policy still applies: remote/non-loopback endpoints require verified TLS. There is no Docker-hostname exception.

## Persistent private volume and custody

Only the dedicated maintenance service mounts `recovery_data` at `/var/lib/open-mercato/recovery`; the fullapp files declare the volume without mounting it into the web app. The monorepo names it `mercato-recovery-data-${DEPLOY_ENV:-local}`; generated apps use the selected Compose project's `recovery_data`. A fresh named volume copies the image's private UID1001/mode0700 directory. Removing/recreating a maintenance container preserves this named volume. Never use `docker compose down -v`, volume removal or a new volume as a resume repair.

The maintenance entrypoint refuses a missing/read-only mount, ephemeral/virtual filesystem (including tmpfs/overlay), wrong owner, symlink, non0700 mode or unwritable directory. It never changes ownership/permissions of an existing volume, uses sudo, copies host custody automatically or deletes recovery state. An existing incompatible volume requires an explicit operator provisioning/migration decision. Arbitrary `--user` overrides must match that private volume's real owner; root execution is not a repair. Run recovery commands only through the isolated maintenance service. Never mount recovery storage or copy its identities, database credentials, archives or resumable workspaces into the network-facing app container. File modes alone cannot isolate custody from an app process running as root.

## Use automatic container configuration

The installed standalone CLI discovers the baked client group and container defaults. Read the plan before performing an operation:

```sh
docker compose --project-directory . -f starters/docker/compose.fullapp.yml -f starters/docker/compose.recovery.yml --profile recovery run --rm --no-deps maintenance node /app/packages/enterprise/bin/mercato-backup.mjs configure --json --progress json
```

Use the standalone-app file/prefix substitutions described above when appropriate. `configure` is read-only and does not bootstrap the application or open a database. It reports selected paths, binary provenance, missing prerequisites and mount/private-file checks. Its assurance is `configuration-plan-only`, not a backup, recovery, admission or correctness pass. A missing prerequisite is not fixed by silently weakening policy.

| Discovered item | Default inside this container |
| --- | --- |
| Recovery base | `/var/lib/open-mercato/recovery` |
| Database service/password files | `custody/pg_service.conf`, `custody/pgpass` under the base |
| Archive public recipients/private identity | `custody/recipients.txt`, `custody/identity.txt` under the base |
| Backup output/resumable workspace | `backups/`, `workspace/` under the base |
| Protected expected-data/trusted records | Separate `rotation-artifacts/`, `rotation-trust/` under the base |
| Native clients | The image-selected `/usr/libexec/postgresql<major>` group |

Provision only the selected custody files through the approved secret manager as UID1001/mode0600 under an owner-private0700 custody directory. Normal authorized operations create only their needed private working paths; configure never creates them. No deployment/escrow key generation, permission repair or software installation occurs automatically. Age archive identities and application previous/current keys or Vault credentials remain separate custody domains.

`OM_RECOVERY_ENV_FILE` is a private **host-side** env-file path. It may be empty for configuration inspection. Its operational values must identify the selected container-visible deployment, rather than copying a host application's `.env` wholesale. The remaining semantic inputs are:

- Already authorized installed Enterprise capability/rights declarations: `OM_ENABLE_ENTERPRISE_MODULES`, `OM_ENABLE_ENTERPRISE_MODULES_BACKUPS` and `OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED`. This profile sets none automatically and grants no license.
- The selected libpq source service (`--source-service` for backup; `OM_ROTATION_BACKUP_SOURCE_SERVICE` for protected rotation), with actual loopback entries in the default private service/password files.
- For application CLI/rotation, secret-manager-injected `DATABASE_URL` identifying the same database through `127.0.0.1` in the PostgreSQL network namespace. The maintenance guard refuses a non-loopback URL; it never rewrites it. Standalone backup uses named libpq services and has no DATABASE_URL fallback.
- The explicitly selected supported previous/current provider and retained key custody, as described in the protected rotation guide. Discovery neither chooses a new key/provider nor exports or generates DEKs.

An existing private override remains authoritative. Optional backup CLI overrides include `--output`, `--workspace`, `--binaries-dir`, `--recipients-file` and `--identity-file`; optional environment overrides include `OM_RECOVERY_ROOT`, `PGSERVICEFILE`, `PGPASSFILE`, `OM_BACKUP_BINARIES_DIR`, `OM_BACKUP_RECIPIENTS_FILE` and `OM_BACKUP_IDENTITY_FILE`. Rotation-specific advanced path overrides remain supported by its operator guide. Invalid explicit selections fail closed instead of silently falling back. A macOS `/Users/...` path is not transplanted into a Linux container.

Before resuming, preserve the exact effective paths/service/tool binding emitted by the original run. A newly selected image, default root or env file is not a substitute for its authenticated original custody and workspace. Retain the persistent volume across maintenance-container recreation.

## Invoke the existing CLIs

The default maintenance command displays standalone backup help. In the monorepo replace it with the actual absolute standalone command plus its normal arguments:

```sh
docker compose --project-directory . -f starters/docker/compose.fullapp.yml -f starters/docker/compose.recovery.yml --profile recovery run --rm --no-deps maintenance node /app/packages/enterprise/bin/mercato-backup.mjs preflight --operation create --source-service source --json --progress json
```

In a generated standalone image use `/app/node_modules/.bin/mercato-backup` instead of the `node /app/packages/...` prefix. For application key rotation use the installed application CLI in its selected working directory, with the configured old/current provider custody and required offline fence; this maintenance service does not stop writers, terminate sessions, change admission/timeouts or retire keys. Use the application Node launcher directly: `maintenance node /app/apps/mercato/scripts/mercato-cli.mjs entities rotate-encryption-key --tenant TENANT_UUID --dry-run` in the monorepo image, or `maintenance node /app/scripts/mercato-cli.mjs entities rotate-encryption-key --tenant TENANT_UUID --dry-run` in a generated standalone image. Replace placeholders and preserve the real application prefix/version. These absolute Node commands avoid runtime Corepack/Yarn downloads for UID1001 on a read-only image. A dry-run does not certify protected readiness.

Creation, verification, target preflight, restore/exercise and resume keep their normal flags and independently trusted digests. Restore/exercise needs a fresh challenge on every attempt and a separately authorized empty quarantined target. Retain the original run ID, workspace, report, custody and PostgreSQL lifetime requirements across interruptions. Full verification is default; streaming restore verification is a separate informed policy choice. No automatic production promotion or writer restart occurs.

See the official Enterprise backup/recovery and protected rotation operator guides for the complete workflow, scope and recovery boundaries. Share only small sanitized aggregate reports and genuine output screenshots. Backups, encrypted archives/expectations, dumps, database volumes, private workspaces, raw logs, identities and key files remain in operator-controlled storage; no such artifacts belong on GitHub.

## Verification scope

A `recovery-tools` target build verifies the actual shared tool stage inherited by application runtimes. Build the `maintenance` image and check its actual CLI help/configuration to verify the self-contained generated CLI runtime. This does not verify the separate Next.js web `runner` target. A helper-stage plus compiled CLI test does not prove that either complete image was built or that every installation/provider is supported. Report actual OS/architecture, tool majors, storage ownership/persistence and command outcomes separately; label Intel/RHEL/PATH simulations as simulations. Performance acceptance and production recovery authorization remain separate from this image integration.
