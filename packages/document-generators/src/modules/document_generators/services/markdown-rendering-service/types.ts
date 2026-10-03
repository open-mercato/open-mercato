import type { DocumentTemplateSource } from '@open-mercato/shared/modules/document-generators'

export interface MarkdownTemplateSource extends DocumentTemplateSource {
  type: 'markdown'
  render: (data: Record<string, unknown>) => string | Promise<string>
}

export interface MarkdownRenderInput {
  format: 'md'
  source: MarkdownTemplateSource
  data: Record<string, unknown>
}
