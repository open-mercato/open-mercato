import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

// Only fields that are never searched via SQL ILIKE or accessed as JSON on raw
// Knex rows in the list API are encrypted here. The messages list API fetches
// rows with raw Knex (bypassing MikroORM's decrypt hooks) and exposes subject,
// body, and external_email to SQL filters, so encrypting those would break
// search and inbox rendering. The remaining inbox-safe fields (external_name,
// action_data, action_result) are also kept out of this map to avoid touching
// the raw-Knex response shape in the list API; revisit when the list endpoint
// is migrated to MikroORM or when per-column hash lookups are introduced.
export const defaultEncryptionMaps: ModuleEncryptionMap[] = []

export default defaultEncryptionMaps
