import { registerTranslatableFields } from '@open-mercato/shared/lib/localization/translatable-fields'

jest.mock('#generated/entity-fields-registry', () => ({
  getEntityFields: jest.fn(),
}))

import { getEntityFields } from '#generated/entity-fields-registry'
import { resolveFieldList } from '../resolve-field-list'

const mockedGetEntityFields = getEntityFields as jest.MockedFunction<typeof getEntityFields>

beforeEach(() => {
  mockedGetEntityFields.mockReset()
})

describe('resolveFieldList', () => {
  describe('explicit fields', () => {
    it('returns explicit fields when provided', () => {
      const result = resolveFieldList('catalog:product', ['title', 'description'], [])
      expect(result).toEqual([
        { key: 'title', label: 'Title', multiline: false },
        { key: 'description', label: 'Description', multiline: true },
      ])
    })

    it('marks content fields as multiline', () => {
      const result = resolveFieldList('catalog:product', ['content', 'short_description'], [])
      expect(result).toEqual([
        { key: 'content', label: 'Content', multiline: true },
        { key: 'short_description', label: 'Short Description', multiline: true },
      ])
    })

    it('ignores registry and entity fields when explicit fields given', () => {
      registerTranslatableFields({ 'test:explicit_priority': ['name', 'description'] })
      const result = resolveFieldList('test:explicit_priority', ['title'], [])
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('title')
    })

    it('ignores custom field defs when explicit fields given', () => {
      const result = resolveFieldList('catalog:product', ['title'], [
        { key: 'custom_note', kind: 'text' },
      ])
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('title')
    })
  })

  describe('registered translatable fields', () => {
    it('uses registered fields when no explicit fields', () => {
      registerTranslatableFields({ 'test:registered': ['name', 'description', 'content'] })
      const result = resolveFieldList('test:registered', undefined, [])
      expect(result).toEqual([
        { key: 'name', label: 'Name', multiline: false },
        { key: 'description', label: 'Description', multiline: true },
        { key: 'content', label: 'Content', multiline: true },
      ])
    })

    it('does not call getEntityFields when registered fields exist', () => {
      registerTranslatableFields({ 'test:no_entity_lookup': ['title'] })
      resolveFieldList('test:no_entity_lookup', undefined, [])
      expect(mockedGetEntityFields).not.toHaveBeenCalled()
    })
  })

  describe('auto-detect via getEntityFields', () => {
    it('auto-detects translatable fields from entity fields', () => {
      mockedGetEntityFields.mockReturnValue({
        field1: 'title',
        field2: 'name',
        field3: 'id',
        field4: 'created_at',
        field5: 'sku',
      })
      const result = resolveFieldList('unknown:my_entity', undefined, [])
      expect(mockedGetEntityFields).toHaveBeenCalledWith('my_entity')
      expect(result.map((f) => f.key)).toEqual(['title', 'name'])
    })

    it('skips non-string and empty values', () => {
      mockedGetEntityFields.mockReturnValue({
        field1: 'title',
        field2: '',
        field3: '   ',
        field4: null as unknown as string,
      })
      const result = resolveFieldList('unknown:test_entity', undefined, [])
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('title')
    })

    it('deduplicates fields', () => {
      mockedGetEntityFields.mockReturnValue({
        field1: 'title',
        field2: 'title',
      })
      const result = resolveFieldList('unknown:dup_entity', undefined, [])
      expect(result).toHaveLength(1)
    })

    it('returns empty when entity slug is missing', () => {
      const result = resolveFieldList('nocolon', undefined, [])
      expect(result).toEqual([])
    })

    it('returns empty when getEntityFields returns null', () => {
      mockedGetEntityFields.mockReturnValue(null)
      const result = resolveFieldList('unknown:missing_entity', undefined, [])
      expect(result).toEqual([])
    })
  })

  describe('custom field defs augmentation (auto-detect path only)', () => {
    it('appends text custom fields when no registered fields', () => {
      mockedGetEntityFields.mockReturnValue({ field1: 'title' })
      const result = resolveFieldList('unknown:cf_text', undefined, [
        { key: 'custom_note', kind: 'text', label: 'Custom Note' },
      ])
      expect(result).toHaveLength(2)
      expect(result[1]).toEqual({ key: 'custom_note', label: 'Custom Note', multiline: false })
    })

    it('appends multiline custom fields as multiline', () => {
      mockedGetEntityFields.mockReturnValue({ field1: 'title' })
      const result = resolveFieldList('unknown:cf_multiline', undefined, [
        { key: 'long_text', kind: 'multiline' },
      ])
      expect(result[1].multiline).toBe(true)
    })

    it('appends richtext custom fields as multiline', () => {
      mockedGetEntityFields.mockReturnValue({ field1: 'title' })
      const result = resolveFieldList('unknown:cf_richtext', undefined, [
        { key: 'rich_content', kind: 'richtext' },
      ])
      expect(result[1].multiline).toBe(true)
    })

    it('skips non-text kinds (number, boolean, etc.)', () => {
      mockedGetEntityFields.mockReturnValue({ field1: 'title' })
      const result = resolveFieldList('unknown:cf_skip', undefined, [
        { key: 'quantity', kind: 'number' },
        { key: 'is_active', kind: 'boolean' },
        { key: 'created_at', kind: 'date' },
      ])
      expect(result).toHaveLength(1)
    })

    it('does not duplicate fields already in the list', () => {
      mockedGetEntityFields.mockReturnValue({ field1: 'title' })
      const result = resolveFieldList('unknown:cf_nodup', undefined, [
        { key: 'title', kind: 'text' },
      ])
      expect(result).toHaveLength(1)
    })

    it('uses formatFieldLabel when custom field has no label', () => {
      mockedGetEntityFields.mockReturnValue({ field1: 'title' })
      const result = resolveFieldList('unknown:cf_nolabel', undefined, [
        { key: 'product_note', kind: 'text' },
      ])
      expect(result[1].label).toBe('Product Note')
    })

    it('skips custom fields with empty key', () => {
      mockedGetEntityFields.mockReturnValue({ field1: 'title' })
      const result = resolveFieldList('unknown:cf_emptykey', undefined, [
        { key: '', kind: 'text' },
        { key: '  ', kind: 'text' },
      ])
      expect(result).toHaveLength(1)
    })

    it('does NOT append custom fields when registered fields exist', () => {
      registerTranslatableFields({ 'test:cf_registered': ['title'] })
      const result = resolveFieldList('test:cf_registered', undefined, [
        { key: 'custom_note', kind: 'text', label: 'Custom Note' },
      ])
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('title')
    })
  })
})
