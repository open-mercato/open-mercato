import * as React from 'react'
import { useCustomFieldDefs, type UseCustomFieldDefsOptions } from './customFieldDefs'
import { Filter } from '@open-mercato/shared/lib/query/types'
import type { FilterDef } from '../FilterOverlay'
import type { CustomFieldDefDto } from './customFieldDefs'
export type { CustomFieldDefDto }
import { filterCustomFieldDefs, fetchCustomFieldDefs as loadCustomFieldDefs } from './customFieldDefs'
import { type UseQueryResult } from '@tanstack/react-query'
import { apiCall } from './apiCall'

function buildOptionsUrl(base: string, query?: string): string {
  if (!query) return base
  try {
    const isAbsolute = /^([a-z][a-z\d+\-.]*:)?\/\//i.test(base)
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const url = isAbsolute ? new URL(base) : new URL(base, origin)
    if (!url.searchParams.has('query')) url.searchParams.append('query', query)
    if (!url.searchParams.has('q')) url.searchParams.append('q', query)
    if (isAbsolute) return url.toString()
    return `${url.pathname}${url.search}`
  } catch {
    const sep = base.includes('?') ? '&' : '?'
    if (base.includes('query=')) return `${base}${sep}q=${encodeURIComponent(query)}`
    return `${base}${sep}query=${encodeURIComponent(query)}`
  }
}

type OptionsResponse = { items?: unknown[] }

async function loadRemoteOptions(url: string): Promise<Array<{ value: string; label: string }>> {
  try {
    const call = await apiCall<OptionsResponse>(url, undefined, { fallback: { items: [] } })
    if (!call.ok) return []
    const payload = call.result ?? { items: [] }
    const items = Array.isArray(payload?.items) ? payload.items : []
    return items.map((it: any) => ({
      value: String(it?.value ?? it),
      label: String(it?.label ?? it?.value ?? it),
    }))
  } catch {
    return []
  }
}

type RawOption = string | number | { value?: unknown; label?: unknown }

function normalizeOptions(options?: RawOption[]): Array<{ value: string; label: string }> {
  if (!Array.isArray(options)) return []
  return options.map((option) => {
    if (option && typeof option === 'object' && 'value' in option) {
      const rawValue = (option as any).value
      const rawLabel = (option as any).label ?? rawValue
      const value = String(rawValue)
      const label = typeof rawLabel === 'string' ? rawLabel : String(rawLabel)
      return { value, label }
    }
    const value = String(option)
    return { value, label: value.charAt(0).toUpperCase() + value.slice(1) }
  })
}

export function buildFilterDefsFromCustomFields(defs: CustomFieldDefDto[]): FilterDef[] {
  const f: FilterDef[] = []
  const visible = filterCustomFieldDefs(defs, 'filter')
  const seenKeys = new Set<string>() // case-insensitive de-dupe by key
  for (const d of visible) {
    const keyLower = String(d.key).toLowerCase()
    if (seenKeys.has(keyLower)) continue
    seenKeys.add(keyLower)
    const id = `cf_${d.key}`
    const label = d.label || d.key
    if (d.kind === 'boolean') {
      f.push({ id, label, type: 'checkbox' })
    } else if (d.kind === 'select' || d.kind === 'relation' || d.kind === 'dictionary') {
      const options = normalizeOptions(d.options)
      const base: FilterDef = { id: d.multi ? `${id}In` : id, label, type: 'select', multiple: !!d.multi, options }
      // When optionsUrl is provided, allow async options loading for filters too
      if (d.optionsUrl) {
        ;(base as FilterDef).loadOptions = async (query?: string) => {
          const url = buildOptionsUrl(d.optionsUrl!, query)
          return loadRemoteOptions(url)
        }
      }
      f.push(base)
    } else if (d.kind === 'text' && d.multi) {
      // Multi-text custom field → use tags input in filters
      const base: FilterDef = {
        id: `${id}In`,
        label,
        type: 'tags',
        // If static options provided, pass them for suggestions
        options: normalizeOptions(d.options),
      } as any
      // Enable async suggestions when optionsUrl provided
      if (d.optionsUrl) {
        ;(base as any).loadOptions = async (query?: string) => {
          const url = buildOptionsUrl(d.optionsUrl!, query)
          return loadRemoteOptions(url)
        }
      }
      f.push(base)
    } else {
      f.push({ id, label, type: 'text' })
    }
  }
  // De-duplicate by id in case of overlaps; keep first occurrence
  const out: FilterDef[] = []
  const seen = new Set<string>()
  for (const item of f) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  // Preserve the original visible order (already sorted by priority) by mapping back
  const order = new Map(visible.map((v, idx) => [v.key, idx]))
  out.sort((a, b) => (order.get(a.id.replace(/^cf_/, '').replace(/In$/, '')) ?? 0) - (order.get(b.id.replace(/^cf_/, '').replace(/In$/, '')) ?? 0))
  return out
}

export async function fetchCustomFieldFilterDefs(
  entityIds: string | string[],
  fetchImpl?: typeof fetch,
  options?: { fieldset?: string },
): Promise<FilterDef[]> {
  const defs: CustomFieldDefDto[] = await loadCustomFieldDefs(
    entityIds,
    fetchImpl,
    options?.fieldset ? { fieldset: options.fieldset } : undefined,
  )
  return buildFilterDefsFromCustomFields(defs)
}

export function useCustomFieldFilterDefs(
  entityIds: string | string[] | null | undefined,
  options: UseCustomFieldDefsOptions<FilterDef[]> = {}
): UseQueryResult<FilterDef[]> {
  const { select, ...rest } = options
  const selectFn = React.useCallback(
    (defs: CustomFieldDefDto[]) => (select ? select(defs) : buildFilterDefsFromCustomFields(defs)),
    [select]
  )
  return useCustomFieldDefs<FilterDef[]>(entityIds, { ...rest, select: selectFn })
}
