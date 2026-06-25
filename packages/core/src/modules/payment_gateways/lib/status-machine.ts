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
