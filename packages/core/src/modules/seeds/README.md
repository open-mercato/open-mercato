# Seeds module — encrypted data seeding

Load confidential, identical baseline data into every tenant without committing the
plaintext to the repo. The data lives in the repo only as an **opaque encrypted
blob**; the decryption key is distributed out-of-band (e.g. at hackathon kickoff).

## Why this exists

Putting confidential data in a `seedExamples` function or a SQL dump leaks it: the
plaintext is readable in the source tree (including by any agent/LLM that browses
it). This module separates the two concerns:

1. **Distribution confidentiality** — the seed file is AES-256-GCM encrypted with a
   key (`OM_SEED_KEY`) that is *not* in the repo. Only the ciphertext is committed.
2. **Encryption-at-rest** — records are inserted through the ORM, so the platform's
   per-tenant field encryption (`TenantDataEncryptionService`) automatically
   encrypts marked fields. You never touch tenant DEKs.

`OM_SEED_KEY` is independent from the field-encryption keys
(`TENANT_DATA_ENCRYPTION_*` / Vault) — rotating one never affects the other.

## File format (plaintext, before encryption)

```jsonc
{
  "format": "om-seed",
  "version": 1,
  "records": [
    {
      "entity": "customers:customer_entity",   // platform entity id (module:entity)
      "match": ["id"],                          // optional idempotency keys (non-encrypted only)
      "data": { "id": "…", "displayName": "Jane Doe", "primaryEmail": "…" }
    }
  ]
}
```

- `data` keys are the **entity's property names** (camelCase, as declared on the
  MikroORM entity), e.g. `displayName`, `primaryEmail`.
- **Do not** put `tenantId`/`organizationId` in `data` — the loader injects the
  target scope at load time, so the same blob seeds any tenant.
- Records apply **in array order**; create parents before children for FK refs
  (use explicit `id`s in `data` to reference them).
- `match` enables idempotent re-runs (skip if a row already matches). Match fields
  **must be non-encrypted natural keys** (`id`, `slug`, `code`, `*_hash`) —
  encrypted fields have non-deterministic ciphertext and cannot be matched.

See `examples/sample-seed.json` for a runnable template.

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

## Hackathon flow

1. Maintainer: `seeds keygen` → share the key privately with participants.
2. Maintainer: author `seed.json`, `seeds encrypt` it, commit only `seed.enc.json`.
3. Each participant: set `OM_SEED_KEY`, run `mercato auth setup …` to create their
   tenant, then `mercato seeds load --in seed.enc.json --tenant <t> --org <o>`.

The generic library lives in `@open-mercato/shared/lib/seed` (`crypto`, `loader`,
`types`) and can be reused from a `setup.ts` `seedExamples` hook if you prefer
automatic loading during `mercato auth setup --with-examples`.
