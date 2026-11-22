import { z } from 'zod'
import {
  DEFAULT_AMOUNT_DECIMAL_PLACES,
  FX_DECIMAL_PLACES,
  decimalToNumber,
  decimalToString,
  divideDecimals,
  nonNegativeDecimalStringSchema,
  resolveExactDecimal,
  roundDecimal,
  toDecimal,
  type DecimalValue,
} from '@open-mercato/shared/lib/decimal'
import {
  registerPaymentProvider,
  registerShippingProvider,
} from './registry'
import type {
  PaymentProvider,
  ProviderAdjustmentResult,
  ShippingMetrics,
  ShippingProvider,
} from './types'

let initialized = false

function exactOr(exact: unknown, legacy: unknown, fallback: DecimalValue): DecimalValue {
  const resolved = resolveExactDecimal(exact, legacy)
  return resolved === null ? fallback : toDecimal(resolved)
}

function percentOf(percent: number, value: DecimalValue): DecimalValue {
  return divideDecimals(percent, 100, FX_DECIMAL_PLACES).times(value)
}

function nonNegative(value: DecimalValue): DecimalValue {
  return value.lt(0) ? toDecimal(0) : value
}

function shippingAdjustmentAmounts(net: DecimalValue, gross: DecimalValue) {
  return {
    amountNet: decimalToNumber(net),
    amountNetExact: decimalToString(net),
    amountGross: decimalToNumber(gross),
    amountGrossExact: decimalToString(gross),
  }
}

function createSurchargeAdjustment(params: {
  providerKey: string
  label: string
  currencyCode: string
  amount: DecimalValue
  decimalPlaces?: number
  metadata?: Record<string, unknown>
}): ProviderAdjustmentResult {
  const amount = roundDecimal(nonNegative(params.amount), params.decimalPlaces ?? DEFAULT_AMOUNT_DECIMAL_PLACES)
  if (amount.lte(0)) return { adjustments: [] }
  return {
    adjustments: [
      {
        kind: 'surcharge',
        code: params.providerKey,
        label: params.label,
        ...shippingAdjustmentAmounts(amount, amount),
        currencyCode: params.currencyCode,
        metadata: params.metadata ?? null,
      },
    ],
    metadata: params.metadata,
  }
}

function nullToUndefined(value: unknown): unknown {
  return value === null || value === '' ? undefined : value
}

function nullToZero(value: unknown): unknown {
  return value === null || value === '' ? 0 : value
}

const cashOnDeliverySettings = z.object({
  feeFlat: z.preprocess(nullToZero, nonNegativeDecimalStringSchema).default('0'),
  feePercent: z.coerce.number().min(0).max(100).default(0),
  maxOrderTotal: z.preprocess(nullToUndefined, nonNegativeDecimalStringSchema.optional()),
})

const stripeSettings = z.object({
  publishableKey: z.string().trim().min(1).max(200).optional(),
  secretKey: z.string().trim().min(1).max(200).optional(),
  webhookSecret: z.string().trim().max(200).optional(),
  applicationFeePercent: z.coerce.number().min(0).max(100).default(0),
  applicationFeeFlat: z.preprocess(nullToZero, nonNegativeDecimalStringSchema).default('0'),
  captureMethod: z.enum(['automatic', 'manual']).default('automatic'),
  successUrl: z.string().trim().max(400).optional(),
  cancelUrl: z.string().trim().max(400).optional(),
})

const flatRateSettings = z.object({
  rates: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().max(120).optional(),
        metric: z.enum(['item_count', 'weight', 'volume', 'subtotal']).default('item_count'),
        min: z.preprocess(nullToZero, nonNegativeDecimalStringSchema).default('0'),
        max: z.preprocess(nullToUndefined, nonNegativeDecimalStringSchema.optional()),
        amountNet: z.preprocess(nullToZero, nonNegativeDecimalStringSchema),
        amountGross: z.preprocess(nullToUndefined, nonNegativeDecimalStringSchema.optional()),
        currencyCode: z.string().trim().length(3).optional(),
      })
    )
    .default([]),
  applyBaseRate: z.boolean().optional(),
})

