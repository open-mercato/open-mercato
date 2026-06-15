import type { AwilixContainer } from 'awilix'
import { pickDefaultTenant } from '../tool-test-runner'

type ExecuteCall = { sql: string; params?: unknown[] }

function makeContainer(
  rowsBySql: (sql: string) => Record<string, unknown>[],
  calls: ExecuteCall[],
): AwilixContainer {
  const connection = {
    execute: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params })
      return rowsBySql(sql)
    },
  }
  const em = { getConnection: () => connection }
  return {
    resolve: (token: string) => {
      if (token === 'em') return em
      throw new Error(`[internal] unexpected resolve token: ${token}`)
    },
  } as unknown as AwilixContainer
}

describe('pickDefaultTenant SQL safety (#2725)', () => {
  it('binds the tenant id as a query parameter instead of interpolating it', async () => {
    const calls: ExecuteCall[] = []
    const tenantId = '11111111-2222-3333-4444-555555555555'
    const orgId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const userId = 'ffffffff-0000-1111-2222-333333333333'
    const container = makeContainer((sql) => {
      if (sql.includes('FROM tenants')) return [{ id: tenantId }]
      if (sql.includes('FROM organizations')) return [{ id: orgId }]
      if (sql.includes('FROM users')) return [{ id: userId }]
      return []
    }, calls)

    const result = await pickDefaultTenant(container)

    expect(result).toEqual({ tenantId, organizationId: orgId, userId })

    const orgCall = calls.find((call) => call.sql.includes('FROM organizations'))
    const userCall = calls.find((call) => call.sql.includes('FROM users'))
    expect(orgCall).toBeDefined()
    expect(userCall).toBeDefined()

    // Tenant value flows through bound parameters, never string-interpolated.
    expect(orgCall?.params).toEqual([tenantId])
    expect(userCall?.params).toEqual([tenantId])
    expect(orgCall?.sql).toContain('tenant_id = ?')
    expect(userCall?.sql).toContain('tenant_id = ?')

    // No call may embed the tenant value or hand-rolled quote-escaping in SQL.
    for (const call of calls) {
      expect(call.sql).not.toContain(tenantId)
      expect(call.sql).not.toContain("''")
    }
  })

  it('returns null when no tenant exists without issuing scoped lookups', async () => {
    const calls: ExecuteCall[] = []
    const container = makeContainer(() => [], calls)

    const result = await pickDefaultTenant(container)

    expect(result).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('FROM tenants')
  })
})
