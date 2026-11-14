export const ASSORTMENT_SCOPE_FIELDS = [
  'categoryIds',
  'tagIds',
  'excludeProductIds',
  'excludeCategoryIds',
  'excludeTagIds',
] as const

export type AssortmentScopeField = (typeof ASSORTMENT_SCOPE_FIELDS)[number]

export type GroupAssortmentScope = Partial<Record<AssortmentScopeField, string[]>>

export type AssortmentScopeFormValues = Record<AssortmentScopeField, string[]>

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    ids.push(trimmed)
  }
  return ids
}

export function mapAssortmentScopeToFormValues(scope: GroupAssortmentScope | null | undefined): AssortmentScopeFormValues {
  return {
    categoryIds: normalizeIds(scope?.categoryIds),
    tagIds: normalizeIds(scope?.tagIds),
    excludeProductIds: normalizeIds(scope?.excludeProductIds),
    excludeCategoryIds: normalizeIds(scope?.excludeCategoryIds),
    excludeTagIds: normalizeIds(scope?.excludeTagIds),
  }
}

export function buildAssortmentScopePayload(values: Partial<Record<AssortmentScopeField, unknown>>): GroupAssortmentScope | null {
  const scope: GroupAssortmentScope = {}
  for (const field of ASSORTMENT_SCOPE_FIELDS) {
    const ids = normalizeIds(values[field])
    if (ids.length > 0) scope[field] = ids
  }
  return Object.keys(scope).length > 0 ? scope : null
}
