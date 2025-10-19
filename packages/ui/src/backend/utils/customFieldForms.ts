import type { CrudField } from '../CrudForm'
import type { CustomFieldDefDto } from './customFieldDefs'
import { filterCustomFieldDefs } from './customFieldDefs'
import { apiFetch } from './api'
import { FieldRegistry } from '../fields/registry'

if (typeof window !== 'undefined') {
  import('@open-mercato/core/modules/dictionaries/fields/dictionary').catch(() => {})
}

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

export function buildFormFieldsFromCustomFields(defs: CustomFieldDefDto[], opts?: { bareIds?: boolean }): CrudField[] {
  const fields: CrudField[] = []
  const visible = filterCustomFieldDefs(defs, 'form')
  const seenKeys = new Set<string>() // case-insensitive de-dupe
  for (const d of visible) {
    const keyLower = String(d.key).toLowerCase()
    if (seenKeys.has(keyLower)) continue
    seenKeys.add(keyLower)
    const id = opts?.bareIds ? d.key : `cf_${d.key}`
    const label = d.label || d.key
    const required = Array.isArray((d as any).validation) ? ((d as any).validation as any[]).some((r) => r && r.rule === 'required') : false
    switch (d.kind) {
      case 'boolean':
        fields.push({ id, label, type: 'checkbox', description: d.description, required })
        break
      case 'integer':
      case 'float':
        fields.push({ id, label, type: 'number', description: d.description, required })
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
        fields.push({ id, label, type: 'richtext', description: d.description, editor, required })
        break
      }
      case 'select':
      case 'relation':
        fields.push({
          id,
          label,
          type: 'select',
          description: d.description,
          options: (d.options || []).map((o) => ({ value: String(o), label: String(o) })),
          multiple: !!d.multi,
          required,
          ...(d.optionsUrl
            ? {
                loadOptions: async (query?: string) => {
                  try {
                    const res = await apiFetch(buildOptionsUrl(d.optionsUrl!, query))
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
          const base: any = { id, label, type: 'tags', description: d.description, required }
          // Provide static suggestions from options if present
          if (Array.isArray(d.options) && d.options.length > 0) {
            base.options = d.options.map((o) => ({ value: String(o), label: String(o) }))
          }
          // Enable async suggestions when optionsUrl provided
          if (d.optionsUrl) {
            base.loadOptions = async (query?: string) => {
              try {
                const res = await apiFetch(buildOptionsUrl(d.optionsUrl!, query))
                const json = await res.json()
                const items = Array.isArray(json?.items) ? json.items : []
                return items.map((it: any) => ({ value: String(it.value ?? it), label: String(it.label ?? it.value ?? it) }))
              } catch { return [] }
            }
          }
          fields.push(base)
        } else if (d.kind === 'text' && typeof d.editor === 'string' && d.editor) {
          // Allow per-field editor override even when kind is 'text'
          // Map to richtext when an editor hint is provided
          let editor: 'simple' | 'uiw' | 'html' = 'uiw'
          if (d.editor === 'simpleMarkdown') editor = 'simple'
          else if (d.editor === 'htmlRichText') editor = 'html'
          // Any other value (including 'markdown') falls back to 'uiw'
          fields.push({ id, label, type: 'richtext', description: d.description, editor, required })
        } else {
          // Try registry-provided input for custom kind
          const input = FieldRegistry.getInput(d.kind)
          if (input) {
            fields.push({ id, label, type: 'custom', required, description: d.description, component: (props) => input({ ...props, def: d }) })
          } else {
            fields.push({ id, label, type: 'text', description: d.description, required })
          }
        }
    }
  }
  return fields
}

export async function fetchCustomFieldFormFields(entityId: string, fetchImpl: typeof fetch = apiFetch, options?: { bareIds?: boolean }): Promise<CrudField[]> {
  const res = await fetchImpl(`/api/entities/definitions?entityId=${encodeURIComponent(entityId)}`, { headers: { 'content-type': 'application/json' } })
  const data = await res.json().catch(() => ({ items: [] }))
  const defs: CustomFieldDefDto[] = data?.items || []
  return buildFormFieldsFromCustomFields(defs, options)
}
