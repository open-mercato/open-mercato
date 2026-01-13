import type { SearchFieldPolicy } from '../types'

/**
 * Encryption map entry as stored in the database.
 * Matches the structure from entities/data/entities EncryptionMap.
 */
export type EncryptionMapEntry = {
  field: string
  hashField?: string | null
}

/**
 * Configuration for field extraction.
 */
export type FieldExtractionConfig = {
  /** Encryption map entries from the database */
  encryptedFields?: EncryptionMapEntry[]
  /** Additional field policy from entity search config */
  fieldPolicy?: SearchFieldPolicy
}

/**
 * Extract only searchable (non-sensitive) fields from a record.
 * This ensures encrypted and sensitive fields are never sent to external search providers.
 *
 * Field filtering logic:
 * 1. Exclude fields in encryption map (they contain encrypted data)
 * 2. Exclude fields in fieldPolicy.excluded
 * 3. Exclude fields in fieldPolicy.hashOnly (should only use hash-based search)
 * 4. If fieldPolicy.searchable is defined, only include those fields (whitelist mode)
 *
 * @param fields - All fields from the record
 * @param config - Extraction configuration with encryption map and field policy
 * @returns Object containing only safe-to-index fields
 */
export function extractSearchableFields(
  fields: Record<string, unknown>,
  config?: FieldExtractionConfig,
): Record<string, unknown> {
  const encryptedFieldSet = new Set<string>(
    config?.encryptedFields?.map((e) => e.field) ?? [],
  )

  const policy = config?.fieldPolicy
  const searchableWhitelist = policy?.searchable ? new Set(policy.searchable) : null
  const excludedBlacklist = new Set([
    ...(policy?.excluded ?? []),
    ...(policy?.hashOnly ?? []),
  ])

  const result: Record<string, unknown> = {}

  for (const [field, value] of Object.entries(fields)) {
    // Skip null/undefined values
    if (value == null) continue

    // Skip encrypted fields
    if (encryptedFieldSet.has(field)) continue

    // Skip explicitly excluded fields
    if (excludedBlacklist.has(field)) continue

    // If whitelist is defined, only include whitelisted fields
    if (searchableWhitelist && !searchableWhitelist.has(field)) continue

    result[field] = value
  }

  return result
}

/**
 * Extract fields that should use hash-based search only.
 * These are typically encrypted fields that have corresponding hash columns.
 *
 * @param fields - All fields from the record
 * @param config - Extraction configuration with encryption map and field policy
 * @returns Object containing field values for hash-based search
 */
export function extractHashOnlyFields(
  fields: Record<string, unknown>,
  config?: FieldExtractionConfig,
): Record<string, unknown> {
  const hashOnlyFromPolicy = new Set(config?.fieldPolicy?.hashOnly ?? [])

  // Fields with hashField in encryption map are also hash-searchable
  const hashFieldsFromEncryption = new Set<string>(
    config?.encryptedFields
      ?.filter((e) => e.hashField)
      .map((e) => e.field) ?? [],
  )

  const result: Record<string, unknown> = {}

  for (const [field, value] of Object.entries(fields)) {
    if (value == null) continue

    if (hashOnlyFromPolicy.has(field) || hashFieldsFromEncryption.has(field)) {
      result[field] = value
    }
  }

  return result
}

/**
 * Build a complete field classification for a record.
 * Useful for debugging and understanding how fields will be indexed.
 *
 * @param fields - All fields from the record
 * @param config - Extraction configuration
 * @returns Classification of each field
 */
export function classifyFields(
  fields: Record<string, unknown>,
  config?: FieldExtractionConfig,
): {
  searchable: string[]
  hashOnly: string[]
  excluded: string[]
} {
  const searchable: string[] = []
  const hashOnly: string[] = []
  const excluded: string[] = []

  const encryptedFieldSet = new Set<string>(
    config?.encryptedFields?.map((e) => e.field) ?? [],
  )
  const hashFieldsFromEncryption = new Set<string>(
    config?.encryptedFields
      ?.filter((e) => e.hashField)
      .map((e) => e.field) ?? [],
  )

  const policy = config?.fieldPolicy
  const searchableWhitelist = policy?.searchable ? new Set(policy.searchable) : null
  const hashOnlyFromPolicy = new Set(policy?.hashOnly ?? [])
  const excludedFromPolicy = new Set(policy?.excluded ?? [])

  for (const field of Object.keys(fields)) {
    // Check explicit exclusions
    if (excludedFromPolicy.has(field)) {
      excluded.push(field)
      continue
    }

    // Check hash-only
    if (hashOnlyFromPolicy.has(field) || hashFieldsFromEncryption.has(field)) {
      hashOnly.push(field)
      continue
    }

    // Check encrypted (without hash)
    if (encryptedFieldSet.has(field) && !hashFieldsFromEncryption.has(field)) {
      excluded.push(field)
      continue
    }

    // Check whitelist if defined
    if (searchableWhitelist && !searchableWhitelist.has(field)) {
      excluded.push(field)
      continue
    }

    searchable.push(field)
  }

  return { searchable, hashOnly, excluded }
}
