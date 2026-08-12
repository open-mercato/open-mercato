import type { MarkdownRenderInput } from '../types'
import { MarkdownRenderingService } from '..'

function makeInput(overrides: Partial<MarkdownRenderInput> = {}): MarkdownRenderInput {
  return {
    data: { document: { id: 'ord-1', number: 'ORD-1' } },
    format: 'md',
    source: { type: 'markdown', render: () => '# Invoice ORD-1\n' },
    ...overrides,
  }
}

describe('MarkdownRenderingService.render', () => {
  it('renders Markdown to UTF-8 bytes', async () => {
    const result = await new MarkdownRenderingService().render(makeInput())

    expect(new TextDecoder().decode(result.buffer)).toBe('# Invoice ORD-1\n')
    expect(result).toMatchObject({
      format: 'md',
      mimeType: 'text/markdown; charset=utf-8',
    })
  })

  it('passes normalized data to an asynchronous Markdown source', async () => {
    const render = jest.fn(async (data: Record<string, unknown>) => `# ${String(data.title)}`)

    const result = await new MarkdownRenderingService().render(makeInput({
      data: { title: 'Invoice' },
      source: { type: 'markdown', render },
    }))

    expect(render).toHaveBeenCalledWith({ title: 'Invoice' })
    expect(new TextDecoder().decode(result.buffer)).toBe('# Invoice')
  })
})
