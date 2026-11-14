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

export type ManualGatewayAction = 'capture' | 'refund' | 'cancel'

const MANUAL_ACTION_TARGET_STATUSES: Record<ManualGatewayAction, UnifiedPaymentStatus[]> = {
  capture: ['captured', 'partially_captured'],
  refund: ['refunded', 'partially_refunded'],
  cancel: ['cancelled'],
}

export function canApplyManualAction(action: ManualGatewayAction, from: UnifiedPaymentStatus): boolean {
  if (isTerminalStatus(from)) return false
  const targets = MANUAL_ACTION_TARGET_STATUSES[action]
  if (!targets) return false
  if (targets.includes(from)) return true
  return targets.some((target) => isValidTransition(from, target))
}

const REFUND_STATUSES: Set<UnifiedPaymentStatus> = new Set(['refunded', 'partially_refunded'])

/**
 * A provider-confirmed refund proves the payment was captured. When a refund status reaches a
 * transaction whose capture was not recorded yet (the capture webhook is late, or was never
 * delivered), the transaction passes through `captured` on its way to the refund status instead
 * of dropping the refund. Returns that intermediate status, or `null` when no bridge applies.
 */
export function resolveImpliedCaptureStatus(
  from: UnifiedPaymentStatus,
  to: UnifiedPaymentStatus,
): UnifiedPaymentStatus | null {
  if (!REFUND_STATUSES.has(to)) return null
  if (isValidTransition(from, to)) return null
  if (!isValidTransition(from, 'captured')) return null
  if (!isValidTransition('captured', to)) return null
  return 'captured'
}
