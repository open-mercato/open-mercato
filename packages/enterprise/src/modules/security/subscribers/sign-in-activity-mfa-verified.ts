import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { SubscriberContext } from '@open-mercato/events/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { MfaChallenge } from '../data/entities'
import { readSignInActivityConfig } from '../lib/sign-in-activity-config'
import { persistSignInMfaReceipt, reportSignInMfaFailure } from '../lib/sign-in-mfa-receipt'

export const metadata = {
  event: 'security.mfa.verified',
  persistent: true,
  id: 'security:sign-in-activity-mfa-verified',
}

const payloadSchema = z.object({ userId: z.string().uuid(), challengeId: z.string().uuid() })

export default async function subscribe(payload: unknown, context: SubscriberContext) {
  const parsed = payloadSchema.safeParse(payload)
  const tenantId = context.tenantId
  const config = readSignInActivityConfig()
  if (!parsed.success || !tenantId || !config.enabled) return
  const { userId, challengeId } = parsed.data
  const em = context.resolve<EntityManager>('em')

  try {
    await em.transactional(async (transaction) => {
      const challenge = await findOneWithDecryption(transaction, MfaChallenge, {
        tenantId, userId, id: challengeId,
      }, undefined, { tenantId })
      if (!challenge?.signInAttemptId || !challenge.verifiedAt) return
      if (challenge.createdAt.getTime() < Date.now() - config.retentionMs) return
      await persistSignInMfaReceipt(transaction, {
        tenantId, userId, attemptId: challenge.signInAttemptId,
      }, { status: 'verified', challengeId, verifiedAt: challenge.verifiedAt })
    })
  } catch {
    reportSignInMfaFailure('security.sign_in_mfa_receipt_failed')
  }
}
