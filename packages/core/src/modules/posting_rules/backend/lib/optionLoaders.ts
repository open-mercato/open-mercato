import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'

// FK-picker option loaders for the posting_rules backend pages, mirroring
// `ledger/backend/lib/optionLoaders.ts`'s own shape — every cross-entity
// reference in this module is a plain FK-id column with no ORM relation.

const DEFAULT_FALLBACK_LABEL = '—'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function normalizeAccountOption(item: unknown, fallbackLabel: string): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  return { value: id, label: toStringOrNull(item.slug) ?? fallbackLabel }
}

/** `ledger.LedgerAccount` picker — cross-module read via `ledger`'s own API. */
export async function loadLedgerAccountOptions(query?: string): Promise<CrudFieldOption[]> {
  const searchParams = new URLSearchParams({ page: '1', pageSize: '50' })
  const trimmed = query?.trim()
  if (trimmed) searchParams.set('search', trimmed)
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/ledger/accounts?${searchParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  return items
    .map((item) => normalizeAccountOption(item, DEFAULT_FALLBACK_LABEL))
    .filter((option): option is CrudFieldOption => option !== null)
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

function normalizeCostCenterOption(item: unknown, fallbackLabel: string): CrudFieldOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  const code = toStringOrNull(item.code)
  const name = toStringOrNull(item.name)
  const label = name && code ? `${code} — ${name}` : name ?? code ?? fallbackLabel
  return { value: id, label }
}

/** This module's own `CostCenter` picker. */
export async function loadCostCenterOptions(query?: string): Promise<CrudFieldOption[]> {
  const searchParams = new URLSearchParams({ page: '1', pageSize: '50', isActive: 'true' })
  const trimmed = query?.trim()
  if (trimmed) searchParams.set('search', trimmed)
  const response = await apiCall<{ items?: unknown[] }>(
    `/api/posting_rules/cost-centers?${searchParams.toString()}`,
    undefined,
    { fallback: { items: [] } },
  )
  const items = Array.isArray(response.result?.items) ? response.result.items : []
  return items
    .map((item) => normalizeCostCenterOption(item, DEFAULT_FALLBACK_LABEL))
    .filter((option): option is CrudFieldOption => option !== null)
}
