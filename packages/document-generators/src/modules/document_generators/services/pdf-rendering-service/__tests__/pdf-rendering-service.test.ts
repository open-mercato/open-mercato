import { createElement } from 'react'
import { PdfRenderingService } from '../pdf-rendering-service'

const mockRenderToBuffer = jest.fn(async () => Buffer.from('%PDF-1.3\nfixture'))
jest.mock('@react-pdf/renderer', () => ({ renderToBuffer: (...args: unknown[]) => mockRenderToBuffer(...args) }))

describe('PdfRenderingService', () => {
  beforeEach(() => mockRenderToBuffer.mockClear())

  it('passes normalized data to the source and returns PDF bytes and MIME metadata', async () => {
    const component = () => createElement('DOCUMENT')
    const data = { amount: 42 }
    const result = await new PdfRenderingService().render({ format: 'pdf', source: { type: 'react-pdf', component }, data })
    expect(mockRenderToBuffer.mock.calls[0]?.[0]).toMatchObject({ type: component, props: { data } })
    expect(result).toMatchObject({ format: 'pdf', mimeType: 'application/pdf' })
    expect(Buffer.from(result.buffer).toString()).toContain('%PDF-')
  })

  it('rejects an incompatible source without invoking React-PDF', async () => {
    await expect(new PdfRenderingService().render({ format: 'pdf', source: { type: 'markdown' }, data: {} })).rejects.toThrow('Invalid React-PDF')
    expect(mockRenderToBuffer).not.toHaveBeenCalled()
  })

  it('propagates render failures to the route error boundary', async () => {
    mockRenderToBuffer.mockRejectedValueOnce(new Error('renderer failed'))
    await expect(new PdfRenderingService().render({ format: 'pdf', source: { type: 'react-pdf', component: () => null }, data: {} })).rejects.toThrow('renderer failed')
  })
})
