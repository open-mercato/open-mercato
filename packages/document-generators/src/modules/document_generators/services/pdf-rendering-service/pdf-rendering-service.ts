import { createElement } from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { DocumentRenderInput } from '../../lib/interfaces'
import type { ReactPdfTemplateSource } from './types'

export class PdfRenderingService {
  async render(input: DocumentRenderInput) {
    if (input.format !== 'pdf' || input.source.type !== 'react-pdf' || typeof input.source.component !== 'function') {
      throw new Error('[internal] Invalid React-PDF document source')
    }
    const source = input.source as ReactPdfTemplateSource
    const element = createElement<DocumentProps & { data: Record<string, unknown> }>(source.component, { data: input.data })
    const buffer = await renderToBuffer(element)
    return { buffer: new Uint8Array(buffer), format: 'pdf', mimeType: 'application/pdf' }
  }
}
