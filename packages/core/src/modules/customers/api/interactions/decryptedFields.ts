import { fieldNameCandidates } from '@open-mercato/shared/lib/query/encrypted-sort'

function normalizeDecryptedValue(value: unknown): unknown {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return value.toISOString()
  return value
}

function findKey(target: Record<string, unknown>, field: string): string | null {
  for (const candidate of fieldNameCandidates(field)) {
    if (Object.prototype.hasOwnProperty.call(target, candidate)) return candidate
  }
  return null
}

/**
 * Overrides the response fields an entity's encryption map covers with the
 * plaintext carried by its decrypted ORM record.
 *
 * List routes that read their base rows through Kysely get raw column values,
 * so every field the map declares arrives as ciphertext. Encryption maps are
 * configurable per deployment, so the covered set is resolved at runtime rather
 * than hard-coded — extending a map must not leave a field passing through as
 * ciphertext (#5945).
 *
 * Map fields are authored as column names (`recurrence_rule`) while response
 * keys and entity properties are camelCase (`recurrenceRule`), so each declared
 * field is matched through the shared candidate spellings. Fields that resolve
 * to neither a response key nor a record property are skipped, which keeps the
 * response shape unchanged.
 */
export function applyDecryptedFields<T extends Record<string, unknown>>(
  item: T,
  decryptedRecord: object | undefined,
  encryptedFields: readonly string[],
): T {
  if (!decryptedRecord || encryptedFields.length === 0) return item
  // ORM entities are class instances rather than index-signature types; the
  // encryption map addresses their columns by name, so read them as a record.
  const source = decryptedRecord as Record<string, unknown>
  let patched: T | null = null
  for (const field of encryptedFields) {
    const responseKey = findKey(item, field)
    const recordKey = findKey(source, field)
    if (!responseKey || !recordKey) continue
    const value = normalizeDecryptedValue(source[recordKey])
    if (value === item[responseKey]) continue
    patched = patched ?? { ...item }
    ;(patched as Record<string, unknown>)[responseKey] = value
  }
  return patched ?? item
}
