import type { EventBus } from '@open-mercato/events'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { rebuildDocumentResult, round } from '../calculations'
import type {
  SalesAdjustmentDraft,
  SalesCalculationContext,
  SalesDocumentCalculationResult,
  SalesDocumentKind,
} from '../types'
import { getTaxProvider } from './registry'
import { DEFAULT_TAX_PROVIDER_KEY } from './taxContext'
import { buildTaxInfo, normalizeTaxProviderResult, type TaxInfo, type TaxProviderResultParsed } from './taxInfo'
import type {
  TaxCalculationRequest,
  TaxCalculationStatus,
  TaxDocumentContext,
  TaxProviderMessage,
  TaxRequestCharge,
  TaxRequestLine,
} from './types'

const logger = createLogger('sales')

/** Named so every fallback groups under one fingerprint in the error reporter. */
class TaxProviderFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxProviderFailedError'
  }
}

/**
 * A decline is an expected outcome — "not my jurisdiction" — so it is not
 * reported as an error. Everything else is a real incident an operator wants to
 * see, even though the write itself succeeded.
 */
function reportTaxProviderFailure(params: {
  failure: NonNullable<TaxInfo['failure']>
  documentKind: SalesDocumentKind
  documentId: string | null
  organizationId: string
  tenantId: string
}): void {
  if (params.failure.code === 'unsupported') return
  try {
    getTelemetryRuntime()?.reportError(new TaxProviderFailedError(params.failure.message), {
      module: 'sales',
      code: 'sales.tax_provider_failed',
      attributes: {
        providerKey: params.failure.providerKey,
        failureCode: params.failure.code,
        documentKind: params.documentKind,
        documentId: params.documentId ?? undefined,
        organizationId: params.organizationId,
        tenantId: params.tenantId,
      },
    })
  } catch {
    // Error reporting must never be the reason a document write fails.
  }
}

/**
 * Half a hundredth of a minor unit: the widest divergence between the
 * provider's own document total and the sum of its lines that cannot be a real
 * discrepancy, and the narrowest that silences honest rounding noise.
 */
const TAX_RECONCILIATION_TOLERANCE = 0.00005

export type TaxFailureCode =
  | 'provider_error'
  | 'timeout'
  | 'invalid_result'
  | 'unsupported'
  | 'integration_disabled'
  | 'credentials_missing'
  | 'provider_missing'
  | 'integrations_unavailable'

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return fallback
}

function extractAdjustmentTaxRate(adjustment: SalesAdjustmentDraft): number | null {
  const metadata = (adjustment.metadata ?? {}) as Record<string, unknown>
  const candidate =
    metadata.taxRate ??
    metadata.tax_rate ??
    metadata.taxRateValue ??
    metadata.tax_rate_value ??
    null
  const parsed = toNumber(candidate, Number.NaN)
  return Number.isFinite(parsed) ? parsed : null
}

function isOrderScoped(adjustment: SalesAdjustmentDraft): boolean {
  return (adjustment.scope ?? 'order') === 'order'
}

/**
 * Assigns every order-scoped adjustment a stable charge id, once, for the whole
 * stage. Deriving it separately on the request side and the apply side is how a
 * positional fallback silently breaks: the request enumerates only the
 * order-scoped adjustments while the apply pass walks all of them, so a single
 * line-scoped adjustment earlier in the array shifts the index and the
 * provider's tax for that charge is dropped without a trace. One map, built
 * once, cannot disagree with itself.
 */
function buildChargeIds(adjustments: SalesAdjustmentDraft[]): Map<SalesAdjustmentDraft, string> {
  const ids = new Map<SalesAdjustmentDraft, string>()
  let position = 0
  for (const adjustment of adjustments) {
    if (!isOrderScoped(adjustment)) continue
    ids.set(adjustment, adjustment.id ?? adjustment.calculatorKey ?? `${adjustment.kind}-${position}`)
    position += 1
  }
  return ids
}

/**
 * Builds the immutable request document a provider receives. It is assembled
 * after the shipping and payment stages, so a shipping surcharge is already a
 * charge the provider can tax.
 */
