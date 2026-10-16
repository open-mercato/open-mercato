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
  const slug = toStringOrNull(item.slug)
  const description = toStringOrNull(item.description)
  const label = slug && description ? `${slug} — ${description}` : slug ?? description ?? fallbackLabel
  return { value: id, label }
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

const POLISH_JURISDICTION = 'PL'
const MAX_TYPES_PER_CLASS = 100

async function fetchItems(url: string): Promise<unknown[]> {
  const response = await apiCall<{ items?: unknown[] }>(url, undefined, { fallback: { items: [] } })
  return Array.isArray(response.result?.items) ? response.result.items : []
}

/**
 * Account picker limited to one Polish account class (zespół), resolved the
 * way the ledger models it: `LedgerAccountGroup(jurisdiction 'PL', code)` →
 * its `LedgerAccountType`s → the accounts of those types. Falls back to the
 * unfiltered list when the class cannot be resolved (for example the default
 * chart of accounts was not imported yet), so the field never ends up empty
 * for a reason the user cannot see.
 */
export function createLedgerAccountClassLoader(groupCode: string): (query?: string) => Promise<CrudFieldOption[]> {
  return async (query?: string) => {
    const groups = await fetchItems(
      `/api/ledger/account-groups?${new URLSearchParams({ page: '1', pageSize: '100', jurisdiction: POLISH_JURISDICTION })}`,
    )
    const group = groups.find((item) => isRecord(item) && item.code === groupCode)
    const groupId = isRecord(group) ? toStringOrNull(group.id) : null
    if (!groupId) return loadLedgerAccountOptions(query)

    const types = await fetchItems(
      `/api/ledger/account-types?${new URLSearchParams({ page: '1', pageSize: String(MAX_TYPES_PER_CLASS), accountGroupId: groupId })}`,
    )
    const typeIds = types
      .map((item) => (isRecord(item) ? toStringOrNull(item.id) : null))
      .filter((id): id is string => id !== null)
    if (!typeIds.length) return loadLedgerAccountOptions(query)

    const trimmed = query?.trim()
    const perType = await Promise.all(
      typeIds.map((typeId) => {
        const params = new URLSearchParams({ page: '1', pageSize: '100', accountTypeId: typeId })
        if (trimmed) params.set('search', trimmed)
        return fetchItems(`/api/ledger/accounts?${params.toString()}`)
      }),
    )
    const seen = new Set<string>()
    const options: CrudFieldOption[] = []
    for (const item of perType.flat()) {
      const option = normalizeAccountOption(item, DEFAULT_FALLBACK_LABEL)
      if (!option || seen.has(option.value)) continue
      seen.add(option.value)
      options.push(option)
    }
    return options.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 100)
  }
}

/** zespół 4 (cost-by-nature accounts) — clearing account, reclassification source. */
export const loadClass4AccountOptions = createLedgerAccountClassLoader('4')
/** zespół 5 (cost-by-function accounts) — unallocated-cost account, reclassification target. */
export const loadClass5AccountOptions = createLedgerAccountClassLoader('5')

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
