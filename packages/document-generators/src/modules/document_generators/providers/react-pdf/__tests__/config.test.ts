import { DEFAULT_REACT_PDF_CONFIG, resolveReactPdfConfig } from '../config'

const withReactPdf = (config?: Record<string, unknown>) => ({ providers: [{ id: 'react-pdf', ...(config ? { config } : {}) }] })

describe('resolveReactPdfConfig', () => {
  it('returns the React-PDF defaults when the provider is not listed or has no config', () => {
    expect(resolveReactPdfConfig({ providers: [] })).toEqual(DEFAULT_REACT_PDF_CONFIG)
    expect(resolveReactPdfConfig({ providers: [{ id: 'docx', config: { fonts: 'ignored' } }] })).toEqual({ fonts: [] })
    expect(resolveReactPdfConfig(withReactPdf())).toEqual({ fonts: [] })
  })

  it('merges a valid provider config over the defaults', () => {
    const fonts = [{ family: 'Inter', sources: [{ package: '@fontsource/inter', file: 'files/inter-latin-400-normal.woff', fontWeight: 400 }] }]
    expect(resolveReactPdfConfig(withReactPdf({ fonts }))).toEqual({ fonts })
    expect(resolveReactPdfConfig(withReactPdf({ fontFamily: 'Times-Roman' }))).toEqual({ fontFamily: 'Times-Roman', fonts: [] })
  })

  it('accepts a fontFamily that names listed families or standard PDF fonts', () => {
    const fonts = [{ family: 'Brand', sources: [{ package: '@acme/fonts', file: 'Brand.ttf' }] }]
    expect(resolveReactPdfConfig(withReactPdf({ fonts, fontFamily: ['Brand', 'Helvetica'] }))).toEqual({ fonts, fontFamily: ['Brand', 'Helvetica'] })
    expect(resolveReactPdfConfig(withReactPdf({ fontFamily: 'Courier' }))).toEqual({ fonts: [], fontFamily: 'Courier' })
  })

  it.each([
    ['an unknown key', { font: 'Inter' }, 'font'],
    ['a relative path', { fonts: [{ family: 'Brand', sources: [{ path: 'fonts/Brand.ttf' }] }] }, 'fonts.0.sources.0'],
    ['a package file escaping the package', { fonts: [{ family: 'Brand', sources: [{ package: 'x', file: '../secret.ttf' }] }] }, 'fonts.0.sources.0'],
    ['a WOFF2 package file', { fonts: [{ family: 'Inter', sources: [{ package: '@fontsource/inter', file: 'files/inter-latin-400-normal.woff2' }] }] }, 'WOFF2 fonts cannot be embedded by React-PDF'],
    ['a WOFF2 path', { fonts: [{ family: 'Brand', sources: [{ path: '/fonts/Brand.WOFF2' }] }] }, 'WOFF2 fonts cannot be embedded by React-PDF'],
    ['a WOFF2 url', { fonts: [{ family: 'Brand', sources: [{ url: 'https://cdn.example.test/Brand.woff2?v=1' }] }] }, 'WOFF2 fonts cannot be embedded by React-PDF'],
    ['a package name escaping node_modules', { fonts: [{ family: 'Brand', sources: [{ package: '../../etc', file: 'Brand.ttf' }] }] }, 'fonts.0.sources.0'],
    ['a package name that is not an npm name', { fonts: [{ family: 'Brand', sources: [{ package: 'Font Pack', file: 'Brand.ttf' }] }] }, 'fonts.0.sources.0'],
    ['a fontFamily that is neither listed nor standard', { fontFamily: 'Intre' }, 'font family "Intre" is neither listed in fonts nor a standard PDF font'],
    ['a fontFamily list with an unknown name', { fonts: [{ family: 'Brand', sources: [{ path: '/fonts/Brand.ttf' }] }], fontFamily: ['Brand', 'Intre'] }, '"Intre"'],
  ])('throws a descriptive error for %s', (_label, config, detail) => {
    const moduleConfig = withReactPdf(config)
    expect(() => resolveReactPdfConfig(moduleConfig)).toThrow('Invalid "react-pdf" provider config')
    expect(() => resolveReactPdfConfig(moduleConfig)).toThrow(detail)
  })

  it('validates one provider config object once and reuses the result', () => {
    const moduleConfig = withReactPdf({ fonts: [{ family: 'Brand', sources: [{ path: '/fonts/Brand.ttf' }] }] })
    expect(resolveReactPdfConfig(moduleConfig).fonts).toBe(resolveReactPdfConfig(moduleConfig).fonts)
  })
})
