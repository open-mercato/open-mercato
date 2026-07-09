import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'

export type LoadOrderOptionsParams = {
  customerId?: string | null
  onAccessChange?: (accessDenied: boolean) => void
}

export type LoadSalesReturnOptionsParams = {
  orderId?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function normalizeOrderOption(item: unknown): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  return { value: id, label: toStringOrNull(item.orderNumber) ?? id }
}

function normalizeSalesReturnOption(item: unknown): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  const returnNumber = toStringOrNull(item.return_number) ?? toStringOrNull(item.returnNumber)
  return { value: id, label: returnNumber ?? id }
}

export async function loadOrderOptions(
  query?: string,
  params?: LoadOrderOptionsParams,
): Promise<CrudFieldOption[]> {
  const searchParams = new URLSearchParams({ page: '1', pageSize: '20' })
  const trimmed = query?.trim()
  if (trimmed) searchParams.set('search', trimmed)
  if (params?.customerId) searchParams.set('customerId', params.customerId)
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/sales/orders?${searchParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  if (response.ok === false && response.status === 403) {
    params?.onAccessChange?.(true)
    return []
  }
  params?.onAccessChange?.(false)
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  return items.map(normalizeOrderOption).filter((option): option is CrudFieldOption => option !== null)
}

export async function resolveOrderLabel(value: string): Promise<string> {
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/sales/orders?${new URLSearchParams({ id: value, page: '1', pageSize: '1' }).toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const option = (response.result?.items ?? [])
    .map(normalizeOrderOption)
    .find((item): item is CrudFieldOption => item !== null)
  return option?.label ?? value
}

export async function loadSalesReturnOptions(
  query?: string,
  params?: LoadSalesReturnOptionsParams,
): Promise<CrudFieldOption[]> {
  const orderId = params?.orderId
  if (!orderId) return []
  const searchParams = new URLSearchParams({ orderId, page: '1', pageSize: '50' })
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/sales/returns?${searchParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  const options = items.map(normalizeSalesReturnOption).filter((option): option is CrudFieldOption => option !== null)
  const needle = query?.trim().toLowerCase()
  if (!needle) return options
  return options.filter((option) => option.label.toLowerCase().includes(needle))
}

export async function resolveSalesReturnLabel(value: string): Promise<string> {
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/sales/returns?${new URLSearchParams({ ids: value, page: '1', pageSize: '1' }).toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const option = (response.result?.items ?? [])
    .map(normalizeSalesReturnOption)
    .find((item): item is CrudFieldOption => item !== null)
  return option?.label ?? value
}
