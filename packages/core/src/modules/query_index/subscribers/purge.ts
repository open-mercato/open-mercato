import type { EntityManager } from '@mikro-orm/postgresql'
import { recordIndexerError } from '@/lib/indexers/error-log'
import { purgeIndexScope } from '../lib/purge'

export const metadata = { event: 'query_index.purge', persistent: true }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<EntityManager>('em')
  const entityType = String(payload?.entityType || '')
  if (!entityType) return
  const orgId = payload?.organizationId ?? null
  const tenantId = payload?.tenantId ?? null

  try {
    await purgeIndexScope(em, { entityType, organizationId: orgId, tenantId })
  } catch (error) {
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
