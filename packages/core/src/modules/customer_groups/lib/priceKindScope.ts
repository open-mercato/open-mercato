import type { EntityManager } from '@mikro-orm/postgresql'

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
