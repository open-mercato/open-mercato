import { apiFetch } from './api'

export type CustomFieldDefDto = {
  entityId?: string
  key: string
  kind: string
  label?: string
  description?: string
  options?: string[]
  optionsUrl?: string
  multi?: boolean
  filterable?: boolean
  formEditable?: boolean
  listVisible?: boolean
  editor?: string
  input?: string
  priority?: number
  // attachments-specific config
  maxAttachmentSizeMb?: number
  acceptExtensions?: string[]
  // optional validation rules
  validation?: Array<
    | { rule: 'required'; message: string }
    | { rule: 'date'; message: string }
    | { rule: 'integer'; message: string }
    | { rule: 'float'; message: string }
    | { rule: 'lt' | 'lte' | 'gt' | 'gte'; param: number; message: string }
    | { rule: 'eq' | 'ne'; param: any; message: string }
    | { rule: 'regex'; param: string; message: string }
  >
  dictionaryId?: string
  dictionaryInlineCreate?: boolean
}

function buildDefinitionsQuery(entityIds: string[]): string {
  const params = new URLSearchParams()
  entityIds.forEach((id) => {
    if (id) params.append('entityId', id)
  })
  return params.toString()
}

export async function fetchCustomFieldDefs(entityIds: string | string[], fetchImpl: typeof fetch = apiFetch): Promise<CustomFieldDefDto[]> {
  const list = Array.isArray(entityIds) ? entityIds : [entityIds]
  const filtered = list.map((id) => String(id || '').trim()).filter((id) => id.length > 0)
  if (!filtered.length) return []
  const query = buildDefinitionsQuery(filtered)
  const res = await fetchImpl(`/api/entities/definitions?${query}`, { headers: { 'content-type': 'application/json' } })
  const data = await res.json().catch(() => ({ items: [] }))
  const items = (data?.items || []) as CustomFieldDefDto[]
  items.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
  return items
}

export type CustomFieldVisibility = 'list' | 'form' | 'filter'

export function isDefVisible(def: CustomFieldDefDto, mode: CustomFieldVisibility): boolean {
  switch (mode) {
    case 'list':
      return def.listVisible !== false
    case 'form':
      return def.formEditable !== false
    case 'filter':
      return !!def.filterable
    default:
      return true
  }
}

export function filterCustomFieldDefs(defs: CustomFieldDefDto[], mode: CustomFieldVisibility): CustomFieldDefDto[] {
  return defs
    .filter((d) => isDefVisible(d, mode))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
}
