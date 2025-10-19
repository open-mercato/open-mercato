import { Filter } from '@/lib/query/types'
import type { FilterDef } from '../FilterOverlay'
import { apiFetch } from './api'
import type { CustomFieldDefDto } from './customFieldDefs'
import { filterCustomFieldDefs } from './customFieldDefs'

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
      const options = (d.options || []).map((o) => ({ value: String(o), label: String(o).charAt(0).toUpperCase() + String(o).slice(1) }))
      const base: FilterDef = { id: d.multi ? `${id}In` : id, label, type: 'select', multiple: !!d.multi, options }
      // When optionsUrl is provided, allow async options loading for filters too
      if (d.optionsUrl) {
        ;(base as FilterDef).loadOptions = async (query?: string) => {
          try {
            const res = await apiFetch(buildOptionsUrl(d.optionsUrl!, query))
            const json = await res.json()
            const items = Array.isArray(json?.items) ? json.items : []
            return items.map((it: any) => ({ value: String(it.value ?? it), label: String(it.label ?? it.value ?? it) }))
          } catch {
            return []
          }
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
        options: (d.options || []).map((o) => ({ value: String(o), label: String(o) })),
      } as any
      // Enable async suggestions when optionsUrl provided
      if (d.optionsUrl) {
        ;(base as any).loadOptions = async (query?: string) => {
          try {
            const res = await apiFetch(buildOptionsUrl(d.optionsUrl!, query))
            const json = await res.json()
            const items = Array.isArray(json?.items) ? json.items : []
            return items.map((it: any) => ({ value: String(it.value ?? it), label: String(it.label ?? it.value ?? it) }))
          } catch {
            return []
          }
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

export async function fetchCustomFieldFilterDefs(entityId: string, fetchImpl: typeof fetch = apiFetch): Promise<FilterDef[]> {
  const res = await fetchImpl(`/api/entities/definitions?entityId=${encodeURIComponent(entityId)}`, { headers: { 'content-type': 'application/json' } })
  const data = await res.json().catch(() => ({ items: [] }))
  const defs: CustomFieldDefDto[] = data?.items || []
  return buildFilterDefsFromCustomFields(defs)
}
