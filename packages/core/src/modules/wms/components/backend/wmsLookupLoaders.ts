import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

// Extends CrudFieldOption with an optional description shown below the label in the dropdown.
// Used by variant comboboxes where label=SKU and description=product name for readability.
export type CatalogVariantOption = CrudFieldOption & { description: string | null }

export function buildQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  return search.toString()
}

// Merges new label entries into a cache without creating a fresh object
// reference when nothing actually changed. Callers that feed the result back
// into React state (e.g. after every ComboboxInput suggestion fetch) rely on
// this bail-out — otherwise a new object identity on every fetch retriggers
// downstream effects that depend on that state, looping indefinitely.
export function mergeLabelCacheEntries(
  prev: Record<string, string>,
  entries: Array<{ value: string; label: string }>,
): Record<string, string> {
  let next: Record<string, string> | null = null
  for (const entry of entries) {
    if (prev[entry.value] !== entry.label) {
      if (!next) next = { ...prev }
      next[entry.value] = entry.label
    }
  }
  return next ?? prev
}

export async function loadWarehouseOptions(query?: string): Promise<CrudFieldOption[]> {
  const params = buildQuery({ page: 1, pageSize: 50, search: query?.trim() || undefined })
  const call = await apiCall<PagedResponse<{ id?: string | null; name?: string | null; code?: string | null }>>(
    `/api/wms/warehouses?${params}`,
  )
  if (!call.ok) return []
  return (call.result?.items ?? [])
    .map((item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      const label = item.name || item.code || value
      return { value, label }
    })
    .filter((option): option is CrudFieldOption => option !== null)
}

// label=SKU so that fillCombobox helpers searching by SKU can match the dropdown button text
// and so that input.value after selection equals the SKU typed by the user/test.
// description=name provides human-readable context beneath the SKU in the dropdown.
export async function loadCatalogVariantOptions(query?: string): Promise<CatalogVariantOption[]> {
  const params = buildQuery({ page: 1, pageSize: 25, search: query?.trim() || undefined })
  const call = await apiCall<PagedResponse<{ id?: string | null; name?: string | null; sku?: string | null }>>(
    `/api/catalog/variants?${params}`,
  )
  if (!call.ok) return []
  return (call.result?.items ?? [])
    .map((item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      const sku = item.sku?.trim() || null
      const name = item.name?.trim() || null
      const label = sku || name || value
      const description = sku && name && sku !== name ? name : null
      return { value, label, description }
    })
    .filter((option): option is CatalogVariantOption => option !== null)
}
