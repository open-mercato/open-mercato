/**
 * Pins the contract between the module's encryption map and its search config.
 *
 * These two files are edited independently and neither one fails to compile when
 * they disagree, but disagreeing is a data leak in one direction and a silently
 * unsearchable column in the other:
 *
 * - a field in `defaultEncryptionMaps` that is ALSO in `fieldPolicy.searchable`
 *   would be handed to an external fulltext/vector provider as plaintext
 * - a field in `defaultEncryptionMaps` that appears in neither `excluded` nor
 *   `hashOnly` is only implicitly kept out of provider payloads, so a later edit
 *   to the whitelist can expose it without any signal
 *
 * Token search over the encrypted column is NOT covered by `fieldPolicy` at all:
 * `search_tokens` rows come from `reindexSearchTokensForRecord`, which decrypts
 * the index doc first. That is why excluding the field here costs no reachability.
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

  it('explicitly keeps every encrypted field out of provider-visible indexing', () => {
    const policy = searchEntityFor(ENTITY_ID).fieldPolicy ?? {}
    const withheld = new Set([...(policy.excluded ?? []), ...(policy.hashOnly ?? [])])
    const implicitOnly = encryptedFieldsFor(ENTITY_ID).filter((field) => !withheld.has(field))
    expect(implicitOnly).toEqual([])
  })

  it('claims a hash-only field only when the encryption map declares a hash sibling', () => {
    const map = defaultEncryptionMaps.find((entry) => entry.entityId === ENTITY_ID)
    const withHashField = new Set(
      (map?.fields ?? []).filter((field) => Boolean(field.hashField)).map((field) => field.field),
    )
    const hashOnly = searchEntityFor(ENTITY_ID).fieldPolicy?.hashOnly ?? []
    const unbacked = hashOnly.filter((field) => !withHashField.has(field))
    expect(unbacked).toEqual([])
  })

  it('keeps the module encryption map scoped to entities this module owns', () => {
    for (const entry of defaultEncryptionMaps) {
      expect(entry.entityId.startsWith('example:')).toBe(true)
    }
  })
})
