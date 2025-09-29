import type { FilterDef } from '../FilterOverlay'

export type CustomFieldDefDto = {
  key: string
  kind: string
  label?: string
  description?: string
  options?: string[]
  optionsUrl?: string
  multi?: boolean
  filterable?: boolean
  formEditable?: boolean
  // Optional UI hints
  editor?: string
  input?: string
}

export function buildFilterDefsFromCustomFields(defs: CustomFieldDefDto[]): FilterDef[] {
  const f: FilterDef[] = []
  for (const d of defs) {
    if (!d.filterable) continue
    const id = `cf_${d.key}`
    const label = d.label || d.key
    if (d.kind === 'boolean') f.push({ id, label, type: 'checkbox' })
    else if (d.kind === 'select') {
      const options = (d.options || []).map((o) => ({ value: String(o), label: String(o).charAt(0).toUpperCase() + String(o).slice(1) }))
      f.push({ id: d.multi ? `${id}In` : id, label, type: 'select', multiple: !!d.multi, options })
    } else {
      f.push({ id, label, type: 'text' })
    }
  }
  return f
}

export async function fetchCustomFieldFilterDefs(entityId: string, fetchImpl: typeof fetch = fetch): Promise<FilterDef[]> {
  const res = await fetchImpl(`/api/custom_fields/definitions?entityId=${encodeURIComponent(entityId)}`, { headers: { 'content-type': 'application/json' } })
  const data = await res.json().catch(() => ({ items: [] }))
  const defs: CustomFieldDefDto[] = data?.items || []
  return buildFilterDefsFromCustomFields(defs)
}
