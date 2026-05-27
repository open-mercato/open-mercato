import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  buildQuery,
  loadCatalogVariantOptions,
  loadWarehouseOptions,
} from './wmsLookupLoaders'

export { buildQuery, loadCatalogVariantOptions, loadWarehouseOptions }

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

export async function loadLocationOptions(
  warehouseId: string,
  query?: string,
): Promise<CrudFieldOption[]> {
  if (!warehouseId) return []
  const params = buildQuery({
    page: 1,
    pageSize: 50,
    warehouseId,
    search: query?.trim() || undefined,
  })
  const call = await apiCall<PagedResponse<{ id?: string | null; code?: string | null }>>(
    `/api/wms/locations?${params}`,
  )
  if (!call.ok) return []
  return (call.result?.items ?? [])
    .map((item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      const label = item.code || value
      return { value, label }
    })
    .filter((option): option is CrudFieldOption => option !== null)
}

export type InventoryBalanceLookupRow = {
  quantity_on_hand?: string | number | null
}

export async function fetchBalanceOnHand(input: {
  warehouseId: string
  locationId: string
  catalogVariantId: string
}): Promise<number> {
  const params = buildQuery({
    page: 1,
    pageSize: 20,
    warehouseId: input.warehouseId,
    locationId: input.locationId,
    catalogVariantId: input.catalogVariantId,
  })
  const call = await apiCall<PagedResponse<InventoryBalanceLookupRow>>(
    `/api/wms/inventory/balances?${params}`,
  )
  if (!call.ok) {
    throw new Error('Failed to load inventory balance.')
  }
  const row = call.result?.items?.[0]
  if (!row) return 0
  const onHand = Number(row.quantity_on_hand ?? 0)
  return Number.isFinite(onHand) ? onHand : 0
}
