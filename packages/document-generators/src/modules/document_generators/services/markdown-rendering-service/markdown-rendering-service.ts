import type { DocumentRenderInput, DocumentRenderOutput, DocumentRenderingService } from '../../lib/interfaces'
import type { MarkdownTemplateSource } from './types'

export class MarkdownRenderingService implements DocumentRenderingService {
  async render(input: DocumentRenderInput): Promise<DocumentRenderOutput> {
    if (input.format !== 'md' || input.source.type !== 'markdown' || typeof input.source.render !== 'function') {
      throw new Error('[internal] Invalid Markdown document source')
    }
    const source = input.source as MarkdownTemplateSource
    const content = await source.render(input.data)
    if (typeof content !== 'string') throw new Error('[internal] Markdown document source must return text')
    return { buffer: new TextEncoder().encode(content), format: 'md', mimeType: 'text/markdown; charset=utf-8' }
  }
}
