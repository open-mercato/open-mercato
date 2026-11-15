import {
  createLinkSchema,
  createTemplateSchema,
  publicSubmitSchema,
  updateLinkSchema,
  updateTemplateSchema,
} from '../validators'

const TEMPLATE_ID = '020b29c5-db01-4ee3-8080-1d9b185c5e29'

describe('checkout validators', () => {
  test.each(['not-an-address', 'buyer@example.com\r\nBcc: victim@example.com', ['buyer@example.com'], 123])('rejects invalid submitted email %p even without a field schema', (email) => {
    expect(publicSubmitSchema.safeParse({ customerData: { email } }).success).toBe(false)
  })

  test.each(['firstName', 'lastName'])('bounds submitted %s at 100 characters', (key) => {
    expect(publicSubmitSchema.safeParse({ customerData: { [key]: 'a'.repeat(101) } }).success).toBe(false)
    expect(publicSubmitSchema.safeParse({ customerData: { [key]: 'a'.repeat(100) } }).success).toBe(true)
  })

  test('normalizes payer details while retaining custom fields for the link-specific allowlist', () => {
    expect(publicSubmitSchema.parse({ customerData: {
      email: ' buyer@example.com ', firstName: ' Buyer ', custom: true,
    } }).customerData).toEqual({ email: 'buyer@example.com', firstName: 'Buyer', custom: true })
    expect(publicSubmitSchema.parse({ customerData: { email: ' ' } }).customerData.email).toBeNull()
  })
  test('createTemplateSchema accepts payloads that omit optional normalized fields', () => {
    const result = createTemplateSchema.parse({
      name: 'QA template',
      pricingMode: 'fixed',
      fixedPriceAmount: 49.99,
      fixedPriceCurrencyCode: 'USD',
      gatewayProviderKey: 'mock',
    })

    expect(result.logoUrl).toBeUndefined()
    expect(result.customFieldsetCode).toBeUndefined()
    expect(result.successTitle).toBeUndefined()
    expect(result.password).toBeUndefined()
  })

  test('createLinkSchema accepts payloads that omit optional normalized fields including slug', () => {
    const result = createLinkSchema.parse({
      name: 'QA link',
      pricingMode: 'fixed',
      fixedPriceAmount: 49.99,
      fixedPriceCurrencyCode: 'USD',
      gatewayProviderKey: 'mock',
    })

    expect(result.logoUrl).toBeUndefined()
    expect(result.slug).toBeUndefined()
    expect(result.password).toBeUndefined()
  })

  test('createLinkSchema normalizes blank optional strings after zod preprocessing', () => {
    const result = createLinkSchema.parse({
      name: 'QA link',
      pricingMode: 'fixed',
      fixedPriceAmount: 49.99,
      fixedPriceCurrencyCode: 'USD',
      gatewayProviderKey: 'mock',
      slug: '   ',
      password: '',
    })

    expect(result.slug).toBeNull()
    expect(result.password).toBeNull()
  })

  test('updateTemplateSchema rejects a cleared gatewayProviderKey', () => {
    expect(() =>
      updateTemplateSchema.parse({
        id: TEMPLATE_ID,
        name: 'Consulting Fee',
        pricingMode: 'fixed',
        fixedPriceAmount: 49.99,
        fixedPriceCurrencyCode: 'USD',
        gatewayProviderKey: null,
      }),
    ).toThrow()

    expect(() =>
      updateTemplateSchema.parse({
        id: TEMPLATE_ID,
        name: 'Consulting Fee',
        pricingMode: 'fixed',
        fixedPriceAmount: 49.99,
        fixedPriceCurrencyCode: 'USD',
        gatewayProviderKey: '   ',
      }),
    ).toThrow()
  })

  test('updateTemplateSchema accepts edits that omit gatewayProviderKey', () => {
    const result = updateTemplateSchema.parse({
      id: TEMPLATE_ID,
      name: 'Consulting Fee renamed',
    })

    expect(Object.prototype.hasOwnProperty.call(result, 'gatewayProviderKey')).toBe(false)
  })

  test('updateLinkSchema accepts a null gatewayProviderKey (issue #2505)', () => {
    const result = updateLinkSchema.parse({
      id: TEMPLATE_ID,
      name: 'Consulting Fee link',
      pricingMode: 'fixed',
      fixedPriceAmount: 49.99,
      fixedPriceCurrencyCode: 'USD',
      gatewayProviderKey: null,
    })

    expect(result.gatewayProviderKey).toBeNull()
  })

  test.each([
    ['updateLinkSchema', updateLinkSchema],
    ['updateTemplateSchema', updateTemplateSchema],
  ])('%s leaves omitted defaulted fields out of a partial update (issue #7127)', (_name, schema) => {
    const result = schema.parse({ id: TEMPLATE_ID, logoAttachmentId: null })

    expect(result).toStrictEqual({ id: TEMPLATE_ID, logoAttachmentId: null })
  })

  test.each([
    ['updateLinkSchema', updateLinkSchema],
    ['updateTemplateSchema', updateTemplateSchema],
  ])('%s still honours explicitly sent defaulted fields', (_name, schema) => {
    const result = schema.parse({ id: TEMPLATE_ID, themeMode: 'dark', sendStartEmail: false })

    expect(result).toStrictEqual({ id: TEMPLATE_ID, themeMode: 'dark', sendStartEmail: false })
  })

  test('createTemplateSchema still rejects a null gatewayProviderKey', () => {
    expect(() =>
      createTemplateSchema.parse({
        name: 'QA template',
        pricingMode: 'fixed',
        fixedPriceAmount: 49.99,
        fixedPriceCurrencyCode: 'USD',
        gatewayProviderKey: null,
      }),
    ).toThrow()
  })
})
