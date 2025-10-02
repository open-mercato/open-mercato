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
}

export async function fetchCustomFieldDefs(entityId: string, fetchImpl: typeof fetch = apiFetch): Promise<CustomFieldDefDto[]> {
  const res = await fetchImpl(`/api/custom_fields/definitions?entityId=${encodeURIComponent(entityId)}`, { headers: { 'content-type': 'application/json' } })
  const data = await res.json().catch(() => ({ items: [] }))
  return (data?.items || []) as CustomFieldDefDto[]
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
  return defs.filter((d) => isDefVisible(d, mode))
}
