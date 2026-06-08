import type { AwilixContainer } from 'awilix'
import { userHasFeature, type ExecutionHelperContext } from '../lib/executionHelpers'

type RbacStub = {
  userHasAllFeatures: jest.Mock<Promise<boolean>, [string, string[], { tenantId: string; organizationId: string }]>
}

function makeContext(
  auth: ExecutionHelperContext['auth'],
  rbac: RbacStub,
): ExecutionHelperContext {
  const container = {
    resolve: (key: string) => {
      if (key === 'rbacService') return rbac
      throw new Error(`[internal] unexpected resolve(${key})`)
    },
  } as unknown as AwilixContainer

  return {
    em: {} as ExecutionHelperContext['em'],
    userId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    container,
    auth,
  }
}

describe('inbox_ops userHasFeature super-admin gate', () => {
  let rbac: RbacStub

  beforeEach(() => {
    rbac = {
      userHasAllFeatures: jest.fn().mockResolvedValue(false),
    }
  })

  it('does NOT bypass the feature check for a role literally named "superadmin" without the isSuperAdmin flag', async () => {
    // Regression for #2699: a tenant-mutable role name must never grant a feature bypass.
    const ctx = makeContext(
      {
        sub: 'user-1',
        tenantId: 'tenant-1',
        orgId: 'org-1',
        roles: ['superadmin'],
        isSuperAdmin: false,
      } as ExecutionHelperContext['auth'],
      rbac,
    )

    const allowed = await userHasFeature(ctx, 'inbox_ops.execute')

    expect(allowed).toBe(false)
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(
      'user-1',
      ['inbox_ops.execute'],
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('does not bypass for spoofed role names with mixed case or whitespace', async () => {
    const ctx = makeContext(
      {
        sub: 'user-1',
        tenantId: 'tenant-1',
        orgId: 'org-1',
        roles: [' SuperAdmin ', 'Super Admin'],
        isSuperAdmin: false,
      } as ExecutionHelperContext['auth'],
      rbac,
    )

    const allowed = await userHasFeature(ctx, 'inbox_ops.execute')

    expect(allowed).toBe(false)
    expect(rbac.userHasAllFeatures).toHaveBeenCalledTimes(1)
  })

  it('bypasses the feature check only when the immutable isSuperAdmin flag is true', async () => {
    const ctx = makeContext(
      {
        sub: 'user-1',
        tenantId: 'tenant-1',
        orgId: 'org-1',
        roles: [],
        isSuperAdmin: true,
      } as ExecutionHelperContext['auth'],
      rbac,
    )

    const allowed = await userHasFeature(ctx, 'inbox_ops.execute')

    expect(allowed).toBe(true)
    expect(rbac.userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('delegates to the rbac feature matcher for a regular user with a granted feature', async () => {
    rbac.userHasAllFeatures.mockResolvedValue(true)
    const ctx = makeContext(
      {
        sub: 'user-1',
        tenantId: 'tenant-1',
        orgId: 'org-1',
        roles: ['employee'],
        isSuperAdmin: false,
      } as ExecutionHelperContext['auth'],
      rbac,
    )

    const allowed = await userHasFeature(ctx, 'inbox_ops.execute')

    expect(allowed).toBe(true)
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(
      'user-1',
      ['inbox_ops.execute'],
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('fails closed for an empty feature requirement without calling rbac', async () => {
    // Regression for #2700: an empty/undefined required feature must deny, not
    // bypass — a blank feature id is a programming error, never an open grant.
    const ctx = makeContext(
      {
        sub: 'user-1',
        tenantId: 'tenant-1',
        orgId: 'org-1',
        roles: ['employee'],
        isSuperAdmin: false,
      } as ExecutionHelperContext['auth'],
      rbac,
    )

    const allowed = await userHasFeature(ctx, '')

    expect(allowed).toBe(false)
    expect(rbac.userHasAllFeatures).not.toHaveBeenCalled()
  })
})
