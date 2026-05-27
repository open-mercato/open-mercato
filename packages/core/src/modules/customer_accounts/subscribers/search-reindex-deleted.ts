export const metadata = {
  event: 'customer_accounts.user.deleted',
  persistent: false,
  id: 'customer_accounts:query-index-reindex-deleted',
}

type Payload = {
  id?: string
  tenantId?: string | null
  organizationId?: string | null
}

type EventBus = { emitEvent: (name: string, body: unknown, options?: unknown) => Promise<void> }
type HandlerContext = { resolve: <T = unknown>(name: string) => T }

export default async function handle(payload: Payload, ctx: HandlerContext) {
  const userId = typeof payload?.id === 'string' ? payload.id : null
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId : null
  if (!userId || !tenantId) return
  let bus: EventBus | null = null
  try {
    bus = ctx.resolve<EventBus>('eventBus')
  } catch {
    bus = null
  }
  if (!bus) return
  await bus.emitEvent(
    'query_index.delete_one',
    {
      entityType: 'customer_accounts:customer_user',
      recordId: userId,
      organizationId: payload.organizationId ?? null,
      tenantId,
    },
    {
      tenantId,
      organizationId: payload.organizationId ?? null,
    },
  ).catch(() => undefined)
}