import type { CrudField } from '../CrudForm'
import type { CustomFieldDefDto } from './customFieldFilters'

export function buildFormFieldsFromCustomFields(defs: CustomFieldDefDto[]): CrudField[] {
  const fields: CrudField[] = []
  for (const d of defs) {
    if (d.formEditable === false) continue
    const id = `cf_${d.key}`
    const label = d.label || d.key
    switch (d.kind) {
      case 'boolean':
        fields.push({ id, label, type: 'checkbox', description: d.description })
        break
      case 'integer':
      case 'float':
        fields.push({ id, label, type: 'number', description: d.description })
        break
      case 'multiline':
        fields.push({ id, label, type: 'textarea', description: d.description })
        break
      case 'select':
        fields.push({
          id,
          label,
          type: 'select',
          description: d.description,
          options: (d.options || []).map((o) => ({ value: String(o), label: String(o) })),
          multiple: !!d.multi,
        })
        break
      default:
        fields.push({ id, label, type: 'text', description: d.description })
    }
  }
  return fields
}

export async function fetchCustomFieldFormFields(entityId: string, fetchImpl: typeof fetch = fetch): Promise<CrudField[]> {
  const res = await fetchImpl(`/api/custom_fields/definitions?entityId=${encodeURIComponent(entityId)}`, { headers: { 'content-type': 'application/json' } })
  const data = await res.json().catch(() => ({ items: [] }))
  const defs: CustomFieldDefDto[] = data?.items || []
  return buildFormFieldsFromCustomFields(defs)
}
