import type { DocumentRenderContext, DocumentRenderInput, DocumentRenderOutput, DocumentRenderingService } from '../lib/interfaces'
import { MarkdownRenderingService } from './markdown-rendering-service'

const builtInRenderers: ReadonlyMap<string, DocumentRenderingService> = new Map<string, DocumentRenderingService>([
  ['md', new MarkdownRenderingService()],
  ['pdf', {
    async render(input: DocumentRenderInput, context: DocumentRenderContext) {
      const { PdfRenderingService } = await import('./pdf-rendering-service')
      return new PdfRenderingService().render(input, context)
    },
  }],
])

export class DocumentRenderer implements DocumentRenderingService {
  constructor(private readonly renderers: ReadonlyMap<string, DocumentRenderingService> = builtInRenderers) {}

  async render(input: DocumentRenderInput, context: DocumentRenderContext): Promise<DocumentRenderOutput> {
    const renderer = this.renderers.get(input.format)
    if (!renderer) throw new Error(`[internal] Unsupported document format: ${input.format}`)
    const rendered = await renderer.render(input, context)
    if (rendered.format !== input.format) throw new Error('[internal] Renderer returned a different document format')
    return rendered
  }
}
