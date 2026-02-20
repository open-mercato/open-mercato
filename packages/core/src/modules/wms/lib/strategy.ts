import type { EntityManager } from '@mikro-orm/postgresql'
import { InventoryBalance, InventoryLot, ProductInventoryProfile } from '../data/entities'

export type InventoryStrategy = 'fifo' | 'lifo' | 'fefo'

export interface StrategyContext {
  em: EntityManager
  warehouseId: string
  catalogVariantId: string
  tenantId: string
  organizationId: string
}

export async function resolveStrategy(ctx: StrategyContext): Promise<InventoryStrategy> {
  const profile = await ctx.em.findOne(ProductInventoryProfile, {
    catalogVariantId: ctx.catalogVariantId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  })
  if (profile?.defaultStrategy === 'lifo') return 'lifo'
  if (profile?.defaultStrategy === 'fefo') return 'fefo'
  return 'fifo'
}

/**
 * Returns balances ordered by the given strategy.
 * FIFO: oldest createdAt first
 * LIFO: newest createdAt first
 * FEFO: earliest lot expires_at first, fallback to FIFO
 */
export async function getOrderedBalances(
  ctx: StrategyContext,
  strategy: InventoryStrategy,
  locationId?: string,
): Promise<InventoryBalance[]> {
  const where: Record<string, unknown> = {
    warehouseId: ctx.warehouseId,
    catalogVariantId: ctx.catalogVariantId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  }
  if (locationId) where.locationId = locationId

  const balances = await ctx.em.find(InventoryBalance, where)

  if (strategy === 'fefo') {
    const lotIds = balances.map((b) => b.lotId).filter(Boolean) as string[]
    const lots = lotIds.length > 0
      ? await ctx.em.find(InventoryLot, { id: { $in: lotIds }, deletedAt: null })
      : []
    const lotMap = new Map(lots.map((l) => [l.id, l]))

    return balances.sort((a, b) => {
      const lotA = a.lotId ? lotMap.get(a.lotId) : null
      const lotB = b.lotId ? lotMap.get(b.lotId) : null
      const expA = lotA?.expiresAt?.getTime() ?? Infinity
      const expB = lotB?.expiresAt?.getTime() ?? Infinity
      if (expA !== expB) return expA - expB
      return a.createdAt.getTime() - b.createdAt.getTime()
    })
  }

  if (strategy === 'lifo') {
    return balances.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  return balances.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

export function computeAvailable(balance: InventoryBalance): number {
  return balance.quantityOnHand - balance.quantityReserved - balance.quantityAllocated
}
