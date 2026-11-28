/**
 * In-memory stand-in for the catalog services a sales line may reference.
 * Command tests mock `findWithDecryption`; routing `CatalogService` lookups
 * through here answers them the way the scoped query would.
 */

export type CatalogServiceRow = {
  id: string
  tenantId: string
  organizationId: string
  deletedAt: Date | null
}

type CatalogServiceWhere = {
  id?: { $in?: string[] }
  tenantId?: string
  organizationId?: string
  deletedAt?: null
}

export function isCatalogServiceEntity(entityClass: unknown): boolean {
  return (entityClass as { name?: string } | null)?.name === 'CatalogService'
}

export function catalogServiceRow(
  id: string,
  scope: { tenantId: string; organizationId: string },
  deletedAt: Date | null = null,
): CatalogServiceRow {
  return { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt }
}

export function matchCatalogServices(rows: CatalogServiceRow[], where: unknown): CatalogServiceRow[] {
  const filter = (where ?? {}) as CatalogServiceWhere
  const ids = filter.id?.$in ?? []
  const excludeDeleted = Object.prototype.hasOwnProperty.call(filter, 'deletedAt')
  return rows.filter(
    (row) =>
      ids.includes(row.id) &&
      row.tenantId === filter.tenantId &&
      row.organizationId === filter.organizationId &&
      (!excludeDeleted || row.deletedAt === null),
  )
}

export function catalogServiceQueries(findWithDecryption: jest.Mock): unknown[] {
  return findWithDecryption.mock.calls
    .filter(([, entityClass]) => isCatalogServiceEntity(entityClass))
    .map(([, , where]) => where)
}
