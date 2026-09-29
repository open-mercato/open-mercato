export const metadata = {
  event: 'inbox_ops.proposal.created',
  persistent: false,
  id: 'inbox_ops:query-index-reindex-proposal-created',
}

type Payload = {
  proposalId?: string
  tenantId?: string | null
  organizationId?: string | null
}

type EventBus = { emitEvent: (name: string, body: unknown, options?: unknown) => Promise<void> }
type HandlerContext = { resolve: <T = unknown>(name: string) => T }

export default async function handle(payload: Payload, ctx: HandlerContext): Promise<void> {
  const recordId = typeof payload.proposalId === 'string' ? payload.proposalId : null
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
  if (!recordId || !tenantId) return

  let eventBus: EventBus | null = null
  try {
    eventBus = ctx.resolve<EventBus>('eventBus')
  } catch {
    return
  }

  await eventBus.emitEvent('query_index.upsert_one', {
    entityType: 'inbox_ops:inbox_proposal',
    recordId,
    organizationId: payload.organizationId ?? null,
    tenantId,
    crudAction: 'created',
    coverageBaseDelta: 1,
  }, {
    tenantId,
    organizationId: payload.organizationId ?? null,
  }).catch(() => undefined)
}
