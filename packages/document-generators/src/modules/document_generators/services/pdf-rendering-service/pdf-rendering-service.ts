import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { DocumentRenderOutput } from '../../lib/interfaces'
import type { PdfRenderInput } from './types'

/** Renders an already loaded and normalized React-PDF template to PDF bytes. */
export class PdfRenderingService {
  async render(input: PdfRenderInput): Promise<DocumentRenderOutput> {
    const element = React.createElement(input.source.component, {
      data: input.data,
    }) as React.ReactElement<DocumentProps>

    const buffer = await renderToBuffer(element)

    return {
      buffer: new Uint8Array(buffer),
      format: 'pdf',
      mimeType: 'application/pdf',
    }
  }
}
