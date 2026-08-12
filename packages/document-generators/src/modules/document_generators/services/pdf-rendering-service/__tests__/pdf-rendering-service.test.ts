import type { ComponentType } from 'react'

jest.mock('@react-pdf/renderer', () => ({
  renderToBuffer: jest.fn(),
}))

import { renderToBuffer } from '@react-pdf/renderer'
import type { PdfRenderInput } from '../types'
import { PdfRenderingService } from '..'

const mockedRenderToBuffer = renderToBuffer as jest.Mock
const FakeDocument: ComponentType<{ data: Record<string, unknown> }> = () => null

function makeInput(overrides: Partial<PdfRenderInput> = {}): PdfRenderInput {
  return {
    data: { document: { id: 'ord-1', number: 'ORD-1' } },
    format: 'pdf',
    source: { type: 'react-pdf', component: FakeDocument },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PdfRenderingService.render', () => {
  it('renders a loaded template and returns a complete document result', async () => {
    mockedRenderToBuffer.mockResolvedValueOnce(Uint8Array.from([1, 2, 3]))

    const result = await new PdfRenderingService().render(makeInput())

    expect(mockedRenderToBuffer).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      buffer: Uint8Array.from([1, 2, 3]),
      format: 'pdf',
      mimeType: 'application/pdf',
    })
  })

  it('passes normalized template data to the React component', async () => {
    mockedRenderToBuffer.mockResolvedValueOnce(Uint8Array.from([1]))
    const input = makeInput({ data: { normalized: true } })

    await new PdfRenderingService().render(input)

    const element = mockedRenderToBuffer.mock.calls[0][0]
    expect(element.type).toBe(FakeDocument)
    expect(element.props).toEqual({ data: { normalized: true } })
  })

  it('propagates React-PDF rendering failures to the caller', async () => {
    mockedRenderToBuffer.mockRejectedValueOnce(new Error('render failed'))

    await expect(new PdfRenderingService().render(makeInput())).rejects.toThrow('render failed')
  })
})
