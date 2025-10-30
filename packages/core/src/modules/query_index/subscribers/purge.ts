import type { EntityManager } from '@mikro-orm/postgresql'
import { purgeIndexScope } from '../lib/purge'

export const metadata = { event: 'query_index.purge', persistent: true }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<EntityManager>('em')
  const entityType = String(payload?.entityType || '')
  if (!entityType) return
  const orgId = payload?.organizationId ?? null
  const tenantId = payload?.tenantId ?? null

  await purgeIndexScope(em, { entityType, organizationId: orgId, tenantId })
}
