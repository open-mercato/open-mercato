import type { EntityManager } from '@mikro-orm/postgresql'

export type BaseCurrencyScope = {
  tenantId: string
  organizationIds?: string[]
}

/**
 * Reads the tenant/organization base currency owned by the `currencies` module.
 *
 * Raw SQL rather than the `Currency` entity on purpose: dashboards must not take a
 * hard dependency on another module's ORM metadata, and the lookup projects a single
 * non-encrypted column. When the `currencies` module is not installed the table is
 * missing and the query throws — that degrades to `null`, which the widgets render
 * with their own fallback currency.
 */
export async function resolveBaseCurrencyCode(
  em: EntityManager,
  scope: BaseCurrencyScope,
): Promise<string | null> {
  if (!scope.tenantId) return null

  const clauses = ['tenant_id = ?', 'is_base = true', 'deleted_at IS NULL']
  const params: unknown[] = [scope.tenantId]
  // With several organizations in scope each may declare its own base currency, so
  // follow the caller's precedence — the selected organization comes first.
  let order = 'code ASC'

  if (scope.organizationIds && scope.organizationIds.length > 0) {
    const organizationArray = `{${scope.organizationIds.join(',')}}`
    clauses.push('organization_id = ANY(?::uuid[])')
    params.push(organizationArray)
    order = 'array_position(?::uuid[], organization_id) ASC, code ASC'
    params.push(organizationArray)
  }

  const sql = `SELECT code FROM currencies WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT 1`

  try {
    const rows = await em.getConnection().execute<Array<{ code: string | null }>>(sql, params)
    const code = Array.isArray(rows) ? rows[0]?.code : null
    return typeof code === 'string' && code.trim().length > 0 ? code.trim().toUpperCase() : null
  } catch {
    return null
  }
}
