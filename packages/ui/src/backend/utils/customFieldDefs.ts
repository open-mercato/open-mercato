import { apiFetch } from './api'

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
}

export async function fetchCustomFieldDefs(entityId: string, fetchImpl: typeof fetch = apiFetch): Promise<CustomFieldDefDto[]> {
  const res = await fetchImpl(`/api/entities/definitions?entityId=${encodeURIComponent(entityId)}`, { headers: { 'content-type': 'application/json' } })
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
