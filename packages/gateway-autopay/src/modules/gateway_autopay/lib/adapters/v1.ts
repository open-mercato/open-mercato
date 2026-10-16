import type {
  GatewayAdapter,
  CreateSessionInput,
  CreateSessionResult,
  CaptureInput,
  CaptureResult,
  RefundInput,
  RefundResult,
  CancelInput,
  CancelResult,
  GetStatusInput,
  GatewayPaymentStatus,
  VerifyWebhookInput,
  WebhookEvent,
  UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  buildSessionRequest,
  cancelTransaction,
  queryTransactionStatus,
  refundTransaction,
  sanitizeOrderId,
  type AutopayCredentials,
} from '../autopay-client'
import { mapAutopayStatus, interpretAutopayTransactionStatus, type AutopayStatusInterpretation } from '../status-map'

function resolveCredentials(raw: Record<string, unknown>): AutopayCredentials {
  const serviceId = raw.serviceId
  const sharedKey = raw.sharedKey
  const gatewayUrl = raw.gatewayUrl
  if (typeof serviceId !== 'string' || !serviceId) {
    throw new Error('[internal] Autopay credentials are missing serviceId')
  }
  if (typeof sharedKey !== 'string' || !sharedKey) {
    throw new Error('[internal] Autopay credentials are missing sharedKey')
  }
  if (typeof gatewayUrl !== 'string' || !gatewayUrl) {
    throw new Error('[internal] Autopay credentials are missing gatewayUrl')
  }
  return {
    serviceId,
    sharedKey,
    gatewayUrl,
    hashAlgorithm: raw.hashAlgorithm === 'sha512' ? 'sha512' : 'sha256',
  }
}

/**
 * `CreateSessionInput` has no dedicated customer-email field, but Autopay's
 * documented parameter table marks CustomerEmail as required (position 7).
 * This adapter reads it from `input.metadata.customerEmail` — callers of
 * `createSession` for the `autopay` provider MUST populate that key. The
 * stock checkout submit route does not populate it yet (see the spec);
 * fixing that caller is tracked separately from this adapter.
 */
function readCustomerEmail(metadata: Record<string, unknown> | undefined): string {
  const value = metadata?.customerEmail
  if (typeof value !== 'string' || !value) {
    throw new Error('[internal] Autopay requires metadata.customerEmail to be set on every session (CustomerEmail is a required field per the Autopay Online v1.1 documentation)')
  }
  return value
}

function readGatewayId(metadata: Record<string, unknown> | undefined): string | undefined {
  const value = metadata?.gatewayId
  return typeof value === 'string' && value ? value : undefined
}

async function resolveStatusInterpretation(
  credentials: AutopayCredentials,
  orderId: string,
): Promise<AutopayStatusInterpretation> {
  const { transactions } = await queryTransactionStatus(credentials, { orderId })
  return interpretAutopayTransactionStatus(transactions)
}

/**
 * `transactionRefund` needs Autopay's own `remoteID`, not the merchant
 * `OrderID` (`sessionId`) the canonical `paymentGatewayService.refundPayment`
 * call actually supplies — it does not thread caller metadata through to the
 * adapter. Rather than require a metadata field no real caller populates,
 * this resolves the settled transaction's `remoteID` itself via
 * `transactionStatus`, the same lookup `getStatus()` already performs. An
 * explicit `metadata.remoteId` is still honored first, as a fast path for a
 * caller that already has it cached (e.g. from a prior `getStatus` result)
 * and wants to skip the extra round trip.
 */
async function resolveRefundRemoteId(
  credentials: AutopayCredentials,
  input: RefundInput,
): Promise<string> {
  const provided = input.metadata?.remoteId
  if (typeof provided === 'string' && provided) return provided

  const interpretation = await resolveStatusInterpretation(credentials, input.sessionId)
  if (interpretation.status !== 'captured' || !interpretation.matchedRemoteId) {
    throw new Error(
      `Autopay cannot refund session ${input.sessionId}: no captured transaction was found (current status: ${interpretation.status})`,
    )
  }
  return interpretation.matchedRemoteId
}

/** This package only ever creates PLN sessions (enforced in `createSession`),
 * so refunds always sign and send `Currency=PLN` explicitly rather than
 * omitting it — an omitted Currency still produces a validly-signed request,
 * but being explicit here removes any ambiguity about which currency the
 * refund applies to. */
const AUTOPAY_CURRENCY = 'PLN'

