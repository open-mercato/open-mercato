import { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type ScopeShape = NonNullable<CommandRuntimeContext['organizationScope']>

function buildCtx(overrides: {
  isSuperAdmin?: boolean
  orgId?: string | null
  selectedOrganizationId?: string | null
  organizationScope?: ScopeShape | null
}): CommandRuntimeContext {
  return {
    container: {} as CommandRuntimeContext['container'],
    auth: {
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: overrides.orgId ?? null,
      isSuperAdmin: overrides.isSuperAdmin ?? false,
    },
    organizationScope: overrides.organizationScope ?? null,
    selectedOrganizationId: overrides.selectedOrganizationId ?? null,
    organizationIds: null,
  }
}

function buildScope(overrides: Partial<ScopeShape>): ScopeShape {
  return {
    selectedId: null,
    filterIds: null,
    allowedIds: null,
    tenantId: 'tenant-1',
    ...overrides,
  }
}

describe('ensureOrganizationScope', () => {
  it('denies a restricted floating user acting on an org outside allowedIds (#2239)', () => {
    const ctx = buildCtx({
      orgId: null,
      selectedOrganizationId: null,
      organizationScope: buildScope({ allowedIds: ['org-a'], filterIds: ['org-a'] }),
    })
    expect(() => ensureOrganizationScope(ctx, 'org-b')).toThrow(CrudHttpError)
  })

  it('allows super admins', () => {
    const ctx = buildCtx({
      isSuperAdmin: true,
      organizationScope: buildScope({ allowedIds: ['org-a'] }),
    })
    expect(() => ensureOrganizationScope(ctx, 'org-b')).not.toThrow()
  })

  it('allows truly unrestricted scope (allowedIds === null)', () => {
    const ctx = buildCtx({
      organizationScope: buildScope({ allowedIds: null }),
    })
    expect(() => ensureOrganizationScope(ctx, 'org-b')).not.toThrow()
  })

  it('allows a restricted user acting on an org inside allowedIds (allow-path regression)', () => {
    const ctx = buildCtx({
      orgId: 'org-a',
      organizationScope: buildScope({ allowedIds: ['org-a'], filterIds: ['org-a'] }),
    })
    expect(() => ensureOrganizationScope(ctx, 'org-a')).not.toThrow()
  })

  describe('absent organization scope (Pattern C — legacy fallback, not deny)', () => {
    it('allows when no current org can be resolved', () => {
      const ctx = buildCtx({ orgId: null, selectedOrganizationId: null, organizationScope: null })
      expect(() => ensureOrganizationScope(ctx, 'org-b')).not.toThrow()
    })

    it('allows when the resolved current org matches the target', () => {
      const ctx = buildCtx({ selectedOrganizationId: 'org-a', organizationScope: null })
      expect(() => ensureOrganizationScope(ctx, 'org-a')).not.toThrow()
    })

    it('denies when the resolved current org differs from the target', () => {
      const ctx = buildCtx({ selectedOrganizationId: 'org-a', organizationScope: null })
      expect(() => ensureOrganizationScope(ctx, 'org-b')).toThrow(CrudHttpError)
    })
  })
})
