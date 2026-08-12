import type { AuthContext } from '../../../lib/auth/server'
import type { AppContainer } from '../../../lib/di/container'
import type {
  TemplateDataContext,
  TemplateEntry,
} from '../lib/interfaces'
import type { DocumentTemplateEntry } from './types'

const untranslated: NonNullable<TemplateDataContext['translate']> = (key) => key

export abstract class BaseDocumentService {
  abstract readonly id: string
  abstract readonly label: string
  abstract readonly module: string
  abstract readonly resourceKind: string

  protected templates_: Map<string, DocumentTemplateEntry> = new Map()

  abstract toTemplateData(input: { data: unknown } & TemplateDataContext): Record<string, unknown>

  filename(_input: { data: Record<string, unknown> }): string {
    return 'document.pdf'
  }

  resourceLabel(_input: { data: Record<string, unknown> }): string | undefined {
    return undefined
  }

  abstract resourceId(input: { data: Record<string, unknown> }): string

  async fetchData(
    input: { data: unknown },
    _context: { container: AppContainer; auth: AuthContext | null },
  ): Promise<unknown> {
    return input.data
  }

  registerTemplate(entry: DocumentTemplateEntry): void {
    this.templates_.set(entry.id, entry)
  }

  getEntries(): TemplateEntry[] {
    return Array.from(this.templates_.values()).map((template) => ({
      id: template.id,
      label: template.label,
      description: template.description,
      module: this.module,
      resourceKind: this.resourceKind,
      documentType: template.documentType,
      format: template.format,
      tags: template.tags,
      note: template.note,
      fromRecord: (data, { locale, translate }) => this.toTemplateData({
        data,
        locale,
        translate: translate ?? untranslated,
      }),
      filename: template.filename ?? ((input) => this.filename(input)),
      resourceId: (input) => this.resourceId(input),
      resourceLabel: (input) => this.resourceLabel(input),
      fetchData: (input, context) => this.fetchData(input, context),
      load: template.load,
    }))
  }
}
