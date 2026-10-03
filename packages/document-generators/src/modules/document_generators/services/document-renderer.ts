import type { DocumentRenderInput, DocumentRenderOutput, DocumentRenderingService } from '../lib/interfaces'
import { MarkdownRenderingService } from './markdown-rendering-service'

const builtInRenderers: ReadonlyMap<string, DocumentRenderingService> = new Map([
  ['md', new MarkdownRenderingService()],
  ['pdf', {
    async render(input: DocumentRenderInput) {
      const { PdfRenderingService } = await import('./pdf-rendering-service')
      return new PdfRenderingService().render(input)
    },
  }],
])

export class DocumentRenderer implements DocumentRenderingService {
  constructor(private readonly renderers: ReadonlyMap<string, DocumentRenderingService> = builtInRenderers) {}

  async render(input: DocumentRenderInput): Promise<DocumentRenderOutput> {
    const renderer = this.renderers.get(input.format)
    if (!renderer) throw new Error(`[internal] Unsupported document format: ${input.format}`)
    const rendered = await renderer.render(input)
    if (rendered.format !== input.format) throw new Error('[internal] Renderer returned a different document format')
    return rendered
  }
}
