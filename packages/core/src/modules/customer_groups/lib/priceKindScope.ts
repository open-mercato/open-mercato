import type { EntityManager } from '@mikro-orm/postgresql'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

// Terms reference a `catalog` price kind by id only (FK-id coupling, no module
// import). `catalog` is optional, so its table may be absent; the id is then only
// shape-checked, as before, since there is nothing it could resolve against.
const PRICE_KIND_TABLE = 'catalog_price_kinds'

export async function isPriceKindInTenant(
  em: EntityManager,
  priceKindId: string,
  tenantId: string,
): Promise<boolean> {
  const connection = em.getConnection()
  const tableRows = await connection.execute('select to_regclass(?) is not null as present', [PRICE_KIND_TABLE])
  const tablePresent = Array.isArray(tableRows) && (tableRows[0] as { present?: unknown } | undefined)?.present === true
  if (!tablePresent) return true
  const rows = await connection.execute(
    `select 1 from ${PRICE_KIND_TABLE} where id = ? and tenant_id = ? and deleted_at is null limit 1`,
    [priceKindId, tenantId],
  )
  return Array.isArray(rows) && rows.length > 0
}

export type TenantPriceKindOption = { id: string; code: string; title: string }

// Terms managers pick a price kind without holding `catalog.settings.manage` (which
// gates `/api/catalog/price-kinds`), so the picker reads the same tenant-scoped rows
// through `customer_groups`' own route. Only id/code/title leave this helper.
export async function listTenantPriceKinds(
  em: EntityManager,
  tenantId: string,
  options: { search?: string | null; ids?: string[] | null; limit: number },
): Promise<TenantPriceKindOption[]> {
  const connection = em.getConnection()
  const tableRows = await connection.execute('select to_regclass(?) is not null as present', [PRICE_KIND_TABLE])
  const tablePresent = Array.isArray(tableRows) && (tableRows[0] as { present?: unknown } | undefined)?.present === true
  if (!tablePresent) return []
  const conditions = ['tenant_id = ?', 'deleted_at is null']
  const params: unknown[] = [tenantId]
  if (options.ids && options.ids.length) {
    conditions.push(`id in (${options.ids.map(() => '?').join(', ')})`)
    params.push(...options.ids)
  }
  const search = options.search?.trim()
  if (search) {
    const like = `%${escapeLikePattern(search)}%`
    conditions.push('(code ilike ? or title ilike ?)')
    params.push(like, like)
  }
  params.push(options.limit)
  const rows = await connection.execute(
    `select id, code, title from ${PRICE_KIND_TABLE} where ${conditions.join(' and ')} order by title asc, code asc limit ?`,
    params,
  )
  if (!Array.isArray(rows)) return []
  return rows.map((row) => {
    const record = row as { id?: unknown; code?: unknown; title?: unknown }
    return {
      id: String(record.id),
      code: typeof record.code === 'string' ? record.code : '',
      title: typeof record.title === 'string' ? record.title : '',
    }
  })
}
