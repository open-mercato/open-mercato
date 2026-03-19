export const metadata = { event: 'translations.translation.deleted', persistent: true, id: 'translations-reindex-entity-on-delete' }

export default async function handle(
  payload: { entityType?: string; entityId?: string; tenantId?: string | null; organizationId?: string | null },
  ctx: { resolve: <T = unknown>(name: string) => T },
) {
  const entityType = String(payload?.entityType || '')
  const entityId = String(payload?.entityId || '')
  if (!entityType || !entityId) return

  const bus = ctx.resolve<{ emitEvent: (event: string, payload: unknown) => Promise<void> }>('eventBus')
  await bus.emitEvent('query_index.upsert_one', {
    entityType,
    recordId: entityId,
    tenantId: payload?.tenantId ?? null,
    organizationId: payload?.organizationId ?? null,
  })
}
