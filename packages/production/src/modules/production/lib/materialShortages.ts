import type { EntityManager } from '@mikro-orm/postgresql'
import { StockItem, MaterialReservation } from '../data/entities.js'
import type { StockScope } from './stockProvider.js'

/**
 * Task 3.2 — release-time material reservations + on-demand shortage list
 * (spec § Scope: "zwolnienie: snapshot, generowanie rezerwacji, lista
 * braków"). A shortage is never a hard release-blocker (release SUCCEEDS with
 * partial reservations + a reported shortage list, matching the draft-level
 * F1.2 decision) — this module only classifies/computes, it never throws.
 */

export type ShortageReason = 'no_stock_item' | 'uom_mismatch' | 'insufficient_stock'

export type ShortageLine = {
  componentProductId: string
  variantId: string | null
  qtyRequired: number
  qtyAvailable: number
  qtyShort: number
  uom: string
  reason: ShortageReason
}

/** Minimal shape both `ProductionOrderMaterial` rows and the release-time
 * in-memory snapshot rows share — kept narrow so this module never depends
 * on the full entity type. */
export type ShortageMaterialLike = {
  componentProductId: string
  componentVariantId?: string | null
  qtyRequired: string
  qtyIssued: string
  uom: string
}

/** Batch-loads every `StockItem` for the given product ids in one query
 * (no N+1 per material line — required by the task brief). */
export async function loadStockItemsByProduct(
  em: EntityManager,
  scope: StockScope,
  productIds: string[],
): Promise<StockItem[]> {
  if (productIds.length === 0) return []
  return em.find(StockItem, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    productId: { $in: productIds },
    deletedAt: null,
  })
}

export function findStockItemFor(
  items: StockItem[],
  productId: string,
  variantId: string | null | undefined,
): StockItem | null {
  const normalizedVariantId = variantId ?? null
  return items.find((item) => item.productId === productId && (item.variantId ?? null) === normalizedVariantId) ?? null
}

function netNeededFor(material: ShortageMaterialLike): number {
  return Math.max(0, Number(material.qtyRequired) - Number(material.qtyIssued))
}

/**
 * On-demand shortage recompute for `GET /orders/[id]/shortages` (spec §
 * API Contracts). Reflects CURRENT on-hand/reservation state — it does not
 * re-run the release-time reservation attempt, it only reports what is still
 * short right now: `qty_required − qty_issued − active reservations` for
 * this order, compared against truly free on-hand (`on_hand − reserved`,
 * `reserved` already covering every order's active reservations, including
 * this one).
 */
export async function computeCurrentShortages(
  em: EntityManager,
  scope: StockScope,
  orderId: string,
  materials: ShortageMaterialLike[],
): Promise<ShortageLine[]> {
  const productIds = [...new Set(materials.map((m) => m.componentProductId))]
  const stockItems = await loadStockItemsByProduct(em, scope, productIds)
  const stockItemIds = stockItems.map((item) => item.id)

  const activeReservations = stockItemIds.length
    ? await em.find(MaterialReservation, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        orderId,
        stockItemId: { $in: stockItemIds },
        status: 'active',
      })
    : []
  const reservedByStockItem = new Map<string, number>()
  for (const reservation of activeReservations) {
    reservedByStockItem.set(
      reservation.stockItemId,
      (reservedByStockItem.get(reservation.stockItemId) ?? 0) + Number(reservation.qty),
    )
  }

  const shortages: ShortageLine[] = []
  for (const material of materials) {
    const netNeeded = netNeededFor(material)
    if (netNeeded <= 0) continue

    const variantId = material.componentVariantId ?? null
    const stockItem = findStockItemFor(stockItems, material.componentProductId, variantId)
    if (!stockItem) {
      shortages.push({
        componentProductId: material.componentProductId,
        variantId,
        qtyRequired: netNeeded,
        qtyAvailable: 0,
        qtyShort: netNeeded,
        uom: material.uom,
        reason: 'no_stock_item',
      })
      continue
    }
    if (stockItem.uom !== material.uom) {
      shortages.push({
        componentProductId: material.componentProductId,
        variantId,
        qtyRequired: netNeeded,
        qtyAvailable: 0,
        qtyShort: netNeeded,
        uom: material.uom,
        reason: 'uom_mismatch',
      })
      continue
    }

    const reservedForThisMaterial = reservedByStockItem.get(stockItem.id) ?? 0
    const stillNeeded = Math.max(0, netNeeded - reservedForThisMaterial)
    if (stillNeeded <= 0) continue

    const available = Math.max(0, Number(stockItem.onHand) - Number(stockItem.reserved))
    const qtyShort = Math.max(0, stillNeeded - available)
    if (qtyShort <= 0) continue

    shortages.push({
      componentProductId: material.componentProductId,
      variantId,
      qtyRequired: stillNeeded,
      qtyAvailable: available,
      qtyShort,
      uom: material.uom,
      reason: 'insufficient_stock',
    })
  }

  return shortages
}
