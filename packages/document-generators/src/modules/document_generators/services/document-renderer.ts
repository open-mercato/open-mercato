import type { DocumentRenderInput, DocumentRenderOutput } from '../lib/interfaces'
import { MarkdownRenderingService } from './markdown-rendering-service'
import { PdfRenderingService } from './pdf-rendering-service'

/** Selects the format-specific renderer for a document render input. */
export class DocumentRenderer {
  constructor(
    private readonly markdownRenderer = new MarkdownRenderingService(),
    private readonly pdfRenderer = new PdfRenderingService(),
  ) {}

  async render(input: DocumentRenderInput): Promise<DocumentRenderOutput> {
    if (input.format === 'md') {
      return this.markdownRenderer.render(input)
    }

    return this.pdfRenderer.render(input)
  }
}
