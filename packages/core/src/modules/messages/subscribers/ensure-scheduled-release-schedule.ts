import { ensureMessagesScheduledReleaseSchedule } from '../lib/scheduledSend'

export const metadata = {
  event: 'messages.message.scheduled',
  persistent: true,
  id: 'messages:ensure-scheduled-release-schedule',
}

type MessageScheduledPayload = {
  tenantId?: string
  organizationId?: string | null
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

/** Scheduling a message guarantees its organization has the release tick, even when the upgrade action never ran. */
export default async function handler(payload: MessageScheduledPayload, ctx: SubscriberContext): Promise<void> {
  if (typeof payload?.tenantId !== 'string' || !payload.tenantId) return
  await ensureMessagesScheduledReleaseSchedule(ctx, {
    tenantId: payload.tenantId,
    organizationId: typeof payload.organizationId === 'string' ? payload.organizationId : null,
  })
}
