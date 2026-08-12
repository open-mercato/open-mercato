import type { DocumentTemplateSource } from '@open-mercato/shared/modules/document-generators'
import type { DocumentRenderInput } from '../../lib/interfaces'

export interface MarkdownTemplateSource extends DocumentTemplateSource {
  type: 'markdown'
  render: (data: Record<string, unknown>) => string | Promise<string>
}

export interface MarkdownRenderInput extends DocumentRenderInput {
  format: 'md'
  source: MarkdownTemplateSource
}
