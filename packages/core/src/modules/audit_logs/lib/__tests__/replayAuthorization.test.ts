import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { authorizeAuditReplayWithEntityManager, isAuditReplayOrganizationAllowed } from '../replayAuthorization'

const actorId = '11111111-1111-4111-8111-111111111111'

describe('audit replay scope membership', () => {
  it.each([
    { filterIds: ['parent', 'child'], allowedIds: ['parent'], expected: false },
    { filterIds: ['parent'], allowedIds: ['parent', 'child'], expected: false },
    { filterIds: [], allowedIds: null, expected: false },
    { filterIds: null, allowedIds: [], expected: false },
    { filterIds: ['parent', 'child'], allowedIds: null, expected: true },
    { filterIds: null, allowedIds: ['parent', 'child'], expected: true },
  ])('requires both finite scope sets: %j', ({ filterIds, allowedIds, expected }) => {
    expect(isAuditReplayOrganizationAllowed({
      scope: { filterIds, allowedIds }, organizationId: 'parent',
      targetOrganizationId: 'child', canReplayTenant: true,
    })).toBe(expected)
  })

  it.each([
    { organizationId: null, canReplayTenant: false, expected: false },
    { organizationId: null, canReplayTenant: true, expected: true },
    { organizationId: 'parent', canReplayTenant: true, expected: false },
    { organizationId: 'child', canReplayTenant: false, expected: true },
  ])('preserves unresolved-scope behavior: %j', ({ organizationId, canReplayTenant, expected }) => {
    expect(isAuditReplayOrganizationAllowed({
      scope: { filterIds: null, allowedIds: null }, organizationId,
      targetOrganizationId: 'child', canReplayTenant,
    })).toBe(expected)
  })
})

function createReplayHarness(action: 'undo' | 'redo') {
  const find = jest.fn().mockResolvedValue([
    { id: 'parent', descendantIds: ['child'] },
  ])
  const em = { find } as unknown as EntityManager
  const loadAclWithEntityManager = jest.fn().mockResolvedValue({
    isSuperAdmin: false, features: [`audit_logs.${action}_self`], organizations: ['parent'],
  })
  const userHasAllFeaturesWithEntityManager = jest.fn().mockImplementation(
    async (_em: EntityManager, _userId: string, features: string[]) => features[0] === `audit_logs.${action}_self`,
  )
  const rbac = { loadAclWithEntityManager, userHasAllFeaturesWithEntityManager } as unknown as RbacService
  const input = {
    auth: { sub: actorId, tenantId: 'tenant', orgId: 'parent' },
    organizationId: 'parent', selfFeature: `audit_logs.${action}_self`,
    tenantFeature: `audit_logs.${action}_tenant`, unavailableMessage: 'Unavailable',
  }
  const log = { actorUserId: actorId, tenantId: 'tenant', organizationId: 'child' }
  const authorize = () => authorizeAuditReplayWithEntityManager(em, rbac, log, input)
  return { authorize, em, find, loadAclWithEntityManager, userHasAllFeaturesWithEntityManager, input, log }
}

describe.each(['undo', 'redo'] as const)('%s replay organization authorization (#7370)', (action) => {
  it('resolves the parent ACL and descendants with the exact transaction EntityManager', async () => {
    const harness = createReplayHarness(action)

    await expect(harness.authorize()).resolves.toBeUndefined()

    expect(harness.loadAclWithEntityManager).toHaveBeenCalledWith(harness.em, actorId, {
      tenantId: 'tenant', organizationId: 'parent',
    })
    expect(harness.find).toHaveBeenCalledWith(Organization, {
      tenant: 'tenant', id: { $in: ['parent'] }, deletedAt: null,
    })
  })

  it.each([false, true])('denies a sibling despite tenant replay permission = %s', async (tenantPermission) => {
    const harness = createReplayHarness(action)
    harness.log.organizationId = 'sibling'
    harness.userHasAllFeaturesWithEntityManager.mockImplementation(
      async (_em: EntityManager, _userId: string, features: string[]) => features[0] === harness.input.selfFeature || tenantPermission,
    )
    await expect(harness.authorize()).rejects.toMatchObject({ status: 400 })
  })

  it('denies a different actor without tenant replay permission', async () => {
    const harness = createReplayHarness(action)
    harness.log.actorUserId = '22222222-2222-4222-8222-222222222222'
    await expect(harness.authorize()).rejects.toMatchObject({ status: 400 })
  })

  it('allows another actor in an authorized child with current tenant replay permission', async () => {
    const harness = createReplayHarness(action)
    harness.log.actorUserId = '22222222-2222-4222-8222-222222222222'
    harness.userHasAllFeaturesWithEntityManager.mockResolvedValue(true)
    await expect(harness.authorize()).resolves.toBeUndefined()
  })

  it('denies another tenant even with tenant replay permission', async () => {
    const harness = createReplayHarness(action)
    harness.log.tenantId = 'other-tenant'
    harness.userHasAllFeaturesWithEntityManager.mockResolvedValue(true)
    await expect(harness.authorize()).rejects.toMatchObject({ status: 400 })
  })

  it.each([null, undefined, ''])('denies an unresolved caller tenant (%s)', async (tenantId) => {
    const harness = createReplayHarness(action)
    Object.assign(harness.input.auth, { tenantId })
    await expect(harness.authorize()).rejects.toMatchObject({ status: 400 })
  })

  it('denies an unresolved caller organization without tenant replay permission', async () => {
    const harness = createReplayHarness(action)
    Object.assign(harness.input, { organizationId: null })
    Object.assign(harness.input.auth, { orgId: null })
    harness.loadAclWithEntityManager.mockResolvedValue({ isSuperAdmin: false, features: [], organizations: null })
    harness.find.mockResolvedValue([])
    await expect(harness.authorize()).rejects.toMatchObject({ status: 400 })
  })

  it('denies access revoked after request preflight', async () => {
    const harness = createReplayHarness(action)
    harness.loadAclWithEntityManager.mockResolvedValue({ isSuperAdmin: false, features: [], organizations: [] })
    await expect(harness.authorize()).rejects.toMatchObject({ status: 400 })
  })

  it('denies a child reparented outside the authorized subtree before replay', async () => {
    const harness = createReplayHarness(action)
    harness.find.mockResolvedValue([{ id: 'parent', descendantIds: [] }])
    await expect(harness.authorize()).rejects.toMatchObject({ status: 400 })
  })

  it('denies a revoked self feature even when the tenant feature remains', async () => {
    const harness = createReplayHarness(action)
    harness.userHasAllFeaturesWithEntityManager.mockImplementation(
      async (_em: EntityManager, _userId: string, features: string[]) => features[0] === harness.input.tenantFeature,
    )
    await expect(harness.authorize()).rejects.toMatchObject({ status: 400 })
  })

  it('preserves tenant-level rows without an organization', async () => {
    const harness = createReplayHarness(action)
    Object.assign(harness.log, { organizationId: null })
    await expect(harness.authorize()).resolves.toBeUndefined()
  })
})
