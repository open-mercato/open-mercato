import { createElement } from 'react'
import { PdfRenderingService } from '../pdf-rendering-service'
import { DEFAULT_DOCUMENT_GENERATORS_CONFIG, type ResolvedDocumentGeneratorsConfig } from '../../../lib/module-config'
import { getPdfFontRegistry } from '../../../providers/react-pdf/font-registry'

const mockRegisterFont = jest.fn()
const mockWarn = jest.fn()
const mockRenderToBuffer = jest.fn(async (): Promise<Buffer> => Buffer.from('%PDF-1.3\nfixture'))
jest.mock('@react-pdf/renderer', () => ({
  renderToBuffer: () => mockRenderToBuffer(),
  Font: { register: (...args: unknown[]) => mockRegisterFont(...args) },
}))
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: (...args: unknown[]) => mockWarn(...args), info: jest.fn(), debug: jest.fn() }),
}))

const reactPdf = (config: Record<string, unknown>): { config: ResolvedDocumentGeneratorsConfig } => ({
  config: { providers: [{ id: 'react-pdf', config }] },
})
const defaults = { config: DEFAULT_DOCUMENT_GENERATORS_CONFIG }
const brand = reactPdf({ fonts: [{ family: 'Brand', sources: [{ path: __filename, fontWeight: 700 }] }] })
const pdf = (component: () => null = () => null, data: Record<string, unknown> = {}) => ({ format: 'pdf', source: { type: 'react-pdf', component }, data })

beforeEach(() => {
  mockRenderToBuffer.mockClear()
  mockRegisterFont.mockClear()
  mockWarn.mockClear()
})

describe('PdfRenderingService', () => {
  it('renders the source with Helvetica by default and returns PDF bytes and MIME metadata', async () => {
    const component = () => createElement('DOCUMENT')
    const result = await new PdfRenderingService().render({ format: 'pdf', source: { type: 'react-pdf', component }, data: { amount: 42 } }, defaults)
    expect(getPdfFontRegistry().fontFamily).toBe('Helvetica')
    expect(result).toMatchObject({ format: 'pdf', mimeType: 'application/pdf' })
    expect(Buffer.from(result.buffer).toString()).toContain('%PDF-')
  })

  it('rejects an incompatible source without invoking React-PDF', async () => {
    await expect(new PdfRenderingService().render({ format: 'pdf', source: { type: 'markdown' }, data: {} }, defaults)).rejects.toThrow('Invalid React-PDF')
    expect(mockRenderToBuffer).not.toHaveBeenCalled()
  })

  it('registers the configured fonts before rendering with them', async () => {
    await new PdfRenderingService().render(pdf(), brand)
    expect(mockRegisterFont).toHaveBeenCalledWith({ family: 'Brand', fonts: [{ src: __filename, fontWeight: 700 }] })
    expect(mockRegisterFont.mock.invocationCallOrder[0]).toBeLessThan(mockRenderToBuffer.mock.invocationCallOrder[0])
    expect(getPdfFontRegistry().fontFamily).toEqual(['Brand'])
  })

  it('propagates render failures unchanged when only standard fonts are in use', async () => {
    const failure = new Error('renderer failed')
    mockRenderToBuffer.mockRejectedValueOnce(failure)
    await expect(new PdfRenderingService().render(pdf(), defaults)).rejects.toBe(failure)
    expect(mockRenderToBuffer).toHaveBeenCalledTimes(1)
  })

  it('names the configured fonts when rendering with them fails, without retrying', async () => {
    mockRenderToBuffer.mockRejectedValueOnce(new RangeError('Offset is outside the bounds of the DataView'))
    await expect(new PdfRenderingService().render(pdf(), brand))
      .rejects.toThrow('PDF rendering failed with the "react-pdf" provider fonts Brand; a variable or corrupted font file cannot be embedded: Offset is outside the bounds of the DataView')
    expect(mockRenderToBuffer).toHaveBeenCalledTimes(1)
  })

  it('fails before rendering when the react-pdf config is invalid', async () => {
    await expect(new PdfRenderingService().render(pdf(), reactPdf({ fontFamily: 'Intre' }))).rejects.toThrow('Invalid "react-pdf" provider config')
    expect(mockRenderToBuffer).not.toHaveBeenCalled()
  })

  it('fails before rendering when a configured font file is missing', async () => {
    const missing = reactPdf({ fonts: [{ family: 'Gone', sources: [{ path: '/nowhere/Gone.ttf' }] }] })
    await expect(new PdfRenderingService().render(pdf(), missing)).rejects.toThrow('Cannot register the "react-pdf" provider font "Gone": Font file not found: /nowhere/Gone.ttf')
    expect(mockRenderToBuffer).not.toHaveBeenCalled()
  })

  it('warns once per process when Helvetica renders characters it cannot display', async () => {
    await new PdfRenderingService().render(pdf(undefined, { label: 'Do zapłaty' }), brand)
    await new PdfRenderingService().render(pdf(undefined, { label: 'Gesamtbetrag – Größe €' }), defaults)
    expect(mockWarn).not.toHaveBeenCalled()
    await new PdfRenderingService().render(pdf(undefined, { label: 'Do zapłaty' }), defaults)
    await new PdfRenderingService().render(pdf(undefined, { label: '청구 금액' }), defaults)
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })
})
