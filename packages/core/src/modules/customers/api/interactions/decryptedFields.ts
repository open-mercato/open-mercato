import { fieldNameCandidates } from '@open-mercato/shared/lib/query/encrypted-sort'

function normalizeDecryptedValue(value: unknown): unknown {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return value.toISOString()
  return value
}

/**
 * Each item on the page has the same response keys. Encrypted columns use the
 * same camelCase key in the response and on the ORM entity (`recurrenceRule`
 * for `recurrence_rule`), so match each map field once per page.
 */
export function createDecryptedFieldsOverlay(fieldsByOrganization: ReadonlyMap<string, readonly string[]>) {
  const keyByField = new Map<string, string | null>()
  const keysByOrganization = new Map<string, readonly string[]>()

  return function applyDecryptedFields<T extends Record<string, unknown>>(
    item: T,
    decryptedRecord: object | undefined,
    organizationId: string,
  ): T {
    const encryptedFields = fieldsByOrganization.get(organizationId)
    if (!decryptedRecord || !encryptedFields?.length) return item

    let keys = keysByOrganization.get(organizationId)
    if (!keys) {
      const organizationKeys: string[] = []
      for (const field of encryptedFields) {
        let key = keyByField.get(field)
        if (key === undefined) {
          key = fieldNameCandidates(field).find((candidate) => Object.hasOwn(item, candidate)) ?? null
          keyByField.set(field, key)
        }
        if (key !== null) organizationKeys.push(key)
      }
      keysByOrganization.set(organizationId, organizationKeys)
      keys = organizationKeys
    }

    const source = decryptedRecord as Record<string, unknown>
    let patched: T | null = null
    for (const key of keys) {
      if (!Object.hasOwn(source, key)) continue
      const value = normalizeDecryptedValue(source[key])
      if (value === item[key]) continue
      patched = patched ?? { ...item }
      const writable = patched as Record<string, unknown>
      writable[key] = value
    }
    return patched ?? item
  }
}
