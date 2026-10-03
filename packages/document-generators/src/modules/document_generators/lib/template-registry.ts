import { DEFAULT_TEMPLATE_VERSION, type DocumentTemplateSource, type TemplateEntry, type TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import type { TranslateWithFallbackFn as TranslateFn } from '@open-mercato/shared/lib/i18n/translate'
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

export class UnknownTemplateVersionError extends Error {
  constructor(readonly templateId: string, readonly version: string) {
    super(`[internal] Unknown version ${version} of document template ${templateId}`)
    this.name = 'UnknownTemplateVersionError'
  }
}

function currentVersion(entry: TemplateEntry): string {
  return entry.version ?? DEFAULT_TEMPLATE_VERSION
}

function availableVersions(entry: TemplateEntry): string[] {
  return [currentVersion(entry), ...(entry.archivedVersions ?? []).map((source) => source.version)]
}

function assertDistinctVersions(entry: TemplateEntry): void {
  const versions = availableVersions(entry)
  if (new Set(versions).size !== versions.length || versions.some((version) => !version.trim())) {
    throw new Error(`[internal] Document template ${entry.id} declares duplicate or empty versions`)
  }
}

function resolveVersionSource(entry: TemplateEntry, version: string | undefined): { version: string; load: () => Promise<DocumentTemplateSource> } {
  const current = currentVersion(entry)
  if (version === undefined || version === current) return { version: current, load: entry.load }
  const archived = entry.archivedVersions?.find((source) => source.version === version)
  if (!archived) throw new UnknownTemplateVersionError(entry.id, version)
  return archived
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
    version: currentVersion(entry),
    versions: availableVersions(entry),
  }
}

export class TemplateRegistry {
  private entries = new Map<string, TemplateEntry>()

  register(entries: TemplateEntry[]): void {
    const next = new Map(this.entries)
    for (const entry of entries) {
      const existing = next.get(entry.id)
      if (existing) throw new DuplicateTemplateError(entry.id, existing.module, entry.module)
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
      template: { id: entry.id, label: metadata(entry, context.translate).label, version: selected.version },
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
