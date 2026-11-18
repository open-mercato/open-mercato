import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export const BUILDING_OPTIONS_PAGE_SIZE = 100
export const BUILDING_OPTIONS_MAX_PAGES = 10

type BuildingPage<T> = { items?: T[]; totalPages?: number; canManageAll?: unknown }

export type BuildingOptionsResult<T> =
  | { ok: true; items: T[]; canManageAll: boolean; truncated: boolean }
  | { ok: false; status: number }

export async function fetchBuildingOptions<T>(filters: Record<string, string> = {}): Promise<BuildingOptionsResult<T>> {
  const items: T[] = []
  let canManageAll = false
  for (let page = 1; page <= BUILDING_OPTIONS_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ sortField: 'name', sortDir: 'asc', ...filters, page: String(page), pageSize: String(BUILDING_OPTIONS_PAGE_SIZE) })
    const call = await apiCall<BuildingPage<T>>(`/api/property_management/buildings?${params.toString()}`, undefined, { fallback: {} })
    if (!call.ok) return { ok: false, status: call.status }
    const pageItems = Array.isArray(call.result?.items) ? call.result.items : []
    items.push(...pageItems)
    canManageAll = call.result?.canManageAll === true
    const totalPages = typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1
    if (page >= totalPages || pageItems.length < BUILDING_OPTIONS_PAGE_SIZE) return { ok: true, items, canManageAll, truncated: false }
  }
  return { ok: true, items, canManageAll, truncated: true }
}
