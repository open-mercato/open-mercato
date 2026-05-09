// Lightweight afterList enrichers shared across WMS list routes.
//
// These run inside `makeCrudRoute({ hooks: { afterList } })` and batch-resolve
// foreign-key labels (e.g. warehouse_id -> warehouse_name) so backend tables
// can render the human-readable label without N+1 lookups on the client.
//
// We deliberately use the `queryEngine` (entity-id-based) rather than ORM
// entity classes so this file stays decoupled from `wms/data/entities`
// internals and from the catalog ORM — same pattern used by High #5 in WMS
// data enrichers.

import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'

type AnyListPayload = {
  items?: Array<Record<string, unknown>>
}

type LookupRow = Record<string, unknown> & { id?: string | null }

const LOOKUP_BATCH_SIZE = 500

function uniqueIdsFromKeys(
  items: Array<Record<string, unknown>>,
  keys: string[],
): string[] {
  const set = new Set<string>()
  for (const item of items) {
    for (const key of keys) {
      const value = item?.[key]
      if (typeof value === 'string' && value.length > 0) set.add(value)
    }
  }
  return Array.from(set)
}

/**
 * Internal: batch-load `entityId` rows by primary id through the QueryEngine
 * and return them keyed by id. Splits requests into chunks of 500. Errors are
 * logged (with a `source` tag for grep-ability) and degrade to an empty map so
 * the surrounding list response still goes through.
 */
async function batchLoadById(
  ctx: CrudCtx,
  entityId: string,
  ids: string[],
  fields: string[],
  source: string,
): Promise<Map<string, LookupRow>> {
  if (ids.length === 0) return new Map()
  const tenantId = ctx.auth?.tenantId
  if (!tenantId) return new Map()
  const queryEngine = ctx.container.resolve('queryEngine') as QueryEngine
  const map = new Map<string, LookupRow>()
  for (let offset = 0; offset < ids.length; offset += LOOKUP_BATCH_SIZE) {
    const slice = ids.slice(offset, offset + LOOKUP_BATCH_SIZE)
    try {
      const result = await queryEngine.query<LookupRow>(entityId, {
        tenantId,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? undefined,
        organizationIds: ctx.organizationIds ?? undefined,
        filters: { id: { $in: slice } },
        fields,
        page: { page: 1, pageSize: slice.length },
      })
      for (const row of result.items ?? []) {
        if (row?.id && typeof row.id === 'string') map.set(row.id, row)
      }
    } catch (err) {
      console.warn(`[wms.listEnrichers] ${source} batch lookup failed`, err)
    }
  }
  return map
}

function decorateOnce(item: Record<string, unknown>, key: string, value: unknown): void {
  if (item[key] === undefined) item[key] = value
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

type WarehouseRow = LookupRow & { name?: string | null; code?: string | null }

const WAREHOUSE_FIELDS = ['id', 'name', 'code']

/**
 * Decorate list items with `warehouse_name` and `warehouse_code` when they
 * carry a `warehouse_id` column. Mutates `payload.items` in place.
 */
export async function attachWarehouseLabelsToListItems(
  payload: AnyListPayload,
  ctx: CrudCtx,
): Promise<void> {
  const items = Array.isArray(payload?.items) ? payload.items : []
  if (items.length === 0) return
  const ids = uniqueIdsFromKeys(items, ['warehouse_id'])
  if (ids.length === 0) return
  const map = (await batchLoadById(
    ctx,
    E.wms.warehouse,
    ids,
    WAREHOUSE_FIELDS,
    'warehouse',
  )) as Map<string, WarehouseRow>
  if (map.size === 0) return
  for (const item of items) {
    const id = item?.warehouse_id
    if (typeof id !== 'string' || !id) continue
    const row = map.get(id)
    if (!row) continue
    decorateOnce(item, 'warehouse_name', row.name ?? null)
    decorateOnce(item, 'warehouse_code', row.code ?? null)
  }
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

type LocationLookupRow = LookupRow & { code?: string | null; type?: string | null }

const LOCATION_FIELDS = ['id', 'code', 'type']

/**
 * Decorate list items with location label/type for any of these foreign-key
 * columns: `location_id`, `location_from_id`, `location_to_id`. The decorated
 * fields follow the same prefix:
 *
 *   location_id        -> location_code, location_type
 *   location_from_id   -> location_from_code, location_from_type
 *   location_to_id     -> location_to_code, location_to_type
 *
 * Mutates `payload.items` in place.
 */
export async function attachLocationLabelsToListItems(
  payload: AnyListPayload,
  ctx: CrudCtx,
): Promise<void> {
  const items = Array.isArray(payload?.items) ? payload.items : []
  if (items.length === 0) return
  const fkColumns = ['location_id', 'location_from_id', 'location_to_id']
  const ids = uniqueIdsFromKeys(items, fkColumns)
  if (ids.length === 0) return
  const map = (await batchLoadById(
    ctx,
    E.wms.warehouse_location,
    ids,
    LOCATION_FIELDS,
    'location',
  )) as Map<string, LocationLookupRow>
  if (map.size === 0) return
  for (const item of items) {
    for (const fk of fkColumns) {
      const id = item?.[fk]
      if (typeof id !== 'string' || !id) continue
      const row = map.get(id)
      if (!row) continue
      const prefix = fk.replace(/_id$/, '')
      decorateOnce(item, `${prefix}_code`, row.code ?? null)
      decorateOnce(item, `${prefix}_type`, row.type ?? null)
    }
  }
}

// ---------------------------------------------------------------------------
// Catalog variants
// ---------------------------------------------------------------------------

type VariantLookupRow = LookupRow & {
  name?: string | null
  sku?: string | null
  product_id?: string | null
}

const VARIANT_FIELDS = ['id', 'name', 'sku', 'product_id']

/**
 * Decorate list items with `variant_name`, `variant_sku`, and `product_id`
 * when they carry a `catalog_variant_id` column. Mutates `payload.items` in
 * place. Uses `queryEngine.query(E.catalog.catalog_product_variant, ...)`
 * rather than importing the catalog ORM entity directly, to keep the WMS
 * module decoupled from the catalog package internals.
 */
export async function attachVariantLabelsToListItems(
  payload: AnyListPayload,
  ctx: CrudCtx,
): Promise<void> {
  const items = Array.isArray(payload?.items) ? payload.items : []
  if (items.length === 0) return
  const ids = uniqueIdsFromKeys(items, ['catalog_variant_id'])
  if (ids.length === 0) return
  const map = (await batchLoadById(
    ctx,
    E.catalog.catalog_product_variant,
    ids,
    VARIANT_FIELDS,
    'variant',
  )) as Map<string, VariantLookupRow>
  if (map.size === 0) return
  for (const item of items) {
    const id = item?.catalog_variant_id
    if (typeof id !== 'string' || !id) continue
    const row = map.get(id)
    if (!row) continue
    decorateOnce(item, 'variant_name', row.name ?? null)
    decorateOnce(item, 'variant_sku', row.sku ?? null)
    decorateOnce(item, 'catalog_product_id', row.product_id ?? null)
  }
}
