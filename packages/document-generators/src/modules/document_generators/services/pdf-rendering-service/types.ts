import type { ComponentType } from 'react'
import type { DocumentTemplateSource } from '@open-mercato/shared/modules/document-generators'
import type { DocumentRenderInput } from '../../lib/interfaces'

export interface ReactPdfTemplateSource extends DocumentTemplateSource {
  type: 'react-pdf'
  component: ComponentType<{ data: Record<string, unknown> }>
}

export interface PdfRenderInput extends DocumentRenderInput {
  format: 'pdf'
  source: ReactPdfTemplateSource
}
