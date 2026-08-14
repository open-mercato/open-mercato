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
  constructor(id: string) {
    super(`[internal] Duplicate template ID: ${id}`)
    this.name = 'DuplicateTemplateError'
  }
}

/**
 * Holds document templates contributed by application modules.
 * Orchestrates server-side data fetching, normalization, and component loading via a single load() call.
 */
export class TemplateRegistry implements TemplateRegistryInterface {
  private templates = new Map<string, TemplateEntry>()

  register(entries: TemplateEntry[]): void {
    const templates = new Map(this.templates)
    for (const entry of entries) {
      if (templates.has(entry.id)) {
        throw new DuplicateTemplateError(entry.id)
      }
      templates.set(entry.id, entry)
    }
    this.templates = templates
  }

  /**
   * Returns template metadata for use in the templates listing endpoint.
   */
  listTemplates(filter?: TemplateFilter, translate?: TranslateFn): TemplateMeta[] {
    const toMeta = ({ id, label, description, module, resourceKind, documentType, format, tags, note }: TemplateEntry): TemplateMeta =>
      ({
        id,
        label: translate ? translate(label, label) : label,
        description: translate ? translate(description, description) : description,
        module,
        resourceKind,
        documentType,
        format,
        tags,
        note,
      })
    return Array.from(this.templates.values())
      .filter((template) => {
        if (filter?.resourceKind && template.resourceKind !== filter.resourceKind) return false
        if (filter?.documentType && template.documentType !== filter.documentType) return false
        if (filter?.format && template.format !== filter.format) return false
        if (filter?.tags?.length && !filter.tags.some((tag) => template.tags.includes(tag))) return false
        return true
      })
      .map(toMeta)
  }

  listTemplateFilterOptions(): TemplateFilterOptions {
    const templates = Array.from(this.templates.values())
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
