import type { EntityManager } from '@mikro-orm/postgresql'

export type LowStockBalanceFilterMode = 'belowReorder' | 'belowSafety'

type LowStockScope = {
  organizationId: string
  tenantId: string
  warehouseId?: string | null
}

export async function resolveLowStockVariantIds(
  em: EntityManager,
  scope: LowStockScope,
  mode: LowStockBalanceFilterMode,
): Promise<string[]> {
  const params: unknown[] = [scope.organizationId, scope.tenantId]
  let warehouseJoin = ''
  if (scope.warehouseId) {
    warehouseJoin = ' and b.warehouse_id = ?'
    params.push(scope.warehouseId)
  }

  const thresholdExpr =
    mode === 'belowSafety'
      ? 'coalesce(p.safety_stock, 0)'
      : 'coalesce(p.reorder_point, 0)'

  const thresholdGuard =
    mode === 'belowSafety'
      ? 'coalesce(p.safety_stock, 0) > 0'
      : '(coalesce(p.reorder_point, 0) > 0 or coalesce(p.safety_stock, 0) > 0)'

  params.push(scope.organizationId, scope.tenantId)

  const sql = `
    select distinct p.catalog_variant_id as catalog_variant_id
    from wms_product_inventory_profiles p
    join (
      select
        b.catalog_variant_id,
        b.warehouse_id,
        sum(
          coalesce(b.quantity_on_hand, 0)
          - coalesce(b.quantity_reserved, 0)
          - coalesce(b.quantity_allocated, 0)
        ) as available
      from wms_inventory_balances b
      where b.organization_id = ?
        and b.tenant_id = ?
        and b.deleted_at is null
        ${warehouseJoin}
      group by b.catalog_variant_id, b.warehouse_id
    ) availability
      on availability.catalog_variant_id = p.catalog_variant_id
    where p.organization_id = ?
      and p.tenant_id = ?
      and p.deleted_at is null
      and p.catalog_variant_id is not null
      and ${thresholdGuard}
      and availability.available <= ${thresholdExpr}
  `

  const rows = await em.getConnection().execute<Array<{ catalog_variant_id: string }>>(sql, params)
  return rows
    .map((row) => row.catalog_variant_id?.trim())
    .filter((value): value is string => Boolean(value))
}

/** Sentinel UUID that never matches a real entity — forces zero results when a low-stock filter returns an empty variant set. */
const NO_MATCH_UUID = '00000000-0000-4000-8000-000000000000'

export function formatLowStockVariantIdsForFilter(variantIds: string[]): string[] {
  return variantIds.length > 0 ? variantIds : [NO_MATCH_UUID]
}
