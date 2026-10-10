import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'

/**
 * Which record's version each payment verb is guarded by.
 *
 * `record` locks the invoiced document the money lands on (the order or the
 * abstract), `void` locks the payment row itself, and `resync` is a repair
 * action that enforces no lock at all. Sending the wrong version produces a 409
 * that looks like a bug — this helper is the single place that decides.
 */
export type PaymentLockAction = 'record' | 'void' | 'resync'

export type PaymentLockSource = { updatedAt?: string | null; updated_at?: string | null } | null | undefined

export function paymentLockHeaders(action: PaymentLockAction, source: PaymentLockSource): Record<string, string> {
  if (action === 'resync') return {}
  const version = source?.updatedAt ?? source?.updated_at ?? null
  return buildOptimisticLockHeader(version)
}
