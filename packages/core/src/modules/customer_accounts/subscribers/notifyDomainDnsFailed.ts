import type { EventBus } from '@open-mercato/events/types'

export const metadata = {
  event: 'customer_accounts.domain_mapping.dns_failed',
  persistent: true,
  id: 'customer_accounts:notify-domain-dns-failed',
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
  const reason = typeof data.reason === 'string' ? data.reason : ''
  if (!id || !tenantId || !organizationId) return

  try {
    const eventBus = ctx.resolve<EventBus>('eventBus')
    await eventBus.emitEvent('notifications.create', {
      type: 'customer_accounts.domain_mapping.dns_failed',
      tenantId,
      organizationId,
      sourceEntityId: id,
      data: { hostname, reason },
    })
  } catch {
    // Notifications module may be absent — best-effort.
  }
}