export const autopayAdapterV1: GatewayAdapter = {
  providerKey: 'autopay',

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    if (input.currencyCode !== AUTOPAY_CURRENCY) {
      throw new Error('Autopay integration in this package only supports PLN sessions')
    }
    const credentials = resolveCredentials(input.credentials)
    const customerEmail = readCustomerEmail(input.metadata)
    const gatewayId = readGatewayId(input.metadata)
    const orderId = sanitizeOrderId(input.paymentId)

    const session = buildSessionRequest({
      credentials,
      orderId,
      amount: input.amount.toFixed(2),
      currencyCode: input.currencyCode,
      description: input.description,
      gatewayId,
      customerEmail,
    })

    const { Hash: _hash, ...fieldsWithoutHash } = session.fields

    return {
      sessionId: orderId,
      status: 'pending',
      redirectUrl: session.redirectUrl,
      providerData: {
        formPost: session.formPost,
        fields: fieldsWithoutHash,
      },
    }
  },

  async capture(_input: CaptureInput): Promise<CaptureResult> {
    const { t } = await resolveTranslations()
    throw new Error(t(
      'gateway_autopay.errors.captureUnsupported',
      'Autopay does not support capturing a payment separately — it settles immediately when the payer completes the redirect.',
    ))
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const credentials = resolveCredentials(input.credentials)
    const remoteId = await resolveRefundRemoteId(credentials, input)
    const result = await refundTransaction(credentials, {
      remoteId,
      amount: input.amount !== undefined ? input.amount.toFixed(2) : undefined,
      currencyCode: AUTOPAY_CURRENCY,
      idempotencyKey: input.idempotencyKey,
    })

    return {
      refundId: result.messageId,
      // Autopay processes refunds asynchronously (docs: up to ~30 minutes,
      // failures reported the next business day). The synchronous
      // acknowledgment is never treated as final settlement.
      status: 'pending' as UnifiedPaymentStatus,
      refundedAmount: input.amount ?? 0,
      providerData: {
        acknowledged: result.acknowledged,
        note: 'Autopay refunds are processed asynchronously; call getStatus to confirm the final outcome.',
      },
    }
  },

  async cancel(input: CancelInput): Promise<CancelResult> {
    const credentials = resolveCredentials(input.credentials)
    const result = await cancelTransaction(credentials, {
      orderId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
    })

    if (result.confirmation === 'CONFIRMED' && result.reason === 'CANCELED_FULLY') {
      return {
        status: 'cancelled',
        providerData: { reason: result.reason, messageId: result.messageId },
      }
    }

    if (result.confirmation === 'CONFIRMED') {
      // Docs also document CONFIRMED / CANCELED_PARTIALLY: at least one
      // attempt was cancelled but another attempt for the same OrderID could
      // not be (for example because it already settled). Claiming a clean
      // `cancelled` here would be a fake state transition the core status
      // machine cannot walk back from (cancelled -> captured is rejected),
      // permanently hiding a payment that actually went through. Reconcile
      // against the real current state instead of trusting the label.
      const interpretation = await resolveStatusInterpretation(credentials, input.sessionId)
      if (interpretation.status === 'captured') {
        return {
          status: 'captured',
          providerData: {
            reason: result.reason,
            messageId: result.messageId,
            reconciledAfterPartialCancel: true,
          },
        }
      }
      const { t: translatePartial } = await resolveTranslations()
      throw new Error(translatePartial(
        'gateway_autopay.errors.cancelPartial',
        'Autopay only partially cancelled this payment ({reason}) and no settled payment was found — this needs to be resolved manually before treating it as cancelled.',
        { reason: result.reason ?? 'unknown reason' },
      ))
    }

    const { t } = await resolveTranslations()
    throw new Error(t(
      'gateway_autopay.errors.cancelFailed',
      'Autopay could not cancel this payment. It may already be settled — try a refund instead. ({reason})',
      { reason: result.reason ?? 'no reason provided by Autopay' },
    ))
  },

  async getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus> {
    const credentials = resolveCredentials(input.credentials)
    const { transactions, reason } = await queryTransactionStatus(credentials, { orderId: input.sessionId })
    const interpretation = interpretAutopayTransactionStatus(transactions)

    return {
      status: interpretation.status,
      amount: interpretation.amount,
      amountReceived: interpretation.amountReceived,
      currencyCode: interpretation.currencyCode || AUTOPAY_CURRENCY,
      providerData: {
        remoteId: interpretation.matchedRemoteId,
        anomaly: interpretation.anomaly,
        transactionCount: transactions.length,
        reason,
      },
    }
  },

  async verifyWebhook(_input: VerifyWebhookInput): Promise<WebhookEvent> {
    throw new Error('[internal] Autopay ITN handling is deferred to a follow-up spec (see .ai/specs/2026-09-10-autopay-hosted-pln-payment-sessions.md, "Why ITN Is Out of Scope") — this integration reads status via getStatus() instead')
  },

  mapStatus(providerStatus: string, _eventType?: string): UnifiedPaymentStatus {
    return mapAutopayStatus(providerStatus)
  },
}
