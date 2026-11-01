# Require production Compose encryption configuration (#7231)

Status: implemented; full validation and named maintainer security-waiver approval pending.

## Problem and scope

Production Compose injected a publicly known root into app, MCP and Documents
collaboration. The derived KMS deterministically derives tenant and system DEKs;
lookup hashing also uses that root when no dedicated pepper is supplied. A database
copy is therefore insufficiently protected when the operator keeps the default.
The env examples published the same reusable material. Issue: #7231.

Affects the canonical starter, root compatibility duplicate and standalone template.
No changes to runtime cryptography, KMS interfaces, API-key hashing, DB schema,
CLI signatures, or explicitly supplied strong operator key precedence.

## Implementation

- Blank preferred and legacy key settings in production Compose and env examples.
- Share one encryption environment mapping between the preflight and every consumer,
  including Vault address/token/mount/timeouts and explicit lookup pepper.
- A Node preflight process using the application image rejects absent configuration,
  normalized keys below 32 UTF-8 bytes and SHA-256 fingerprints of published keys.
  It preserves runtime normalization and preferred-over-legacy key precedence.
  Without a key, both a valid HTTP(S) Vault address and nonempty token are required.
- Every app/sidecar depends on preflight `service_completed_successfully`, before
  initialization or serving. The template tags the app image for preflight reuse.
- Compose rendering alone is not a startup check; the executed preflight enforces
  the requirement. It never logs key/token values. It validates configuration, not
  Vault reachability, policy or cryptographic entropy. Operators generate random keys.
- The production guard is independent of the encryption toggle. Disabling encryption
  does not bypass it; this prevents using the toggle as an upgrade workaround.
  Local development stacks remain intended only for disposable development data.

## Migration & Backward Compatibility

Deployment environment/default behavior is STABLE configuration. Removing the
published fallback is a deliberate security narrowing: retaining the implicit default
or a toggle to accept it would leave offline decryption reachable for another release.
Existing explicit strong keys and supported configured Vault remain accepted, with
ciphertext formats, derivation and lookup precedence unchanged.

The narrow removal needs the Emergency Security Exception in
`BACKWARD_COMPATIBILITY.md`; named human maintainer approval acknowledging steps
1–3 of the deprecation protocol is **pending and required before merge**. An automated
review cannot grant it. The security label and dated contract entry accompany this spec.

Operator and downstream client instructions are in `UPGRADE_NOTES.md` and
[the migration runbook](../../starters/docker/encryption-migration.md). Old roots and
DEKs must be preserved securely until complete data/hashes migration and backup
recovery are verified. Published/weak keys are accepted only as old material by an
offline administrative migration process, never as the production server's active key.

The existing entities rotation CLI migrates derived tenant-root mapped fields and
custom documents, with dry runs and explicit scope. It is not a universal rotation
or lookup backfill: system-scoped data, hashes outside migrated fields, Vault old
DEKs and service-level credential envelopes require owner-assisted work. Affected
installations must remain in maintenance until their complete migration is validated.
No automatic migration, secret regeneration, data deletion or fallback bridge ships.

## Verification

`node --test scripts/__tests__/fullapp-compose-encryption.test.mjs` renders each
production stack with a clean environment and runs its rendered preflight command:
missing/blank settings and incomplete Vault fail; generated preferred/legacy keys
and configured Vault succeed; short/published keys and invalid Vault URLs fail;
consumer environments, image reuse, precedence and successful-completion dependencies
are checked. Env examples must contain empty keys. With
`OM_COMPOSE_ENCRYPTION_TEST_IMAGE` set to an available Node-capable container image,
the same suite runs isolated Compose projects with the real preflight and a dependent
application probe, proving rejection prevents process startup and valid keys permit it.
No production containers or databases are used. Root compatibility parity and existing
deployment configuration tests also run. No API/UI route changes need new API/UI tests.
Live Vault connectivity and real installation-wide rotation remain operator checks.

## Changelog

- 2026-11-01: Verified #7231, implemented configuration guard and tests, documented
  safe migration, rotation gaps, recovery requirements and pending security waiver.
