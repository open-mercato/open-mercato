import {
  formatFieldLabel,
  formatEntityLabel,
  buildEntityListUrl,
  getRecordLabel,
} from '../helpers'

describe('translation helpers', () => {
  describe('formatFieldLabel', () => {
    it('converts snake_case to Title Case', () => {
      expect(formatFieldLabel('product_name')).toBe('Product Name')
    })

    it('capitalizes single word', () => {
      expect(formatFieldLabel('title')).toBe('Title')
    })

    it('formats option dot-path as "Value (option)"', () => {
      expect(formatFieldLabel('options.red.label')).toBe('Red (option)')
    })

    it('formats option dot-path with lowercase value', () => {
      expect(formatFieldLabel('options.blue.label')).toBe('Blue (option)')
    })

    it('formats generic dot-path with " > " separator', () => {
      expect(formatFieldLabel('a.b.c')).toBe('A > B > C')
    })

    it('handles "description"', () => {
      expect(formatFieldLabel('description')).toBe('Description')
    })

    it('returns original for empty string', () => {
      expect(formatFieldLabel('')).toBe('')
    })

    it('handles multiple underscores', () => {
      expect(formatFieldLabel('long_field_name_here')).toBe('Long Field Name Here')
    })

    it('handles dot-path with two segments', () => {
      expect(formatFieldLabel('section.title')).toBe('Section > Title')
    })

    it('does not treat 4-segment option path as option', () => {
      expect(formatFieldLabel('options.red.label.extra')).toBe('Options > Red > Label > Extra')
    })
  })

  describe('formatEntityLabel', () => {
    it('returns provided label when different from entityId', () => {
      expect(formatEntityLabel('catalog:product', 'Product')).toBe('Product')
    })

    it('falls back to formatted name when label equals entityId', () => {
      expect(formatEntityLabel('catalog:product', 'catalog:product')).toBe('Product')
    })

    it('falls back to formatted name when no label provided', () => {
      expect(formatEntityLabel('catalog:catalog_product')).toBe('Catalog Product')
    })

    it('formats single-part entityId (no colon)', () => {
      expect(formatEntityLabel('product')).toBe('Product')
    })

    it('falls back when label is undefined', () => {
      expect(formatEntityLabel('catalog:offer', undefined)).toBe('Offer')
    })

    it('falls back when label is empty string', () => {
      expect(formatEntityLabel('catalog:item', '')).toBe('Item')
    })
  })

  describe('buildEntityListUrl', () => {
    it('builds URL for standard entity type', () => {
      expect(buildEntityListUrl('catalog:catalog_product')).toBe('/api/catalog/products')
    })

    it('builds URL when entity does not have module prefix', () => {
      expect(buildEntityListUrl('catalog:offer')).toBe('/api/catalog/offers')
    })

    it('does not double-pluralize already-plural entity', () => {
      expect(buildEntityListUrl('catalog:products')).toBe('/api/catalog/products')
    })

    it('returns null when no entity part after colon', () => {
      expect(buildEntityListUrl('catalog:')).toBeNull()
    })

    it('returns null when no colon present', () => {
      expect(buildEntityListUrl('catalog')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(buildEntityListUrl('')).toBeNull()
    })

    it('strips module prefix from entity name', () => {
      expect(buildEntityListUrl('sales:sales_order')).toBe('/api/sales/orders')
    })

    it('does not strip partial prefix match', () => {
      expect(buildEntityListUrl('catalog:category')).toBe('/api/catalog/categorys')
    })
  })

  describe('getRecordLabel', () => {
    it('returns title when present', () => {
      expect(getRecordLabel({ title: 'Foo' })).toBe('Foo')
    })

    it('falls back to name when no title', () => {
      expect(getRecordLabel({ name: 'Bar' })).toBe('Bar')
    })

    it('falls back to label when no title or name', () => {
      expect(getRecordLabel({ label: 'Baz' })).toBe('Baz')
    })

    it('falls back to display_name', () => {
      expect(getRecordLabel({ display_name: 'Display' })).toBe('Display')
    })

    it('falls back to id', () => {
      expect(getRecordLabel({ id: '123' })).toBe('123')
    })

    it('returns empty string for empty object', () => {
      expect(getRecordLabel({})).toBe('')
    })

    it('title takes priority over name', () => {
      expect(getRecordLabel({ title: 'A', name: 'B' })).toBe('A')
    })

    it('name takes priority over label', () => {
      expect(getRecordLabel({ name: 'N', label: 'L', id: 'X' })).toBe('N')
    })

    it('converts non-string values to string', () => {
      expect(getRecordLabel({ id: 42 })).toBe('42')
    })
  })
})
