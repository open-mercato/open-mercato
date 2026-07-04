# Step 6 — Optional Features (search, translations, CLI, enrichers, encryption)

## 11. Optional Features

### Search Configuration

**File**: `src/modules/<module_id>/search.ts`

```typescript
import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  entities: {
    '<module_id>.<entity>': {
      fields: ['name'],  // Fields to index for fulltext search
      // Additional search config as needed
    },
  },
}
```

### Translations

**File**: `src/modules/<module_id>/translations.ts`

```typescript
export const translatableFields = {
  '<entity>': ['name', 'description'],  // Fields that support i18n
}
```

### CLI Commands

**File**: `src/modules/<module_id>/cli.ts`

```typescript
export default function registerCli(program: any) {
  program
    .command('<module_id>:seed')
    .description('Seed sample <entities>')
    .action(async () => {
      // Implementation
    })
}
```

### Response Enrichers

Use enrichers to add computed fields to another module's API responses without coupling the modules.

**File**: `src/modules/<module_id>/data/enrichers.ts`

```typescript
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

const <entity>Enricher: ResponseEnricher = {
  id: '<module_id>.<entity>-enricher',
  targetEntity: '<other_module>.<entity>',
  features: ['<module_id>.<entity>.view'],
  timeout: 2000,
  fallback: { _<module_id>: {} },
  async enrichOne(record, context) {
    return { ...record, _<module_id>: { /* computed fields */ } }
  },
  async enrichMany(records, context) {
    return records.map(r => ({ ...r, _<module_id>: { /* computed fields */ } }))
  },
}

export const enrichers: ResponseEnricher[] = [<entity>Enricher]
```

**Rules:**
- MUST implement `enrichOne` (required by the `ResponseEnricher` interface)
- MUST implement `enrichMany` for list endpoints to prevent N+1 queries
- Namespace enriched fields with `_<module_id>` prefix
- The target route must opt in: `makeCrudRoute({ ..., enrichers: { entityId: '<other_module>.<entity>' } })`
- Run `yarn generate` after adding `data/enrichers.ts`

---

### Encryption maps (sensitive / GDPR-relevant fields)

**Mandatory** when the entity stores PII, contact info, addresses, free-text notes about people, integration credentials, secrets, or anything subject to a data-processing agreement. Do NOT hand-roll AES, KMS calls, or "TODO encrypt later" stubs — the framework provides per-tenant DEKs and a declarative field-level map.

**File**: `src/modules/<module_id>/encryption.ts`

```typescript
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: '<module_id>:<entity>',  // matches data/entities.ts table id, colon-separated
    fields: [
      { field: 'first_name' },
      { field: 'last_name' },
      { field: 'phone' },
      // Add a hashField for deterministic equality lookups (e.g. login by email):
      { field: 'email', hashField: 'email_hash' },
    ],
  },
]

export default defaultEncryptionMaps
```

**Read paths** — never `em.find` an encrypted column directly:

```typescript
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

// Signature: (em, entityName, where, options?, scope?) — MikroORM FindOptions in slot 4
// (pass `undefined` when none), decryption scope in slot 5.
const records = await findWithDecryption(em, '<Entity>', filter, undefined, { tenantId, organizationId })
const single  = await findOneWithDecryption(em, '<Entity>', { id }, undefined, { tenantId, organizationId })
```

**Apply to existing tenants** after declaring or updating maps:

```bash
yarn mercato entities seed-encryption --tenant <tenantId> [--organization <orgId>]
```

New tenants pick up `defaultEncryptionMaps` automatically during `auth:setup`. Toggling the **Encrypted** flag for a field only applies to data written **after** the change — historical plaintext rows stay as they were until backfilled via `yarn mercato entities rotate-encryption-key --tenant <tenantId> --org <organizationId>` (without `--old-key` the command only encrypts plaintext and skips already-encrypted fields). Use `yarn mercato entities decrypt-database` to roll back. For end-to-end usage and admin UI flows see <https://docs.open-mercato.dev/user-guide/encryption>.

> Tip: when `email` (or any other column) needs deterministic lookups while encrypted, declare a sibling `hashField` in the map and add a matching `varchar` column to the entity. The framework keeps the hash in sync on writes; queries can target the hash instead of the cleartext column.
