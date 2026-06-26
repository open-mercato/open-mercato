---
id: encrypted-seeding
title: Encrypted Data Seeding
sidebar_label: Encrypted Seeding
---

# Encrypted Data Seeding

Load confidential, identical baseline data into every tenant **without committing
the plaintext to the repo**. The data lives in git only as an opaque encrypted
blob; the decryption key is distributed out-of-band (for example, handed to
participants at the start of a hackathon).

The `seeds` core module provides the CLI; the reusable logic lives in
`@open-mercato/shared/lib/seed` and can be called from a `setup.ts`
`seedExamples` hook if you prefer automatic loading during `mercato auth setup`.

## Why this exists

Putting confidential data in a `seedExamples` function or a SQL dump leaks it —
the plaintext is readable in the source tree, including by any agent/LLM that
browses it. This mechanism separates two independent concerns:

1. **Distribution confidentiality** — the seed file is AES-256-GCM encrypted with
   a key (`OM_SEED_KEY`) that is *not* in the repo. Only the ciphertext is
   committed.
2. **Encryption-at-rest** — records are inserted through the ORM, so the
   platform's per-tenant field encryption (`TenantDataEncryptionService`)
   automatically encrypts marked fields. You never touch tenant DEKs.

These are different layers. The platform's field encryption alone does **not**
solve distribution confidentiality: if the plaintext sits in a seed function, the
*source* is readable even though the DB column ends up encrypted. `OM_SEED_KEY` is
deliberately separate from the field-encryption keys (`TENANT_DATA_ENCRYPTION_*` /
Vault) — rotating or sharing one never affects the other.

### Why not a database dump?

A `pg_dump` captures the **ciphertext as stored**, tied to one specific
`tenantId` + DEK. Restoring it only decrypts correctly if every participant shares
the same `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` + `LOOKUP_HASH_PEPPER` and the
`tenantId` is preserved (derived-key mode only — **impossible with Vault**, where
the DEK is random and lives server-side). It also fights with migrations and
multi-tenant scoping. The encrypted-seed approach avoids all of this: you insert
plaintext through the ORM and whatever encryption backend is configured encrypts
transparently.

## File format

The plaintext seed document (before encryption):

```jsonc
{
  "format": "om-seed",
  "version": 1,
  "records": [
    {
      "entity": "customers:customer_entity",   // platform entity id (module:entity)
      "match": ["id"],                          // optional idempotency keys
      "data": { "id": "…", "displayName": "Jane Doe", "primaryEmail": "…" }
    }
  ]
}
```

Rules:

- `entity` is the platform entity id (`module:entity`).
- `data` keys are the **entity's property names** (camelCase, as declared on the
  MikroORM entity), e.g. `displayName`, `primaryEmail`.
- **Do not** put `tenantId`/`organizationId` in `data` — the loader injects the
  target scope at load time, so the same blob seeds any tenant.
- Records apply **in array order**; create parents before children for foreign-key
  references (use explicit `id`s in `data` to reference them).
- `match` enables idempotent re-runs (skip if a row already matches). Match fields
  **must be non-encrypted natural keys** (`id`, `slug`, `code`, `*_hash`) —
  encrypted fields have non-deterministic ciphertext and cannot be matched.

The committed, encrypted envelope is opaque:

```json
{
  "format": "om-encrypted-seed",
  "version": 1,
  "algorithm": "aes-256-gcm",
  "payload": "<iv:ct:tag:v1>"
}
```

## CLI

```bash
# 1. Generate a key once; distribute it out-of-band, never commit it.
yarn mercato seeds keygen
#   → prints a base64 32-byte key. Set OM_SEED_KEY=<key> for every participant.

# 2. Author plaintext seed data locally (NOT committed), then encrypt it.
OM_SEED_KEY=<key> yarn mercato seeds encrypt --in ./seed.json --out ./seed.enc.json
#   → commit seed.enc.json (opaque); keep seed.json out of git (.gitignore).

# 3. Edit later: decrypt → edit → re-encrypt.
OM_SEED_KEY=<key> yarn mercato seeds decrypt --in ./seed.enc.json --out ./seed.json

# 4. Load into a tenant (after `mercato auth setup` created the tenant/org).
OM_SEED_KEY=<key> yarn mercato seeds load \
  --in ./seed.enc.json --tenant <tenantId> --org <organizationId>

#   Dry run (validates + reports counts, rolls back the transaction):
OM_SEED_KEY=<key> yarn mercato seeds load --in ./seed.enc.json --tenant <t> --org <o> --dry-run

#   Load an unencrypted file (local dev only):
yarn mercato seeds load --in ./seed.json --tenant <t> --org <o> --plain
```

`--key <base64>` overrides `OM_SEED_KEY` on any command.

| Command | Touches DB? | Purpose |
|---------|-------------|---------|
| `keygen` | no | Generate a base64 32-byte `OM_SEED_KEY` |
| `encrypt` | no | Plaintext seed → opaque encrypted envelope |
| `decrypt` | no | Envelope → plaintext (for editing) |
| `load` | **yes** | Decrypt + insert into a tenant (idempotent, auto-encrypts at rest) |

## Hackathon flow

1. **Maintainer:** `seeds keygen` → share the key privately with participants.
2. **Maintainer:** author `seed.json`, `seeds encrypt` it, commit only
   `seed.enc.json`. Add the plaintext file to `.gitignore`.
3. **Each participant:** set `OM_SEED_KEY`, run `mercato auth setup …` to create
   their tenant, then
   `mercato seeds load --in seed.enc.json --tenant <t> --org <o>`.

Every participant ends up with identical baseline data, encrypted at rest in their
own tenant, and the confidential plaintext never enters the repository.

## Encryption backend interaction

Whether loaded data is encrypted at rest depends on the configured KMS backend
(see [the encryption configuration](../security/)):

- **Vault** (`VAULT_ADDR` + `VAULT_TOKEN`) or a **derived fallback key**
  (`TENANT_DATA_ENCRYPTION_FALLBACK_KEY`) → marked fields are encrypted at rest
  automatically as records are inserted.
- **Nothing configured** → the platform falls back to a no-op KMS and fields are
  stored as plaintext. Ensure participants have a key source configured if
  at-rest encryption matters for the seeded data.

The seed mechanism itself is agnostic to this — it always inserts plaintext
through the ORM and lets the configured backend do (or skip) the encryption.

## Programmatic use

The library is exported from `@open-mercato/shared/lib/seed`:

```ts
import { decryptSeedEnvelope, resolveSeedKey } from '@open-mercato/shared/lib/seed/crypto'
import { loadSeedDocument } from '@open-mercato/shared/lib/seed/loader'

// e.g. inside a setup.ts seedExamples hook
const doc = decryptSeedEnvelope(envelopeJson, resolveSeedKey())
await loadSeedDocument(em, doc, { tenantId, organizationId })
```
