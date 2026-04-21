import { MESSAGE_ENTITY_ID } from '../lib/constants'

export const metadata = {
  event: 'messages.message.sent',
  persistent: false,
  id: 'messages:query-index-reindex-sent',
}

type Payload = {
  messageId?: string
  tenantId?: string | null
  organizationId?: string | null
}

type EventBus = { emitEvent: (name: string, body: unknown, options?: unknown) => Promise<void> }
type HandlerContext = { resolve: <T = unknown>(name: string) => T }

export default async function handle(payload: Payload, ctx: HandlerContext) {
  const messageId = typeof payload?.messageId === 'string' ? payload.messageId : null
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId : null
  if (!messageId || !tenantId) return
  let bus: EventBus | null = null
  try {
    bus = ctx.resolve<EventBus>('eventBus')
  } catch {
    bus = null
  }
  if (!bus) return
  await bus.emitEvent(
    'query_index.upsert_one',
    {
      entityType: MESSAGE_ENTITY_ID,
      recordId: messageId,
      organizationId: payload.organizationId ?? null,
      tenantId,
      crudAction: 'created',
      coverageBaseDelta: 1,
    },
    {
      tenantId,
      organizationId: payload.organizationId ?? null,
    },
  ).catch(() => undefined)
}
