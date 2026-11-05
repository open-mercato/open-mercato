import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * Default at-rest encryption for this module's entities.
 *
 * Tenant data encryption is ON unless `TENANT_DATA_ENCRYPTION` is explicitly
 * turned off, but these rows are only *materialized* as `EncryptionMap` records
 * at tenant creation or by `yarn mercato entities seed-encryption --tenant <id>`.
 * Declaring a field here therefore protects new tenants automatically and
 * existing tenants after that CLI runs.
 *
 * `Todo.notes` is the only field listed on purpose. `title` is simultaneously the
 * display column, the sort column and a CSV export column, and a column that
 * holds ciphertext cannot serve any of those: `order by title` sorts ciphertext,
 * `title ilike '%foo%'` compares a plaintext pattern against ciphertext and
 * matches nothing, and a CSV export would emit base64 blobs. Encrypting a field
 * is a decision about every read path that touches it — see `search.ts` and
 * `api/todos/route.ts` for the read-path consequences this module takes on.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'example:todo',
    fields: [{ field: 'notes' }],
  },
]

export default defaultEncryptionMaps
