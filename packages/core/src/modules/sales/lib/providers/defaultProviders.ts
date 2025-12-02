import { z } from 'zod'
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

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return fallback
}

function createSurchargeAdjustment(params: {
  providerKey: string
  label: string
  currencyCode: string
  amount: number
  metadata?: Record<string, unknown>
}): ProviderAdjustmentResult {
  const amount = Math.max(0, params.amount)
  if (!Number.isFinite(amount) || amount <= 0) return { adjustments: [] }
  return {
    adjustments: [
      {
        kind: 'surcharge',
        code: params.providerKey,
        label: params.label,
        amountNet: amount,
        amountGross: amount,
        currencyCode: params.currencyCode,
        metadata: params.metadata ?? null,
      },
    ],
    metadata: params.metadata,
  }
}

const cashOnDeliverySettings = z.object({
  feeFlat: z.coerce.number().min(0).default(0),
  feePercent: z.coerce.number().min(0).max(100).default(0),
  maxOrderTotal: z.coerce.number().min(0).optional(),
})

const stripeSettings = z.object({
  publishableKey: z.string().trim().min(1).max(200).optional(),
  secretKey: z.string().trim().min(1).max(200).optional(),
  webhookSecret: z.string().trim().max(200).optional(),
  applicationFeePercent: z.coerce.number().min(0).max(100).default(0),
  applicationFeeFlat: z.coerce.number().min(0).default(0),
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
        min: z.coerce.number().min(0).default(0),
        max: z.coerce.number().min(0).optional(),
        amountNet: z.coerce.number().min(0),
        amountGross: z.coerce.number().min(0).optional(),
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
    let value = metrics.itemCount
    if (rate.metric === 'subtotal') value = metrics.subtotalGross
    if (rate.metric === 'weight') value = metrics.totalWeight
    if (rate.metric === 'volume') value = metrics.totalVolume
    const min = toNumber(rate.min, 0)
    const max = rate.max === undefined || rate.max === null ? Number.POSITIVE_INFINITY : toNumber(rate.max, 0)
    if (value >= min && value <= max) return rate
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
    const total = document.totals.grandTotalGrossAmount ?? 0
    const amount = Math.max(0, applicationFeeFlat + (applicationFeePercent / 100) * Math.max(total, 0))
    return createSurchargeAdjustment({
      providerKey: 'stripe',
      label: 'Stripe processing fee',
      currencyCode: context.currencyCode,
      amount,
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
      const total = document.totals.grandTotalGrossAmount ?? 0
      if (!parsed.success) return { adjustments: [] }
      const { feeFlat, feePercent, maxOrderTotal } = parsed.data
      if (maxOrderTotal !== undefined && maxOrderTotal !== null && total > maxOrderTotal) {
        return { adjustments: [] }
      }
      const percentageFee = (feePercent / 100) * Math.max(total, 0)
      const amount = percentageFee + feeFlat
      return createSurchargeAdjustment({
        providerKey: 'cash-on-delivery',
        label: 'Cash on delivery fee',
        currencyCode: context.currencyCode,
        amount,
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
      const baseNet = toNumber(method.baseRateNet, 0)
      const baseGross = toNumber(method.baseRateGross, baseNet)
      if (!parsed.success) {
        return {
          adjustments: [
            {
              kind: 'shipping' as const,
              code: method.code ?? 'shipping',
              label: method.name ?? 'Shipping',
              amountNet: baseNet,
              amountGross: baseGross,
              currencyCode: method.currencyCode ?? context.currencyCode,
            },
          ],
        }
      }
      const selected = selectFlatRate(parsed.data, metrics)
      const baseAdjustment = parsed.data.applyBaseRate !== false && (baseNet || baseGross)
      const chosenNet = selected ? toNumber(selected.amountNet, baseNet) : baseNet
      const chosenGross = selected ? toNumber(selected.amountGross, chosenNet) : baseGross
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
          amountNet: baseNet,
          amountGross: baseGross,
          currencyCode: currency,
          metadata: { providerKey: 'flat-rate', rate: null },
        })
      }
      if (selected) {
        adjustments.push({
          kind: 'shipping' as const,
          code: selected.name ?? method.code ?? 'shipping',
          label: selected.name ?? 'Shipping',
          amountNet: chosenNet,
          amountGross: chosenGross,
          currencyCode: currency,
          metadata: { providerKey: 'flat-rate', rate: selected },
        })
      } else if (!baseAdjustment) {
        adjustments.push({
          kind: 'shipping' as const,
          code: method.code ?? 'shipping',
          label: method.name ?? 'Shipping',
          amountNet: baseNet,
          amountGross: baseGross,
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
