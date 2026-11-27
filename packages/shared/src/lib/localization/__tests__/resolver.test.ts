import { applyLocalizedContent } from '../resolver'
import { registerTranslatableFields } from '../translatable-fields'

const entityType = 'test:localizable_record'
registerTranslatableFields({ [entityType]: ['title', 'description', 'price', 'id', 'tenantId', 'organization_id'] })

describe('applyLocalizedContent', () => {
  const baseRecord = { id: '1', title: 'Hello', description: 'World', price: 100 }

  describe('no overlay applied', () => {
    it('returns original record when translations is null', () => {
      const result = applyLocalizedContent(baseRecord, null, 'de', entityType)
      expect(result).toEqual(baseRecord)
      expect(result._locale).toBeUndefined()
      expect(result._translated).toBeUndefined()
    })

    it('returns original record when translations is undefined', () => {
      const result = applyLocalizedContent(baseRecord, undefined, 'de', entityType)
      expect(result).toEqual(baseRecord)
    })

    it('returns original record when locale not in translations', () => {
      const translations = { fr: { title: 'Bonjour' } }
      const result = applyLocalizedContent(baseRecord, translations, 'de', entityType)
      expect(result).toEqual(baseRecord)
      expect(result._locale).toBeUndefined()
    })

    it('returns original record when translations is empty object', () => {
      const result = applyLocalizedContent(baseRecord, {}, 'de', entityType)
      expect(result).toEqual(baseRecord)
    })
  })

  describe('overlay applied', () => {
    it('overlays fields from matching locale', () => {
      const translations = { de: { title: 'Hallo', description: 'Welt' } }
      const result = applyLocalizedContent(baseRecord, translations, 'de', entityType)
      expect(result.title).toBe('Hallo')
      expect(result.description).toBe('Welt')
      expect(result.price).toBe(100)
    })

    it('adds _locale metadata', () => {
      const translations = { de: { title: 'Hallo' } }
      const result = applyLocalizedContent(baseRecord, translations, 'de', entityType)
      expect(result._locale).toBe('de')
    })

    it('adds _translated array with overlaid field names', () => {
      const translations = { de: { title: 'Hallo', description: 'Welt' } }
      const result = applyLocalizedContent(baseRecord, translations, 'de', entityType)
      expect(result._translated).toEqual(['title', 'description'])
    })

    it('only overlays fields that exist on the base record', () => {
      const translations = { de: { title: 'Hallo', nonexistent: 'Nope' } }
      const result = applyLocalizedContent(baseRecord, translations, 'de', entityType)
      expect(result.title).toBe('Hallo')
      expect((result as Record<string, unknown>).nonexistent).toBeUndefined()
      expect(result._translated).toEqual(['title'])
    })

    it('limits overlays to registered text fields and preserves identity and scope', () => {
      const original = { ...baseRecord, tenantId: 'tenant', organization_id: 'organization', status: 'draft' }
      const translations = {
        de: {
          title: 'Hallo',
          description: 42,
          status: 'Published label',
          id: 'identifier',
          tenantId: 'scope',
          organization_id: 'scope',
          price: '100',
        },
      }

      expect(applyLocalizedContent(original, translations, 'de', entityType)).toEqual({
        ...original, title: 'Hallo', _locale: 'de', _translated: ['title'],
      })
    })

    it('returns the base record when the entity has no translation registration', () => {
      const translations = { de: { title: 'Hallo' } }
      expect(applyLocalizedContent(baseRecord, translations, 'de', 'test:unregistered')).toBe(baseRecord)
      expect(applyLocalizedContent(baseRecord, translations, 'de')).toBe(baseRecord)
    })

    it('can localize a nullable text field', () => {
      const original = { ...baseRecord, description: null }
      const translations = { de: { description: 'Welt' } }
      expect(applyLocalizedContent(original, translations, 'de', entityType).description).toBe('Welt')
    })

    it('does not overlay null translation values', () => {
      const translations = { de: { title: null, description: 'Welt' } }
      const result = applyLocalizedContent(baseRecord, translations, 'de', entityType)
      expect(result.title).toBe('Hello')
      expect(result.description).toBe('Welt')
      expect(result._translated).toEqual(['description'])
    })

    it('does not overlay undefined translation values', () => {
      const translations = { de: { title: undefined, description: 'Welt' } }
      const result = applyLocalizedContent(baseRecord, translations, 'de', entityType)
      expect(result.title).toBe('Hello')
      expect(result.description).toBe('Welt')
    })
  })

  describe('immutability', () => {
    it('does not mutate the original record', () => {
      const original = { id: '1', title: 'Hello' }
      const translations = { de: { title: 'Hallo' } }
      const result = applyLocalizedContent(original, translations, 'de', entityType)
      expect(result.title).toBe('Hallo')
      expect(original.title).toBe('Hello')
    })
  })

  describe('metadata not added when nothing translated', () => {
    it('omits _locale and _translated when overlay has no matching fields', () => {
      const translations = { de: { unknown_field: 'value' } }
      const result = applyLocalizedContent(baseRecord, translations, 'de', entityType)
      expect(result._locale).toBeUndefined()
      expect(result._translated).toBeUndefined()
    })

    it('omits _locale and _translated when all overlay values are null', () => {
      const translations = { de: { title: null } }
      const result = applyLocalizedContent(baseRecord, translations, 'de', entityType)
      expect(result._locale).toBeUndefined()
      expect(result._translated).toBeUndefined()
    })
  })
})
