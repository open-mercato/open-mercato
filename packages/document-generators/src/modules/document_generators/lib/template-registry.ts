import type { TemplateEntry, TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { LoadedTemplate, TemplateFilter, TemplateFilterOptions, TemplateLoadContext } from './interfaces'

export class UnknownTemplateError extends Error {
  constructor(readonly templateId: string) {
    super(`[internal] Unknown document template: ${templateId}`)
    this.name = 'UnknownTemplateError'
  }
}

export class DuplicateTemplateError extends Error {
  constructor(templateId: string, existingModule: string, incomingModule: string) {
    super(`[internal] Duplicate template ${templateId} from ${incomingModule}; already registered by ${existingModule}. Use module-prefixed template IDs.`)
    this.name = 'DuplicateTemplateError'
  }
}

function metadata(entry: TemplateEntry, translate?: TranslateFn): TemplateMeta {
  return {
    id: entry.id,
    label: translate ? translate(entry.label, entry.label) : entry.label,
    description: translate ? translate(entry.description, entry.description) : entry.description,
    module: entry.module,
    resourceKind: entry.resourceKind,
    documentType: entry.documentType,
    format: entry.format,
    tags: [...entry.tags],
    ...(entry.note === undefined ? {} : { note: entry.note }),
    ...(entry.requiredFeatures === undefined ? {} : { requiredFeatures: [...entry.requiredFeatures] }),
  }
}

export class TemplateRegistry {
  private entries = new Map<string, TemplateEntry>()

  register(entries: TemplateEntry[]): void {
    const next = new Map(this.entries)
    for (const entry of entries) {
      const existing = next.get(entry.id)
      if (existing) throw new DuplicateTemplateError(entry.id, existing.module, entry.module)
      next.set(entry.id, {
        ...entry,
        tags: [...entry.tags],
        requiredFeatures: entry.requiredFeatures ? [...entry.requiredFeatures] : undefined,
      })
    }
    this.entries = next
  }

  listTemplates(filter: TemplateFilter = {}, translate?: TranslateFn): TemplateMeta[] {
    return [...this.entries.values()]
      .filter((entry) => (!filter.resourceKind || entry.resourceKind === filter.resourceKind)
        && (!filter.documentType || entry.documentType === filter.documentType)
        && (!filter.format || entry.format === filter.format)
        && (!filter.tags?.length || filter.tags.some((tag) => entry.tags.includes(tag))))
      .map((entry) => metadata(entry, translate))
  }

  getTemplateMetadata(id: string, translate?: TranslateFn): TemplateMeta {
    return metadata(this.getEntry(id), translate)
  }

  listTemplateFilterOptions(templates: TemplateMeta[]): TemplateFilterOptions {
    return {
      resourceKinds: [...new Set(templates.map((template) => template.resourceKind))].sort((left, right) => left.localeCompare(right)),
      formats: [...new Set(templates.map((template) => template.format))].sort((left, right) => left.localeCompare(right)),
    }
  }

  async load(input: { id: string; data: unknown }, context: TemplateLoadContext): Promise<LoadedTemplate> {
    const entry = this.getEntry(input.id)
    const fetched = entry.fetchData ? await entry.fetchData({ data: input.data }, context) : input.data
    const data = entry.fromRecord(fetched, { locale: context.locale, translate: context.translate })
    const resourceId = entry.resourceId({ data })
    if (!resourceId) throw new Error('[internal] Document template did not resolve its source identity')
    const filename = entry.filename({ data })
    const source = await entry.load()
    return {
      data,
      filename,
      template: { id: entry.id, label: metadata(entry, context.translate).label },
      resource: { kind: entry.resourceKind, id: resourceId, label: entry.resourceLabel?.({ data }) },
      render: { format: entry.format, source, data },
    }
  }

  private getEntry(id: string): TemplateEntry {
    const entry = this.entries.get(id)
    if (!entry) throw new UnknownTemplateError(id)
    return entry
  }
}

const registryGlobal = globalThis as typeof globalThis & {
  __openMercatoDocumentTemplateRegistry?: TemplateRegistry
}

export const templateRegistry = registryGlobal.__openMercatoDocumentTemplateRegistry
  ?? (registryGlobal.__openMercatoDocumentTemplateRegistry = new TemplateRegistry())
