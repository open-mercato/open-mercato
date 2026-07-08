import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type ScopeShape = NonNullable<CommandRuntimeContext['organizationScope']>

function buildCtx(overrides: {
  isSuperAdmin?: boolean
  tenantId?: string | null
  orgId?: string | null
  selectedOrganizationId?: string | null
  organizationScope?: ScopeShape | null
  systemActor?: boolean
}): CommandRuntimeContext {
  return {
    container: {} as CommandRuntimeContext['container'],
    auth: {
      sub: 'user-1',
      tenantId: overrides.tenantId === undefined ? 'tenant-1' : overrides.tenantId,
      orgId: overrides.orgId ?? null,
      isSuperAdmin: overrides.isSuperAdmin ?? false,
    },
    organizationScope: overrides.organizationScope ?? null,
    selectedOrganizationId: overrides.selectedOrganizationId ?? null,
    organizationIds: null,
    systemActor: overrides.systemActor,
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

describe('ensureTenantScope', () => {
  it('denies a tenant-less non-superadmin acting on a tenant-scoped target (#3910)', () => {
    const ctx = buildCtx({ tenantId: null, isSuperAdmin: false })
    expect(() => ensureTenantScope(ctx, 'tenant-2')).toThrow(CrudHttpError)
  })

  it('allows super admins with no tenant context to act on tenant-scoped targets', () => {
    const ctx = buildCtx({ tenantId: null, isSuperAdmin: true })
    expect(() => ensureTenantScope(ctx, 'tenant-2')).not.toThrow()
  })

  it('preserves legacy system contexts without an authenticated actor', () => {
    const ctx = { ...buildCtx({}), auth: null }
    expect(() => ensureTenantScope(ctx, 'tenant-2')).not.toThrow()
  })

  it('denies authenticated tenant-less systemActor contexts unless they are superadmin (#3910)', () => {
    const ctx = buildCtx({ tenantId: null, isSuperAdmin: false, systemActor: true })
    expect(() => ensureTenantScope(ctx, 'tenant-2')).toThrow(CrudHttpError)
  })

  it('allows a scoped principal acting inside its own tenant', () => {
    const ctx = buildCtx({ tenantId: 'tenant-1' })
    expect(() => ensureTenantScope(ctx, 'tenant-1')).not.toThrow()
  })
})

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

  it('denies null-tenant organization scope for a non-superadmin (#3910)', () => {
    const ctx = buildCtx({
      tenantId: null,
      organizationScope: buildScope({ tenantId: null, allowedIds: null, filterIds: null }),
    })
    expect(() => ensureOrganizationScope(ctx, 'org-b')).toThrow(CrudHttpError)
  })

  it('allows null-tenant organization scope for a superadmin', () => {
    const ctx = buildCtx({
      tenantId: null,
      isSuperAdmin: true,
      organizationScope: buildScope({ tenantId: null, allowedIds: null, filterIds: null }),
    })
    expect(() => ensureOrganizationScope(ctx, 'org-b')).not.toThrow()
  })

  it('preserves null-tenant organization scope for system contexts without an authenticated actor', () => {
    const ctx = {
      ...buildCtx({
        tenantId: null,
        organizationScope: buildScope({ tenantId: null, allowedIds: null, filterIds: null }),
      }),
      auth: null,
    }
    expect(() => ensureOrganizationScope(ctx, 'org-b')).not.toThrow()
  })

  it('denies authenticated null-tenant systemActor organization scopes unless they are superadmin (#3910)', () => {
    const ctx = buildCtx({
      tenantId: null,
      systemActor: true,
      organizationScope: buildScope({ tenantId: null, allowedIds: null, filterIds: null }),
    })
    expect(() => ensureOrganizationScope(ctx, 'org-b')).toThrow(CrudHttpError)
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

  describe('fail-open-by-omission hardening (#2441)', () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalStrict = process.env.OM_ENFORCE_ORG_SCOPE_STRICT
    let warnSpy: jest.SpyInstance

    beforeEach(() => {
      // The scope loggers suppress output under NODE_ENV==='test'; flip it so the
      // observability signal becomes assertable, then restore in afterEach.
      process.env.NODE_ENV = 'development'
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warnSpy.mockRestore()
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = originalNodeEnv
      if (originalStrict === undefined) delete process.env.OM_ENFORCE_ORG_SCOPE_STRICT
      else process.env.OM_ENFORCE_ORG_SCOPE_STRICT = originalStrict
    })

    it('emits an observability warning when scope and currentOrg are both null', () => {
      delete process.env.OM_ENFORCE_ORG_SCOPE_STRICT
      const ctx = buildCtx({ orgId: null, selectedOrganizationId: null, organizationScope: null })
      expect(() => ensureOrganizationScope(ctx, 'org-b')).not.toThrow()
      expect(warnSpy).toHaveBeenCalledWith(
        '[scope] Unscoped organization command executed without organization context',
        expect.objectContaining({ targetOrganizationId: 'org-b', strictEnforcement: false })
      )
    })

    it('throws when OM_ENFORCE_ORG_SCOPE_STRICT is enabled', () => {
      process.env.OM_ENFORCE_ORG_SCOPE_STRICT = 'true'
      const ctx = buildCtx({ orgId: null, selectedOrganizationId: null, organizationScope: null })
      expect(() => ensureOrganizationScope(ctx, 'org-b')).toThrow(CrudHttpError)
      expect(warnSpy).toHaveBeenCalledWith(
        '[scope] Unscoped organization command executed without organization context',
        expect.objectContaining({ targetOrganizationId: 'org-b', strictEnforcement: true })
      )
    })

    it('does not warn or throw when there is no target organization to validate', () => {
      delete process.env.OM_ENFORCE_ORG_SCOPE_STRICT
      const ctx = buildCtx({ orgId: null, selectedOrganizationId: null, organizationScope: null })
      expect(() => ensureOrganizationScope(ctx, '')).not.toThrow()
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
