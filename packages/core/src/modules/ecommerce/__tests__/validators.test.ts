import {
  ECOMMERCE_BRANDING_FONTS,
  ecommerceAssortmentScopeSchema,
  ecommerceStoreBrandingSchema,
  ecommerceStoreChannelBindingCreateSchema,
  ecommerceStoreChannelBindingUpdateSchema,
  ecommerceStoreCreateSchema,
  ecommerceStoreDomainBindingCreateSchema,
  ecommerceStoreSettingsPatchSchema,
  ecommerceStoreSettingsSchema,
  ecommerceStoreUpdateSchema,
  isValidBrandingColor,
  isValidBorderRadius,
  normalizePathPrefix,
} from '../data/validators'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const storeId = '33333333-3333-4333-8333-333333333333'
const otherId = '44444444-4444-4444-8444-444444444444'

const validStore = {
  tenantId,
  organizationId,
  code: 'main_store',
  name: 'Main store',
  slug: 'main-store',
  defaultLocale: 'en',
  supportedLocales: ['en', 'pl'],
  defaultCurrencyCode: 'EUR',
}

const injectionPayloads = [
  'red; } body { background: url(https://evil/) } :root {',
  '#fff;}',
  'oklch(1 0 0);x',
  'oklch(1 0 0) } body { color: red',
  'red',
  'rgb(0, 0, 0)',
  'url(https://evil/)',
  'var(--primary)',
  'expression(alert(1))',
  '#ff',
  '#ggg',
  '#fffff',
  '#fffffffff',
  'oklch(1 0 0',
  'oklch(-0.1 0 0)',
  'oklch(1.2 0 0)',
  'oklch(0.5 0.9 0)',
  'oklch(0.5 0.1 400)',
  'oklch(0.5 0.1 120 / 2)',
  'oklch(0.5,0.1,120)',
  'OKLCH(0.5 0.1 120)',
  'oklch(0.5 0.1 120)\n}',
  '</style><script>alert(1)</script>',
]

describe('ecommerce store validators', () => {
  it('accepts a minimal store and applies defaults', () => {
    const parsed = ecommerceStoreCreateSchema.parse(validStore)
    expect(parsed.status).toBe('draft')
    expect(parsed.isPrimary).toBe(false)
    expect(parsed.settings.display).toEqual({ priceDisplayModeDefault: 'gross', enableSearch: true })
    expect(parsed.settings.branding).toEqual({})
  })

  it('rejects a default locale outside the supported locales with a field-level error', () => {
    const result = ecommerceStoreCreateSchema.safeParse({ ...validStore, defaultLocale: 'de' })
    expect(result.success).toBe(false)
    const issue = result.error?.issues.find((entry) => entry.path.join('.') === 'defaultLocale')
    expect(issue?.message).toBe('ecommerce.validation.defaultLocaleNotSupported')
  })

  it('applies the locale rule on update only when both fields are present', () => {
    expect(ecommerceStoreUpdateSchema.safeParse({ id: storeId, defaultLocale: 'de' }).success).toBe(true)
    const result = ecommerceStoreUpdateSchema.safeParse({ id: storeId, defaultLocale: 'en', supportedLocales: ['pl'] })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['defaultLocale'])
  })

  it('rejects empty or duplicated supported locales', () => {
    expect(ecommerceStoreCreateSchema.safeParse({ ...validStore, supportedLocales: [] }).success).toBe(false)
    expect(ecommerceStoreCreateSchema.safeParse({ ...validStore, supportedLocales: ['en', 'en'] }).success).toBe(false)
  })

  it('validates code, slug and currency formats', () => {
    expect(ecommerceStoreCreateSchema.safeParse({ ...validStore, code: 'Main Store' }).success).toBe(false)
    expect(ecommerceStoreCreateSchema.safeParse({ ...validStore, slug: 'main_store' }).success).toBe(false)
    expect(ecommerceStoreCreateSchema.safeParse({ ...validStore, slug: 'main--store' }).success).toBe(false)
    expect(ecommerceStoreCreateSchema.safeParse({ ...validStore, slug: 'shop/../admin' }).success).toBe(false)
    expect(ecommerceStoreCreateSchema.safeParse({ ...validStore, defaultCurrencyCode: 'eur' }).success).toBe(false)
    expect(ecommerceStoreCreateSchema.safeParse({ ...validStore, defaultCurrencyCode: 'EURO' }).success).toBe(false)
    expect(ecommerceStoreCreateSchema.safeParse({ ...validStore, status: 'published' }).success).toBe(false)
  })

  it('rejects unknown top-level store keys', () => {
    expect(ecommerceStoreCreateSchema.safeParse({ ...validStore, requireAuthentication: true }).success).toBe(false)
  })
})

