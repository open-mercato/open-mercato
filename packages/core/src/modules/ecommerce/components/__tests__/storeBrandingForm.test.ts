import { ECOMMERCE_BRANDING_DEFAULTS } from '../../lib/brandingStyles'
import {
  buildBrandingPreviewDocument,
  buildStoreBrandingInitialValues,
  buildStoreBrandingPayload,
  formatRadiusRem,
  parseRadiusRem,
  sanitizePreviewBranding,
  storeBrandingFormSchema,
} from '../storeBrandingForm'

const labels = {
  storeName: 'Main store',
  navShop: 'Shop',
  navCategories: 'Categories',
  navCart: 'Cart',
  heroTitle: 'Hero',
  heroText: 'Text',
  heroButton: 'Go',
  productName: 'Product',
  productPrice: '29.00 EUR',
}

describe('store branding form helpers', () => {
  it('prefills the documented defaults for unset fields and keeps stored values', () => {
    const values = buildStoreBrandingInitialValues({ settings: { branding: { primaryColor: '#112233', fontFamilyHeading: 'lato' } } })
    expect(values.primaryColor).toBe('#112233')
    expect(values.accentColor).toBe(ECOMMERCE_BRANDING_DEFAULTS.accentColor)
    expect(values.borderRadius).toBe(ECOMMERCE_BRANDING_DEFAULTS.borderRadius)
    expect(values.fontFamilyBase).toBe('inter')
    expect(values.fontFamilyHeading).toBe('lato')
    expect(values.logoUrl).toBe('')
    expect(buildStoreBrandingInitialValues({ settings: null }).primaryColor).toBe(ECOMMERCE_BRANDING_DEFAULTS.primaryColor)
  })

  it('sends stored keys and edited values but not untouched defaults', () => {
    const store = { settings: { branding: { primaryColor: '#112233', logoUrl: 'https://cdn.example.com/logo.png' } } }
    const values = { ...buildStoreBrandingInitialValues(store), accentColor: '#ff00aa' }
    expect(buildStoreBrandingPayload(values, store)).toEqual({
      primaryColor: '#112233',
      accentColor: '#ff00aa',
      logoUrl: 'https://cdn.example.com/logo.png',
    })
  })

  it('clears a stored key when its value is emptied and keeps a stored default-equal value', () => {
    const store = { settings: { branding: { borderRadius: '0.625rem', logoUrl: 'https://cdn.example.com/logo.png' } } }
    const values = { ...buildStoreBrandingInitialValues(store), logoUrl: '  ' }
    expect(buildStoreBrandingPayload(values, store)).toEqual({ borderRadius: '0.625rem' })
  })

  it('omits the heading font while it inherits the body font', () => {
    const values = buildStoreBrandingInitialValues({ settings: null })
    expect(buildStoreBrandingPayload(values, { settings: null })).toEqual({})
    expect(buildStoreBrandingPayload({ ...values, fontFamilyHeading: 'poppins' }, { settings: null })).toEqual({
      fontFamilyHeading: 'poppins',
    })
  })

  it('validates with the server rules and reports each rejected field', () => {
    const values = {
      ...buildStoreBrandingInitialValues({ settings: null }),
      primaryColor: 'red;}</style><script>alert(1)</script>',
      fontFamilyBase: 'comic-sans',
      borderRadius: '9rem',
      logoUrl: 'javascript:alert(1)',
    }
    const result = storeBrandingFormSchema.safeParse(values)
    expect(result.success).toBe(false)
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.')).sort((a, b) => a.localeCompare(b))
    expect(paths).toEqual(['borderRadius', 'fontFamilyBase', 'logoUrl', 'primaryColor'])
    expect(storeBrandingFormSchema.safeParse(buildStoreBrandingInitialValues({ settings: null })).success).toBe(true)
  })

  it('maps the radius slider between rem and the stored string', () => {
    expect(parseRadiusRem('0.625rem')).toBe(0.625)
    expect(parseRadiusRem('16px')).toBe(1)
    expect(parseRadiusRem('0')).toBe(0)
    expect(parseRadiusRem('80px')).toBe(5)
    expect(formatRadiusRem(0)).toBe('0')
    expect(formatRadiusRem(1.375)).toBe('1.375rem')
  })

  it('keeps only validated values in the sanitized preview branding', () => {
    const sanitized = sanitizePreviewBranding({
      primaryColor: 'OKLCH(0.5 0.1 200)',
      accentColor: 'url(javascript:alert(1))',
      borderRadius: '2rem;background:red',
      fontFamilyBase: 'poppins',
      fontFamilyHeading: 'not-a-font',
      logoUrl: 'javascript:alert(1)',
    })
    expect(sanitized).toEqual({ fontFamilyBase: 'poppins' })
    expect(sanitizePreviewBranding({ primaryColor: '#ABCDEF', logoUrl: 'https://cdn.example.com/a.png' })).toEqual({
      primaryColor: '#abcdef',
      logoUrl: 'https://cdn.example.com/a.png',
    })
  })

  it('renders a document where invalid input never appears and text is escaped', () => {
    const document = buildBrandingPreviewDocument(
      {
        primaryColor: 'red;}</style><script>alert(1)</script>',
        accentColor: '#112233',
        logoUrl: 'https://cdn.example.com/a.png" onerror="alert(1)',
      },
      { ...labels, storeName: '<img src=x onerror=alert(1)>' },
    )
    expect(document).not.toContain('<script')
    expect(document).not.toContain('alert(1)</style>')
    expect(document).not.toContain('<img src=x')
    expect(document).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(document).toContain(`--primary:${ECOMMERCE_BRANDING_DEFAULTS.primaryColor}`)
    expect(document).toContain('--accent:#112233')
    expect(document).not.toContain('<img src="https://cdn.example.com/a.png" onerror')
    expect(document).toContain("default-src 'none'")
  })
})
