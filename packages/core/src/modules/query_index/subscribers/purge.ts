import type { EntityManager } from '@mikro-orm/postgresql'
import { recordIndexerError } from '@/lib/indexers/error-log'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import { refreshCoverageSnapshot } from '../lib/coverage'
import { purgeIndexScope } from '../lib/purge'

export const metadata = { event: 'query_index.purge', persistent: true }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<EntityManager>('em')
  const entityType = String(payload?.entityType || '')
  if (!entityType) return
  const orgId = payload?.organizationId ?? null
  const tenantId = payload?.tenantId ?? null

  try {
    await recordIndexerLog(
      { em },
      {
        source: 'query_index',
        handler: 'event:query_index.purge',
        message: `Purge started for ${entityType}`,
        entityType,
        tenantId,
        organizationId: orgId,
        details: { source: 'event' },
      },
    )
    await purgeIndexScope(em, { entityType, organizationId: orgId, tenantId })
    try {
      await refreshCoverageSnapshot(
        em,
        {
          entityType,
          organizationId: orgId,
          tenantId,
          withDeleted: false,
        },
      )
    } catch (refreshError) {
      await recordIndexerLog(
        { em },
        {
          source: 'query_index',
          handler: 'event:query_index.purge',
          level: 'warn',
          message: `Coverage refresh failed after purge for ${entityType}`,
          entityType,
          tenantId,
          organizationId: orgId,
          details: {
            error: refreshError instanceof Error ? refreshError.message : String(refreshError),
          },
        },
      ).catch(() => undefined)
    }
    await recordIndexerLog(
      { em },
      {
        source: 'query_index',
        handler: 'event:query_index.purge',
        message: `Purge completed for ${entityType}`,
        entityType,
        tenantId,
        organizationId: orgId,
      },
    )
  } catch (error) {
    await recordIndexerLog(
      { em },
      {
        source: 'query_index',
        handler: 'event:query_index.purge',
        level: 'warn',
        message: `Purge failed for ${entityType}`,
        entityType,
        tenantId,
        organizationId: orgId,
        details: { error: error instanceof Error ? error.message : String(error) },
      },
    ).catch(() => undefined)
    await recordIndexerError(
      { em },
      {
        source: 'query_index',
        handler: 'event:query_index.purge',
        error,
        entityType,
        tenantId,
        organizationId: orgId,
        payload,
      },
    )
    throw error
  }
}
