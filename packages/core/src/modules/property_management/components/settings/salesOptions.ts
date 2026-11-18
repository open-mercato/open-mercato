import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export const SALES_OPTIONS_PAGE_SIZE = 100
export const SALES_OPTIONS_MAX_PAGES = 10

type OptionPage<T> = { items?: T[]; totalPages?: number }

export type SalesOptionSource<T extends { id: string }> = {
  path: string
  label: string
  toOption: (item: T) => CrudFieldOption
}

async function fetchPage<T>(path: string, params: Record<string, string>) {
  const query = new URLSearchParams(params)
  return apiCall<OptionPage<T>>(`${path}?${query.toString()}`, undefined, { fallback: {} })
}

async function fetchAllPages<T extends { id: string }>(source: SalesOptionSource<T>): Promise<Map<string, T>> {
  const items = new Map<string, T>()
  for (let page = 1; page <= SALES_OPTIONS_MAX_PAGES; page += 1) {
    const call = await fetchPage<T>(source.path, { page: String(page), pageSize: String(SALES_OPTIONS_PAGE_SIZE) })
    if (!call.ok) throw new Error(`[internal] loading ${source.label} failed with ${call.status}`)
    const pageItems = Array.isArray(call.result?.items) ? call.result.items : []
    for (const item of pageItems) items.set(item.id, item)
    const totalPages = typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1
    if (page >= totalPages || pageItems.length < SALES_OPTIONS_PAGE_SIZE) break
  }
  return items
}

async function fetchSaved<T extends { id: string }>(source: SalesOptionSource<T>, id: string): Promise<T | null> {
  const call = await fetchPage<T>(source.path, { id, pageSize: '1' })
  if (!call.ok) return null
  const items = Array.isArray(call.result?.items) ? call.result.items : []
  return items.find((item) => item.id === id) ?? null
}

export async function loadSalesOptions<T extends { id: string }>(source: SalesOptionSource<T>, savedId: string | null): Promise<CrudFieldOption[]> {
  const items = await fetchAllPages(source)
  if (savedId && !items.has(savedId)) {
    const saved = await fetchSaved(source, savedId)
    if (saved) items.set(saved.id, saved)
  }
  return Array.from(items.values(), source.toOption)
}
