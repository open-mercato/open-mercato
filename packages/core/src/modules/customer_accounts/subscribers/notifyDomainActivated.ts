import type { EventBus } from '@open-mercato/events/types'

export const metadata = {
  event: 'customer_accounts.domain_mapping.activated',
  persistent: true,
  id: 'customer_accounts:notify-domain-activated',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const data = (payload ?? {}) as Record<string, unknown>
  const id = typeof data.id === 'string' ? data.id : null
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId : null
  const organizationId = typeof data.organizationId === 'string' ? data.organizationId : null
  const hostname = typeof data.hostname === 'string' ? data.hostname : ''
  if (!id || !tenantId || !organizationId) return

  try {
    const eventBus = ctx.resolve<EventBus>('eventBus')
    await eventBus.emitEvent('notifications.create', {
      type: 'customer_accounts.domain_mapping.activated',
      tenantId,
      organizationId,
      sourceEntityId: id,
      data: { hostname },
    })
  } catch {
    // Notifications module may be absent — best-effort.
  }
}
