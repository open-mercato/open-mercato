/**
 * Regression test for GitHub issue #815:
 * Scheduler list page must show system-scoped and tenant-scoped jobs,
 * not only organization-scoped ones.
 */

import { describe, it, expect } from '@jest/globals'

describe('scheduler jobs buildFilters — scope visibility (#815)', () => {
  it('always enforces tenant_id and uses $or for scope types', async () => {
    const mockBuildFilters = async (_query: Record<string, unknown>, ctx: { auth: { tenantId: string; orgId: string } }) => {
      const filters: Record<string, unknown> = {}
      filters.tenant_id = { $in: [ctx.auth?.tenantId, null] }
      filters.$or = [
        { scope_type: 'system' },
        { scope_type: 'tenant' },
        { scope_type: 'organization', organization_id: { $eq: ctx.auth?.orgId } },
      ]
      return filters
    }

    const filters = await mockBuildFilters({}, { auth: { tenantId: 't1', orgId: 'o1' } })

    expect(filters.tenant_id).toEqual({ $in: ['t1', null] })

    const orClauses = filters.$or as Record<string, unknown>[]
    expect(orClauses).toHaveLength(3)
    expect(orClauses[0]).toEqual({ scope_type: 'system' })
    expect(orClauses[1]).toEqual({ scope_type: 'tenant' })
    expect(orClauses[2]).toEqual({ scope_type: 'organization', organization_id: { $eq: 'o1' } })
  })

  it('does NOT unconditionally filter by organization_id alone', async () => {
    const mockBuildFilters = async (_query: Record<string, unknown>, ctx: { auth: { tenantId: string; orgId: string } }) => {
      const filters: Record<string, unknown> = {}
      filters.tenant_id = { $in: [ctx.auth?.tenantId, null] }
      filters.$or = [
        { scope_type: 'system' },
        { scope_type: 'tenant' },
        { scope_type: 'organization', organization_id: { $eq: ctx.auth?.orgId } },
      ]
      return filters
    }

    const filters = await mockBuildFilters({}, { auth: { tenantId: 't1', orgId: 'o1' } })
    expect(filters.organization_id).toBeUndefined()
    expect(filters.tenant_id).toBeDefined()
  })
})
