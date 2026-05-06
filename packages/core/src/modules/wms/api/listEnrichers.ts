// Lightweight afterList enrichers shared across WMS list routes.
//
// These run inside `makeCrudRoute({ hooks: { afterList } })` and batch-resolve
// foreign-key labels (e.g. warehouse_id -> warehouse_name) so backend tables
// can render the human-readable label without N+1 lookups on the client.
//
// We deliberately use the `queryEngine` (entity-id-based) rather than ORM
// entity classes so this file stays decoupled from `wms/data/entities`
// internals — same pattern used by High #5 in WMS data enrichers.

import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'

type AnyListPayload = {
  items?: Array<Record<string, unknown>>
}

type WarehouseRow = {
  id?: string | null
  name?: string | null
  code?: string | null
}

const WAREHOUSE_FIELDS = ['id', 'name', 'code']
const WAREHOUSE_BATCH_SIZE = 500

function uniqueIds(items: Array<Record<string, unknown>>, key: string): string[] {
  const set = new Set<string>()
  for (const item of items) {
    const value = item?.[key]
    if (typeof value === 'string' && value.length > 0) set.add(value)
  }
  return Array.from(set)
}

async function loadWarehouseRowsByIds(
  ctx: CrudCtx,
  ids: string[],
): Promise<Map<string, WarehouseRow>> {
  if (ids.length === 0) return new Map()
  const tenantId = ctx.auth?.tenantId
  if (!tenantId) return new Map()
  const queryEngine = ctx.container.resolve('queryEngine') as QueryEngine
  const map = new Map<string, WarehouseRow>()
  for (let offset = 0; offset < ids.length; offset += WAREHOUSE_BATCH_SIZE) {
    const slice = ids.slice(offset, offset + WAREHOUSE_BATCH_SIZE)
    try {
      const result = await queryEngine.query<WarehouseRow>(E.wms.warehouse, {
        tenantId,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? undefined,
        organizationIds: ctx.organizationIds ?? undefined,
        filters: { id: { $in: slice } },
        fields: WAREHOUSE_FIELDS,
        page: { page: 1, pageSize: slice.length },
      })
      for (const row of result.items ?? []) {
        if (row?.id && typeof row.id === 'string') map.set(row.id, row)
      }
    } catch (err) {
      console.warn('[wms.listEnrichers] warehouse batch lookup failed', err)
    }
  }
  return map
}

/**
 * Decorate list items with `warehouse_name` and `warehouse_code` when they
 * carry a `warehouse_id` column. Safe to register on any WMS list route whose
 * rows reference `wms_warehouses.id` directly. Mutates `payload.items` in
 * place to match the existing `afterList` hook contract.
 */
export async function attachWarehouseLabelsToListItems(
  payload: AnyListPayload,
  ctx: CrudCtx,
): Promise<void> {
  const items = Array.isArray(payload?.items) ? payload.items : []
  if (items.length === 0) return
  const ids = uniqueIds(items, 'warehouse_id')
  if (ids.length === 0) return
  const map = await loadWarehouseRowsByIds(ctx, ids)
  if (map.size === 0) return
  for (const item of items) {
    const id = item?.warehouse_id
    if (typeof id !== 'string' || !id) continue
    const row = map.get(id)
    if (!row) continue
    if (item.warehouse_name === undefined) item.warehouse_name = row.name ?? null
    if (item.warehouse_code === undefined) item.warehouse_code = row.code ?? null
  }
}
