import type {
  DocumentRenderInput,
  DocumentRenderOutput,
} from '../lib/interfaces'
import { MarkdownRenderingService, type MarkdownRenderInput } from './markdown-rendering-service'
import { PdfRenderingService, type PdfRenderInput } from './pdf-rendering-service'

type DocumentRenderHandler = (input: DocumentRenderInput) => Promise<DocumentRenderOutput>

/** Selects the format-specific renderer for a document render input. */
export class DocumentRenderer {
  private readonly renderers: ReadonlyMap<string, DocumentRenderHandler>

  constructor(
    markdownRenderer = new MarkdownRenderingService(),
    pdfRenderer = new PdfRenderingService(),
  ) {
    this.renderers = new Map<string, DocumentRenderHandler>([
      ['md', (input) => markdownRenderer.render(input as MarkdownRenderInput)],
      ['pdf', (input) => pdfRenderer.render(input as PdfRenderInput)],
    ])
  }

  async render(input: DocumentRenderInput): Promise<DocumentRenderOutput> {
    const renderer = this.renderers.get(input.format)
    if (!renderer) {
      throw new Error(`[internal] Unsupported document format: ${input.format}`)
    }

    return renderer(input)
  }
}
