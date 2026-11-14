import type { UnifiedPaymentStatus } from '@open-mercato/shared/modules/payment_gateways/types'

const TPAY_STATUS_MAP: Record<string, UnifiedPaymentStatus> = {
  pending: 'pending',
  paid: 'captured',
  correct: 'captured',
  refund: 'refunded',
  canceled: 'cancelled',
}

export function mapTpayStatus(status: string | null | undefined): UnifiedPaymentStatus {
  if (typeof status !== 'string') return 'unknown'
  return Object.prototype.hasOwnProperty.call(TPAY_STATUS_MAP, status) ? TPAY_STATUS_MAP[status] : 'unknown'
}
