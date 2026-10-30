import { z } from 'zod'
import {
  assertExactCustomAmountRange,
  createLinkSchema,
  createTemplateSchema,
  priceListItemSchema,
  publicSubmitSchema,
  updateLinkSchema,
  updateTemplateSchema,
} from '../validators'

const TEMPLATE_ID = '020b29c5-db01-4ee3-8080-1d9b185c5e29'

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

  test('assertExactCustomAmountRange rejects a min above max that differs only beyond float precision', () => {
    let caught: unknown = null
    try {
      assertExactCustomAmountRange({
        pricingMode: 'custom_amount',
        customAmountMinExact: '1.000000000000000002',
        customAmountMaxExact: '1.000000000000000001',
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(z.ZodError)
    expect((caught as z.ZodError).issues).toEqual([
      expect.objectContaining({
        code: 'custom',
        message: 'checkout.validation.customAmount.range',
        path: ['customAmountMax'],
      }),
    ])
  })

  test('assertExactCustomAmountRange accepts ordered, equal, partial or non custom amount ranges', () => {
    expect(() => assertExactCustomAmountRange({
      pricingMode: 'custom_amount',
      customAmountMinExact: '1.000000000000000001',
      customAmountMaxExact: '1.000000000000000002',
    })).not.toThrow()
    expect(() => assertExactCustomAmountRange({
      pricingMode: 'custom_amount',
      customAmountMinExact: '1.000000000000000001',
      customAmountMaxExact: '1.0000000000000000010',
    })).not.toThrow()
    expect(() => assertExactCustomAmountRange({
      pricingMode: 'custom_amount',
      customAmountMinExact: '1.000000000000000002',
    })).not.toThrow()
    expect(() => assertExactCustomAmountRange({
      pricingMode: 'fixed',
      customAmountMinExact: '1.000000000000000002',
      customAmountMaxExact: '1.000000000000000001',
    })).not.toThrow()
  })

  describe('money fields beyond the decimal size caps', () => {
    const oversizedValues = [1e305, '1e305', `0.${'1'.repeat(1001)}`]
    const fixedTemplate = {
      name: 'QA template',
      pricingMode: 'fixed' as const,
      fixedPriceCurrencyCode: 'USD',
      gatewayProviderKey: 'mock',
    }

    test.each(['fixedPriceAmount', 'fixedPriceOriginalAmount', 'customAmountMin', 'customAmountMax'] as const)(
      'createTemplateSchema rejects an oversized %s instead of storing 0',
      (field) => {
        for (const value of oversizedValues) {
          const result = createTemplateSchema.safeParse({ ...fixedTemplate, fixedPriceAmount: 10, [field]: value })
          expect(result.success).toBe(false)
          if (!result.success) {
            expect(result.error.issues).toEqual(expect.arrayContaining([
              expect.objectContaining({ path: [field], message: 'checkout.validation.common.invalidNumber' }),
            ]))
          }
        }
      },
    )

    test('priceListItemSchema rejects an oversized amount and keeps coercing in-range values', () => {
      const item = { id: 'general', description: 'General admission', currencyCode: 'USD' }
      for (const value of oversizedValues) {
        expect(priceListItemSchema.safeParse({ ...item, amount: value }).success).toBe(false)
      }
      expect(priceListItemSchema.parse({ ...item, amount: '25.125' }).amount).toBe(25.125)
      expect(priceListItemSchema.parse({ ...item, amount: null }).amount).toBe(0)
    })

    test('publicSubmitSchema rejects an oversized amount and keeps a null amount for fixed pricing', () => {
      for (const value of oversizedValues) {
        expect(publicSubmitSchema.safeParse({ customerData: {}, amount: value }).success).toBe(false)
      }
      expect(publicSubmitSchema.parse({ customerData: {}, amount: '12.5' }).amount).toBe(12.5)
      expect(publicSubmitSchema.parse({ customerData: {}, amount: null }).amount).toBe(0)
      expect(publicSubmitSchema.parse({ customerData: {} }).amount).toBeUndefined()
    })
  })
})
