import type { CrudField } from '../CrudForm'
import type { CustomFieldDefDto } from './customFieldFilters'
import { apiFetch } from './api'

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
      case 'multiline': {
        // Prefer rich text editors for multiline; allow override via definition.editor
        // Supported editor values:
        // - 'markdown' (default) -> uiw markdown editor
        // - 'simpleMarkdown'    -> SimpleMarkdownEditor
        // - 'htmlRichText'      -> HtmlRichTextEditor
        let editor: 'simple' | 'uiw' | 'html' = 'uiw'
        if (d.editor === 'simpleMarkdown') editor = 'simple'
        else if (d.editor === 'htmlRichText') editor = 'html'
        // Any other value (including 'markdown' or undefined) falls back to 'uiw'
        fields.push({ id, label, type: 'richtext', description: d.description, editor })
        break
      }
      case 'select':
        fields.push({
          id,
          label,
          type: 'select',
          description: d.description,
          options: (d.options || []).map((o) => ({ value: String(o), label: String(o) })),
          multiple: !!d.multi,
          ...(d.optionsUrl
            ? {
                loadOptions: async () => {
                  try {
                    const res = await apiFetch(d.optionsUrl!)
                    const json = await res.json()
                    const items = Array.isArray(json?.items) ? json.items : []
                    return items.map((it: any) => ({ value: String(it.value ?? it), label: String(it.label ?? it.value ?? it) }))
                  } catch {
                    return []
                  }
                },
              }
            : {}),
          // UI hint: render multi-select as listbox
          ...(d.multi && d.input === 'listbox' ? { listbox: true } as any : {}),
        })
        break
      default:
        // If text + multi => render as tags input for free-form tagging
        if (d.kind === 'text' && d.multi) {
          const base: any = { id, label, type: 'tags', description: d.description }
          if (d.optionsUrl) {
            base.loadOptions = async () => {
              try {
                const res = await apiFetch(d.optionsUrl!)
                const json = await res.json()
                const items = Array.isArray(json?.items) ? json.items : []
                return items.map((it: any) => ({ value: String(it.value ?? it), label: String(it.label ?? it.value ?? it) }))
              } catch { return [] }
            }
          }
          fields.push(base)
        } else {
          fields.push({ id, label, type: 'text', description: d.description })
        }
    }
  }
  return fields
}

export async function fetchCustomFieldFormFields(entityId: string, fetchImpl: typeof fetch = apiFetch): Promise<CrudField[]> {
  const res = await fetchImpl(`/api/custom_fields/definitions?entityId=${encodeURIComponent(entityId)}`, { headers: { 'content-type': 'application/json' } })
  const data = await res.json().catch(() => ({ items: [] }))
  const defs: CustomFieldDefDto[] = data?.items || []
  return buildFormFieldsFromCustomFields(defs)
}
