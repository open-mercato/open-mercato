export const metadata = { event: 'query_index.upsert_one', persistent: false }

export default async function handle(
  payload: { entityType?: string; recordId?: string; organizationId?: string | null; tenantId?: string | null },
  ctx: { resolve: <T=unknown>(key: string) => T }
) {
  try {
    const service = ctx.resolve('vectorSearchService') as { upsertFromIndexEvent: (input: any) => Promise<void> }
    if (!service || typeof service.upsertFromIndexEvent !== 'function') return
    if (!payload || !payload.entityType || !payload.recordId) return
    await service.upsertFromIndexEvent({
      entityType: payload.entityType,
      recordId: payload.recordId,
      organizationId: payload.organizationId ?? null,
      tenantId: payload.tenantId ?? null,
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[vector_search] upsert subscriber failed', error)
  }
}
