import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

export function buildQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  return search.toString()
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

export async function loadCatalogVariantOptions(query?: string): Promise<CrudFieldOption[]> {
  const params = buildQuery({ page: 1, pageSize: 25, search: query?.trim() || undefined })
  const call = await apiCall<PagedResponse<{ id?: string | null; name?: string | null; sku?: string | null }>>(
    `/api/catalog/variants?${params}`,
  )
  if (!call.ok) return []
  return (call.result?.items ?? [])
    .map((item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      const label = item.name || item.sku || value
      return { value, label }
    })
    .filter((option): option is CrudFieldOption => option !== null)
}
