import type { EntityManager } from '@mikro-orm/postgresql'
import { Material } from '../data/entities'

export const metadata = {
  event: 'materials.sales_profile.created',
  persistent: true,
  id: 'materials:sync-sales-capability-on-create',
}

type SalesProfileCreatedPayload = {
  id: string
  materialId: string
  organizationId: string
  tenantId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Materializes Material.is_sellable = true when a sales profile row appears.
 *
 * Idempotent: if the flag is already true (or the master row no longer exists),
 * no UPDATE is issued. Forked EM avoids identity-map pollution from any
 * concurrent CRUD subscribers running in the same request lifecycle.
 *
 * Counterpart: subscribers/sync-sales-on-delete.ts toggles the flag back to false
 * when the profile is removed.
 */
export default async function handle(payload: SalesProfileCreatedPayload, ctx: ResolverContext) {
  if (!payload?.materialId) return
  const em = (ctx.resolve('em') as EntityManager).fork()
  const material = await em.findOne(Material, { id: payload.materialId })
  if (!material) return
  if (material.isSellable) return
  material.isSellable = true
  await em.flush()
}
