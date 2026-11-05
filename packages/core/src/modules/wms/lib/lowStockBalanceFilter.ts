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

  params.push(scope.organizationId, scope.tenantId, scope.organizationId, scope.tenantId)

  const sql = `
    select distinct availability.catalog_variant_id as catalog_variant_id
    from (
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
    left join catalog_product_variants v
      on v.id = availability.catalog_variant_id
     and v.organization_id = ?
     and v.tenant_id = ?
     and v.is_active = true
     and v.deleted_at is null
    join lateral (
      select profile.reorder_point, profile.safety_stock
      from wms_product_inventory_profiles profile
      where profile.organization_id = ?
        and profile.tenant_id = ?
        and profile.deleted_at is null
        and (
          profile.catalog_variant_id = availability.catalog_variant_id
          or (profile.catalog_variant_id is null and profile.catalog_product_id = v.product_id)
        )
      order by (profile.catalog_variant_id is null) asc
      limit 1
    ) p on true
    where ${thresholdGuard}
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
