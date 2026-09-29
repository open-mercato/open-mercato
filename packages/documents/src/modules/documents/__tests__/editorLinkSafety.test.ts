import { getDocumentEditorExtensions } from '../lib/editorConfig'

describe('document editor link protocol policy', () => {
  it('keeps TipTap default URI validation on manual links', () => {
    const link = getDocumentEditorExtensions().find((extension) => extension.name === 'link') as {
      options?: {
        defaultProtocol?: string
        protocols?: unknown[]
        isAllowedUri?: (href: string, context: Record<string, unknown>) => boolean
      }
    } | undefined
    expect(link?.options?.isAllowedUri).toBeDefined()

    const context = {
      defaultProtocol: link?.options?.defaultProtocol,
      protocols: link?.options?.protocols ?? [],
      defaultValidate: () => false,
    }
    expect(link?.options?.isAllowedUri?.('https://example.test/document', context)).toBe(true)
    expect(link?.options?.isAllowedUri?.('/backend/documents', context)).toBe(true)
    expect(link?.options?.isAllowedUri?.('javascript:alert(1)', context)).toBe(false)
    expect(link?.options?.isAllowedUri?.('data:text/html,<script>alert(1)</script>', context)).toBe(false)
  })
})
