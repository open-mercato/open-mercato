import type { CrudField } from '../CrudForm'
import type { CustomFieldDefDto, CustomFieldDefinitionsPayload } from './customFieldDefs'
import { filterCustomFieldDefs } from './customFieldDefs'
import { fetchCustomFieldDefs, fetchCustomFieldDefinitionsPayload } from './customFieldDefs'
import { FieldRegistry, loadGeneratedFieldRegistrations } from '../fields/registry'
import { apiCall } from './apiCall'

let registryReady: Promise<void> | null = null

async function ensureFieldRegistryReady() {
  if (!registryReady) {
    registryReady = loadGeneratedFieldRegistrations().catch((err) => {
      registryReady = null
      throw err
    })
  }
  await registryReady
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
                  const url = buildOptionsUrl(d.optionsUrl!, query)
                  return loadRemoteOptions(url)
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
              const url = buildOptionsUrl(d.optionsUrl!, query)
              return loadRemoteOptions(url)
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

export async function fetchCustomFieldFormStructure(
  entityIds: string | string[],
  fetchImpl?: typeof fetch,
  options?: { bareIds?: boolean },
): Promise<{ fields: CrudField[]; definitions: CustomFieldDefDto[]; metadata: CustomFieldDefinitionsPayload }> {
  await ensureFieldRegistryReady()
  const metadata = await fetchCustomFieldDefinitionsPayload(entityIds, fetchImpl)
  const definitions = Array.isArray(metadata.items) ? metadata.items : []
  const fields = buildFormFieldsFromCustomFields(definitions, options)
  return { fields, definitions, metadata }
}

export async function fetchCustomFieldFormFields(
  entityIds: string | string[],
  fetchImpl?: typeof fetch,
  options?: { bareIds?: boolean },
): Promise<CrudField[]> {
  const { fields } = await fetchCustomFieldFormStructure(entityIds, fetchImpl, options)
  return fields
}

export async function fetchCustomFieldFormFieldsWithDefinitions(
  entityIds: string | string[],
  fetchImpl?: typeof fetch,
  options?: { bareIds?: boolean },
): Promise<{ fields: CrudField[]; definitions: CustomFieldDefDto[]; metadata: CustomFieldDefinitionsPayload }> {
  return fetchCustomFieldFormStructure(entityIds, fetchImpl, options)
}
