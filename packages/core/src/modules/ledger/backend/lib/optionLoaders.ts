import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'

// Shared FK-picker option loaders for the ledger backend pages (OM-12).
// Every cross-entity reference in this module is a plain FK-id column with
// no ORM relation (see data/entities.ts's own doc comments), so these
// pickers resolve a human-readable label purely client-side, the same way
// warranty_claims/backend/components/orderLookup.ts resolves order/customer
// pickers.

const DEFAULT_FALLBACK_LABEL = '—'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

export type LoadLedgerAccountTypeOptionsParams = {
  excludeId?: string | null
  fallbackLabel?: string
}

function normalizeAccountTypeOption(item: unknown, fallbackLabel: string): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  const slug = toStringOrNull(item.slug)
  const name = toStringOrNull(item.name)
  const label = name && slug ? `${name} (${slug})` : name ?? slug ?? fallbackLabel
  return { value: id, label }
}

export async function loadLedgerAccountTypeOptions(
  query?: string,
  params?: LoadLedgerAccountTypeOptionsParams,
): Promise<CrudFieldOption[]> {
  const searchParams = new URLSearchParams({ page: '1', pageSize: '50' })
  const trimmed = query?.trim()
  if (trimmed) searchParams.set('search', trimmed)
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/ledger/account-types?${searchParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const fallbackLabel = params?.fallbackLabel ?? DEFAULT_FALLBACK_LABEL
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  return items
    .filter((item) => !params?.excludeId || (isRecord(item) && item.id !== params.excludeId))
    .map((item) => normalizeAccountTypeOption(item, fallbackLabel))
    .filter((option): option is CrudFieldOption => option !== null)
}

export type LoadLedgerAccountOptionsParams = {
  excludeId?: string | null
  fallbackLabel?: string
}

function normalizeAccountOption(item: unknown, fallbackLabel: string): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  return { value: id, label: toStringOrNull(item.slug) ?? fallbackLabel }
}

export async function loadLedgerAccountOptions(
  query?: string,
  params?: LoadLedgerAccountOptionsParams,
): Promise<CrudFieldOption[]> {
  const searchParams = new URLSearchParams({ page: '1', pageSize: '50' })
  const trimmed = query?.trim()
  if (trimmed) searchParams.set('search', trimmed)
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/ledger/accounts?${searchParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const fallbackLabel = params?.fallbackLabel ?? DEFAULT_FALLBACK_LABEL
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  return items
    .filter((item) => !params?.excludeId || (isRecord(item) && item.id !== params.excludeId))
    .map((item) => normalizeAccountOption(item, fallbackLabel))
    .filter((option): option is CrudFieldOption => option !== null)
}

export async function loadLedgerAccountTypeLabelsByIds(ids: string[]): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(ids.filter((id) => id.trim().length > 0))]
  if (!uniqueIds.length) return {}
  const searchParams = new URLSearchParams({ page: '1', pageSize: String(uniqueIds.length), ids: uniqueIds.join(',') })
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/ledger/account-types?${searchParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  const labels: Record<string, string> = {}
  for (const item of items) {
    if (!isRecord(item)) continue
    const id = toStringOrNull(item.id)
    if (!id) continue
    const option = normalizeAccountTypeOption(item, DEFAULT_FALLBACK_LABEL)
    if (option) labels[id] = option.label
  }
  return labels
}

export async function loadLedgerAccountLabelsByIds(ids: string[]): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(ids.filter((id) => id.trim().length > 0))]
  if (!uniqueIds.length) return {}
  const searchParams = new URLSearchParams({ page: '1', pageSize: String(uniqueIds.length), ids: uniqueIds.join(',') })
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/ledger/accounts?${searchParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  const labels: Record<string, string> = {}
  for (const item of items) {
    if (!isRecord(item)) continue
    const id = toStringOrNull(item.id)
    if (!id) continue
    const option = normalizeAccountOption(item, DEFAULT_FALLBACK_LABEL)
    if (option) labels[id] = option.label
  }
  return labels
}

export type LoadLedgerAccountGroupOptionsParams = {
  fallbackLabel?: string
}

function normalizeAccountGroupOption(item: unknown, fallbackLabel: string): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  const code = toStringOrNull(item.code)
  const name = toStringOrNull(item.name)
  const label = name && code ? `${code} — ${name}` : name ?? code ?? fallbackLabel
  return { value: id, label }
}

// `LedgerAccountGroup` rows are permanently system-seeded reference data
// (never created/edited by tenants — see api/account-groups/route.ts's
// header comment), so this is a plain read-only picker, same shape as
// `loadLedgerAccountTypeOptions` above.
export async function loadLedgerAccountGroupOptions(
  query?: string,
  params?: LoadLedgerAccountGroupOptionsParams,
): Promise<CrudFieldOption[]> {
  const searchParams = new URLSearchParams({ page: '1', pageSize: '50' })
  const trimmed = query?.trim()
  if (trimmed) searchParams.set('search', trimmed)
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/ledger/account-groups?${searchParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const fallbackLabel = params?.fallbackLabel ?? DEFAULT_FALLBACK_LABEL
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  return items
    .map((item) => normalizeAccountGroupOption(item, fallbackLabel))
    .filter((option): option is CrudFieldOption => option !== null)
}

export type LoadFiscalPeriodOptionsParams = {
  fallbackLabel?: string
}

function normalizeFiscalPeriodOption(item: unknown, fallbackLabel: string): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  const startDate = toStringOrNull(item.startDate)
  const endDate = toStringOrNull(item.endDate)
  const label = startDate && endDate ? `${startDate} → ${endDate}` : fallbackLabel
  return { value: id, label }
}

export async function loadFiscalPeriodOptions(
  query?: string,
  params?: LoadFiscalPeriodOptionsParams,
): Promise<CrudFieldOption[]> {
  const searchParams = new URLSearchParams({ page: '1', pageSize: '50' })
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/ledger/fiscal-periods?${searchParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const fallbackLabel = params?.fallbackLabel ?? DEFAULT_FALLBACK_LABEL
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  const trimmed = query?.trim()?.toLowerCase()
  return items
    .map((item) => normalizeFiscalPeriodOption(item, fallbackLabel))
    .filter((option): option is CrudFieldOption => option !== null)
    .filter((option) => !trimmed || option.label.toLowerCase().includes(trimmed))
}
