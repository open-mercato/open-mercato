import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureTenantScope } from '../shared'

function buildCtx(overrides: {
  tenantId?: string | null
  isSuperAdmin?: boolean
}): CommandRuntimeContext {
  return {
    container: {} as CommandRuntimeContext['container'],
    auth: {
      sub: 'user-1',
      tenantId: overrides.tenantId === undefined ? 'tenant-1' : overrides.tenantId,
      orgId: null,
      isSuperAdmin: overrides.isSuperAdmin ?? false,
    },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
}

describe('planner command scope helpers', () => {
  it('denies a tenant-less non-superadmin acting on a tenant-scoped planner target (#3910)', () => {
    const ctx = buildCtx({ tenantId: null, isSuperAdmin: false })
    expect(() => ensureTenantScope(ctx, 'tenant-2')).toThrow(CrudHttpError)
  })

  it('allows super admins with no tenant context to act on tenant-scoped planner targets', () => {
    const ctx = buildCtx({ tenantId: null, isSuperAdmin: true })
    expect(() => ensureTenantScope(ctx, 'tenant-2')).not.toThrow()
  })
})
