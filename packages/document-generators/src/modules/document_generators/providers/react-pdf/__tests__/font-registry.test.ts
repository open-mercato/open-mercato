import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PdfFontRegistry } from '../font-registry'
import { DEFAULT_REACT_PDF_CONFIG, type ResolvedReactPdfConfig } from '../config'

const mockRegisterFont = jest.fn()
jest.mock('@react-pdf/renderer', () => ({
  Font: { register: (...args: unknown[]) => mockRegisterFont(...args) },
}))

let directory: string
let brandFont: string

beforeAll(() => {
  directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'om-pdf-fonts-')))
  brandFont = path.join(directory, 'Brand.ttf')
  writeFileSync(brandFont, 'font')
})

afterAll(() => rmSync(directory, { recursive: true, force: true }))

beforeEach(() => jest.clearAllMocks())

const config = (overrides: Partial<ResolvedReactPdfConfig> = {}): ResolvedReactPdfConfig => ({
  ...DEFAULT_REACT_PDF_CONFIG,
  ...overrides,
})

const brand = (overrides: Partial<ResolvedReactPdfConfig> = {}) =>
  config({ fonts: [{ family: 'Brand', sources: [{ path: brandFont, fontWeight: 400 }] }], ...overrides })

describe('PdfFontRegistry.applyConfig', () => {
  it('uses Helvetica when no font is configured', () => {
    const registry = new PdfFontRegistry()
    expect(registry.fontFamily).toBe('Helvetica')
    expect(registry.applyConfig(config())).toBe('Helvetica')
    expect(mockRegisterFont).not.toHaveBeenCalled()
  })

  it('honours a standard family without registering anything', () => {
    const registry = new PdfFontRegistry()
    expect(registry.applyConfig(config({ fontFamily: 'Times-Roman' }))).toBe('Times-Roman')
    expect(registry.fontFamily).toBe('Times-Roman')
    expect(mockRegisterFont).not.toHaveBeenCalled()
  })

  it('registers the configured fonts once and uses the registered families', () => {
    const registry = new PdfFontRegistry()
    expect(registry.applyConfig(brand())).toEqual(['Brand'])
    expect(registry.applyConfig(brand())).toEqual(['Brand'])
    expect(registry.fontFamily).toEqual(['Brand'])
    expect(mockRegisterFont).toHaveBeenCalledTimes(1)
    expect(mockRegisterFont).toHaveBeenCalledWith({ family: 'Brand', fonts: [{ src: brandFont, fontWeight: 400 }] })
  })

  it('returns an explicit fontFamily', () => {
    const registry = new PdfFontRegistry()
    expect(registry.applyConfig(brand({ fontFamily: ['Brand', 'Helvetica'] }))).toEqual(['Brand', 'Helvetica'])
  })

  it('does not register a family again when the font configuration changes at runtime', () => {
    const registry = new PdfFontRegistry()
    registry.applyConfig(brand())
    registry.applyConfig(brand({ fonts: [{ family: 'Brand', sources: [{ path: brandFont, fontWeight: 700 }] }] }))
    expect(mockRegisterFont).toHaveBeenCalledTimes(1)
  })

  it('throws an error naming the family when a font file is missing, on every call until it is fixed', () => {
    const registry = new PdfFontRegistry()
    const missing = config({ fonts: [{ family: 'Gone', sources: [{ package: '@fontsource/missing', file: 'files/a.woff' }] }] })
    expect(() => registry.applyConfig(missing)).toThrow('Cannot register the "react-pdf" provider font "Gone": Font file "files/a.woff" not found in package "@fontsource/missing"')
    expect(() => registry.applyConfig(missing)).toThrow('Cannot register the "react-pdf" provider font "Gone"')
    expect(mockRegisterFont).not.toHaveBeenCalled()
    expect(registry.fontFamily).toBe('Helvetica')
    expect(registry.applyConfig(brand())).toEqual(['Brand'])
  })

  it('registers only the families that are not registered yet', () => {
    const registry = new PdfFontRegistry()
    registry.applyConfig(brand())
    registry.applyConfig(config({ fonts: [
      { family: 'Brand', sources: [{ path: brandFont }] },
      { family: 'Second', sources: [{ path: brandFont }] },
    ] }))
    expect(mockRegisterFont).toHaveBeenCalledTimes(2)
    expect(mockRegisterFont).toHaveBeenLastCalledWith({ family: 'Second', fonts: [{ src: brandFont }] })
  })
})