export function buildTaxCalculationRequest(params: {
  documentKind: SalesDocumentKind
  tax: TaxDocumentContext
  context: SalesCalculationContext
  document: SalesDocumentCalculationResult
  chargeIds: Map<SalesAdjustmentDraft, string>
}): TaxCalculationRequest {
  const { tax, document } = params

  const lines: TaxRequestLine[] = document.lines.map((entry, index) => {
    const line = entry.line
    const productId = line.productId ?? null
    const variantId = line.productVariantId ?? null
    const facts =
      (variantId ? tax.productFacts[variantId] : undefined) ??
      (productId ? tax.productFacts[productId] : undefined) ??
      null
    const metadata = (line.metadata ?? {}) as Record<string, unknown>
    return {
      id: line.id ?? `line-${index + 1}`,
      lineNumber: line.lineNumber ?? index + 1,
      kind: line.kind,
      productId,
      productVariantId: variantId,
      sku: facts?.sku ?? null,
      name: line.name ?? null,
      description: line.description ?? null,
      quantity: toNumber(line.normalizedQuantity ?? line.quantity, 0),
      unitPriceNet: toNumber(line.unitPriceNet, 0),
      amountNet: entry.netAmount,
      amountGross: entry.grossAmount,
      discountAmount: entry.discountAmount,
      taxAmount: entry.taxAmount,
      taxIncluded: metadata.priceMode === 'gross',
      taxRateId: facts?.taxRateId ?? null,
      taxRate: line.taxRate ?? null,
      taxClassificationCode: facts?.taxClassificationCode ?? null,
      hsCode: facts?.hsCode ?? null,
      // Per line destinations are reserved; they travel in metadata until a
      // core feature needs them.
      shipTo: null,
      metadata,
    }
  })

  const charges: TaxRequestCharge[] = document.adjustments
    .filter(isOrderScoped)
    .map((adjustment) => {
      const amountNet = toNumber(adjustment.amountNet, toNumber(adjustment.amountGross, 0))
      const amountGross = toNumber(adjustment.amountGross, amountNet)
      const taxRate = extractAdjustmentTaxRate(adjustment)
      return {
        id: params.chargeIds.get(adjustment)!,
        kind: adjustment.kind,
        code: adjustment.code ?? null,
        label: adjustment.label ?? null,
        amountNet,
        amountGross,
        taxRate,
        taxAmount: taxRate === null ? 0 : round(amountGross - amountNet),
        calculatorKey: adjustment.calculatorKey ?? null,
      }
    })

  return {
    documentKind: params.documentKind,
    documentId: tax.document.id,
    documentNumber: tax.document.number,
    documentDate: tax.document.date,
    intent: tax.document.intent,
    currencyCode: document.currencyCode,
    organizationId: params.context.organizationId,
    tenantId: params.context.tenantId,
    channelId: tax.document.channelId,
    customer: tax.customer,
    addresses: tax.addresses,
    lines,
    charges,
    totals: {
      subtotalNetAmount: document.totals.subtotalNetAmount,
      discountTotalAmount: document.totals.discountTotalAmount,
      shippingNetAmount: document.totals.shippingNetAmount ?? 0,
    },
    metadata: tax.metadata,
  }
}

type Reconciliation = TaxInfo['reconciliation']

/**
 * Keeps the stored header total equal to the sum of the stored line taxes. When
 * the provider's own document total disagrees with its lines by more than the
 * tolerance, the difference lands on the largest taxable line (ties: lowest
 * line number) — the largest remainder rule Shopify and commercetools apply.
 */
function reconcile(
  result: TaxProviderResultParsed,
  request: TaxCalculationRequest
): { result: TaxProviderResultParsed; reconciliation: Reconciliation } {
  const lineSum = round(
    result.lines.reduce((sum, line) => sum + line.taxAmount, 0) +
      result.charges.reduce((sum, charge) => sum + charge.taxAmount, 0)
  )
  const delta = round(result.totals.taxTotal - lineSum)
  if (Math.abs(delta) <= TAX_RECONCILIATION_TOLERANCE || result.lines.length === 0) {
    return { result, reconciliation: null }
  }

  const lineNumbers = new Map(request.lines.map((line) => [line.id, line.lineNumber]))
  let target = result.lines[0]
  for (const line of result.lines) {
    if (line.taxableAmount > target.taxableAmount) {
      target = line
      continue
    }
    if (line.taxableAmount === target.taxableAmount) {
      const current = lineNumbers.get(line.lineId) ?? Number.MAX_SAFE_INTEGER
      const best = lineNumbers.get(target.lineId) ?? Number.MAX_SAFE_INTEGER
      if (current < best) target = line
    }
  }

  return {
    result: {
      ...result,
      lines: result.lines.map((line) =>
        line.lineId === target.lineId ? { ...line, taxAmount: round(line.taxAmount + delta) } : line
      ),
    },
    reconciliation: {
      providerTotal: result.totals.taxTotal,
      lineSum,
      delta,
      appliedToLineId: target.lineId,
    },
  }
}

