/**
 * Materials translatable fields registry.
 *
 * Pinned per spec: `entityId: 'materials:material'`. Phase 1 covers `name` and `description`
 * on the master entity; sales-only fields (`gtin`, `commodity_code`) on `material_sales_profiles`
 * are not user-facing strings (codes / regulatory identifiers) so they are intentionally not
 * declared here.
 */
export const translatableFields: Record<string, string[]> = {
  'materials:material': ['name', 'description'],
}

export default translatableFields
