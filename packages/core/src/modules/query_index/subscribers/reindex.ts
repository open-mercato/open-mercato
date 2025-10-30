import type { EntityManager } from '@mikro-orm/postgresql'
import { reindexEntity } from '../lib/reindexer'

export const metadata = { event: 'query_index.reindex', persistent: true }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<EntityManager>('em')
  const eventBus = ctx.resolve<any>('eventBus')
  const entityType = String(payload?.entityType || '')
  if (!entityType) return
  // Keep undefined to mean "no filter"; null to mean "global-only"
  const tenantId: string | null | undefined = payload?.tenantId
  const forceFull: boolean = Boolean(payload?.force)
  const batchSize = Number.isFinite(payload?.batchSize) ? Number(payload.batchSize) : undefined
  const partitionCount = Number.isFinite(payload?.partitionCount) ? Math.max(1, Math.trunc(payload.partitionCount)) : undefined
  const partitionIndex = Number.isFinite(payload?.partitionIndex) ? Math.max(0, Math.trunc(payload.partitionIndex)) : undefined
  const resetCoverage = typeof payload?.resetCoverage === 'boolean' ? payload.resetCoverage : undefined

  await reindexEntity(em, {
    entityType,
    tenantId,
    force: forceFull,
    batchSize,
    eventBus,
    emitVectorizeEvents: true,
    partitionCount,
    partitionIndex,
    resetCoverage,
  })
}
