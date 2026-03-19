const NON_TRANSLATABLE_SUFFIXES = ['_id', '_at', '_hash']
const NON_TRANSLATABLE_EXACT = [
  'id', 'created_at', 'updated_at', 'deleted_at',
  'tenant_id', 'organization_id', 'is_active',
  'sort_order', 'position', 'slug', 'sku', 'barcode',
  'price', 'quantity', 'weight', 'width', 'height', 'depth',
  'metadata', 'config', 'settings', 'options',
]

export function isTranslatableField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase()
  if (NON_TRANSLATABLE_EXACT.includes(lower)) return false
  for (const suffix of NON_TRANSLATABLE_SUFFIXES) {
    if (lower.endsWith(suffix)) return false
  }
  return true
}
