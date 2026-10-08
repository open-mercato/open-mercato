import { DocumentRenderer } from '../document-renderer'
import { MarkdownRenderingService } from '../markdown-rendering-service'
import { DEFAULT_DOCUMENT_GENERATORS_CONFIG } from '../../lib/module-config'

const context = { config: DEFAULT_DOCUMENT_GENERATORS_CONFIG }

describe('format-neutral document rendering', () => {
  it('renders async Markdown as UTF-8 while passing normalized data unchanged', async () => {
    const data = { name: 'Łódź 한국' }
    const render = jest.fn(async (input) => `# ${input.name}`)
    const output = await new DocumentRenderer().render({ format: 'md', source: { type: 'markdown', render }, data }, context)
    expect(render).toHaveBeenCalledWith(data)
    expect(new TextDecoder().decode(output.buffer)).toBe('# Łódź 한국')
    expect(output).toMatchObject({ format: 'md', mimeType: 'text/markdown; charset=utf-8' })
  })

  it('supports another format without changing registry or shared contracts', async () => {
    const result = { buffer: new Uint8Array([42]), format: 'custom', mimeType: 'application/x-custom' }
    const render = jest.fn(async () => result)
    const renderer = new DocumentRenderer(new Map([['custom', { render }]]))
    const input = { format: 'custom', source: { type: 'custom-source' }, data: {} }
    await expect(renderer.render(input, context)).resolves.toBe(result)
    expect(render).toHaveBeenCalledWith(input, context)
  })

  it('rejects absent formats, wrong source kinds and non-text Markdown results', async () => {
    await expect(new DocumentRenderer().render({ format: '', source: { type: 'markdown' }, data: {} }, context)).rejects.toThrow('Unsupported document format')
    await expect(new MarkdownRenderingService().render({ format: 'md', source: { type: 'react-pdf' }, data: {} })).rejects.toThrow('Invalid Markdown')
    await expect(new MarkdownRenderingService().render({ format: 'md', source: { type: 'markdown', render: () => 42 }, data: {} })).rejects.toThrow('must return text')
  })

  it('does not accept a renderer format mismatch', async () => {
    const renderer = new DocumentRenderer(new Map([['md', { render: async () => ({ buffer: new Uint8Array(), format: 'pdf', mimeType: 'application/pdf' }) }]]))
    await expect(renderer.render({ format: 'md', source: { type: 'markdown' }, data: {} }, context)).rejects.toThrow('different document format')
  })
})
