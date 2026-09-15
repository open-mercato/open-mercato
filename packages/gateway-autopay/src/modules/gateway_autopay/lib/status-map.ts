import type { UnifiedPaymentStatus } from '@open-mercato/shared/modules/payment_gateways/types'

/**
 * Base hosted-redirect flow only sends PENDING/SUCCESS/FAILURE (docs §
 * "Szczegółowy opis zachowania i zmiany statusów płatności"). ON_HOLD and
 * CONFIRMED belong to the out-of-scope card pre-authorization extension and
 * are intentionally absent here — an unrecognized value must map to
 * 'unknown', never be guessed into a success state.
 */
const AUTOPAY_STATUS_MAP: Record<string, UnifiedPaymentStatus> = {
  PENDING: 'pending',
  SUCCESS: 'captured',
  FAILURE: 'failed',
}

export function mapAutopayStatus(paymentStatus: string): UnifiedPaymentStatus {
  return AUTOPAY_STATUS_MAP[paymentStatus] ?? 'unknown'
}

export interface AutopayTransactionRecord {
  orderID: string
  remoteID: string
  amount: string
  currency: string
  gatewayID?: string
  paymentDate: string
  paymentStatus: string
  paymentStatusDetails?: string
}

export interface AutopayStatusInterpretation {
  status: UnifiedPaymentStatus
  /** The transaction's own declared amount (docs: identical across every
   * record for one OrderID outside the out-of-scope commission-added
   * model), sourced from the same record as `amountReceived` so the two
   * never describe two different underlying transactions. */
  amount: number
  amountReceived: number
  currencyCode: string
  matchedRemoteId?: string
  anomaly?: 'overpaid'
}

/**
 * Applies the multi-transaction interpretation table from docs §
 * "Odpytanie o status transakcji" — a single OrderID can carry multiple
 * underlying Autopay transactions (e.g. the payer retried with a different
 * channel).
 */
export function interpretAutopayTransactionStatus(
  transactions: AutopayTransactionRecord[],
): AutopayStatusInterpretation {
  const successes = transactions.filter((t) => t.paymentStatus === 'SUCCESS')
  const pendings = transactions.filter((t) => t.paymentStatus === 'PENDING')

  if (successes.length === 1) {
    const [success] = successes
    const amount = Number(success.amount)
    return {
      status: 'captured',
      amount,
      amountReceived: amount,
      currencyCode: success.currency,
      matchedRemoteId: success.remoteID,
    }
  }

  if (successes.length > 1) {
    const [first] = successes
    const totalReceived = successes.reduce((sum, t) => sum + Number(t.amount), 0)
    return {
      status: 'captured',
      amount: Number(first.amount),
      amountReceived: totalReceived,
      currencyCode: first.currency,
      matchedRemoteId: first.remoteID,
      anomaly: 'overpaid',
    }
  }

  if (pendings.length > 0) {
    const [pending] = pendings
    return {
      status: 'pending',
      amount: Number(pending.amount),
      amountReceived: 0,
      currencyCode: pending.currency,
      matchedRemoteId: pending.remoteID,
    }
  }

  if (transactions.length > 0) {
    const [first] = transactions
    return {
      status: 'failed',
      amount: Number(first.amount),
      amountReceived: 0,
      currencyCode: first.currency,
      matchedRemoteId: first.remoteID,
    }
  }

  return {
    status: 'unknown',
    amount: 0,
    amountReceived: 0,
    currencyCode: '',
  }
}
