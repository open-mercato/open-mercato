import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import enDictionary from '../../i18n/en.json'
import plDictionary from '../../i18n/pl.json'
import { captureSchema, createSessionSchema, refundSchema } from '../../data/validators'
import { buildInvalidPayloadBody, findAmountPrecisionError } from '../amount-precision'

const mockResolveTranslations = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: () => mockResolveTranslations(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const scope = { organizationId: 'org_1', tenantId: 'tenant_1' }

function makeContainer(decimalPlaces: number | null | undefined) {
  return {
    resolve<T = unknown>(name: string): T {
      if (name === 'currencyPrecisionService' && decimalPlaces !== undefined) {
        return { getDecimalPlaces: async () => decimalPlaces } as T
      }
      throw new Error(`[internal] unexpected resolve ${name}`)
    },
  }
}

describe('payment amount precision', () => {
  beforeEach(() => {
    mockResolveTranslations.mockResolvedValue({ translate: createFallbackTranslator(enDictionary) })
  })

  afterEach(() => {
    mockResolveTranslations.mockReset()
  })

  it('rejects an amount with more decimals than the currency has', async () => {
    await expect(findAmountPrecisionError(makeContainer(undefined), { amount: '10.005', currencyCode: 'usd', scope }))
      .resolves.toEqual({ error: 'Amount 10.005 has more decimal places than USD supports (2)' })
  })

  it('accepts amounts within the currency decimals, ignoring trailing zeros', async () => {
    const container = makeContainer(undefined)
    await expect(findAmountPrecisionError(container, { amount: '10.05', currencyCode: 'USD', scope })).resolves.toBeNull()
    await expect(findAmountPrecisionError(container, { amount: '10.0500', currencyCode: 'USD', scope })).resolves.toBeNull()
    await expect(findAmountPrecisionError(container, { amount: 1000, currencyCode: 'JPY', scope })).resolves.toBeNull()
  })

  it('rejects fractional amounts for a zero-decimal currency', async () => {
    await expect(findAmountPrecisionError(makeContainer(undefined), { amount: '1000.5', currencyCode: 'JPY', scope }))
      .resolves.toEqual({ error: 'Amount 1000.5 has more decimal places than JPY supports (0)' })
  })

  it('caps a tenant currency precision above the ISO minor unit at the ISO digits', async () => {
    const container = makeContainer(4)
    await expect(findAmountPrecisionError(container, { amount: '10.01', currencyCode: 'USD', scope })).resolves.toBeNull()
    await expect(findAmountPrecisionError(container, { amount: '10.0051', currencyCode: 'USD', scope }))
      .resolves.toEqual({ error: 'Amount 10.0051 has more decimal places than USD supports (2)' })
  })

  it('applies a tenant currency precision below the ISO minor unit', async () => {
    const container = makeContainer(0)
    await expect(findAmountPrecisionError(container, { amount: '10', currencyCode: 'USD', scope })).resolves.toBeNull()
    await expect(findAmountPrecisionError(container, { amount: '10.5', currencyCode: 'USD', scope }))
      .resolves.toMatchObject({ error: expect.stringContaining('(0)') })
  })

  it('uses the tenant currency precision for a non-ISO currency', async () => {
    const container = makeContainer(8)
    await expect(findAmountPrecisionError(container, { amount: '0.12345678', currencyCode: 'BTC', scope })).resolves.toBeNull()
    await expect(findAmountPrecisionError(container, { amount: '0.123456789', currencyCode: 'BTC', scope }))
      .resolves.toMatchObject({ error: expect.stringContaining('(8)') })
  })

  it('skips the check when the currency precision is unknown', async () => {
    await expect(findAmountPrecisionError(makeContainer(null), { amount: '1.123456', currencyCode: '1$X', scope }))
      .resolves.toBeNull()
    await expect(findAmountPrecisionError(makeContainer(undefined), { amount: '1.123456', currencyCode: null, scope }))
      .resolves.toBeNull()
  })

  it('serves the precision error from the request dictionary', async () => {
    mockResolveTranslations.mockResolvedValue({ translate: createFallbackTranslator(plDictionary) })
    await expect(findAmountPrecisionError(makeContainer(undefined), { amount: '10.005', currencyCode: 'USD', scope }))
      .resolves.toEqual({ error: 'Kwota 10.005 ma więcej miejsc po przecinku, niż obsługuje waluta USD (2)' })
  })

  it('rejects session, capture and refund amounts beyond the decimal size caps', () => {
    const transactionId = '11111111-1111-4111-8111-111111111111'
    for (const amount of [1e305, '1e305', `0.${'1'.repeat(1001)}`]) {
      expect(createSessionSchema.safeParse({ providerKey: 'mock', amount, currencyCode: 'USD' }).success).toBe(false)
      expect(captureSchema.safeParse({ transactionId, amount }).success).toBe(false)
      expect(refundSchema.safeParse({ transactionId, amount }).success).toBe(false)
    }
  })

  it('rejects session, capture and refund amounts whose positive float copy is zero', () => {
    const amount = '1e-400'
    const transactionId = '11111111-1111-4111-8111-111111111111'

    expect(createSessionSchema.safeParse({ providerKey: 'mock', amount, currencyCode: 'USD' }).success).toBe(false)
    expect(captureSchema.safeParse({ transactionId, amount }).success).toBe(false)
    expect(refundSchema.safeParse({ transactionId, amount }).success).toBe(false)
  })

  it('translates validator message keys in the invalid-payload body', async () => {
    mockResolveTranslations.mockResolvedValue({ translate: createFallbackTranslator(plDictionary) })
    const parsed = createSessionSchema.safeParse({ providerKey: 'mock', amount: '0', currencyCode: 'USD' })
    if (parsed.success) throw new Error('[internal] expected a validation failure')

    const body = await buildInvalidPayloadBody(parsed.error)

    expect(body).toMatchObject({
      error: 'Invalid payload',
      details: { fieldErrors: { amount: ['Kwota musi być większa od zera'] } },
    })
  })
})
