import { createLinkSchema, createTemplateSchema } from '../validators'

describe('checkout validators', () => {
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
})
