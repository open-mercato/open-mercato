import type { ComponentType } from 'react'

jest.mock('@react-pdf/renderer', () => ({
  renderToBuffer: jest.fn(),
}))

import { renderToBuffer } from '@react-pdf/renderer'
import type { LoadedPdfTemplate } from '../../../lib/interfaces'
import { PdfRenderingService } from '..'

const mockedRenderToBuffer = renderToBuffer as jest.Mock
const FakeDocument: ComponentType<{ data: Record<string, unknown> }> = () => null

function makeTemplate(overrides: Partial<LoadedPdfTemplate> = {}): LoadedPdfTemplate {
  return {
    data: { document: { id: 'ord-1', number: 'ORD-1' } },
    filename: 'invoice-ORD-1.pdf',
    source: { type: 'react-pdf', component: FakeDocument },
    template: { id: 'order-invoice', label: 'Order Invoice' },
    resource: { kind: 'sales.order', id: 'ord-1', label: 'ORD-1' },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PdfRenderingService.render', () => {
  it('renders a loaded template and returns a complete document result', async () => {
    mockedRenderToBuffer.mockResolvedValueOnce(Uint8Array.from([1, 2, 3]))

    const result = await new PdfRenderingService().render(makeTemplate())

    expect(mockedRenderToBuffer).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      buffer: Uint8Array.from([1, 2, 3]),
      filename: 'invoice-ORD-1.pdf',
      format: 'pdf',
      mimeType: 'application/pdf',
      template: { id: 'order-invoice', label: 'Order Invoice' },
      resource: { kind: 'sales.order', id: 'ord-1', label: 'ORD-1' },
    })
  })

  it('passes normalized template data to the React component', async () => {
    mockedRenderToBuffer.mockResolvedValueOnce(Uint8Array.from([1]))
    const template = makeTemplate({ data: { normalized: true } })

    await new PdfRenderingService().render(template)

    const element = mockedRenderToBuffer.mock.calls[0][0]
    expect(element.type).toBe(FakeDocument)
    expect(element.props).toEqual({ data: { normalized: true } })
  })

  it('propagates React-PDF rendering failures to the caller', async () => {
    mockedRenderToBuffer.mockRejectedValueOnce(new Error('render failed'))

    await expect(new PdfRenderingService().render(makeTemplate())).rejects.toThrow('render failed')
  })
})
