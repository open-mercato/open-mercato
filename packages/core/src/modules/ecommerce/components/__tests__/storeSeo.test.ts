import { ecommerceStoreSettingsPatchSchema } from '../../data/validators'
import {
  STORE_SEO_FIELD_LIMITS,
  buildStoreSeoInitialValues,
  buildStoreSeoPayload,
  remapStoreSeoFieldErrors,
  storeSeoFormSchema,
} from '../storeSeo'

const emptyValues = { siteName: '', defaultMetaDescription: '', googleSiteVerification: '', robotsTxt: '' }

describe('store SEO form helpers', () => {
  it('omits cleared and whitespace-only fields from the payload', () => {
    const payload = buildStoreSeoPayload('store-1', {
      siteName: 'Shop',
      defaultMetaDescription: '',
      googleSiteVerification: '  ',
      robotsTxt: '',
    })
    expect(payload).toEqual({ id: 'store-1', settings: { seo: { siteName: 'Shop' } } })
    expect('defaultMetaDescription' in payload.settings.seo).toBe(false)
  })

  it('sends only the seo subtree', () => {
    expect(Object.keys(buildStoreSeoPayload('store-1', emptyValues).settings)).toEqual(['seo'])
  })

  it('builds a payload the real settings patch schema accepts, including a fully cleared form', () => {
    const filled = buildStoreSeoPayload('store-1', {
      siteName: ' My Store ',
      defaultMetaDescription: 'Shop the best products',
      googleSiteVerification: 'abc_123-XYZ',
      robotsTxt: 'User-agent: *\nDisallow: /admin\n',
    })
    const parsedFilled = ecommerceStoreSettingsPatchSchema.safeParse(filled.settings)
    expect(parsedFilled.success).toBe(true)
    expect(parsedFilled.success && parsedFilled.data.seo?.siteName).toBe('My Store')

    const cleared = ecommerceStoreSettingsPatchSchema.safeParse(buildStoreSeoPayload('store-1', emptyValues).settings)
    expect(cleared.success).toBe(true)
    expect(cleared.success && cleared.data.seo).toEqual({})
  })

  it('reads initial values with a safe parse and falls back to empty strings', () => {
    expect(buildStoreSeoInitialValues({ settings: { seo: { siteName: 'Shop', robotsTxt: 'x' } } })).toEqual({
      siteName: 'Shop',
      defaultMetaDescription: '',
      googleSiteVerification: '',
      robotsTxt: 'x',
    })
    expect(buildStoreSeoInitialValues({ settings: { seo: 'garbage' } })).toEqual(emptyValues)
    expect(buildStoreSeoInitialValues({ settings: { seo: { unknown: 1 } } })).toEqual(emptyValues)
    expect(buildStoreSeoInitialValues({ settings: null })).toEqual(emptyValues)
    expect(buildStoreSeoInitialValues({})).toEqual(emptyValues)
  })

  it('exposes the server limits', () => {
    expect(STORE_SEO_FIELD_LIMITS).toEqual({
      siteName: 200,
      defaultMetaDescription: 500,
      googleSiteVerification: 128,
      robotsTxt: 10000,
    })
  })

  describe('client validation matches the server rules', () => {
    const paths = (values: Record<string, string>) => {
      const result = storeSeoFormSchema.safeParse(values)
      return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
    }

    it('accepts empty values and values at the limit', () => {
      expect(paths(emptyValues)).toEqual([])
      expect(
        paths({
          siteName: 'a'.repeat(200),
          defaultMetaDescription: 'a'.repeat(500),
          googleSiteVerification: 'a'.repeat(128),
          robotsTxt: 'a'.repeat(10000),
        }),
      ).toEqual([])
    })

    it('rejects values over the server limits', () => {
      expect(paths({ ...emptyValues, siteName: 'a'.repeat(201) })).toEqual(['siteName'])
      expect(paths({ ...emptyValues, defaultMetaDescription: 'a'.repeat(501) })).toEqual(['defaultMetaDescription'])
      expect(paths({ ...emptyValues, robotsTxt: 'a'.repeat(10001) })).toEqual(['robotsTxt'])
    })

    it('rejects an invalid verification token with a translatable message', () => {
      const result = storeSeoFormSchema.safeParse({ ...emptyValues, googleSiteVerification: 'not a token!' })
      expect(result.success).toBe(false)
      expect(!result.success && result.error.issues[0]).toMatchObject({
        path: ['googleSiteVerification'],
        message: 'ecommerce.validation.googleSiteVerificationInvalid',
      })
      expect(paths({ ...emptyValues, googleSiteVerification: 'a'.repeat(129) })).toEqual(['googleSiteVerification'])
    })
  })

  it('remaps settings.seo.<key> field errors and leaves other keys alone', () => {
    expect(remapStoreSeoFieldErrors({ 'settings.seo.siteName': 'a', name: 'b' })).toEqual({ siteName: 'a', name: 'b' })
    expect(remapStoreSeoFieldErrors(undefined)).toBeUndefined()
  })
})
