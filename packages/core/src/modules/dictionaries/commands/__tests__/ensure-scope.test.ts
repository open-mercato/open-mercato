import { ensureDictionaryEntryScope } from '@open-mercato/core/modules/dictionaries/commands/factory'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type ScopeShape = NonNullable<CommandRuntimeContext['organizationScope']>

function buildCtx(overrides: {
  auth?: CommandRuntimeContext['auth']
  isSuperAdmin?: boolean
  tenantId?: string | null
  orgId?: string | null
  selectedOrganizationId?: string | null
  organizationScope?: ScopeShape | null
}): CommandRuntimeContext {
  const auth =
    overrides.auth === null
      ? null
      : {
          sub: 'user-1',
          tenantId: overrides.tenantId === undefined ? 'tenant-1' : overrides.tenantId,
          orgId: overrides.orgId ?? null,
          isSuperAdmin: overrides.isSuperAdmin ?? false,
        }
  return {
    container: {} as CommandRuntimeContext['container'],
    auth: auth as CommandRuntimeContext['auth'],
    organizationScope: overrides.organizationScope ?? null,
    selectedOrganizationId: overrides.selectedOrganizationId ?? null,
    organizationIds: null,
  }
}

function buildOrganizationScope(overrides: Partial<ScopeShape>): ScopeShape {
  return {
    selectedId: null,
    filterIds: null,
    allowedIds: null,
    tenantId: 'tenant-1',
    ...overrides,
  } as ScopeShape
}

const targetScope = { tenantId: 'tenant-1', organizationId: 'org-victim' }

describe('ensureDictionaryEntryScope', () => {
  it('denies a restricted user with no resolved organization acting on another organization (#3846)', () => {
    const ctx = buildCtx({
      selectedOrganizationId: null,
      orgId: null,
      organizationScope: buildOrganizationScope({ allowedIds: ['org-attacker'] }),
    })

    expect(() => ensureDictionaryEntryScope(ctx, targetScope)).toThrow(CrudHttpError)
    try {
      ensureDictionaryEntryScope(ctx, targetScope)
    } catch (err) {
      expect((err as CrudHttpError).status).toBe(403)
    }
  })

  it('denies a cross-tenant actor', () => {
    const ctx = buildCtx({
      tenantId: 'tenant-other',
      selectedOrganizationId: 'org-victim',
      organizationScope: buildOrganizationScope({ tenantId: 'tenant-other', allowedIds: ['org-victim'] }),
    })

    expect(() => ensureDictionaryEntryScope(ctx, targetScope)).toThrow(CrudHttpError)
  })

  it('denies a restricted user acting on an organization outside their allowed set', () => {
    const ctx = buildCtx({
      selectedOrganizationId: 'org-attacker',
      organizationScope: buildOrganizationScope({ allowedIds: ['org-attacker'] }),
    })

    expect(() => ensureDictionaryEntryScope(ctx, targetScope)).toThrow(CrudHttpError)
  })

  it('allows a super admin with no resolved organization', () => {
    const ctx = buildCtx({
      isSuperAdmin: true,
      selectedOrganizationId: null,
      organizationScope: buildOrganizationScope({ allowedIds: ['org-attacker'] }),
    })

    expect(() => ensureDictionaryEntryScope(ctx, targetScope)).not.toThrow()
  })

  it('allows a user whose allowed set contains the target organization', () => {
    const ctx = buildCtx({
      selectedOrganizationId: 'org-victim',
      organizationScope: buildOrganizationScope({ allowedIds: ['org-victim', 'org-other'] }),
    })

    expect(() => ensureDictionaryEntryScope(ctx, targetScope)).not.toThrow()
  })

  it('preserves system contexts without an authenticated actor', () => {
    const ctx = buildCtx({ auth: null, organizationScope: null })

    expect(() => ensureDictionaryEntryScope(ctx, targetScope)).not.toThrow()
  })
})
