import { isTranslatableField } from '../translatable-fields'

describe('isTranslatableField', () => {
  describe('translatable fields (returns true)', () => {
    it.each([
      'title',
      'name',
      'description',
      'content',
      'short_description',
      'style_code',
      'summary',
      'bio',
      'notes',
    ])('"%s" is translatable', (field) => {
      expect(isTranslatableField(field)).toBe(true)
    })
  })

  describe('exact blacklist (returns false)', () => {
    it.each([
      'id',
      'created_at',
      'updated_at',
      'deleted_at',
      'tenant_id',
      'organization_id',
      'is_active',
      'sort_order',
      'position',
      'slug',
      'sku',
      'barcode',
      'price',
      'quantity',
      'weight',
      'width',
      'height',
      'depth',
      'metadata',
      'config',
      'settings',
      'options',
    ])('"%s" is not translatable (exact blacklist)', (field) => {
      expect(isTranslatableField(field)).toBe(false)
    })
  })

  describe('suffix blacklist (returns false)', () => {
    it.each([
      ['product_id', '_id'],
      ['category_id', '_id'],
      ['updated_at', '_at'],
      ['expires_at', '_at'],
      ['password_hash', '_hash'],
      ['token_hash', '_hash'],
    ])('"%s" is not translatable (suffix %s)', (field) => {
      expect(isTranslatableField(field)).toBe(false)
    })
  })

  describe('case insensitivity', () => {
    it('rejects uppercase "ID"', () => {
      expect(isTranslatableField('ID')).toBe(false)
    })

    it('rejects mixed case "Created_At"', () => {
      expect(isTranslatableField('Created_At')).toBe(false)
    })

    it('rejects uppercase "SKU"', () => {
      expect(isTranslatableField('SKU')).toBe(false)
    })

    it('rejects "METADATA"', () => {
      expect(isTranslatableField('METADATA')).toBe(false)
    })
  })
})
