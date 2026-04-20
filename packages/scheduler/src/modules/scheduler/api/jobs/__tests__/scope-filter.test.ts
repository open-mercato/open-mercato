/**
 * Regression test for GitHub issues #815 and #1587:
 * Scheduler jobs list must return tenant-scoped, org-scoped, and (for
 * superadmins) system-scoped rows via `$or` visibility branches. This
 * exercises the real `buildSchedulerJobsFilters` used by the route — not a
 * local mock — so the test stays in lockstep with production behavior.
 */

import { describe, it, expect } from '@jest/globals'
import { buildSchedulerJobsFilters } from '../buildFilters'

type Ctx = Parameters<typeof buildSchedulerJobsFilters>[1]

const makeCtx = (overrides: Partial<{
  tenantId: string | null
  orgId: string | null
  roles: unknown
  organizationIds: string[] | null
}> = {}): Ctx => ({
  auth: {
    tenantId: overrides.tenantId === undefined ? 't1' : overrides.tenantId,
    orgId: overrides.orgId === undefined ? 'o1' : overrides.orgId,
    roles: overrides.roles === undefined ? ['admin'] : overrides.roles,
  },
  organizationIds: overrides.organizationIds === undefined ? ['o1'] : overrides.organizationIds,
})

describe('buildSchedulerJobsFilters — scope visibility (#815, #1587)', () => {
  it('returns organization + tenant visibility branches for a non-superadmin', async () => {
    const filters = await buildSchedulerJobsFilters({}, makeCtx())
    const or = filters.$or as Record<string, unknown>[]
    expect(Array.isArray(or)).toBe(true)
    expect(or).toEqual([
      { organization_id: { $eq: 'o1' }, tenant_id: { $eq: 't1' } },
      { organization_id: { $eq: null }, tenant_id: { $eq: 't1' }, scope_type: { $eq: 'tenant' } },
    ])
    expect(filters.tenant_id).toBeUndefined()
    expect(filters.organization_id).toBeUndefined()
    expect(filters.id).toBeUndefined()
  })

  it('adds a system-scope branch only for superadmins', async () => {
    const filters = await buildSchedulerJobsFilters(
      {},
      makeCtx({ roles: ['superadmin'] }),
    )
    const or = filters.$or as Record<string, unknown>[]
    expect(or).toContainEqual({
      organization_id: { $eq: null },
      tenant_id: { $eq: null },
      scope_type: { $eq: 'system' },
    })
  })

  it('does NOT leak system-scope rows to non-superadmins', async () => {
    const filters = await buildSchedulerJobsFilters(
      {},
      makeCtx({ roles: ['admin'] }),
    )
    const or = filters.$or as Record<string, unknown>[]
    const systemBranch = or.find(
      (branch) => (branch.scope_type as { $eq?: string } | undefined)?.$eq === 'system',
    )
    expect(systemBranch).toBeUndefined()
  })

  it('fails closed when tenantId is missing', async () => {
    const filters = await buildSchedulerJobsFilters({}, makeCtx({ tenantId: null }))
    expect(filters.id).toEqual({ $eq: '00000000-0000-0000-0000-000000000000' })
    expect(filters.$or).toBeUndefined()
  })

  it('uses $in for multiple organization ids', async () => {
    const filters = await buildSchedulerJobsFilters(
      {},
      makeCtx({ organizationIds: ['o1', 'o2'] }),
    )
    const or = filters.$or as Record<string, unknown>[]
    expect(or[0]).toEqual({ organization_id: { $in: ['o1', 'o2'] }, tenant_id: { $eq: 't1' } })
  })

  it('distributes search across every visibility branch (name + description)', async () => {
    const filters = await buildSchedulerJobsFilters(
      { search: 'nightly' },
      makeCtx({ roles: ['superadmin'] }),
    )
    const or = filters.$or as Record<string, unknown>[]
    // 3 visibility branches (org, tenant, system) × 2 columns (name, description) = 6
    expect(or).toHaveLength(6)
    for (const clause of or) {
      const hasNameLike = (clause.name as { $ilike?: string } | undefined)?.$ilike === '%nightly%'
      const hasDescLike = (clause.description as { $ilike?: string } | undefined)?.$ilike === '%nightly%'
      expect(hasNameLike || hasDescLike).toBe(true)
      // Every clause must still carry a tenant constraint (no leaks)
      expect(clause.tenant_id).toBeDefined()
    }
  })

  it('escapes LIKE metacharacters in the search needle', async () => {
    const filters = await buildSchedulerJobsFilters(
      { search: '50%_off' },
      makeCtx(),
    )
    const or = filters.$or as Record<string, unknown>[]
    const first = or[0] as { name?: { $ilike?: string } }
    expect(first.name?.$ilike).toBe('%50\\%\\_off%')
  })

  it('adds additional explicit filters (scopeType, isEnabled, sourceType, sourceModule, id)', async () => {
    const filters = await buildSchedulerJobsFilters(
      {
        id: 'abc',
        scopeType: 'tenant',
        isEnabled: true,
        sourceType: 'user',
        sourceModule: 'ops',
      },
      makeCtx(),
    )
    expect(filters.id).toEqual({ $eq: 'abc' })
    expect(filters.scope_type).toEqual({ $eq: 'tenant' })
    expect(filters.is_enabled).toEqual({ $eq: true })
    expect(filters.source_type).toEqual({ $eq: 'user' })
    expect(filters.source_module).toEqual({ $eq: 'ops' })
  })
})
