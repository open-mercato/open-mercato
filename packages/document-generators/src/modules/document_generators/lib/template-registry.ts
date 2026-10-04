import type { TemplateEntry, TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import type { TranslateWithFallbackFn as TranslateFn } from '@open-mercato/shared/lib/i18n/translate'
import type { LoadedTemplate, TemplateFilter, TemplateFilterOptions, TemplateLoadContext } from './interfaces'
import { DuplicateTemplateError, UnknownTemplateError } from './template-errors'
import { assertDistinctVersions, availableVersions, currentVersion, resolveVersionSource } from './template-versions'

function translateText(key: string, translate?: TranslateFn): string {
  return translate ? translate(key, key) : key
}

function matchesFilter(entry: TemplateEntry, filter: TemplateFilter): boolean {
  return (!filter.resourceKind || entry.resourceKind === filter.resourceKind)
    && (!filter.documentType || entry.documentType === filter.documentType)
    && (!filter.format || entry.format === filter.format)
    && (!filter.tags?.length || filter.tags.some((tag) => entry.tags.includes(tag)))
}

function metadata(entry: TemplateEntry, translate?: TranslateFn): TemplateMeta {
  return {
    id: entry.id,
    label: translateText(entry.label, translate),
    description: translateText(entry.description, translate),
    module: entry.module,
    resourceKind: entry.resourceKind,
    documentType: entry.documentType,
    format: entry.format,
    tags: [...entry.tags],
    ...(entry.note === undefined ? {} : { note: entry.note }),
    ...(entry.requiredFeatures === undefined ? {} : { requiredFeatures: [...entry.requiredFeatures] }),
    version: currentVersion(entry),
    versions: availableVersions(entry),
  }
}

export class TemplateRegistry {
  private entries = new Map<string, TemplateEntry>()

  register(entries: TemplateEntry[]): void {
    const next = new Map(this.entries)
    const batchIds = new Set<string>()
    for (const entry of entries) {
      const existing = next.get(entry.id)
      if (batchIds.has(entry.id) || (existing && existing.module !== entry.module)) {
        throw new DuplicateTemplateError(entry.id, existing?.module ?? entry.module, entry.module)
      }
      batchIds.add(entry.id)
      assertDistinctVersions(entry)
      next.set(entry.id, {
        ...entry,
        tags: [...entry.tags],
        requiredFeatures: entry.requiredFeatures ? [...entry.requiredFeatures] : undefined,
        archivedVersions: entry.archivedVersions ? entry.archivedVersions.map((source) => ({ ...source })) : undefined,
      })
    }
    this.entries = next
  }

  listTemplates(filter: TemplateFilter = {}, translate?: TranslateFn): TemplateMeta[] {
    return [...this.entries.values()]
      .filter((entry) => matchesFilter(entry, filter))
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

  async load(input: { id: string; data: unknown; version?: string }, context: TemplateLoadContext): Promise<LoadedTemplate> {
    const entry = this.getEntry(input.id)
    const selected = resolveVersionSource(entry, input.version)
    const fetched = entry.fetchData ? await entry.fetchData({ data: input.data }, context) : input.data
    const data = entry.fromRecord(fetched, { locale: context.locale, translate: context.translate })
    const resourceId = entry.resourceId({ data })
    if (!resourceId) throw new Error('[internal] Document template did not resolve its source identity')
    const filename = entry.filename({ data })
    const source = await selected.load()
    return {
      data,
      filename,
      template: { id: entry.id, label: translateText(entry.label, context.translate), version: selected.version },
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
