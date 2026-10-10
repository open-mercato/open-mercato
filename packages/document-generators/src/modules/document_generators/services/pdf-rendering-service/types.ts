import type { ComponentType } from 'react'
import type { DocumentTemplateSource } from '@open-mercato/shared/modules/document-generators'

export interface ReactPdfTemplateSource extends DocumentTemplateSource {
  type: 'react-pdf'
  component: ComponentType<{ data: Record<string, unknown> }>
}

export interface PdfRenderInput {
  format: 'pdf'
  source: ReactPdfTemplateSource
  data: Record<string, unknown>
}
