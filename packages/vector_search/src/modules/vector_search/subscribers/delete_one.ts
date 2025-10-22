export const metadata = { event: 'query_index.delete_one', persistent: false }

export default async function handle(
  payload: { entityType?: string; recordId?: string; organizationId?: string | null; tenantId?: string | null },
  ctx: { resolve: <T=unknown>(key: string) => T }
) {
  try {
    const service = ctx.resolve('vectorSearchService') as { markDeleted: (input: any) => Promise<void> }
    if (!service || typeof service.markDeleted !== 'function') return
    if (!payload || !payload.entityType || !payload.recordId) return
    await service.markDeleted({
      entityType: payload.entityType,
      recordId: payload.recordId,
      organizationId: payload.organizationId ?? null,
      tenantId: payload.tenantId ?? null,
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[vector_search] delete subscriber failed', error)
  }
}
