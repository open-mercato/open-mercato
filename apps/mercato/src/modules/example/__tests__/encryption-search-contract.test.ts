/**
 * Pins the contract between the module's encryption map and its search config.
 *
 * These two files are edited independently and neither one fails to compile when
 * they disagree, but disagreeing is a data leak in one direction and a silently
 * unsearchable column in the other:
 *
 * - a field in `defaultEncryptionMaps` that is ALSO in `fieldPolicy.searchable`
 *   would be handed to an external fulltext/vector provider as plaintext
 * - a field in `defaultEncryptionMaps` that is in NEITHER `searchable` nor
 *   `hashOnly` falls through the whitelist and is silently unsearchable
 */
import defaultEncryptionMaps from '../encryption'
import searchConfig from '../search'

const ENTITY_ID = 'example:todo'

function encryptedFieldsFor(entityId: string): string[] {
  const map = defaultEncryptionMaps.find((entry) => entry.entityId === entityId)
  return (map?.fields ?? []).map((field) => field.field)
}

function searchEntityFor(entityId: string) {
  const entity = searchConfig.entities.find((entry) => entry.entityId === entityId)
  if (!entity) throw new Error(`[internal] search config has no entry for ${entityId}`)
  return entity
}

describe('example encryption map and search config agree', () => {
  it('encrypts notes on the todo entity', () => {
    expect(encryptedFieldsFor(ENTITY_ID)).toEqual(['notes'])
  })

  it('never lists an encrypted field as provider-visible searchable text', () => {
    const encrypted = new Set(encryptedFieldsFor(ENTITY_ID))
    const searchable = searchEntityFor(ENTITY_ID).fieldPolicy?.searchable ?? []
    const leaked = searchable.filter((field) => encrypted.has(field))
    expect(leaked).toEqual([])
  })

  it('routes every encrypted field to hash-only search so it stays findable', () => {
    const encrypted = encryptedFieldsFor(ENTITY_ID)
    const hashOnly = new Set(searchEntityFor(ENTITY_ID).fieldPolicy?.hashOnly ?? [])
    const unreachable = encrypted.filter((field) => !hashOnly.has(field))
    expect(unreachable).toEqual([])
  })

  it('keeps the module encryption map scoped to entities this module owns', () => {
    for (const entry of defaultEncryptionMaps) {
      expect(entry.entityId.startsWith('example:')).toBe(true)
    }
  })
})
