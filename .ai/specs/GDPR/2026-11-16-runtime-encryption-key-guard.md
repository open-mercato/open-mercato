# Production refuses published encryption keys

> **Tracker:** open-mercato/open-mercato#8593
> **Program:** [program](2026-11-15-gdpr-ready-deployments-program.md)
> **Edition:** OSS
> **GDPR basis:** Art. 32(1)(a) (encryption of personal data); Art. 5(1)(f) (integrity and confidentiality)

## TLDR

**Key points**
- A production process refuses to run when its tenant encryption secret or forms master key is one published in this repository: it exits 1 and points to a runbook. A weak or unset tenant secret produces one warning. Today only the Compose preflight checks the secret, and only for Compose; every other deployment encrypts with whatever it is given, and the container bootstrap swallows errors.
- The runbook moves an installation off a published key without breaking logins. Two CLI bugs that block it are fixed first, and forms gains a master-key rewrap command.
- Phase 2: the production Compose files stop shipping a Meilisearch development master key, a default `postgres` password and `DEMO_MODE=true`.

**Scope**
- New `packages/shared/src/lib/encryption/keyPolicy.ts`: published SHA-256 digest set and `inspectTenantEncryptionSecret(env)`.
- Refusal in `createKmsService`, the forms KMS adapter and every service start. `createRequestContainer` no longer swallows the typed error.
- Development escape `OM_ALLOW_PUBLISHED_DEV_KEY=1`. CI and the integration runner generate keys per run.
- Runbook exit; prerequisite fixes in `entities rotate-encryption-key` and `entities backfill-system-encryption`; `forms rewrap-master-key`.
- Phase 2: production Compose defaults.

