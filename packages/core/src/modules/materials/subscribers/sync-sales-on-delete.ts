import type { EntityManager } from '@mikro-orm/postgresql'
import { Material, MaterialSalesProfile } from '../data/entities'

export const metadata = {
  event: 'materials.sales_profile.deleted',
  persistent: true,
  id: 'materials:sync-sales-capability-on-delete',
}

type SalesProfileDeletedPayload = {
  id: string
  materialId: string
  organizationId: string
  tenantId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Materializes Material.is_sellable = false when the sales profile is removed.
 *
 * Defense-in-depth: also re-checks for any non-soft-deleted profile row in case
 * a concurrent upsert happened — only flips the flag if zero live rows remain
 * for this material.
 *
 * Counterpart: subscribers/sync-sales-on-create.ts toggles the flag to true
 * when a profile appears.
 */
export default async function handle(payload: SalesProfileDeletedPayload, ctx: ResolverContext) {
  if (!payload?.materialId) return
  const em = (ctx.resolve('em') as EntityManager).fork()
  const material = await em.findOne(Material, { id: payload.materialId })
  if (!material) return
  // Re-check live profile rows (a concurrent upsert may have created a new one).
  const liveProfile = await em.findOne(MaterialSalesProfile, {
    materialId: payload.materialId,
    deletedAt: null,
  })
  const expectedFlag = !!liveProfile
  if (material.isSellable === expectedFlag) return
  material.isSellable = expectedFlag
  await em.flush()
}
