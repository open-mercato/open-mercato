/** @jest-environment node */

import {
  assertEntityAclForRequest,
  resolveEntityAclRequirement,
} from '@open-mercato/core/modules/entities/lib/entityAcl'

type AclResult = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

function makeRbac(result: AclResult) {
  return {
    loadAcl: jest.fn().mockResolvedValue(result),
    userHasAllFeatures: jest.fn().mockImplementation(async (
      _userId: string,
      required: string[],
    ) => result.isSuperAdmin || required.every((feature) => (
      result.features.includes(feature)
      || result.features.includes('*')
      || result.features.some((grant) => grant.endsWith('.*') && feature.startsWith(grant.slice(0, -1)))
    ))),
  }
}

const baseAuth = {
  sub: 'actor-1',
  tenantId: '11111111-1111-1111-1111-111111111111',
  orgId: '22222222-2222-2222-2222-222222222222',
}

describe('resolveEntityAclRequirement', () => {
  test('returns the platform-only requirement for directory:tenant', () => {
    expect(resolveEntityAclRequirement('directory:tenant')).toEqual({
      view: ['directory.tenants.view'],
      manage: ['directory.tenants.manage'],
      platformOnly: true,
    })
  })

  test('returns the requirement for directory:organization', () => {
    expect(resolveEntityAclRequirement('directory:organization')).toEqual({
      view: ['directory.organizations.view'],
      manage: ['directory.organizations.manage'],
    })
  })

  test('returns null for an unmapped entity id', () => {
    expect(resolveEntityAclRequirement('unknown:thing')).toBeNull()
  })
})

describe('assertEntityAclForRequest', () => {
  test('allows a mapped entity when the exact feature is granted', async () => {
    const rbac = makeRbac({ isSuperAdmin: false, features: ['directory.organizations.view'], organizations: null })

    await expect(
      assertEntityAclForRequest({
        auth: baseAuth,
        entityId: 'directory:organization',
        action: 'view',
        isCustomEntity: false,
        rbac: rbac as never,
      }),
    ).resolves.toBeUndefined()
  })

  test('denies a mapped entity when the feature is missing', async () => {
    const rbac = makeRbac({ isSuperAdmin: false, features: ['customers.people.view'], organizations: null })

    await expect(
      assertEntityAclForRequest({
        auth: baseAuth,
        entityId: 'directory:organization',
        action: 'view',
        isCustomEntity: false,
        rbac: rbac as never,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('denies a platformOnly entity for a non-superadmin even with the named feature', async () => {
    const rbac = makeRbac({ isSuperAdmin: false, features: ['directory.tenants.view'], organizations: null })

    await expect(
      assertEntityAclForRequest({
        auth: baseAuth,
        entityId: 'directory:tenant',
        action: 'view',
        isCustomEntity: false,
        rbac: rbac as never,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('wildcard grant satisfies a non-platform mapped entity', async () => {
    const rbac = makeRbac({ isSuperAdmin: false, features: ['directory.*'], organizations: null })

    await expect(
      assertEntityAclForRequest({
        auth: baseAuth,
        entityId: 'directory:organization',
        action: 'view',
        isCustomEntity: false,
        rbac: rbac as never,
      }),
    ).resolves.toBeUndefined()
  })

  test('wildcard grant does NOT satisfy a platformOnly entity for a non-superadmin', async () => {
    const rbac = makeRbac({ isSuperAdmin: false, features: ['directory.*'], organizations: null })

    await expect(
      assertEntityAclForRequest({
        auth: baseAuth,
        entityId: 'directory:tenant',
        action: 'view',
        isCustomEntity: false,
        rbac: rbac as never,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('denies an unmapped non-custom entity for a non-superadmin', async () => {
    const rbac = makeRbac({ isSuperAdmin: false, features: ['*'], organizations: null })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, features: ['entities.records.view'], organizations: null })

    await expect(
      assertEntityAclForRequest({
        auth: baseAuth,
        entityId: 'some_module:unmapped',
        action: 'view',
        isCustomEntity: false,
        rbac: rbac as never,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('allows an unmapped non-custom entity for a superadmin', async () => {
    const rbac = makeRbac({ isSuperAdmin: true, features: ['*'], organizations: null })

    await expect(
      assertEntityAclForRequest({
        auth: baseAuth,
        entityId: 'some_module:unmapped',
        action: 'manage',
        isCustomEntity: false,
        rbac: rbac as never,
      }),
    ).resolves.toBeUndefined()
  })

  test('allows a platformOnly entity for a superadmin', async () => {
    const rbac = makeRbac({ isSuperAdmin: true, features: ['*'], organizations: null })

    await expect(
      assertEntityAclForRequest({
        auth: baseAuth,
        entityId: 'directory:tenant',
        action: 'manage',
        isCustomEntity: false,
        rbac: rbac as never,
      }),
    ).resolves.toBeUndefined()
  })

  test('always passes for a custom entity without consulting the ACL', async () => {
    const rbac = makeRbac({ isSuperAdmin: false, features: [], organizations: null })

    await expect(
      assertEntityAclForRequest({
        auth: baseAuth,
        entityId: 'custom:thing',
        action: 'manage',
        isCustomEntity: true,
        rbac: rbac as never,
      }),
    ).resolves.toBeUndefined()
    expect(rbac.loadAcl).not.toHaveBeenCalled()
    expect(rbac.userHasAllFeatures).not.toHaveBeenCalled()
  })
})
