# Sensitive Data and Encryption Maps

## 8. Sensitive Data and Encryption Maps

When the developer asks for "we need this column encrypted", "store this securely", "this is PII", "GDPR", or "encryption at rest" — and whenever you are designing a column that will hold names, addresses, contact information, free-text notes about people, integration credentials, secrets, or any data subject to a data-processing agreement — use the framework's **encryption-maps mechanism**. Do NOT hand-roll AES, raw `crypto.subtle`, custom KMS calls, or "TODO encrypt later" stubs.

The mechanism gives you:

- Per-tenant Data Encryption Keys (DEKs) resolved through the configured KMS (Vault by default, env-fallback in dev).
- Declarative, per-entity, per-field encryption with optional deterministic-hash sibling columns for equality lookups (for example login by email).
- Boot-time auto-application: every enabled module's `defaultEncryptionMaps` is collected during `auth:setup` and applied when `TENANT_DATA_ENCRYPTION=yes`.
- A `findWithDecryption` / `findOneWithDecryption` read API that transparently decrypts on read.

### When encryption is mandatory

| Field example | Encrypt? |
|---|---|
| First name, last name, preferred name | Yes |
| Email, phone | Yes — usually with a `hashField` for lookups |
| Postal address (line 1/2, city, region, postal code, country) | Yes |
| Free-text comments / notes / activity bodies that mention people | Yes |
| Integration secrets, API keys, OAuth tokens, webhook signing keys | Yes |
| Document numbers (tax IDs, national IDs) | Yes |
| Status enums, counters, timestamps, FKs, currency codes | No |
| Public catalog metadata (product titles for a public storefront) | Usually no |

If you are unsure, default to encrypting and confirm with the user — re-introducing encryption later requires a backfill, but turning it off later is a single map edit.

### Declare the map in `<module>/encryption.ts`

```typescript
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: '<module_id>:<entity>',  // matches the entity's table id (colon-separated)
    fields: [
      { field: 'first_name' },
      { field: 'last_name' },
      { field: 'phone' },
      // Sibling deterministic hash for equality lookups (e.g. login by email).
      // Add a matching `<field>_hash varchar` column to the entity.
      { field: 'email', hashField: 'email_hash' },
    ],
  },
]

export default defaultEncryptionMaps
```

### Read with decryption — never raw `em.find`

```typescript
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

// Signature: (em, entityName, where, options?, scope?). MikroORM FindOptions go in slot 4
// (pass `undefined` if you have none), the decryption scope `{ tenantId, organizationId }` in slot 5.
const records = await findWithDecryption(em, '<Entity>', filter, undefined, { tenantId, organizationId })
const single  = await findOneWithDecryption(em, '<Entity>', { id }, undefined, { tenantId, organizationId })
```

Calling `em.find` on an encrypted column returns ciphertext, breaks search, and silently leaks bug surface. The `findWithDecryption` family is the one entry point.

### Apply maps to existing tenants

```bash
yarn mercato entities seed-encryption --tenant <tenantId> [--organization <orgId>]
```

New tenants pick up the maps automatically during `auth:setup`. Toggling the **Encrypted** flag on a custom field via the admin UI also only applies to data written **after** the change — backfill historical plaintext rows by running `yarn mercato entities rotate-encryption-key --tenant <tenantId> --org <organizationId>` (without `--old-key` it skips already-encrypted fields and just encrypts plaintext). Use `yarn mercato entities decrypt-database` to roll back. For full UI flows and CLI options see <https://docs.open-mercato.dev/user-guide/encryption>.

### Vector search caveat

The `vector` module stores raw embeddings unencrypted in the vector store (e.g. pgvector). Even though the source text is decrypted only transiently to compute embeddings, treat the embeddings as sensitive: avoid embedding raw high-sensitivity text and rely on disk-level / managed-database encryption-at-rest for the vector column.

### Environment switches

- `TENANT_DATA_ENCRYPTION=yes|no` (default `yes`) — set to `no` to run the hooks as no-op (validation still applies).
- `TENANT_DATA_ENCRYPTION_DEBUG=yes` — log map evaluation, KMS calls, cache hits.
- `VAULT_ADDR` / `VAULT_TOKEN` / `VAULT_KV_PATH` — HashiCorp Vault KMS configuration.
- `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` — local/dev fallback key when Vault is unavailable. In dev, `AUTH_SECRET` / `NEXTAUTH_SECRET` is used as a last resort; production falls back to noop KMS.
