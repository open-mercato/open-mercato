import type { EntityManager } from '@mikro-orm/postgresql'
import { CheckoutSession, CheckoutTransaction } from '../data/entities'

export const PAYMENT_RESOLVING_PROGRESS = 'payment_resolving'
const PAYMENT_PENDING_PROGRESS = 'payment_initiated'
const STALE_CLAIM_MS = 5 * 60 * 1000

type ClaimScope = { tenantId: string; organizationId: string }

export type PersistedPaymentOutcome = 'completed' | 'failed' | 'cancelled'

export function derivePersistedPaymentOutcome(
  status: CheckoutTransaction['status'] | null | undefined,
): PersistedPaymentOutcome | null {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'expired') return 'failed'
  return null
}

export async function claimAwaitingPaymentSession(
  em: EntityManager,
  sessionId: string,
  scope: ClaimScope,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS)
  const affected = await em.nativeUpdate(
    CheckoutSession,
    {
      id: sessionId,
      ...scope,
      status: 'awaiting_payment',
      $or: [
        { submitProgress: null },
        { submitProgress: { $ne: PAYMENT_RESOLVING_PROGRESS } },
        { updatedAt: { $lt: staleBefore } },
      ],
    },
    { submitProgress: PAYMENT_RESOLVING_PROGRESS, updatedAt: new Date() },
  )
  return affected > 0
}

export async function releaseAwaitingPaymentClaim(
  em: EntityManager,
  sessionId: string,
  scope: ClaimScope,
): Promise<void> {
  await em.nativeUpdate(
    CheckoutSession,
    { id: sessionId, ...scope, status: 'awaiting_payment', submitProgress: PAYMENT_RESOLVING_PROGRESS },
    { submitProgress: PAYMENT_PENDING_PROGRESS, updatedAt: new Date() },
  )
}
