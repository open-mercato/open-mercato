/**
 * Business-key vocabulary for idempotent workflow starts (#7182).
 *
 * PURE: no ORM, DI or registry imports, so validators, routes and the executor
 * share one definition of what a valid key is and when a key may be reused.
 */

import type { WorkflowInstanceStatus } from '../data/entities'

export const WORKFLOW_BUSINESS_KEY_REUSE_POLICIES = [
  'reject_duplicate',
  'allow_duplicate',
  'allow_duplicate_failed_only',
] as const

export type WorkflowBusinessKeyReusePolicy = (typeof WORKFLOW_BUSINESS_KEY_REUSE_POLICIES)[number]

export const DEFAULT_WORKFLOW_BUSINESS_KEY_REUSE_POLICY: WorkflowBusinessKeyReusePolicy = 'reject_duplicate'

export const WORKFLOW_BUSINESS_KEY_MAX_LENGTH = 255

/**
 * The instance state machine's terminal statuses. MUST match the predicate of
 * the `workflow_instances_business_key_open_uq` partial unique index — a status
 * missing here would let a finished run keep its key locked forever.
 */
export const WORKFLOW_TERMINAL_INSTANCE_STATUSES: readonly WorkflowInstanceStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'COMPENSATED',
]

const UNSUCCESSFUL_TERMINAL_INSTANCE_STATUSES: readonly WorkflowInstanceStatus[] = [
  'FAILED',
  'CANCELLED',
  'COMPENSATED',
]

export type BusinessKeyNormalization =
  | { ok: true; businessKey: string | null }
  | { ok: false; reason: 'empty' | 'tooLong' }

export function normalizeBusinessKey(value: string | null | undefined): BusinessKeyNormalization {
  if (value === undefined || value === null) return { ok: true, businessKey: null }
  const trimmed = value.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }
  if (trimmed.length > WORKFLOW_BUSINESS_KEY_MAX_LENGTH) return { ok: false, reason: 'tooLong' }
  return { ok: true, businessKey: trimmed }
}

export function isTerminalInstanceStatus(status: WorkflowInstanceStatus): boolean {
  return WORKFLOW_TERMINAL_INSTANCE_STATUSES.includes(status)
}

/**
 * Whether a start carrying a key that already belongs to `existingStatus` may
 * create a NEW instance. An open instance is never reused past — that is the
 * guarantee the partial unique index enforces.
 */
export function canStartNewInstanceForBusinessKey(
  policy: WorkflowBusinessKeyReusePolicy,
  existingStatus: WorkflowInstanceStatus,
): boolean {
  if (!isTerminalInstanceStatus(existingStatus)) return false
  if (policy === 'allow_duplicate') return true
  if (policy === 'allow_duplicate_failed_only') {
    return UNSUCCESSFUL_TERMINAL_INSTANCE_STATUSES.includes(existingStatus)
  }
  return false
}