function selectFlatRate(
  settings: z.infer<typeof flatRateSettings>,
  metrics: ShippingMetrics
) {
  for (const rate of settings.rates ?? []) {
    let value = toDecimal(metrics.itemCount)
    if (rate.metric === 'subtotal') value = exactOr(metrics.subtotalGrossExact, metrics.subtotalGross, toDecimal(0))
    if (rate.metric === 'weight') value = toDecimal(metrics.totalWeight)
    if (rate.metric === 'volume') value = toDecimal(metrics.totalVolume)
    const aboveMin = value.gte(toDecimal(rate.min ?? '0'))
    const belowMax = rate.max === undefined || rate.max === null || value.lte(toDecimal(rate.max))
    if (aboveMin && belowMax) return rate
  }
  return null
}

const stripeProvider: PaymentProvider = {
  key: 'stripe',
  label: 'Stripe',
  description: 'Card payments processed via Stripe with optional application fee.',
  settings: {
    fields: [
      { key: 'publishableKey', label: 'Publishable key', type: 'secret', required: true },
      { key: 'secretKey', label: 'Secret key', type: 'secret', required: true },
      { key: 'webhookSecret', label: 'Webhook secret', type: 'secret' },
      { key: 'applicationFeePercent', label: 'Application fee (%)', type: 'number' },
      { key: 'applicationFeeFlat', label: 'Application fee (flat)', type: 'number' },
      {
        key: 'captureMethod',
        label: 'Capture method',
        type: 'select',
        options: [
          { value: 'automatic', label: 'Automatic' },
          { value: 'manual', label: 'Manual' },
        ],
      },
      { key: 'successUrl', label: 'Success URL', type: 'url' },
      { key: 'cancelUrl', label: 'Cancel URL', type: 'url' },
    ],
    schema: stripeSettings,
  },
  calculate: ({ document, context, settings }) => {
    const parsed = stripeSettings.safeParse(settings ?? {})
    if (!parsed.success) return { adjustments: [] }
    const { applicationFeeFlat, applicationFeePercent } = parsed.data
    const total = exactOr(document.totals.grandTotalGrossAmountExact, document.totals.grandTotalGrossAmount, toDecimal(0))
    const amount = toDecimal(applicationFeeFlat).plus(percentOf(applicationFeePercent, nonNegative(total)))
    return createSurchargeAdjustment({
      providerKey: 'stripe',
      label: 'Stripe processing fee',
      currencyCode: context.currencyCode,
      amount,
      decimalPlaces: context.amountDecimalPlaces,
      metadata: parsed.data,
    })
  },
}

const paymentProviders: PaymentProvider[] = [
  stripeProvider,
  {
    key: 'wire-transfer',
    label: 'Wire transfer',
    description: 'Bank transfer with offline settlement and optional due date instructions.',
    settings: {
      fields: [
        {
          key: 'instructions',
          label: 'Payment instructions',
          type: 'textarea',
          description: 'Shown to buyers after confirming the order.',
        },
        { key: 'accountNumber', label: 'Account / IBAN', type: 'text' },
        { key: 'dueDays', label: 'Due in days', type: 'number' },
      ],
      schema: z.object({
        instructions: z.string().trim().max(4000).optional(),
        accountNumber: z.string().trim().max(255).optional(),
        dueDays: z.coerce.number().int().min(0).max(365).optional(),
      }),
    },
    calculate: () => ({ adjustments: [] }),
  },
  {
    key: 'cash-on-delivery',
    label: 'Cash on delivery',
    description: 'Collect payment on delivery with optional handling fee.',
    settings: {
      fields: [
        {
          key: 'feeFlat',
          label: 'Flat fee',
          type: 'number',
          description: 'Fixed handling fee added to the order.',
        },
        {
          key: 'feePercent',
          label: 'Percent fee',
          type: 'number',
          description: 'Percentage applied to the order total (after shipping).',
        },
        {
          key: 'maxOrderTotal',
          label: 'Apply up to total',
          type: 'number',
          description: 'Skip the fee if the order total exceeds this amount.',
        },
      ],
      schema: cashOnDeliverySettings,
    },
    calculate: ({ document, context, settings }) => {
      const parsed = cashOnDeliverySettings.safeParse(settings ?? {})
      const total = exactOr(document.totals.grandTotalGrossAmountExact, document.totals.grandTotalGrossAmount, toDecimal(0))
      if (!parsed.success) return { adjustments: [] }
      const { feeFlat, feePercent, maxOrderTotal } = parsed.data
      if (maxOrderTotal !== undefined && maxOrderTotal !== null && total.gt(toDecimal(maxOrderTotal))) {
        return { adjustments: [] }
      }
      const amount = percentOf(feePercent, nonNegative(total)).plus(toDecimal(feeFlat))
      return createSurchargeAdjustment({
        providerKey: 'cash-on-delivery',
        label: 'Cash on delivery fee',
        currencyCode: context.currencyCode,
        amount,
        decimalPlaces: context.amountDecimalPlaces,
        metadata: { feeFlat, feePercent, maxOrderTotal },
      })
    },
  },
]

