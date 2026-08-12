import type { DocumentRenderOutput } from '../../lib/interfaces'
import type { MarkdownRenderInput } from './types'

/** Renders an already loaded and normalized Markdown template to UTF-8 bytes. */
export class MarkdownRenderingService {
  async render(input: MarkdownRenderInput): Promise<DocumentRenderOutput> {
    const markdown = await input.source.render(input.data)

    return {
      buffer: new TextEncoder().encode(markdown),
      format: 'md',
      mimeType: 'text/markdown; charset=utf-8',
    }
  }
}
