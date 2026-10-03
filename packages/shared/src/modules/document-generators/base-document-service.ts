import { createTranslator } from '../../lib/i18n/translate'
import type {
  DocumentDataInput,
  DocumentFetchContext,
  DocumentTemplateEntry,
  TemplateEntry,
  TemplateNormalizationInput,
} from './types'

const fallbackTranslator = createTranslator({})

export abstract class BaseDocumentService {
  abstract readonly id: string
  abstract readonly label: string
  abstract readonly module: string
  abstract readonly resourceKind: string

  private readonly templates: DocumentTemplateEntry[] = []

  protected registerTemplate(entry: DocumentTemplateEntry): void {
    this.templates.push({
      ...entry,
      tags: [...entry.tags],
      requiredFeatures: entry.requiredFeatures ? [...entry.requiredFeatures] : undefined,
    })
  }

  getEntries(): TemplateEntry[] {
    return this.templates.map((entry) => ({
      ...entry,
      tags: [...entry.tags],
      requiredFeatures: entry.requiredFeatures ? [...entry.requiredFeatures] : undefined,
      module: this.module,
      resourceKind: this.resourceKind,
      fromRecord: (data, { locale, translate }) => this.toTemplateData({
        data,
        locale,
        translate: translate ?? fallbackTranslator,
      }),
      fetchData: (input, context) => this.fetchData(input, context),
      resourceId: (input) => this.resourceId(input),
      resourceLabel: (input) => this.resourceLabel(input),
    }))
  }

  async fetchData({ data }: { data: unknown }, _context: DocumentFetchContext): Promise<unknown> {
    return data
  }

  abstract toTemplateData(input: TemplateNormalizationInput): Record<string, unknown>

  abstract resourceId(input: DocumentDataInput): string

  resourceLabel(_input: DocumentDataInput): string | undefined {
    return undefined
  }
}
