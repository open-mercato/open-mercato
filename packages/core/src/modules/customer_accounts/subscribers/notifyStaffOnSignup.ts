import type { EventBus } from '@open-mercato/events/types'

export const metadata = {
  event: 'customer_accounts.user.created',
  persistent: true,
  id: 'customer_accounts:notify-staff-on-signup',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T; eventName?: string },
): Promise<void> {
  const data = payload as Record<string, unknown>
  const userId = data?.id as string
  const email = data?.email as string
  const tenantId = data?.tenantId as string
  const organizationId = data?.organizationId as string
  if (!userId || !email || !tenantId || !organizationId) return

  try {
    const eventBus = ctx.resolve<EventBus>('eventBus')
    await eventBus.emitEvent('notifications.create', {
      type: 'customer_accounts.user.signup',
      tenantId,
      organizationId,
      sourceEntityId: userId,
      data: { userId, email },
    })
  } catch {
    // Notifications module may not be available
  }
}