**Out of scope** (security backlog, one line each)
- Turning the weak or unset warning into a refusal; the insecure Vault address check also stays Compose-only.
- KMS fail-closed when a configured KMS is unreachable (#2241).
- Lookup-secret rotation. After this runbook, lookup hashes may stay keyed with a published value.

## Overview

#7231 removed the published key from the production Compose files and added a Compose-only preflight (`docker-compose.fullapp.yml:18-45`). Deployments on Kubernetes, a bare `mercato server start`, Railway or a scaffolded app get no check. Encryption keyed with a secret anyone can read from this repository is no encryption under Art. 32(1)(a). The guard moves the one hard rule, "never a published key in production", into the runtime. It follows the existing JWT-secret precedent: checked at server start, and the process exits (`apps/mercato/src/instrumentation.ts:5-24`).

> **Market reference.** Rails refuses to boot in production without `secret_key_base`. Django's `check --deploy` only warns about a weak `SECRET_KEY`. Adopted: Rails' hard stop, but only for publicly known material, and Django's warning for weak private material.

## Problem Statement

Verified on `b0304f2986`.

- **No runtime validation.** `resolveDerivedKeySecret` takes the first non-empty of `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` and `TENANT_DATA_ENCRYPTION_KEY` (`packages/shared/src/lib/encryption/kms.ts:119-135`). With encryption on, no Vault and no secret, `createKmsService` returns a no-op service, so data is stored as plaintext (`kms.ts:455-461`). Encryption is on by default (`toggles.ts:3-9`).
- **Published values.** The implementation stores only these digests. Test probes carry the literals.

| # | Published in | Variable | SHA-256 |
|---|---|---|---|
| 1 | Dev Compose defaults (`docker-compose.fullapp.dev.yml:147`, `starters/docker/compose.fullapp.dev.yml:143`, `packages/create-app/template/docker-compose.fullapp.dev.yml:33`); earlier `apps/mercato/.env.example` | tenant key | `c7eabc7b8d9e7cd03f1bf71364dfdd871518a68c0b9b684c14f4ece5fd7a0e3e` |
| 2 | Integration runner default (`packages/cli/src/lib/testing/integration.ts:2283, 3694`) | tenant key | `98ad4a4afedee55ac36b52033d320ea341406e01aa28a3604dba7f30d47a294a` |
| 3 | `customers/__integration__/TC-CUSTOMERS-SEED-001.spec.ts:57` | tenant key | `1ddaf04dcf69200b4e44e3b35a04e558ea833f3fbdcea75270196a32b2269472` |
| 4 | `shared/.../__tests__/lookupHash.test.ts:19` (already in the Compose denylist) | tenant key or pepper | `68fe65529a84f01100e5ed78ea304e3020b8b19b50545aac49c54652baf61b76` |
| 5 | `checkout/lib/__tests__/utils.test.ts:260` (already in the Compose denylist) | tenant key | `1b64067151000c77316ca44dfee4ea09e195f3d2956a42ff745035db351dd639` |
| 6 | Standalone CI (`.github/workflows/snapshot.yml:235, 379`, `npm-snapshot-preview.yml:353, 484`, `scripts/test-create-app-integration.ts:101, 456`) | tenant key | `b8edced4f85915bb81fa4550efbdce754d1b39cd049af926b797eb85404bd33e` |
| 7 | Non-production dev default (`kms.ts:132`) | tenant key | `0fa16ead8dc970c2b4b74dd435cae66b3d210f2e562ee401ce9fcca2770bbd43` |
| 8 | `.github/workflows/ci.yml:1063` | forms master key (digest of the 32 decoded bytes) | `c375c793d6cfcfbb77d3c35be39c8484af1eb95f996126c2d6d7c3d38c1ae664` |
| 9 | Integration runner default (`integration.ts:2214, 3606`) | forms master key (decoded bytes) | `fa4c960afa25c2d222b2e1f499fed43e235ca035c500f159281dcc7449134c9e` |

- **Errors are swallowed.** `createRequestContainer` runs bootstrap inside `catch { /* optional */ }` (`packages/shared/src/lib/di/container.ts:283`) and registrars only log (`:258`), so a throw from `createKmsService` (`packages/core/src/bootstrap.ts:194`) would leave the process with no encryption services. Tenant setup swallows DEK provisioning errors (`packages/core/src/modules/auth/lib/setup-app.ts:409-413`). The preflight probe replaces any failure with "restore the original keys" (`packages/starter/src/encryption-preflight.mjs:236, 260`, with copies in `scripts/` and the template).
- **The repository's own environments would be refused.** The integration runner starts the app with `NODE_ENV=production` on defaults 2 and 9; standalone CI uses value 6; `mercato server dev` spawns workers and the scheduler with `NODE_ENV=production` (`packages/cli/src/mercato.ts:412-414, 2407`) while the dev Compose files default to value 1.
- **The exit path is broken.**
  - (a) `entities rotate-encryption-key` aborts on any tenant with search enabled. Setup seeds the `vector:vector_search` map per tenant (`setup-app.ts:229`, `packages/search/src/modules/search/encryption.ts:5`). That entity has no ORM metadata, so it is classified as unresolvable and the run fails (`packages/core/src/modules/entities/cli.ts:430-436, 470-480`).
  - (b) `entities backfill-system-encryption` skips ciphertext and takes no old key (`cli.ts:1271-1274, 1393`), so system-scoped records sealed under the old root become unreadable.
  - (c) The lookup pepper falls back to the encryption secret (`aes.ts:191-203`). Rotating the secret without pinning `LOOKUP_HASH_PEPPER` changes every lookup hash and breaks email-hash login.
  - (d) The forms module can rotate data keys (`forms/services/encryption-service.ts:375`) but cannot rewrap them under a new master key.

## Proposed Solution

### 1. Policy module: `packages/shared/src/lib/encryption/keyPolicy.ts`

- `PUBLISHED_TENANT_KEY_DIGESTS` (rows 1–7) and `PUBLISHED_FORMS_MASTER_KEY_DIGESTS` (rows 8–9) hold hex SHA-256 digests only. The forms digest is computed over the decoded 32 bytes, so a hex and a base64 spelling of the same key both match.
- `inspectTenantEncryptionSecret(env = process.env): 'published' | 'weak' | 'unset' | 'ok'`.
  - It looks at the effective secret: the first non-empty of the two variables, normalized like `kms.ts` (trim, strip surrounding quotes).
  - `published`: the digest is in the set.
  - `weak`: under 32 UTF-8 bytes or fewer than 8 distinct characters, the same rule as Compose.
  - `unset`: no secret and Vault not fully configured, or tenant encryption switched off.
  - `TENANT_DATA_ENCRYPTION_OLD_KEY` and `LOOKUP_HASH_PEPPER` are never inspected, so rotating away from a published key works.
- `isPublishedFormsMasterKey(value)`: decodes like `EnvMasterKeyKmsAdapter.fromEncoded` and checks the digest.
- `PublishedEncryptionKeyError`, with `code: 'published_tenant_key' | 'published_forms_master_key'` and `envName`. It carries a `Symbol.for` brand, and `isPublishedEncryptionKeyError(err)` checks the brand, because `instanceof` fails across bundle copies.
- `assertEncryptionKeyPolicy(env = process.env)`.
  - Production is `NODE_ENV=production` without the escape (section 3).
  - In production, a published tenant key or forms key throws. `weak` and `unset` log one warning per process.
  - Outside production, a published key logs one warning, and `weak` or `unset` stay silent.
- The message names the variable, says the value is published in the Open Mercato repository, links `https://docs.openmercato.com/user-guide/encryption#replace-a-published-key`, and says not to generate a new key over existing data. It never contains the value, its length or its digest.

### 2. Where it runs

| Site | Behaviour |
|---|---|
| `createKmsService()` (`kms.ts:443`), encryption on | Calls the assertion first. This covers bootstrap, every CLI and `api_keys`, `integrations`, `query_index` and tenant setup. |
| Forms `resolveKmsAdapter` (`forms/services/encryption-service.ts:239`) | Refuses a published `FORMS_ENCRYPTION_MASTER_KEY` in production. |
| Web server: `apps/mercato/src/instrumentation.ts` and the template copy | Assertion beside `assertJwtSecretPolicy`, inside the same Node-only, not-during-build block that exits 1. |
| CLI dispatcher (`packages/cli/src/mercato.ts`) | One list of service commands: `server start` (before it spawns), `queue worker`, `scheduler start`, `search worker`, `ai_assistant mcp:serve`, `mcp:serve-http`, `workflows start-worker` and `channel_discord start-gateway`. They are asserted before running, and a refusal exits 1 before a job is consumed. Third-party long-running commands call the exported assertion. |
| Documents collaboration server | Asserts before `listen()` (`packages/documents/server/documents-collab-server.ts:3418`). |
| Swallow sites | `container.ts:283` and `:258` and `setup-app.ts:409` rethrow when `isPublishedEncryptionKeyError(err)`. The preflight probe exits with a dedicated code on that error, and the parent prints the policy message instead of "restore the original keys". |

### 3. Development escape

- `OM_ALLOW_PUBLISHED_DEV_KEY=1` turns the published refusal into a warning.
- Set by:
  - `mercato server dev`, in the environment of the production-mode children it spawns;
  - the three dev Compose files.
- Not set or honoured by:
  - `mercato server start`, which deletes it from its own and its children's environment before the check;
  - `.env.example`, which does not document it.
- When honoured under `NODE_ENV=production`, the process logs one error-level line naming the variable.

### 4. Test environments use generated keys

- **Integration runner.** It generates a tenant key and a forms master key for each new ephemeral environment and stores both in `.ai/qa/ephemeral-env.json` (gitignored), so reuse and attach keep them. A stored state without keys is stale and recreated. The `??` defaults at `integration.ts:2214, 2283, 3606, 3694` go away.
- **CI.** `ci.yml`, `snapshot.yml` and `npm-snapshot-preview.yml` write `openssl rand -hex 32` values to `$GITHUB_ENV`. `scripts/test-create-app-integration.ts` uses `randomBytes`, as `scripts/lib/standalone-preset-initialization.ts:57` already does.
- **Seed spec.** `TC-CUSTOMERS-SEED-001` uses a generated value.
- **Probes.** Literals stay only in `keyPolicy.test.ts`, as refusal probes.

### 5. Runbook: replace a published key

A new section, "Replace a published key", in `apps/docs/docs/user-guide/encryption.mdx`, with the same steps in `starters/docker/encryption-migration.md`. The [deployment docs](2026-11-16-gdpr-deployment-docs.md) hardening page links to it.

0. Empty database: generate a new key and stop here. Otherwise stop traffic and workers, and take a backup.
1. Set `LOOKUP_HASH_PEPPER` to the old secret first. Lookup hashes are keyed with it through the fallback in `aes.ts:191-203`; without this step, email-hash login and every hash lookup stop matching.
2. Put a new strong secret in `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` and the old one in `TENANT_DATA_ENCRYPTION_OLD_KEY`. Per tenant, run `mercato entities rotate-encryption-key --tenant <id> --dry-run`, then the same command without `--dry-run`. Then run `mercato entities backfill-system-encryption`.
3. Run `mercato query_index reindex --tenant <id> --force`, then `mercato search reindex --tenant <id> --purgeFirst`.
4. Forms: if `FORMS_ENCRYPTION_MASTER_KEY` was published, set the new key, put the old one in `FORMS_ENCRYPTION_OLD_MASTER_KEY` and run `mercato forms rewrap-master-key`.
5. Remove the old-key variables and start. Integration credentials and OAuth grants follow the runbook's existing "Service-level envelopes" step.

Accepted residual: lookup hashes stay keyed with a public value. That is the same strength as the legacy unkeyed digest, and moving off it is lookup-secret rotation, which is out of scope.

### 6. Prerequisite fixes (ship before the refusal)

- **(a)** `rotate-encryption-key` classifies maps whose entity id starts with `vector:` as nothing-to-process. The closing summary prints "vector entries are rebuilt, not rotated: run `mercato search reindex --tenant <id> --purgeFirst`". Every other unresolvable map still fails the run.
- **(b)** `backfill-system-encryption` reads `TENANT_DATA_ENCRYPTION_OLD_KEY`.
  - A value that is ciphertext and does not open under the current system DEK is decrypted with the DEK derived from the old root (`DerivedKeyKmsService`, as `rotate-encryption-key` uses), resealed under the current DEK, and its hash field is recomputed.
  - Values that open under neither key are counted, and the command exits non-zero.
  - The docstring "never accepts an old key" is updated.
- **(c)** New `packages/core/src/modules/forms/cli.ts` with `rewrap-master-key`. For every `FormsEncryptionKey` row it unwraps with the old master key and wraps with the current one. It is idempotent: rows already wrapped under the current key are skipped. `--dry-run` reports counts.

### 7. Phase 2: production Compose defaults

Files: `docker-compose.fullapp.yml`, `starters/docker/compose.fullapp.yml`, `packages/create-app/template/docker-compose.fullapp.yml`.
- `MEILISEARCH_MASTER_KEY` becomes required (`${MEILISEARCH_MASTER_KEY:?…}`, following the `JWT_SECRET` precedent). Set `MEILI_ENV: production`, which makes Meilisearch require a key of at least 16 bytes, and remove the `meilisearch-dev-key` defaults, including the template's `MEILISEARCH_API_KEY`.
- `POSTGRES_PASSWORD` becomes required in the `postgres` service and every `DATABASE_URL`.
- `DEMO_MODE: ${DEMO_MODE:-false}`. Demo mode enables demo widgets, including the public feedback form that collects an email address (`onboarding/api/demo-feedback/route.ts:34`).
- Dev Compose files keep their defaults.

**Template sync.**
- The create-app template's Compose files are edited in the same PR.
- The `instrumentation.ts` change is mirrored with `yarn template:sync:fix`; `packages/create-app/src/lib/template-instrumentation-runtime.test.ts` checks parity.

## Architecture

```
keyPolicy.ts (digests, inspect, assert, typed error)
  ├─ createKmsService ──────────── every in-process encryption user (throws)
  ├─ forms resolveKmsAdapter ───── forms envelope encryption (throws)
  ├─ instrumentation.ts / CLI service list / collab server ── exit 1 at start
  └─ createRequestContainer, setup-app, preflight probe ───── rethrow / relay, never swallow
```

The shared module holds the rules, and the call sites only call it. No module reads another module's key.

## Data Models

None.

## API Contracts

- **Exports** from `@open-mercato/shared/lib/encryption/keyPolicy`: `inspectTenantEncryptionSecret`, `isPublishedFormsMasterKey`, `assertEncryptionKeyPolicy`, `PublishedEncryptionKeyError`, `isPublishedEncryptionKeyError`, `PUBLISHED_TENANT_KEY_DIGESTS`, `PUBLISHED_FORMS_MASTER_KEY_DIGESTS`.
- **Behaviour change:** in production, `createKmsService()` and `createRequestContainer()` may throw `PublishedEncryptionKeyError`, and service commands exit 1.
- **Environment:** `OM_ALLOW_PUBLISHED_DEV_KEY` (development only); `FORMS_ENCRYPTION_OLD_MASTER_KEY` (maintenance only).
- **CLI:** `rotate-encryption-key` skips `vector:` maps and prints the reindex step; `backfill-system-encryption` honours `TENANT_DATA_ENCRYPTION_OLD_KEY`; new `mercato forms rewrap-master-key [--dry-run]`.
- No events, routes or DI keys.

## Migration & Backward Compatibility

- **Published-key refusal: Emergency Security Exception.** Accepting a key anyone can read is itself the vulnerability. A bridge release would leave every such deployment readable, as in the dated entry "Compose encryption (2026-11-01, #7231)".
- **The development escape is not a retained bridge.** It marks a development runtime, like `NODE_ENV=development`, which already disables the check. `server start` strips it, production templates never set it, and an honoured escape in production logs an error on every start. The PR carries the argument, the `security` label and a named maintainer approval.
- **Weak or unset secrets:** warning only, no behaviour change.
- **`UPGRADE_NOTES.md`:**
  - "A production process now exits if its tenant encryption key or forms master key is a value published in the Open Mercato repository. Follow 'Replace a published key' in the encryption guide; do not generate a new key over existing data. Data sealed with a published key should be treated as exposed. Module authors: never swallow `PublishedEncryptionKeyError`."
  - Phase 2: "Production Compose requires `MEILISEARCH_MASTER_KEY` (at least 16 bytes; the app uses it as its API key)." / "Production Compose requires `POSTGRES_PASSWORD`; for an existing volume set the current password (`postgres` if never changed), then change it with `ALTER USER`." / "Production Compose defaults to `DEMO_MODE=false`; set `true` to keep the demo widgets."
- **`BACKWARD_COMPATIBILITY.md`:** one dated entry for the refusal (surface, classification, argument, migration path). One note covering the three Compose default changes.

## Risks & Impact Review

#### A live deployment on a published key stops at upgrade
- **Scenario**: An installation that copied the dev Compose key into production upgrades, and every service exits 1.
- **Severity**: High
- **Affected area**: That installation's availability
- **Mitigation**: The message names the variable and the runbook, and the upgrade note announces it. Prerequisite fixes (a)–(c) ship before the refusal, so every runbook step works.
- **Residual risk**: Downtime for the maintenance window. That cost is intended: the data was readable by anyone.

#### The operator generates a new key over existing data
- **Scenario**: To get past the refusal, the operator replaces the key without rotating, and existing ciphertext becomes unreadable.
- **Severity**: High
- **Affected area**: All encrypted data of the installation
- **Mitigation**: Every refusal says "do not generate a new key over existing data". The runbook starts with the empty-database check and a backup.
- **Residual risk**: An operator who ignores both still has the backup and the old key.

#### Logins break after rotation
- **Scenario**: The pepper falls back to the new secret, so every `email_hash` changes.
- **Severity**: High
- **Affected area**: Staff and portal login, all hash lookups
- **Mitigation**: Runbook step 1 pins `LOOKUP_HASH_PEPPER` to the old value before rotation. TC-ENC-KEY-003 verifies a lookup after rotation.
- **Residual risk**: Lookup hashes stay keyed with a public pepper; that work is in the security backlog.

#### The escape is set in production
- **Scenario**: An operator copies `OM_ALLOW_PUBLISHED_DEV_KEY=1` from a dev Compose file into production.
- **Severity**: Medium
- **Affected area**: That deployment
- **Mitigation**: `server start` strips it, and an error-level log fires on every start of any other process that honours it.
- **Residual risk**: A process started directly with the variable runs. That is a deliberate operator act.

#### A swallow site hides the refusal
- **Scenario**: A broad `catch` around `createKmsService` keeps the process alive without encryption.
- **Severity**: Medium
- **Affected area**: Any in-process caller
- **Mitigation**: The service-start assertion runs before any container exists, the known catch sites rethrow, and a unit test covers `createRequestContainer` rejecting.
- **Residual risk**: Third-party catch sites. The upgrade note tells module authors to rethrow.

## Implementation Plan

### Phase 1: Runtime guard
1. Add `keyPolicy.ts` and `keyPolicy.test.ts`: each outcome, normalization and multi-byte characters; forms hex and base64 decoding; the source file contains none of the probe literals; every digest in the production Compose preflight set is in `PUBLISHED_TENANT_KEY_DIGESTS`; no secret, length or digest in any message.
2. Prerequisite (a). Unit test: a tenant with a `vector:vector_search` map rotates, exits 0 and prints the reindex step; an unknown unresolvable map still fails.
3. Prerequisite (b). Unit test with a recording connection: old-root ciphertext is resealed and its hash recomputed, current ciphertext is untouched, and an unreadable value is counted with a non-zero exit.
4. Prerequisite (c). Unit test: rows are rewrapped, the second run is a no-op, and `--dry-run` changes nothing.
5. Test environments (section 4). Runner unit tests cover create, reuse, attach and stale state.
6. Enforcement (sections 2 and 3), the Emergency Security Exception PR. Unit tests: `createKmsService` and forms `resolveKmsAdapter` throw only in production; the escape and its stripping by `server start`; `createRequestContainer` rejects with the typed error; the dispatcher asserts its service list before run; the preflight probe relays the policy message. Steps 1–5 change no behaviour and may merge first.
7. Docs runbook, `UPGRADE_NOTES.md` and the `BACKWARD_COMPATIBILITY.md` entry.

### Phase 2: Production Compose defaults
1. Edit the three production Compose files (section 7), including template sync.
2. Extend `scripts/__tests__/fullapp-compose-encryption.test.mjs` (or a sibling, skipped without Docker like it): `docker compose config` fails without `MEILISEARCH_MASTER_KEY` or `POSTGRES_PASSWORD`; the rendered `DEMO_MODE` is `false` and `MEILI_ENV` is `production`.
3. Upgrade note lines and the compatibility note.

## Integration Coverage

The tests start child processes against the ephemeral environment's database, with their own environment variables. They never change the shared app's environment, and they kill children and delete fixtures in `finally`.

| Test | Path | Asserts |
|---|---|---|
| TC-ENC-KEY-001 | `mercato queue worker <queue>` child, `NODE_ENV=production` | With published probe 1 it exits 1 before consuming. Stderr names `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` and the runbook anchor and does not contain the probe. With `OM_ALLOW_PUBLISHED_DEV_KEY=1` it stays up and logs one error line. With a 20-byte key it stays up and logs one warning. |
| TC-ENC-KEY-002 | Same child with published forms probe 8 | Exits 1 naming `FORMS_ENCRYPTION_MASTER_KEY`. |
| TC-ENC-KEY-003 | `POST /api/directory/tenants` fixture, `mercato entities rotate-encryption-key` child | Inputs: a new key, `TENANT_DATA_ENCRYPTION_OLD_KEY` set to the environment's key, and `LOOKUP_HASH_PEPPER` set to the environment's effective lookup secret. The fixture tenant rotates with exit 0 and prints the vector reindex step. A second child on the new configuration decrypts the fixture user and finds it by email hash. |

Phase 2 changes no runtime path; its coverage is the Compose script test.

## Final Compliance Report — 2026-11-20

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Never commit credentials | Compliant | Published literals leave CI and runner config; code stores digests only |
| root AGENTS.md | Mirror `apps/mercato` app and env changes into the create-app template | Compliant | Template sync stated, parity test exists |
| root AGENTS.md | Never bypass encryption helpers | Compliant | One shared policy, called by the KMS factory |
| `BACKWARD_COMPATIBILITY.md` | Emergency Security Exception | Compliant | Narrow refusal; escape argued; dated entry; upgrade note; named approval |
| `.ai/qa/AGENTS.md` | Self-contained integration tests | Compliant | Child processes and fixture tenant cleaned up |

Verdict: ready for implementation. The refusal (Phase 1 step 6) waits for steps 2–5.

## Changelog

### 2026-11-20
- Rewritten to minimal GDPR scope
