import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { TaxRateSummary } from './productForm'

type TaxRateListResult = { items?: unknown[] }

/**
 * Normalizes a raw tax-rate API item into the `TaxRateSummary` shape used by the
 * product/variant select controls. Mirrors the inline mapping used by the
 * capped list loaders so seeded (fetched-by-id) entries are shaped identically.
 */
export function normalizeTaxRateSummary(item: unknown, unnamedLabel: string): TaxRateSummary | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const id =
    typeof record.id === 'string' && record.id.length
      ? record.id
      : record.id != null
        ? String(record.id)
        : null
  if (!id) return null
  const rawRate = typeof record.rate === 'number' ? record.rate : Number(record.rate ?? Number.NaN)
  const name =
    typeof record.name === 'string' && record.name.trim().length ? record.name : unnamedLabel
  const code =
    typeof record.code === 'string' && record.code.trim().length ? record.code : null
  const isDefault = Boolean(
    typeof record.isDefault === 'boolean'
      ? record.isDefault
      : typeof record.is_default === 'boolean'
        ? record.is_default
        : false,
  )
  return { id, name, code, rate: Number.isFinite(rawRate) ? rawRate : null, isDefault }
}

/**
 * Returns the subset of selected ids that are not present in the loaded tax-rate
 * list. These are the persisted values that would render blank because no
 * matching `SelectItem` exists for them.
 */
export function collectMissingTaxRateIds(
  taxRates: TaxRateSummary[],
  selectedIds: Array<string | null | undefined>,
): string[] {
  const present = new Set(taxRates.map((rate) => rate.id))
  const missing = new Set<string>()
  for (const id of selectedIds) {
    if (typeof id === 'string' && id.length && !present.has(id)) missing.add(id)
  }
  return Array.from(missing)
}

/**
 * Merges fetched tax rates into the existing list, de-duplicating by id and
 * keeping the existing ordering (capped list first, seeded entries appended).
 */
export function mergeTaxRateSummaries(
  existing: TaxRateSummary[],
  incoming: TaxRateSummary[],
): TaxRateSummary[] {
  if (!incoming.length) return existing
  const byId = new Map<string, TaxRateSummary>()
  for (const rate of existing) byId.set(rate.id, rate)
  for (const rate of incoming) {
    if (!byId.has(rate.id)) byId.set(rate.id, rate)
  }
  return Array.from(byId.values())
}

export type UseEnsureSelectedTaxRatesArgs = {
  taxRates: TaxRateSummary[]
  setTaxRates: React.Dispatch<React.SetStateAction<TaxRateSummary[]>>
  selectedIds: Array<string | null | undefined>
  unnamedLabel: string
  errorMessage: string
}

/**
 * Ensures persisted tax-rate selections survive capped option lists. When a
 * selected id is missing from the loaded `taxRates` (e.g. the saved record sorts
 * past the first page), this fetches the missing records by id via the CRUD
 * `?ids=` filter and merges them into the option list so controlled selects
 * render their saved label instead of a blank/placeholder trigger.
 */
export function useEnsureSelectedTaxRates({
  taxRates,
  setTaxRates,
  selectedIds,
  unnamedLabel,
  errorMessage,
}: UseEnsureSelectedTaxRatesArgs): void {
  const requestedRef = React.useRef<Set<string>>(new Set())
  const selectedKey = selectedIds
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort()
    .join(',')

  React.useEffect(() => {
    const selected = selectedKey.length ? selectedKey.split(',') : []
    const missing = collectMissingTaxRateIds(taxRates, selected).filter(
      (id) => !requestedRef.current.has(id),
    )
    if (!missing.length) return
    for (const id of missing) requestedRef.current.add(id)
    let cancelled = false
    void (async () => {
      try {
        const payload = await readApiResultOrThrow<TaxRateListResult>(
          `/api/sales/tax-rates?ids=${encodeURIComponent(missing.join(','))}&pageSize=200`,
          undefined,
          { errorMessage, fallback: { items: [] } },
        )
        const items = Array.isArray(payload.items) ? payload.items : []
        const normalized = items
          .map((item) => normalizeTaxRateSummary(item, unnamedLabel))
          .filter((rate): rate is TaxRateSummary => rate !== null)
        if (!cancelled && normalized.length) {
          setTaxRates((prev) => mergeTaxRateSummaries(prev, normalized))
        }
      } catch (err) {
        console.error('sales.tax-rates.ensure-selected failed', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedKey, taxRates, setTaxRates, unnamedLabel, errorMessage])
}