describe('ecommerce store settings schema', () => {
  it('rejects unknown keys at every level', () => {
    expect(ecommerceStoreSettingsSchema.safeParse({ features: { enableReviews: true } }).success).toBe(false)
    expect(ecommerceStoreSettingsSchema.safeParse({ branding: { logo: 'x' } }).success).toBe(false)
    expect(ecommerceStoreSettingsSchema.safeParse({ contact: { fax: '1' } }).success).toBe(false)
    expect(ecommerceStoreSettingsSchema.safeParse({ seo: { keywords: 'a' } }).success).toBe(false)
    expect(ecommerceStoreSettingsPatchSchema.safeParse({ other: {} }).success).toBe(false)
  })

  it('does not accept availability defaults in display (D12)', () => {
    expect(ecommerceStoreSettingsSchema.safeParse({ display: { showOutOfStock: true } }).success).toBe(false)
    expect(ecommerceStoreSettingsSchema.safeParse({ display: { allowBackorder: true } }).success).toBe(false)
  })

  it('leaves omitted sections untouched in a patch', () => {
    expect(ecommerceStoreSettingsPatchSchema.parse({ display: { enableSearch: false } })).toEqual({
      display: { enableSearch: false },
    })
  })

  it('accepts OKLCH and hex colours', () => {
    for (const value of [
      'oklch(0.3 0.15 270)',
      'oklch(0.205 0 0)',
      'oklch(1 0 0)',
      'oklch(50% 0.2 120deg)',
      'oklch(0.5 40% 360)',
      'oklch(0.5 0.1 120 / 0.5)',
      'oklch(.5 .1 120/50%)',
      '#fff',
      '#1A2b3C',
      '#1a2b3c80',
    ]) {
      expect(isValidBrandingColor(value)).toBe(true)
      expect(ecommerceStoreBrandingSchema.safeParse({ primaryColor: value }).success).toBe(true)
    }
  })

  it('rejects malformed and injection colour payloads', () => {
    for (const payload of injectionPayloads) {
      const result = ecommerceStoreBrandingSchema.safeParse({ primaryColor: payload })
      expect({ payload, success: result.success }).toEqual({ payload, success: false })
    }
  })

  it('rejects injection payloads in every colour field', () => {
    const fields = [
      'primaryColor',
      'primaryForeground',
      'accentColor',
      'accentForeground',
      'backgroundColor',
      'foregroundColor',
    ]
    for (const field of fields) {
      const result = ecommerceStoreBrandingSchema.safeParse({ [field]: injectionPayloads[0] })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('ecommerce.validation.colorInvalid')
    }
  })

  it('restricts fonts to the allowlist', () => {
    const allowed = ECOMMERCE_BRANDING_FONTS[0].id
    expect(ecommerceStoreBrandingSchema.safeParse({ fontFamilyBase: allowed }).success).toBe(true)
    for (const font of ['Comic Sans MS', "'Inter', sans-serif", "x; } body { font-family: url(https://evil/)"]) {
      const result = ecommerceStoreBrandingSchema.safeParse({ fontFamilyHeading: font })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('ecommerce.validation.fontNotAllowed')
    }
  })

  it('exposes only safe font ids and stacks', () => {
    for (const font of ECOMMERCE_BRANDING_FONTS) {
      expect(font.id).toMatch(/^[a-z0-9-]+$/)
      expect(font.stack).not.toMatch(/[;{}<>()\\]/)
    }
  })

  it('restricts borderRadius to bounded rem/px values', () => {
    for (const value of ['0', '0.625rem', '.5rem', '8px', '5rem', '80px']) {
      expect(isValidBorderRadius(value)).toBe(true)
    }
    for (const value of ['6rem', '81px', '1em', '-1px', '1rem;}', 'calc(1px + 1rem)', '1 rem', 'rem']) {
      expect(isValidBorderRadius(value)).toBe(false)
      expect(ecommerceStoreBrandingSchema.safeParse({ borderRadius: value }).success).toBe(false)
    }
  })

  it('rejects script URLs for logo and favicon', () => {
    expect(ecommerceStoreBrandingSchema.safeParse({ logoUrl: 'https://cdn.example.com/logo.png' }).success).toBe(true)
    expect(ecommerceStoreBrandingSchema.safeParse({ faviconUrl: '/api/attachments/file/abc' }).success).toBe(true)
    expect(ecommerceStoreBrandingSchema.safeParse({ logoUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(ecommerceStoreBrandingSchema.safeParse({ logoUrl: '//evil.example.com/x.png' }).success).toBe(false)
    expect(ecommerceStoreBrandingSchema.parse({ logoUrl: '' })).toEqual({ logoUrl: null })
  })
})

describe('ecommerce domain binding validators', () => {
  it('normalizes the path prefix', () => {
    expect(normalizePathPrefix('Shop/')).toBe('/shop')
    expect(normalizePathPrefix('/B2B/Wholesale//')).toBe('/b2b/wholesale')
    expect(normalizePathPrefix('  /shop  ')).toBe('/shop')
    expect(normalizePathPrefix('/')).toBeNull()
    expect(normalizePathPrefix('')).toBeNull()
    expect(normalizePathPrefix(null)).toBeNull()
  })

  it('stores the normalized prefix and rejects unsafe characters', () => {
    const base = { tenantId, organizationId, storeId, domainMappingId: otherId }
    expect(ecommerceStoreDomainBindingCreateSchema.parse({ ...base, pathPrefix: 'Shop/' })).toMatchObject({
      pathPrefix: '/shop',
      isPrimary: false,
    })
    expect(ecommerceStoreDomainBindingCreateSchema.parse({ ...base, pathPrefix: '/' }).pathPrefix).toBeNull()
    for (const prefix of ['/shop?x=1', '/shop.html', '/sh op', '/shop//sale', '/../admin', '/shop_eu']) {
      expect(ecommerceStoreDomainBindingCreateSchema.safeParse({ ...base, pathPrefix: prefix }).success).toBe(false)
    }
  })
})

describe('ecommerce channel binding validators', () => {
  const base = { tenantId, organizationId, storeId, salesChannelId: otherId }

  it('defaults price sort fallback and is_default', () => {
    expect(ecommerceStoreChannelBindingCreateSchema.parse(base)).toMatchObject({
      priceSortFallback: 'approximate',
      isDefault: false,
    })
  })

  it('accepts only the price sort fallback enum values', () => {
    expect(ecommerceStoreChannelBindingCreateSchema.safeParse({ ...base, priceSortFallback: 'unavailable' }).success).toBe(true)
    expect(ecommerceStoreChannelBindingCreateSchema.safeParse({ ...base, priceSortFallback: 'exact' }).success).toBe(false)
    expect(ecommerceStoreChannelBindingUpdateSchema.safeParse({ id: storeId, priceSortFallback: 'none' }).success).toBe(false)
  })

  it('accepts a strict assortment scope and null', () => {
    expect(ecommerceAssortmentScopeSchema.parse(null)).toBeNull()
    expect(
      ecommerceStoreChannelBindingCreateSchema.safeParse({
        ...base,
        assortmentScope: { categoryIds: [otherId], excludeTagIds: [storeId] },
      }).success,
    ).toBe(true)
  })

  it('rejects allOf, unknown keys and non-uuid ids in the assortment scope', () => {
    expect(ecommerceAssortmentScopeSchema.safeParse({ allOf: [{ categoryIds: [otherId] }] }).success).toBe(false)
    expect(ecommerceAssortmentScopeSchema.safeParse({ productIds: [otherId] }).success).toBe(false)
    expect(ecommerceAssortmentScopeSchema.safeParse({ categoryIds: ['not-a-uuid'] }).success).toBe(false)
    expect(
      ecommerceStoreChannelBindingCreateSchema.safeParse({ ...base, assortmentScope: { allOf: [] } }).success,
    ).toBe(false)
  })
})
