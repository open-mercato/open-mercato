import { registerDefaultSalesProviders } from '../providers/defaultProviders'
import { getPaymentProvider, getShippingProvider } from '../providers/registry'
import type {
  PaymentProviderCalculateInput,
  ShippingMetrics,
  ShippingProviderCalculateInput,
} from '../providers/types'

function flatRateInput(settings: Record<string, unknown>, metrics: Partial<ShippingMetrics>): ShippingProviderCalculateInput {
  return {
    method: { code: 'standard', name: 'Standard', baseRateNet: 5, baseRateGross: 5 },
    settings,
    document: {} as ShippingProviderCalculateInput['document'],
    lines: [],
    context: { tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'USD' },
    metrics: { itemCount: 0, totalWeight: 0, totalVolume: 0, subtotalNet: 0, subtotalGross: 0, ...metrics },
  }
}

describe('flat-rate shipping provider settings', () => {
  beforeAll(() => registerDefaultSalesProviders())

  it('applies a rule saved by the admin UI with an empty max and gross', async () => {
    const provider = getShippingProvider('flat-rate')
    const result = await provider!.calculate!(
      flatRateInput(
        {
          applyBaseRate: false,
          rates: [{ id: 'r1', name: 'Bulk', metric: 'item_count', min: 3, max: null, amountNet: 12, amountGross: null }],
        },
        { itemCount: 5 },
      ),
    )

    expect(result?.adjustments).toHaveLength(1)
    expect(result?.adjustments[0]).toMatchObject({ amountNetExact: '12', amountGrossExact: '12', code: 'Bulk' })
  })

  it('keeps tier amounts exact beyond float precision', async () => {
    const provider = getShippingProvider('flat-rate')
    const result = await provider!.calculate!(
      flatRateInput(
        {
          applyBaseRate: false,
          rates: [{ metric: 'subtotal', min: '0', amountNet: '0.000000000000000001' }],
        },
        { subtotalGross: 1, subtotalGrossExact: '1' },
      ),
    )

    expect(result?.adjustments[0]?.amountNetExact).toBe('0.000000000000000001')
  })
})

function paymentInput(settings: Record<string, unknown>, grandTotalGrossAmountExact: string, amountDecimalPlaces?: number): PaymentProviderCalculateInput {
  return {
    method: { code: 'card', name: 'Card' },
    settings,
    document: { totals: { grandTotalGrossAmount: Number(grandTotalGrossAmountExact), grandTotalGrossAmountExact } } as PaymentProviderCalculateInput['document'],
    lines: [],
    context: { tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'USD', amountDecimalPlaces },
  }
}

describe('percentage payment fees', () => {
  beforeAll(() => registerDefaultSalesProviders())

  it('rounds the stripe fee to the amount precision', async () => {
    const result = await getPaymentProvider('stripe')!.calculate!(paymentInput({ applicationFeePercent: 2.9 }, '10.1234'))
    expect(result?.adjustments[0]).toMatchObject({ amountNetExact: '0.2936', amountGrossExact: '0.2936' })
  })

  it('rounds the cash on delivery fee to the currency precision', async () => {
    const result = await getPaymentProvider('cash-on-delivery')!.calculate!(
      paymentInput({ feePercent: 3, feeFlat: 0 }, '1.123456789012345678', 18),
    )
    expect(result?.adjustments[0]).toMatchObject({ amountNetExact: '0.03370370367037037' })
  })
})
