import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { eraseXrayActor } from '../lib/projection/jobs'

const logger = createLogger('insights').child({ component: 'xray-user-deleted' })

export const metadata = {
  event: 'auth.user.deleted',
  persistent: true,
  id: 'insights:xray-user-deleted',
}

type UserDeletedPayload = {
  id?: unknown
  userId?: unknown
  tenantId?: unknown
}

type SubscriberContext = {
  resolve: <TService = unknown>(name: string) => TService
}

/**
 * GDPR: when a user is deleted, records the user in the Process X-Ray erasure ledger and
 * re-pseudonymizes every projected event of that user in the tenant with one fresh random
 * pseudonym, so the rows can no longer be linked to the user and no later re-projection
 * restores the link. Idempotent (the ledger keeps one replacement per user; a replay finds
 * no row under the user's pseudonym). Fails — and is retried — while the pseudonym key is
 * unavailable. Requires the tenant: an unscoped erasure is never attempted.
 */
export default async function handler(payload: UserDeletedPayload, ctx: SubscriberContext): Promise<void> {
  const userId = isUuid(payload?.id) ? payload.id : isUuid(payload?.userId) ? payload.userId : null
  const tenantId = isUuid(payload?.tenantId) ? payload.tenantId : null
  if (!userId || !tenantId) return
  const changed = await eraseXrayActor({ resolve: (name) => ctx.resolve(name) }, tenantId.toLowerCase(), userId.toLowerCase())
  if (changed > 0) logger.info('Re-pseudonymized Process X-Ray events of a deleted user', { tenantId, rows: changed })
}