const shippingProviders: ShippingProvider[] = [
  {
    key: 'flat-rate',
    label: 'Flat rate',
    description: 'Configurable flat-rate shipping with tiered rules.',
    settings: {
      fields: [
        {
          key: 'applyBaseRate',
          label: 'Always include base rate',
          type: 'boolean',
          description: 'When enabled, add the method base rate even if a tier matches.',
        },
        {
          key: 'rates',
          label: 'Rate table',
          type: 'json',
          description: 'Add tiered rates by items, weight, volume, or subtotal.',
        },
      ],
      schema: flatRateSettings,
    },
    calculate: ({ method, settings, document, metrics, context }) => {
      const parsed = flatRateSettings.safeParse(settings ?? {})
      const baseNet = exactOr(method.baseRateNetExact, method.baseRateNet, toDecimal(0))
      const baseGross = exactOr(method.baseRateGrossExact, method.baseRateGross, baseNet)
      if (!parsed.success) {
        return {
          adjustments: [
            {
              kind: 'shipping' as const,
              code: method.code ?? 'shipping',
              label: method.name ?? 'Shipping',
              ...shippingAdjustmentAmounts(baseNet, baseGross),
              currencyCode: method.currencyCode ?? context.currencyCode,
            },
          ],
        }
      }
      const selected = selectFlatRate(parsed.data, metrics)
      const baseAdjustment = parsed.data.applyBaseRate !== false && (!baseNet.eq(0) || !baseGross.eq(0))
      const chosenNet = selected ? exactOr(selected.amountNet, undefined, baseNet) : baseNet
      const chosenGross = selected ? exactOr(selected.amountGross, undefined, chosenNet) : baseGross
      const currency =
        selected?.currencyCode?.toUpperCase() ??
        method.currencyCode ??
        context.currencyCode
      const adjustments = []
      if (baseAdjustment) {
        adjustments.push({
          kind: 'shipping' as const,
          code: method.code ?? 'shipping',
          label: method.name ?? 'Shipping',
          ...shippingAdjustmentAmounts(baseNet, baseGross),
          currencyCode: currency,
          metadata: { providerKey: 'flat-rate', rate: null },
        })
      }
      if (selected) {
        adjustments.push({
          kind: 'shipping' as const,
          code: selected.name ?? method.code ?? 'shipping',
          label: selected.name ?? 'Shipping',
          ...shippingAdjustmentAmounts(chosenNet, chosenGross),
          currencyCode: currency,
          metadata: { providerKey: 'flat-rate', rate: selected },
        })
      } else if (!baseAdjustment) {
        adjustments.push({
          kind: 'shipping' as const,
          code: method.code ?? 'shipping',
          label: method.name ?? 'Shipping',
          ...shippingAdjustmentAmounts(baseNet, baseGross),
          currencyCode: currency,
          metadata: { providerKey: 'flat-rate', rate: null },
        })
      }
      return { adjustments, metadata: { selectedRate: selected ?? null } }
    },
  },
]

export function registerDefaultSalesProviders() {
  if (initialized) return
  initialized = true
  paymentProviders.forEach((provider) => registerPaymentProvider(provider))
  shippingProviders.forEach((provider) => registerShippingProvider(provider))
}

export function registerStripeProvider() {
  return registerPaymentProvider(stripeProvider)
}
