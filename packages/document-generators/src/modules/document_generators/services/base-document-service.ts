import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { TemplateEntry, TemplateDataContext } from '../lib/interfaces'
import type { DocumentTemplateEntry } from './types'

const untranslated: NonNullable<TemplateDataContext['translate']> = (key) => key

export type { DocumentTemplateEntry } from './types'

/**
 * Base class for document services.
 *
 * Each concrete service owns a set of related templates and the normalization
 * logic for converting raw widget records into the data shape those templates expect.
 * Extend this class once per module (e.g. QuotesDocumentService, OrdersDocumentService).
 */
export abstract class BaseDocumentService {
  abstract readonly id: string
  abstract readonly label: string
  /** Top-level module name — e.g. 'sales'. Used for grouping on the backend page. */
  abstract readonly module: string
  /** Framework resource kind — matches ctx.resourceKind in widgets. E.g. 'sales.quote'. */
  abstract readonly resourceKind: string

  protected templates_: Map<string, DocumentTemplateEntry> = new Map()

  /**
   * Normalizes a raw server record into the flat data shape expected by this service's templates.
   *
   * @param input - Enriched record plus the required active locale
   * @returns Normalized data object passed to the template component
   */
  abstract toTemplateData(input: { data: unknown } & TemplateDataContext): Record<string, unknown>

  /**
   * Returns the filename for the generated PDF.
   * Override in concrete services to include document-specific identifiers (e.g. order number).
   *
   * @param data - Normalized data returned by toTemplateData
   */
  filename(_input: { data: Record<string, unknown> }): string {
    return 'document.pdf'
  }

  /**
   * Returns a human-readable label for the source resource, derived server-side
   * from the normalized data (e.g. an order or quote number). Used for the
   * generation-history list. Override in concrete services.
   *
   * @param data - Normalized data returned by toTemplateData
   * @returns Label string, or undefined when none can be derived
   */
  resourceLabel(_input: { data: Record<string, unknown> }): string | undefined {
    return undefined
  }

  /**
   * Returns the canonical source-resource id derived from normalized server-side
   * data. The generation route uses it to verify client-supplied history metadata.
   */
  resourceId(_input: { data: Record<string, unknown> }): string | undefined {
    return undefined
  }

  /**
   * Optional hook to fetch related data before normalization.
   * Called server-side in the generate route with the request-scoped DI container.
   * Override in concrete services that need data not available in the widget context (e.g. line items).
   *
   * @param record - Raw record from the widget context
   * @param container - Request-scoped Awilix DI container
   * @returns Enriched record with related data attached
   */
  async fetchData(input: { data: unknown }, _ctx: { container: AppContainer; auth: AuthContext | null }): Promise<unknown> {
    return input.data
  }

  /**
   * Registers a template with this service.
   *
   * @param entry - Template definition without resourceKind and fromRecord
   */
  registerTemplate(entry: DocumentTemplateEntry): void {
    this.templates_.set(entry.id, entry)
  }

  /**
   * Returns all templates registered with this service as TemplateEntry objects,
   * with resourceKind and fromRecord bound to this service instance.
   *
   * @returns Array of registry entries ready to be passed to templateRegistry
   */
  getEntries(): TemplateEntry[] {
    return Array.from(this.templates_.values()).map((template) => ({
      id: template.id,
      label: template.label,
      description: template.description,
      module: this.module,
      resourceKind: this.resourceKind,
      documentType: template.documentType,
      format: template.format ?? 'pdf',
      tags: template.tags,
      note: template.note,
      fromRecord: (data: unknown, { locale, translate }: TemplateDataContext) => this.toTemplateData({ data, locale, translate: translate ?? untranslated }),
      filename: template.filename ?? ((input: { data: Record<string, unknown> }) => this.filename(input)),
      resourceId: (input: { data: Record<string, unknown> }) => this.resourceId(input),
      resourceLabel: (input: { data: Record<string, unknown> }) => this.resourceLabel(input),
      fetchData: (input: { data: unknown }, ctx: { container: AppContainer; auth: AuthContext | null }) => this.fetchData(input, ctx),
      load: template.load,
    }))
  }
}
