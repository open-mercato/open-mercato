import type { ComponentType } from 'react'

jest.mock('@react-pdf/renderer', () => ({
  renderToBuffer: jest.fn(),
}))

import { renderToBuffer } from '@react-pdf/renderer'
import type { DocumentRenderInput } from '../../lib/interfaces'
import { DocumentRenderer } from '..'

const mockedRenderToBuffer = renderToBuffer as jest.Mock
const FakeDocument: ComponentType<{ data: Record<string, unknown> }> = () => null

describe('DocumentRenderer.render', () => {
  it('dispatches Markdown templates to the Markdown renderer', async () => {
    const input: DocumentRenderInput = {
      data: { title: 'Invoice' },
      format: 'md',
      source: { type: 'markdown', render: (data) => `# ${String(data.title)}` },
    }

    const result = await new DocumentRenderer().render(input)

    expect(result.format).toBe('md')
    expect(new TextDecoder().decode(result.buffer)).toBe('# Invoice')
    expect(mockedRenderToBuffer).not.toHaveBeenCalled()
  })

  it('dispatches PDF templates to the PDF renderer', async () => {
    mockedRenderToBuffer.mockResolvedValueOnce(Uint8Array.from([1, 2, 3]))
    const input: DocumentRenderInput = {
      data: {},
      format: 'pdf',
      source: { type: 'react-pdf', component: FakeDocument },
    }

    const result = await new DocumentRenderer().render(input)

    expect(result.format).toBe('pdf')
    expect(mockedRenderToBuffer).toHaveBeenCalledTimes(1)
  })
})