/** Runs the provider under a bounded timeout, aborting its signal when it elapses. */
async function callWithTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T> | T
): Promise<{ ok: true; value: T } | { ok: false; code: 'timeout' | 'provider_error'; error: unknown }> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<{ ok: false; code: 'timeout'; error: unknown }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ ok: false, code: 'timeout', error: new Error('[internal] tax provider timed out') })
    }, timeoutMs)
  })
  try {
    const value = await Promise.race([
      Promise.resolve(run(controller.signal)).then((resolved) => ({ ok: true as const, value: resolved })),
      timeout,
    ])
    return value
  } catch (error) {
    return { ok: false, code: 'provider_error', error }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function applyResultToDocument(params: {
  documentKind: SalesDocumentKind
  document: SalesDocumentCalculationResult
  result: TaxProviderResultParsed
  chargeIds: Map<SalesAdjustmentDraft, string>
}): SalesDocumentCalculationResult {
  const { document, result } = params
  const lineTax = new Map(result.lines.map((line) => [line.lineId, line]))
  const chargeTax = new Map(result.charges.map((charge) => [charge.chargeId, charge]))

  const lines = document.lines.map((entry, index) => {
    const id = entry.line.id ?? `line-${index + 1}`
    const providerLine = lineTax.get(id)
    if (!providerLine) return entry
    const taxAmount = round(providerLine.taxAmount)
    return {
      ...entry,
      taxAmount,
      grossAmount: round(entry.netAmount + taxAmount),
    }
  })

  const adjustments = document.adjustments.map((adjustment) => {
    const id = params.chargeIds.get(adjustment)
    if (id === undefined) return adjustment
    const providerCharge = chargeTax.get(id)
    if (!providerCharge) return adjustment
    const amountNet = toNumber(adjustment.amountNet, toNumber(adjustment.amountGross, 0))
    const taxAmount = round(providerCharge.taxAmount)
    return {
      ...adjustment,
      amountGross: round(amountNet + taxAmount),
      metadata: {
        ...(adjustment.metadata ?? {}),
        taxRate: providerCharge.rate,
      },
    }
  })

  return rebuildDocumentResult({
    documentKind: params.documentKind,
    currencyCode: document.currencyCode,
    lines,
    adjustments,
    metadata: document.metadata,
  })
}

function withTaxMetadata(
  document: SalesDocumentCalculationResult,
  info: TaxInfo
): SalesDocumentCalculationResult {
  return { ...document, metadata: { ...(document.metadata ?? {}), tax: info } }
}

function chargeKindsOf(request: TaxCalculationRequest): Record<string, string> {
  const kinds: Record<string, string> = {}
  for (const charge of request.charges) kinds[charge.id] = charge.kind
  return kinds
}

export type TaxStageOutcome = {
  document: SalesDocumentCalculationResult
  info: TaxInfo
}

/**
 * The third stage of the provider totals calculator. It runs after shipping and
 * payment so the shipping surcharge is already taxable, and before the command
 * opens its transaction, so no Postgres transaction is held during a provider's
 * network call and a timeout can never abort the write.
 */
export async function runTaxStage(params: {
  documentKind: SalesDocumentKind
  context: SalesCalculationContext
  tax: TaxDocumentContext
  document: SalesDocumentCalculationResult
  eventBus?: EventBus | null
}): Promise<TaxStageOutcome | null> {
  const { tax, context, documentKind, eventBus } = params

  if (tax.totalsMode === 'external') {
    const info = buildTaxInfo({
      providerKey: tax.selection.providerKey,
      status: 'external',
      intent: tax.document.intent,
      result: null,
      chargeKinds: {},
      messages: [
        {
          level: 'info',
          code: 'external',
          text: 'The document carries external amounts, so no tax provider ran.',
        },
      ],
    })
    return { document: withTaxMetadata(params.document, info), info }
  }

  const messages: TaxProviderMessage[] = []
  let failure: TaxInfo['failure'] = null
  let providerKey = tax.selection.providerKey || DEFAULT_TAX_PROVIDER_KEY
  let provider = getTaxProvider(providerKey)

  if (!provider) {
    // The package that registered the key is gone; degrade to the built in
    // default rather than failing the write.
    failure = {
      code: 'provider_missing',
      message: `Tax provider "${providerKey}" is not registered.`,
      at: new Date().toISOString(),
      providerKey,
    }
    providerKey = DEFAULT_TAX_PROVIDER_KEY
    provider = getTaxProvider(DEFAULT_TAX_PROVIDER_KEY)
  } else if (tax.selection.integrationId && !tax.selection.integrationEnabled) {
    failure = {
      code: 'integration_disabled',
      message: `The integration backing "${providerKey}" is disabled.`,
      at: new Date().toISOString(),
      providerKey,
    }
    providerKey = DEFAULT_TAX_PROVIDER_KEY
    provider = getTaxProvider(DEFAULT_TAX_PROVIDER_KEY)
  }

  if (!provider) return null

  // Built once and shared by the request side and the apply side, so the two
  // can never disagree about which charge is which.
  const chargeIds = buildChargeIds(params.document.adjustments)
  let request = buildTaxCalculationRequest({
    documentKind,
    tax,
    context,
    document: params.document,
    chargeIds,
  })

  if (eventBus) {
    await eventBus.emitEvent('sales.tax.adjustments.apply.before', {
      documentKind,
      providerKey,
      document: params.document,
      request,
      setRequest(next: TaxCalculationRequest | null | undefined) {
        if (next) request = next
      },
    })
  }

  const credentials = tax.selection.integrationId ? await tax.resolveCredentials() : {}
  const call = await callWithTimeout(tax.timeoutMs, (signal) =>
    provider!.calculate({
      request,
      settings: tax.selection.settings,
      credentials,
      context,
      signal,
    })
  )

  let status: TaxCalculationStatus = 'fallback'
  let normalized: TaxProviderResultParsed | null = null
  let reconciliation: Reconciliation = null

  if (!call.ok) {
    failure = failure ?? {
      code: call.code,
      message:
        call.error instanceof Error ? call.error.message : 'The tax provider did not return a result.',
      at: new Date().toISOString(),
      providerKey,
    }
    logger.warn('tax provider failed; table rates were applied', {
      providerKey,
      documentKind,
      documentId: tax.document.id,
      code: call.code,
    })
  } else if (call.value === null) {
    failure = failure ?? {
      code: 'unsupported',
      message: 'The tax provider declined the document.',
      at: new Date().toISOString(),
      providerKey,
    }
  } else {
    normalized = normalizeTaxProviderResult(call.value)
    if (!normalized) {
      failure = failure ?? {
        code: 'invalid_result',
        message: 'The tax provider returned a result the contract does not describe.',
        at: new Date().toISOString(),
        providerKey,
      }
      logger.warn('tax provider returned an invalid result; table rates were applied', {
        providerKey,
        documentKind,
        documentId: tax.document.id,
        code: 'invalid_result',
      })
    } else if (normalized.status === 'unsupported') {
      failure = failure ?? {
        code: 'unsupported',
        message: 'The tax provider declined the document.',
        at: new Date().toISOString(),
        providerKey,
      }
      normalized = null
    } else {
      const reconciled = reconcile(normalized, request)
      normalized = reconciled.result
      reconciliation = reconciled.reconciliation
      status = normalized.status === 'exempt' ? 'exempt' : 'calculated'
    }
  }

  if (failure) {
    messages.push({
      level: failure.code === 'unsupported' ? 'info' : 'warning',
      code: failure.code,
      text: failure.message,
    })
  }

  let document =
    normalized === null
      ? params.document
      : applyResultToDocument({ documentKind, document: params.document, result: normalized, chargeIds })

  const info = buildTaxInfo({
    providerKey,
    status,
    intent: tax.document.intent,
    result: normalized,
    chargeKinds: chargeKindsOf(request),
    reconciliation,
    messages,
    failure,
  })

  document = withTaxMetadata(document, info)

  if (failure) {
    reportTaxProviderFailure({
      failure,
      documentKind,
      documentId: tax.document.id,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
    })
    if (eventBus) {
      // Emitted for every fallback, including a decline: a merchant may well
      // want to know that their engine is declining documents.
      await eventBus.emitEvent('sales.tax.calculation.failed', {
        id: tax.document.id ?? `${documentKind}:unsaved`,
        documentKind,
        documentId: tax.document.id,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        providerKey: failure.providerKey,
        code: failure.code,
        message: failure.message,
      })
    }
  }

  if (eventBus) {
    let nextDocument = document
    await eventBus.emitEvent('sales.tax.adjustments.apply.after', {
      documentKind,
      providerKey,
      status,
      document: nextDocument,
      tax: info,
      setDocument(next: SalesDocumentCalculationResult | null | undefined) {
        if (next) nextDocument = next
      },
    })
    document = nextDocument
  }

  return { document, info }
}
