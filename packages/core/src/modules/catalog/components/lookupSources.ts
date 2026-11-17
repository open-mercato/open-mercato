import {
  createIdsLookupSource,
  pickLookupString,
  type LookupSource,
} from '@open-mercato/ui/backend/inputs/lookupSources'

export const categoryLookupSource: LookupSource = createIdsLookupSource(
  'categories',
  '/api/catalog/categories',
  (item) => {
    const value = pickLookupString(item, 'id')
    if (!value) return null
    return { value, label: pickLookupString(item, 'pathLabel', 'name') || value }
  },
  { view: 'manage' },
)

export const productLookupSource: LookupSource = createIdsLookupSource('products', '/api/catalog/products', (item) => {
  const value = pickLookupString(item, 'id')
  if (!value) return null
  const sku = pickLookupString(item, 'sku')
  return { value, label: pickLookupString(item, 'title', 'name') || value, description: sku || null }
})

export const tagLookupSource: LookupSource = createIdsLookupSource('tags', '/api/catalog/tags', (item) => {
  const value = pickLookupString(item, 'id')
  if (!value) return null
  return { value, label: pickLookupString(item, 'label') || value }
})
