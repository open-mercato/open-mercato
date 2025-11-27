import { registerSalesTotalsCalculator, rebuildDocumentResult } from '../calculations'
import type { SalesAdjustmentDraft, SalesDocumentCalculationResult } from '../types'
import {
  getPaymentProvider,
  getShippingProvider,
  normalizeProviderSettings,
} from './registry'
import type {
  PaymentMethodContext,
  ProviderAdjustment,
  ProviderAdjustmentResult,
  ShippingMethodContext,
  ShippingMetrics,
} from './types'

const SHIPPING_PREFIX = 'shipping-provider:'
const PAYMENT_PREFIX = 'payment-provider:'

let totalsRegistered = false

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return fallback
}

function isProviderAdjustment(adjustment: SalesAdjustmentDraft): boolean {
  const key = adjustment.calculatorKey ?? ''
  return typeof key === 'string' && (key.startsWith(SHIPPING_PREFIX) || key.startsWith(PAYMENT_PREFIX))
}

function withoutPrefix(adjustments: SalesAdjustmentDraft[], prefix: string) {
  return adjustments.filter((adj) => !(adj.calculatorKey ?? '').startsWith(prefix))
}

function extractProviderSettings(
  method: ShippingMethodContext | PaymentMethodContext | null | undefined
): Record<string, unknown> | null {
  if (!method) return null
  if (method.providerSettings && typeof method.providerSettings === 'object') {
    return method.providerSettings as Record<string, unknown>
  }
  if (method.metadata && typeof method.metadata === 'object') {
    const meta = method.metadata as Record<string, unknown>
    if (meta.providerSettings && typeof meta.providerSettings === 'object') {
      return meta.providerSettings as Record<string, unknown>
    }
  }
  return null
}

function computeMetrics(lines: SalesDocumentCalculationResult['lines']): ShippingMetrics {
  let itemCount = 0
  let totalWeight = 0
  let totalVolume = 0
  let subtotalNet = 0
  let subtotalGross = 0

  for (const entry of lines) {
    const { line } = entry
    const qty = toNumber(line.quantity, 0)
    itemCount += qty
    subtotalNet += toNumber(entry.netAmount, 0)
    subtotalGross += toNumber(entry.grossAmount, 0)

    const meta = (line.metadata ?? {}) as Record<string, unknown>
    const configuration = (line.configuration ?? {}) as Record<string, unknown>
    const weight =
      toNumber((meta.weight as number | string | undefined) ?? (configuration.weight as number | string | undefined), 0) *
      qty
    const volume =
      toNumber(
        (meta.volume as number | string | undefined) ??
          (configuration.volume as number | string | undefined),
        0
      ) * qty

    totalWeight += weight
    totalVolume += volume
  }

  return {
    itemCount,
    totalWeight,
    totalVolume,
    subtotalNet,
    subtotalGross,
  }
}

function normalizeAdjustments(params: {
  providerKey: string
  calculatorKey: string
  adjustments: ProviderAdjustment[]
  currencyCode: string
  defaultKind: SalesAdjustmentDraft['kind']
}) {
  return params.adjustments.map<SalesAdjustmentDraft>((adj, index) => ({
    scope: 'order',
    kind: adj.kind ?? params.defaultKind,
    code: adj.code ?? params.providerKey,
    label: adj.label ?? params.providerKey,
    calculatorKey: params.calculatorKey,
    promotionId: null,
    rate: null,
    amountNet: toNumber(adj.amountNet, 0),
    amountGross:
      adj.amountGross === undefined || adj.amountGross === null
        ? toNumber(adj.amountNet, 0)
        : toNumber(adj.amountGross, 0),
    currencyCode: (adj.currencyCode || params.currencyCode || '').toUpperCase() || params.currencyCode,
    metadata: adj.metadata ?? null,
    position: 10_000 + index,
  }))
}

function mergeMetadata(
  base: Record<string, unknown> | undefined,
  key: string,
  value: unknown
): Record<string, unknown> {
  const next = { ...(base ?? {}) }
  next[key] = value
  return next
}

function applyProviderResult(
  current: SalesDocumentCalculationResult,
  adjustments: SalesAdjustmentDraft[],
  providerKey: string,
  calculatorKey: string,
  result: ProviderAdjustmentResult | null | undefined,
  defaultKind: SalesAdjustmentDraft['kind']
): SalesDocumentCalculationResult {
  if (!result?.adjustments?.length) {
    return rebuildDocumentResult({
      documentKind: current.kind,
      currencyCode: current.currencyCode,
      lines: current.lines,
      adjustments,
      metadata: current.metadata,
    })
  }
  const normalized = normalizeAdjustments({
    providerKey,
    calculatorKey,
    adjustments: result.adjustments,
    currencyCode: current.currencyCode,
    defaultKind,
  })
  const nextAdjustments = [...adjustments, ...normalized]
  const next = rebuildDocumentResult({
    documentKind: current.kind,
    currencyCode: current.currencyCode,
    lines: current.lines,
    adjustments: nextAdjustments,
    metadata: current.metadata,
  })
  if (result.metadata) {
    next.metadata = mergeMetadata(next.metadata, calculatorKey, result.metadata)
  }
  return next
}

export function ensureProviderTotalsCalculator() {
  if (totalsRegistered) return
  totalsRegistered = true

  registerSalesTotalsCalculator(async ({ documentKind, lines, context, current }) => {
    const metadata = (context.metadata ?? {}) as Record<string, unknown>
    const shippingMethod = (metadata.shippingMethod ?? null) as ShippingMethodContext | null
    const paymentMethod = (metadata.paymentMethod ?? null) as PaymentMethodContext | null

    let runningAdjustments = (current.adjustments ?? []).filter((adj) => !isProviderAdjustment(adj))
    let working = rebuildDocumentResult({
      documentKind,
      currencyCode: current.currencyCode,
      lines,
      adjustments: runningAdjustments,
      metadata: current.metadata,
    })

    if (shippingMethod?.providerKey) {
      const provider = getShippingProvider(shippingMethod.providerKey)
      if (provider?.calculate) {
        const rawSettings = extractProviderSettings(shippingMethod)
        const settings =
          normalizeProviderSettings('shipping', provider.key, rawSettings) ?? rawSettings ?? {}
        const metrics = computeMetrics(working.lines)
        const result = await provider.calculate({
          method: shippingMethod,
          settings,
          document: working,
          lines: working.lines,
          context,
          metrics,
        })
        working = applyProviderResult(working, runningAdjustments, provider.key, `${SHIPPING_PREFIX}${provider.key}`, result, 'shipping')
        runningAdjustments = working.adjustments
      }
    }

    if (paymentMethod?.providerKey) {
      const provider = getPaymentProvider(paymentMethod.providerKey)
      if (provider?.calculate) {
        runningAdjustments = withoutPrefix(runningAdjustments, PAYMENT_PREFIX)
        const rawSettings = extractProviderSettings(paymentMethod)
        const settings =
          normalizeProviderSettings('payment', provider.key, rawSettings) ?? rawSettings ?? {}
        const result = await provider.calculate({
          method: paymentMethod,
          settings,
          document: working,
          lines: working.lines,
          context,
        })
        working = applyProviderResult(
          working,
          runningAdjustments,
          provider.key,
          `${PAYMENT_PREFIX}${provider.key}`,
          result,
          'surcharge'
        )
        runningAdjustments = working.adjustments
      }
    }

    return working
  })
}
