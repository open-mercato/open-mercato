import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type {
  TemplateEntry,
  TemplateMeta,
} from '@open-mercato/shared/modules/document-generators'
import type {
  LoadedTemplate,
  TemplateFilter,
  TemplateFilterOptions,
  TemplateLoadContext,
  TemplateRegistry as TemplateRegistryInterface,
} from './interfaces'

export class UnknownTemplateError extends Error {
  constructor(id: string) {
    super(`Unknown template: ${id}`)
    this.name = 'UnknownTemplateError'
  }
}

export class DuplicateTemplateError extends Error {
  constructor(id: string, registeredModule: string, incomingModule: string) {
    super(
      `[internal] Duplicate template ID "${id}": already registered by module "${registeredModule}", attempted by module "${incomingModule}". Template IDs must be globally unique and module-namespaced.`,
    )
    this.name = 'DuplicateTemplateError'
  }
}

/**
 * Holds document templates contributed by application modules.
 * Orchestrates server-side data fetching, normalization, and component loading via a single load() call.
 */
export class TemplateRegistry implements TemplateRegistryInterface {
  private templates = new Map<string, TemplateEntry>()

  /**
   * Projects a runtime registry entry to safe, optionally translated catalogue metadata.
   */
  private toMeta(entry: TemplateEntry, translate?: TranslateFn): TemplateMeta {
    return {
      id: entry.id,
      label: translate ? translate(entry.label, entry.label) : entry.label,
      description: translate ? translate(entry.description, entry.description) : entry.description,
      module: entry.module,
      resourceKind: entry.resourceKind,
      documentType: entry.documentType,
      format: entry.format,
      tags: entry.tags,
      note: entry.note,
      requiredFeatures: entry.requiredFeatures,
    }
  }

  /**
   * Atomically registers a batch of templates and rejects every duplicate global ID.
   *
   * @throws DuplicateTemplateError if an ID is already registered or repeated in the batch
   */
  register(entries: TemplateEntry[]): void {
    const templates = new Map(this.templates)
    for (const entry of entries) {
      const registered = templates.get(entry.id)
      if (registered) {
        throw new DuplicateTemplateError(entry.id, registered.module, entry.module)
      }
      templates.set(entry.id, entry)
    }
    this.templates = templates
  }

  /**
   * Returns template metadata for use in the templates listing endpoint.
   */
  listTemplates(filter?: TemplateFilter, translate?: TranslateFn): TemplateMeta[] {
    return Array.from(this.templates.values())
      .filter((template) => {
        if (filter?.resourceKind && template.resourceKind !== filter.resourceKind) return false
        if (filter?.documentType && template.documentType !== filter.documentType) return false
        if (filter?.format && template.format !== filter.format) return false
        if (filter?.tags?.length && !filter.tags.some((tag) => template.tags.includes(tag))) return false
        return true
      })
      .map((entry) => this.toMeta(entry, translate))
  }

  /**
   * Returns safe catalogue metadata for one registered template.
   *
   * @throws UnknownTemplateError if the template is not registered
   */
  getTemplateMetadata(id: string, translate?: TranslateFn): TemplateMeta {
    return this.toMeta(this.findTemplate(id), translate)
  }

  /**
   * Derives sorted, unique catalogue filter options from the provided accessible templates.
   * Uses the complete registered catalogue when no template list is provided.
   */
  listTemplateFilterOptions(templates: TemplateMeta[] = this.listTemplates()): TemplateFilterOptions {
    const resourceKinds = Array.from(new Set(templates.map((template) => template.resourceKind)))
      .sort((left, right) => left.localeCompare(right))
    const formats = Array.from(new Set(templates.map((template) => template.format)))
      .sort((left, right) => left.localeCompare(right))
    return { resourceKinds, formats }
  }

  /**
   * @param id - Template ID
   * @throws Error if template is not registered
   */
  private findTemplate(id: string): TemplateEntry {
    const entry = this.templates.get(id)
    if (!entry) throw new UnknownTemplateError(id)
    return entry
  }

  /**
   * Calls fetchData if defined on the template; returns the original data otherwise.
   *
   * @param id - Template ID
   * @param data - Raw data from the widget context
   * @param context - Request-scoped DI/auth context plus the required active locale
   */
  private async enrich({ id, data }: { id: string; data: unknown }, { container, auth }: { container: AppContainer; auth: AuthContext | null }): Promise<unknown> {
    const entry = this.findTemplate(id)
    if (!entry.fetchData) return data
    return entry.fetchData({ data }, { container, auth })
  }

  /**
   * Fetches data, normalizes it, and lazy-loads the component in one call.
   *
   * @param id - Template ID
   * @param data - Raw data from the widget (only `id` is required when fetchData is defined)
   * @param context - Request-scoped DI/auth context plus the required active locale
   * @throws Error if template ID is not registered
   */
  async load({ id, data: rawData }: { id: string; data: unknown }, { container, auth, locale, translate }: TemplateLoadContext): Promise<LoadedTemplate> {
    const entry = this.findTemplate(id)
    const enriched = await this.enrich({ id, data: rawData }, { container, auth })
    const source = await entry.load()
    const data = entry.fromRecord(enriched, { locale, translate })
    const filename = entry.filename({ data })
    const resourceId = entry.resourceId({ data })
    const resourceLabel = entry.resourceLabel?.({ data })
    const loadedBase = {
      filename,
      template: {
        id: entry.id,
        label: translate ? translate(entry.label, entry.label) : entry.label,
      },
      resource: { kind: entry.resourceKind, id: resourceId, label: resourceLabel },
    }

    return {
      ...loadedBase,
      render: { format: entry.format, source, data },
    }
  }
}

/** Singleton registry for document templates — use this to register, query, and load templates. */
export const templateRegistry = new TemplateRegistry()
