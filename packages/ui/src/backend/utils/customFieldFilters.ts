import type { FilterDef } from '../FilterOverlay'
import { apiFetch } from './api'
import type { CustomFieldDefDto } from './customFieldDefs'
import { filterCustomFieldDefs } from './customFieldDefs'

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
    } else if (d.kind === 'select' || d.kind === 'relation') {
      const options = (d.options || []).map((o) => ({ value: String(o), label: String(o).charAt(0).toUpperCase() + String(o).slice(1) }))
      const base: FilterDef = { id: d.multi ? `${id}In` : id, label, type: 'select', multiple: !!d.multi, options }
      // When optionsUrl is provided, allow async options loading for filters too
      if (d.optionsUrl) {
        ;(base as any).loadOptions = async () => {
          try {
            const res = await apiFetch(d.optionsUrl!)
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
        ;(base as any).loadOptions = async () => {
          try {
            const res = await apiFetch(d.optionsUrl!)
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
  return out
}

export async function fetchCustomFieldFilterDefs(entityId: string, fetchImpl: typeof fetch = apiFetch): Promise<FilterDef[]> {
  const res = await fetchImpl(`/api/custom_fields/definitions?entityId=${encodeURIComponent(entityId)}`, { headers: { 'content-type': 'application/json' } })
  const data = await res.json().catch(() => ({ items: [] }))
  const defs: CustomFieldDefDto[] = data?.items || []
  return buildFilterDefsFromCustomFields(defs)
}
