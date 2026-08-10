import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { LoadedPdfTemplate, RenderedDocument } from '../../lib/interfaces'

/** Renders an already loaded and normalized React-PDF template to PDF bytes. */
export class PdfRenderingService {
  async render(template: LoadedPdfTemplate): Promise<RenderedDocument> {
    const element = React.createElement(template.source.component, {
      data: template.data,
    }) as React.ReactElement<DocumentProps>

    const buffer = await renderToBuffer(element)

    return {
      buffer: new Uint8Array(buffer),
      filename: template.filename,
      format: 'pdf',
      mimeType: 'application/pdf',
      template: template.template,
      resource: template.resource,
    }
  }
}
