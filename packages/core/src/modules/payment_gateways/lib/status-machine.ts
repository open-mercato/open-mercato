import type { UnifiedPaymentStatus } from '@open-mercato/shared/modules/payment_gateways/types'

const VALID_TRANSITIONS: Record<string, UnifiedPaymentStatus[]> = {
  pending: ['authorized', 'captured', 'failed', 'expired', 'cancelled'],
  authorized: ['captured', 'partially_captured', 'cancelled', 'failed'],
  captured: ['refunded', 'partially_refunded'],
  partially_captured: ['captured', 'refunded', 'partially_refunded', 'cancelled'],
  partially_refunded: ['refunded'],
  // Terminal states: refunded, cancelled, failed, expired — no valid transitions out
}

export const TERMINAL_STATUSES: Set<UnifiedPaymentStatus> = new Set([
  'refunded',
  'cancelled',
  'failed',
  'expired',
])

export function isValidTransition(from: UnifiedPaymentStatus, to: UnifiedPaymentStatus): boolean {
  if (from === to) return false
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}

export function isTerminalStatus(status: UnifiedPaymentStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}
