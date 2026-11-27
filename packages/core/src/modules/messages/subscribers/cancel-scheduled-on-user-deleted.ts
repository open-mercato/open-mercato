import type { EntityManager } from '@mikro-orm/postgresql'
import { Message } from '../data/entities'

export const metadata = {
  event: 'auth.user.deleted',
  persistent: true,
  id: 'messages:cancel-scheduled-on-user-deleted',
}

type AuthUserDeletedPayload = {
  id?: string
  userId?: string
  tenantId?: string
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

/** A deleted author's scheduled messages must not go out on their behalf: they return to drafts. */
export default async function handler(payload: AuthUserDeletedPayload, ctx: SubscriberContext): Promise<void> {
  const userId = payload?.id ?? payload?.userId
  if (typeof userId !== 'string' || !userId) return
  if (typeof payload.tenantId !== 'string' || !payload.tenantId) return
  const em = ctx.resolve<EntityManager>('em').fork()
  await em.nativeUpdate(
    Message,
    { senderUserId: userId, tenantId: payload.tenantId, status: 'scheduled', deletedAt: null },
    { status: 'draft', scheduledAt: null },
  )
}
