import type { CrudField } from '../CrudForm'
import type {
  CustomFieldDefDto,
  CustomFieldDefinitionsPayload,
} from './customFieldDefs'
import {
  filterCustomFieldDefs,
  fetchCustomFieldDefs,
  fetchCustomFieldDefinitionsPayload,
} from './customFieldDefs'
import { FieldRegistry, loadGeneratedFieldRegistrations } from '../fields/registry'
import { apiCall } from './apiCall'
import { normalizeCustomFieldOptions } from '@open-mercato/shared/modules/entities/options'

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

export function buildFormFieldFromCustomFieldDef(
  def: CustomFieldDefDto,
  opts?: { bareIds?: boolean }
): CrudField | null {
  const id = opts?.bareIds ? def.key : `cf_${def.key}`
  const label = def.label || def.key
  const required = Array.isArray((def as any).validation)
    ? ((def as any).validation as any[]).some((rule) => rule && rule.rule === 'required')
    : false

  switch (def.kind) {
    case 'boolean':
      return { id, label, type: 'checkbox', description: def.description, required }
    case 'integer':
    case 'float':
      return { id, label, type: 'number', description: def.description, required }
    case 'multiline': {
      let editor: 'simple' | 'uiw' | 'html' = 'uiw'
      if (def.editor === 'simpleMarkdown') editor = 'simple'
      else if (def.editor === 'htmlRichText') editor = 'html'
      return { id, label, type: 'richtext', description: def.description, editor, required }
    }
    case 'select':
    case 'relation':
      return {
        id,
        label,
        type: 'select',
        description: def.description,
        options: normalizeCustomFieldOptions(def.options || []).map((option) => ({
          value: option.value,
          label: option.label,
        })),
        multiple: !!def.multi,
        required,
        ...(def.optionsUrl
          ? {
              loadOptions: async (query?: string) => {
                const url = buildOptionsUrl(def.optionsUrl!, query)
                return loadRemoteOptions(url)
              },
            }
          : {}),
        ...(def.multi && def.input === 'listbox' ? ({ listbox: true } as any) : {}),
      }
    default: {
      if (def.kind === 'text' && def.multi) {
        const base: any = { id, label, type: 'tags', description: def.description, required }
        const resolvedOptions = normalizeCustomFieldOptions(def.options || [])
        if (resolvedOptions.length > 0) {
          base.options = resolvedOptions.map((option) => ({ value: option.value, label: option.label }))
        }
        if (def.optionsUrl) {
          base.loadOptions = async (query?: string) => {
            const url = buildOptionsUrl(def.optionsUrl!, query)
            return loadRemoteOptions(url)
          }
        }
        return base
      }
      if (def.kind === 'text' && typeof def.editor === 'string' && def.editor) {
        let editor: 'simple' | 'uiw' | 'html' = 'uiw'
        if (def.editor === 'simpleMarkdown') editor = 'simple'
        else if (def.editor === 'htmlRichText') editor = 'html'
        return { id, label, type: 'richtext', description: def.description, editor, required }
      }
      const input = FieldRegistry.getInput(def.kind)
      if (input) {
        return {
          id,
          label,
          type: 'custom',
          required,
          description: def.description,
          component: (props) => input({ ...props, def }),
        }
      }
      return { id, label, type: 'text', description: def.description, required }
    }
  }
}

export function buildFormFieldsFromCustomFields(
  defs: CustomFieldDefDto[],
  opts?: { bareIds?: boolean }
): CrudField[] {
  const fields: CrudField[] = []
  const visible = filterCustomFieldDefs(defs, 'form')
  const seenKeys = new Set<string>()
  for (const def of visible) {
    const keyLower = String(def.key).toLowerCase()
    if (seenKeys.has(keyLower)) continue
    seenKeys.add(keyLower)
    const field = buildFormFieldFromCustomFieldDef(def, opts)
    if (field) fields.push(field)
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
