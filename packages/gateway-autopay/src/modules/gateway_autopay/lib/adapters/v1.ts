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
import {
  buildSessionRequest,
  cancelTransaction,
  queryTransactionStatus,
  refundTransaction,
  sanitizeOrderId,
  type AutopayCredentials,
} from '../autopay-client'
import { mapAutopayStatus, interpretAutopayTransactionStatus } from '../status-map'

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
 * `createSession` for the `autopay` provider MUST populate that key.
 */
function readCustomerEmail(metadata: Record<string, unknown> | undefined): string {
  const value = metadata?.customerEmail
  if (typeof value !== 'string' || !value) {
    throw new Error('Autopay requires metadata.customerEmail to be set on every session (CustomerEmail is a required field per the Autopay Online v1.1 documentation)')
  }
  return value
}

function readGatewayId(metadata: Record<string, unknown> | undefined): string | undefined {
  const value = metadata?.gatewayId
  return typeof value === 'string' && value ? value : undefined
}

/**
 * Autopay's `transactionRefund` needs the provider's own `remoteID`, not the
 * merchant `OrderID` used elsewhere in this adapter — `remoteID` is only
 * known once the payer picks a channel (captured from a prior `getStatus`
 * call) and must be threaded through by the caller.
 */
function readRemoteId(metadata: Record<string, unknown> | undefined): string {
  const value = metadata?.remoteId
  if (typeof value !== 'string' || !value) {
    throw new Error('Autopay refund requires metadata.remoteId, the provider transaction id captured from a prior getStatus call — the OrderID alone is not sufficient')
  }
  return value
}

export const autopayAdapterV1: GatewayAdapter = {
  providerKey: 'autopay',

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    if (input.currencyCode !== 'PLN') {
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
    throw new Error('Autopay does not support capture for hosted-redirect sessions: payment settles immediately on redirect completion. This capability is unsupported by this integration.')
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const credentials = resolveCredentials(input.credentials)
    const remoteId = readRemoteId(input.metadata)
    const result = await refundTransaction(credentials, {
      remoteId,
      amount: input.amount !== undefined ? input.amount.toFixed(2) : undefined,
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
    const result = await cancelTransaction(credentials, { orderId: input.sessionId })

    if (result.confirmation === 'CONFIRMED') {
      return {
        status: 'cancelled',
        providerData: { reason: result.reason, messageId: result.messageId },
      }
    }

    throw new Error(`Autopay could not cancel the transaction — it may already be settled (use refund instead): ${result.reason ?? 'no reason provided by Autopay'}`)
  },

  async getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus> {
    const credentials = resolveCredentials(input.credentials)
    const { transactions } = await queryTransactionStatus(credentials, { orderId: input.sessionId })
    const interpretation = interpretAutopayTransactionStatus(transactions)

    return {
      status: interpretation.status,
      amount: transactions[0] ? Number(transactions[0].amount) : 0,
      amountReceived: interpretation.amountReceived,
      currencyCode: interpretation.currencyCode || 'PLN',
      providerData: {
        remoteId: interpretation.matchedRemoteId,
        anomaly: interpretation.anomaly,
        transactionCount: transactions.length,
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
