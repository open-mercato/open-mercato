import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'

const SEARCH_PAGE_SIZE = 100

async function queryMatchingIds(
  ctx: CrudCtx,
  entityId: string,
  filters: Record<string, unknown>,
  source: string,
): Promise<string[]> {
  const tenantId = ctx.auth?.tenantId
  if (!tenantId) return []
  try {
    const queryEngine = ctx.container.resolve('queryEngine') as QueryEngine
    const result = await queryEngine.query<{ id?: string | null }>(entityId, {
      tenantId,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? undefined,
      organizationIds: ctx.organizationIds ?? undefined,
      filters,
      fields: ['id'],
      page: { page: 1, pageSize: SEARCH_PAGE_SIZE },
    })
    return (result.items ?? [])
      .map((row) => (typeof row?.id === 'string' ? row.id : null))
      .filter((id): id is string => Boolean(id))
  } catch (err) {
    console.warn(`[wms.listSearch] ${source} lookup failed`, err)
    return []
  }
}

/**
 * Resolve warehouse ids whose name or code matches an already-escaped ILIKE term
 * (e.g. `%midnight%`). Used by reservation/balance list search so operators can
 * find rows by the labels shown in the table, not only serial numbers.
 */
export async function resolveWarehouseIdsMatchingSearch(
  ctx: CrudCtx,
  like: string,
): Promise<string[]> {
  return queryMatchingIds(
    ctx,
    E.wms.warehouse,
    {
      $or: [
        { name: { $ilike: like } },
        { code: { $ilike: like } },
      ],
    },
    'warehouse-search',
  )
}

/**
 * Resolve catalog variant ids whose name or SKU matches an already-escaped
 * ILIKE term. Decoupled from catalog ORM via QueryEngine (same as list enrichers).
 */
export async function resolveVariantIdsMatchingSearch(
  ctx: CrudCtx,
  like: string,
): Promise<string[]> {
  return queryMatchingIds(
    ctx,
    E.catalog.catalog_product_variant,
    {
      $or: [
        { name: { $ilike: like } },
        { sku: { $ilike: like } },
      ],
    },
    'variant-search',
  )
}

/**
 * Build a reservation-list `$or` clause that matches serial number, warehouse
 * label, or variant name/SKU for the given search term.
 */
export async function buildReservationSearchOrFilters(
  ctx: CrudCtx,
  term: string,
  escapeLike: (value: string) => string,
): Promise<Array<Record<string, unknown>>> {
  const like = `%${escapeLike(term)}%`
  const orFilters: Array<Record<string, unknown>> = [{ serial_number: { $ilike: like } }]
  const [warehouseIds, variantIds] = await Promise.all([
    resolveWarehouseIdsMatchingSearch(ctx, like),
    resolveVariantIdsMatchingSearch(ctx, like),
  ])
  if (warehouseIds.length > 0) {
    orFilters.push({ warehouse_id: { $in: warehouseIds } })
  }
  if (variantIds.length > 0) {
    orFilters.push({ catalog_variant_id: { $in: variantIds } })
  }
  return orFilters
}
