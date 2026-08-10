import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TemplateMeta, TemplateEntry, TemplateLoadContext, TemplateRegistry as TemplateRegistryInterface, LoadedTemplate } from './interfaces'

export class UnknownTemplateError extends Error {
  constructor(id: string) {
    super(`Unknown template: ${id}`)
    this.name = 'UnknownTemplateError'
  }
}

/**
 * Holds built-in and externally registered PDF templates.
 * Orchestrates server-side data fetching, normalization, and component loading via a single load() call.
 */
class TemplateRegistry implements TemplateRegistryInterface {
  private internal: TemplateEntry[] = []
  private external: TemplateEntry[] = []

  /**
   * Registers built-in templates shipped with this package.
   *
   * @param entries - Template entries produced by document services
   */
  registerInternal(entries: TemplateEntry[]): void {
    this.internal = entries
  }

  /**
   * Registers templates contributed by external modules via the generator convention.
   *
   * @param entries - Template entries from the auto-generated registry file
   */
  registerExternal(entries: TemplateEntry[]): void {
    this.external = entries
  }

  private getInternal(): TemplateEntry[] {
    return this.internal
  }

  private getExternal(): TemplateEntry[] {
    return this.external
  }

  private getAll(): TemplateEntry[] {
    return [...this.getInternal(), ...this.getExternal()]
  }

  /**
   * Returns template metadata grouped by source, for use in the templates listing endpoint.
   *
   * @returns Object with `internal` and `external` arrays of TemplateMeta
   */
  listTemplates(): { internal: TemplateMeta[]; external: TemplateMeta[] } {
    const toMeta = ({ id, label, description, module, resourceKind, documentType, tags, note }: TemplateEntry): TemplateMeta =>
      ({ id, label, description, module, resourceKind, documentType, tags, note })
    return {
      internal: this.getInternal().map(toMeta),
      external: this.getExternal().map(toMeta),
    }
  }

  /**
   * @param id - Template ID
   * @throws Error if template is not registered
   */
  private findTemplate(id: string): TemplateEntry {
    const entry = this.getAll().find((template) => template.id === id)
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
  async load({ id, data: rawData }: { id: string; data: unknown }, { container, auth, locale }: TemplateLoadContext): Promise<LoadedTemplate> {
    const entry = this.findTemplate(id)
    const enriched = await this.enrich({ id, data: rawData }, { container, auth })
    const source = await entry.load()
    const data = entry.fromRecord(enriched, { locale })
    const filename = entry.filename({ data })
    const resourceId = entry.resourceId?.({ data })
    const resourceLabel = entry.resourceLabel?.({ data })
    return {
      data,
      filename,
      source,
      template: { id: entry.id, label: entry.label },
      resource: { kind: entry.resourceKind, id: resourceId, label: resourceLabel },
    }
  }
}

/** Singleton registry for PDF templates — use this to register, query, and load templates. */
export const templateRegistry = new TemplateRegistry()
