import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import { resolveEffectiveFeatures } from '@open-mercato/shared/security/featurePolicy'
import { RbacService, ROLE_ACL_PREVIEW_LIMITS, type RoleAclChangePreview } from '@open-mercato/core/modules/auth/services/rbacService'
import { listSuperAdminUserIds } from '@open-mercato/core/modules/auth/lib/grantChecks'
import { normalizeRoleAclSnapshot, type RoleAclSnapshot } from '@open-mercato/core/modules/auth/lib/roleAclFingerprint'
import {
  createFakeEntityManager,
  createRandom,
  emptyRows,
  uuidOf,
  type FakeEntityManager,
  type FakeRole,
  type FakeRows,
} from './rbacPreviewFixture'

const TENANT = '11111111-0000-4000-8000-0000000000c7'
const OTHER_TENANT = '11111111-0000-4000-8000-0000000000c8'
const ORG_A = '22222222-0000-4000-8000-0000000000a1'
const ORG_B = '22222222-0000-4000-8000-0000000000b1'
const ORG_C = '22222222-0000-4000-8000-0000000000c1'
const ORG_OTHER = '22222222-0000-4000-8000-0000000000d1'

const MODULES = [
  { id: 'auth', features: [
    { id: 'auth.acl.manage', title: 'ACL', module: 'auth' },
    { id: 'auth.users.list', title: 'Users', module: 'auth' },
    { id: 'auth.roles.list', title: 'Roles', module: 'auth' },
  ] },
  { id: 'sales', features: [
    { id: 'sales.orders.view', title: 'Orders', module: 'sales' },
    { id: 'sales.orders.manage', title: 'Manage orders', module: 'sales' },
    { id: 'sales.quotes.view', title: 'Quotes', module: 'sales' },
  ] },
  { id: 'catalog', features: [
    { id: 'catalog.products.view', title: 'Products', module: 'catalog' },
    { id: 'catalog.pricing.manage', title: 'Pricing', module: 'catalog' },
  ] },
  { id: 'customers', features: [
    { id: 'customers.deals.view', title: 'Deals', module: 'customers' },
    { id: 'customers.people.view', title: 'People', module: 'customers' },
  ] },
] as unknown as Module[]

const FEATURE_POOL = [
  'auth.acl.manage', 'auth.users.list', 'sales.orders.view', 'sales.orders.manage', 'sales.quotes.view',
  'catalog.products.view', 'catalog.pricing.manage', 'customers.deals.view', 'customers.people.view',
  'sales.*', 'catalog.*', 'customers.*', 'auth.*', 'sales.orders.*', '*',
]

const ORGANIZATION_LISTS: Array<string[] | null> = [null, [], ['__all__'], [ORG_A], [ORG_B], [ORG_C], [ORG_A, ORG_C]]

beforeAll(() => {
  registerModules(MODULES)
})

function baseOrganizations(rows: FakeRows): void {
  rows.organizations.push(
    { id: ORG_A, tenant: { id: TENANT }, tenantId: TENANT, name: 'Alpha', ancestorIds: [], deletedAt: null },
    { id: ORG_B, tenant: { id: TENANT }, tenantId: TENANT, name: 'Beta', ancestorIds: [ORG_A], deletedAt: null },
    { id: ORG_C, tenant: { id: TENANT }, tenantId: TENANT, name: 'Gamma', ancestorIds: [], deletedAt: null },
    { id: ORG_OTHER, tenant: { id: OTHER_TENANT }, tenantId: OTHER_TENANT, name: 'Other', ancestorIds: [], deletedAt: null },
  )
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]
}

function subset<T>(random: () => number, values: readonly T[], max: number): T[] {
  const count = Math.floor(random() * (max + 1))
  const chosen = new Set<T>()
  for (let index = 0; index < count; index += 1) chosen.add(pick(random, values))
  return Array.from(chosen)
}

type Scenario = {
  rows: FakeRows
  editedRole: FakeRole
  proposal: RoleAclSnapshot
}

function buildScenario(seed: number): Scenario {
  const random = createRandom(seed)
  const rows = emptyRows()
  baseOrganizations(rows)
  const roles: FakeRole[] = Array.from({ length: 5 }, (_, index) => ({ id: uuidOf(seed, 10 + index), tenantId: TENANT, name: `role-${index}`, deletedAt: null }))
  const foreignSuperRole: FakeRole = { id: uuidOf(seed, 20), tenantId: OTHER_TENANT, name: 'foreign-super', deletedAt: null }
  rows.roles.push(...roles, foreignSuperRole)
  rows.roleAcls.push({ id: uuidOf(seed, 30), role: foreignSuperRole, tenantId: OTHER_TENANT, isSuperAdmin: true, featuresJson: [], organizationsJson: null })
  roles.forEach((role, index) => {
    if (random() < 0.15) return
    rows.roleAcls.push({
      id: uuidOf(seed, 40 + index),
      role,
      tenantId: TENANT,
      isSuperAdmin: random() < 0.12,
      featuresJson: subset(random, FEATURE_POOL, 4),
      organizationsJson: pick(random, ORGANIZATION_LISTS),
    })
  })
  for (let index = 0; index < 12; index += 1) {
    const userId = uuidOf(seed, 100 + index)
    rows.users.push({
      id: userId,
      tenantId: random() < 0.08 ? OTHER_TENANT : TENANT,
      organizationId: pick(random, [ORG_A, ORG_B, ORG_C, null]),
      email: `user${index}@example.com`,
      name: random() < 0.5 ? `User ${index}` : null,
      deletedAt: random() < 0.06 ? new Date('2026-01-01T00:00:00Z') : null,
    })
    for (const role of subset(random, roles, 3)) rows.userRoles.push({ id: uuidOf(seed, 200 + rows.userRoles.length), user: { id: userId }, role })
    if (random() < 0.06) rows.userRoles.push({ id: uuidOf(seed, 200 + rows.userRoles.length), user: { id: userId }, role: foreignSuperRole })
    if (random() < 0.12) {
      rows.userAcls.push({
        id: uuidOf(seed, 300 + index),
        user: { id: userId },
        tenantId: TENANT,
        isSuperAdmin: random() < 0.2,
        featuresJson: subset(random, FEATURE_POOL, 3),
        organizationsJson: pick(random, ORGANIZATION_LISTS),
      })
    } else if (random() < 0.05) {
      rows.userAcls.push({ id: uuidOf(seed, 300 + index), user: { id: userId }, tenantId: OTHER_TENANT, isSuperAdmin: true, featuresJson: [], organizationsJson: null })
    }
  }
  for (let index = 0; index < 8; index += 1) {
    const roll = random()
    rows.apiKeys.push({
      id: uuidOf(seed, 400 + index),
      tenantId: roll < 0.06 ? OTHER_TENANT : TENANT,
      organizationId: pick(random, [null, ORG_A, ORG_B, ORG_C]),
      rolesJson: subset(random, roles, 3).map((role) => role.id),
      deletedAt: roll > 0.94 ? new Date('2026-01-01T00:00:00Z') : null,
      expiresAt: roll > 0.85 && roll <= 0.94 ? new Date('2020-01-01T00:00:00Z') : null,
      sessionUserId: roll > 0.75 && roll <= 0.85 ? uuidOf(seed, 100) : null,
      name: `key-${index}`,
      keyPrefix: `omk_${index}`,
    })
  }
  const editedRole = pick(random, roles)
  const proposal = normalizeRoleAclSnapshot({
    isSuperAdmin: random() < 0.1,
    features: subset(random, FEATURE_POOL, 5),
    organizations: pick(random, ORGANIZATION_LISTS),
  })
  return { rows, editedRole, proposal }
}

function currentSnapshot(rows: FakeRows, role: FakeRole): RoleAclSnapshot {
  const acl = rows.roleAcls.find((row) => row.role.id === role.id && row.tenantId === TENANT)
  return normalizeRoleAclSnapshot(acl ? { isSuperAdmin: acl.isSuperAdmin, features: acl.featuresJson, organizations: acl.organizationsJson } : null)
}

function applyProposal(rows: FakeRows, role: FakeRole, proposal: RoleAclSnapshot): void {
  rows.roleAcls = rows.roleAcls.filter((row) => !(row.role.id === role.id && row.tenantId === TENANT))
  rows.roleAcls.push({
    id: uuidOf(999, rows.roleAcls.length),
    role,
    tenantId: TENANT,
    isSuperAdmin: proposal.isSuperAdmin,
    featuresJson: [...proposal.features],
    organizationsJson: proposal.organizations === null ? null : [...proposal.organizations],
  })
}

const sorted = (values: readonly string[]): string[] => [...values].sort()

/** The effective features `loadAclWithEntityManager` grants (through the public projection of its grants). */
async function loaderEffective(service: RbacService, em: FakeEntityManager, principalId: string, organizationId: string): Promise<string[]> {
  const granted = await service.getGrantedFeaturesWithEntityManager(em as never, principalId, { tenantId: TENANT, organizationId })
  return sorted(resolveEffectiveFeatures(granted))
}

function principalKey(type: string, id: string): string {
  return type === 'user' ? id : `api_key:${id}`
}

function accessByPrincipal(preview: RoleAclChangePreview): Map<string, Map<string, { before: string[]; after: string[] }>> {
  const result = new Map<string, Map<string, { before: string[]; after: string[] }>>()
  for (const cohort of preview.cohorts) {
    for (const principal of cohort.principals) {
      const byOrganization = new Map<string, { before: string[]; after: string[] }>()
      for (const access of cohort.access) {
        byOrganization.set(access.organizationId, { before: preview.featureSets[access.before], after: preview.featureSets[access.after] })
      }
      result.set(principalKey(cohort.principalType, principal.id), byOrganization)
    }
  }
  return result
}

async function globallySuperAdmin(service: RbacService, em: FakeEntityManager, userId: string): Promise<boolean> {
  const acl = await service.loadAclWithEntityManager(em as never, userId, { tenantId: TENANT, organizationId: null })
  return acl.isSuperAdmin && acl.organizations === null && acl.features.length === 1 && acl.features[0] === '*'
}

/** Principals the preview must evaluate: holders of the role in the tenant, minus super administrators and ephemeral/expired/deleted keys. */
async function eligiblePrincipals(service: RbacService, em: FakeEntityManager, rows: FakeRows, role: FakeRole): Promise<{ users: string[]; keys: string[] }> {
  const superAdmins = await listSuperAdminUserIds(em as never, TENANT)
  const users: string[] = []
  for (const link of rows.userRoles.filter((entry) => entry.role.id === role.id)) {
    const user = rows.users.find((entry) => entry.id === link.user.id)
    if (!user || user.tenantId !== TENANT || user.deletedAt) continue
    if (superAdmins.has(user.id) || (await globallySuperAdmin(service, em, user.id))) continue
    if (!users.includes(user.id)) users.push(user.id)
  }
  const keys = rows.apiKeys
    .filter((key) => key.tenantId === TENANT && !key.deletedAt && !key.sessionUserId && !(key.expiresAt && key.expiresAt.getTime() < Date.now()))
    .filter((key) => (key.rolesJson ?? []).includes(role.id))
    .map((key) => key.id)
  return { users, keys }
}

const TENANT_ORGANIZATIONS = [ORG_A, ORG_B, ORG_C]

describe('RbacService.previewRoleAclChange — parity with loadAclWithEntityManager (property-style)', () => {
  const seeds = Array.from({ length: 40 }, (_, index) => 7_001 + index)

  it.each(seeds)('an unchanged proposal reproduces every principal\'s effective features in every organization (seed %i)', async (seed) => {
    const { rows, editedRole } = buildScenario(seed)
    if (!rows.roleAcls.some((row) => row.role.id === editedRole.id && row.tenantId === TENANT)) {
      rows.roleAcls.push({ id: uuidOf(seed, 98), role: editedRole, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['sales.orders.view'], organizationsJson: [ORG_B] })
    }
    const em = createFakeEntityManager(rows)
    const service = new RbacService(em as never)
    const preview = await service.previewRoleAclChange(TENANT, editedRole.id, currentSnapshot(rows, editedRole), { em: em as never })
    expect(preview).not.toBeNull()
    const access = accessByPrincipal(preview!)
    for (const cohort of preview!.cohorts) {
      for (const entry of cohort.access) expect(entry.before).toBe(entry.after)
    }
    const eligible = await eligiblePrincipals(service, em, rows, editedRole)
    const userAclHolders = new Set(rows.userAcls.filter((acl) => acl.tenantId === TENANT).map((acl) => acl.user.id))
    for (const userId of eligible.users) {
      const listed = access.get(userId)
      for (const organizationId of TENANT_ORGANIZATIONS) {
        const expected = await loaderEffective(service, em, userId, organizationId)
        if (userAclHolders.has(userId)) {
          expect(listed).toBeUndefined()
          continue
        }
        const actual = listed?.get(organizationId)
        expect(actual?.before ?? []).toEqual(expected)
        expect(actual?.after ?? []).toEqual(expected)
      }
    }
    for (const keyId of eligible.keys) {
      const listed = access.get(`api_key:${keyId}`)
      for (const organizationId of TENANT_ORGANIZATIONS) {
        const expected = await loaderEffective(service, em, `api_key:${keyId}`, organizationId)
        expect(listed?.get(organizationId)?.before ?? []).toEqual(expected)
      }
    }
    const listedIds = new Set(preview!.cohorts.flatMap((cohort) => cohort.principals.map((principal) => principalKey(cohort.principalType, principal.id))))
    for (const id of listedIds) {
      expect([...eligible.users, ...eligible.keys.map((key) => `api_key:${key}`)]).toContain(id)
    }
  })

  it.each(seeds)('a changed proposal reproduces the effective features the loader grants once the proposal is saved (seed %i)', async (seed) => {
    const { rows, editedRole, proposal } = buildScenario(seed)
    const em = createFakeEntityManager(rows)
    const service = new RbacService(em as never)
    const eligibleBefore = await eligiblePrincipals(service, em, rows, editedRole)
    const preview = await service.previewRoleAclChange(TENANT, editedRole.id, proposal, { em: em as never })
    expect(preview).not.toBeNull()
    const access = accessByPrincipal(preview!)
    const before = new Map<string, Map<string, string[]>>()
    const principals = [...eligibleBefore.users, ...eligibleBefore.keys.map((key) => `api_key:${key}`)]
    for (const principal of principals) {
      const perOrganization = new Map<string, string[]>()
      for (const organizationId of TENANT_ORGANIZATIONS) perOrganization.set(organizationId, await loaderEffective(service, em, principal, organizationId))
      before.set(principal, perOrganization)
    }
    applyProposal(rows, editedRole, proposal)
    const userAclHolders = new Set(rows.userAcls.filter((acl) => acl.tenantId === TENANT).map((acl) => acl.user.id))
    for (const principal of principals) {
      const listed = access.get(principal)
      for (const organizationId of TENANT_ORGANIZATIONS) {
        const expectedBefore = before.get(principal)!.get(organizationId)!
        const expectedAfter = await loaderEffective(service, em, principal, organizationId)
        if (!listed) {
          if (userAclHolders.has(principal)) {
            expect(expectedAfter).toEqual(expectedBefore)
          } else {
            expect(expectedBefore).toEqual([])
            expect(expectedAfter).toEqual([])
          }
          continue
        }
        expect(listed.get(organizationId)?.before ?? []).toEqual(expectedBefore)
        expect(listed.get(organizationId)?.after ?? []).toEqual(expectedAfter)
      }
    }
  })
})

describe('RbacService.previewRoleAclChange — a role without an ACL row', () => {
  it('previews the row its first save creates: an absent allowlist widens a holder\'s organization visibility', async () => {
    const rows = emptyRows()
    baseOrganizations(rows)
    const unsaved: FakeRole = { id: uuidOf(7, 1), tenantId: TENANT, name: 'Unsaved', deletedAt: null }
    const scoped: FakeRole = { id: uuidOf(7, 2), tenantId: TENANT, name: 'Scoped', deletedAt: null }
    rows.roles.push(unsaved, scoped)
    rows.roleAcls.push({ id: uuidOf(7, 3), role: scoped, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['sales.orders.view'], organizationsJson: [] })
    const userId = uuidOf(7, 4)
    rows.users.push({ id: userId, tenantId: TENANT, organizationId: ORG_A, email: 'u@example.com', name: null, deletedAt: null })
    rows.userRoles.push({ id: uuidOf(7, 5), user: { id: userId }, role: unsaved }, { id: uuidOf(7, 6), user: { id: userId }, role: scoped })
    const em = createFakeEntityManager(rows)
    const service = new RbacService(em as never)
    const preview = await service.previewRoleAclChange(TENANT, unsaved.id, { isSuperAdmin: false, features: [], organizations: null }, { em: em as never })
    expect(preview!.current).toEqual({ isSuperAdmin: false, features: [], organizations: null })
    expect(preview!.currentExists).toBe(false)
    expect(await loaderEffective(service, em, userId, ORG_A)).toEqual([])
    const access = accessByPrincipal(preview!).get(userId)!.get(ORG_A)!
    expect(access.before).toEqual([])
    expect(access.after).toEqual(['sales.orders.view'])
    applyProposal(rows, unsaved, { isSuperAdmin: false, features: [], organizations: null })
    expect(await loaderEffective(service, em, userId, ORG_A)).toEqual(['sales.orders.view'])
  })
})

describe('RbacService.previewRoleAclChange — principals', () => {
  function fixture() {
    const rows = emptyRows()
    baseOrganizations(rows)
    const role: FakeRole = { id: uuidOf(1, 1), tenantId: TENANT, name: 'Sales', deletedAt: null }
    const superRole: FakeRole = { id: uuidOf(1, 2), tenantId: TENANT, name: 'superadmin', deletedAt: null }
    const otherRole: FakeRole = { id: uuidOf(1, 3), tenantId: TENANT, name: 'Support', deletedAt: null }
    const foreignRole: FakeRole = { id: uuidOf(1, 4), tenantId: OTHER_TENANT, name: 'Sales', deletedAt: null }
    rows.roles.push(role, superRole, otherRole, foreignRole)
    rows.roleAcls.push(
      { id: uuidOf(2, 1), role, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['sales.orders.view', 'auth.acl.manage'], organizationsJson: null },
      { id: uuidOf(2, 2), role: superRole, tenantId: TENANT, isSuperAdmin: true, featuresJson: [], organizationsJson: null },
      { id: uuidOf(2, 3), role: otherRole, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['customers.*'], organizationsJson: [ORG_C] },
    )
    const user = (index: number, organizationId: string | null) => {
      const id = uuidOf(3, index)
      rows.users.push({ id, tenantId: TENANT, organizationId, email: `u${index}@example.com`, name: null, deletedAt: null })
      return id
    }
    const plain = user(1, ORG_A)
    const hiddenSuperAdmin = user(2, ORG_A)
    const withUserAcl = user(3, ORG_A)
    const inOrgC = user(4, ORG_C)
    const requester = user(5, ORG_A)
    for (const id of [plain, hiddenSuperAdmin, withUserAcl, inOrgC, requester]) rows.userRoles.push({ id: uuidOf(4, rows.userRoles.length), user: { id }, role })
    rows.userRoles.push({ id: uuidOf(4, 90), user: { id: hiddenSuperAdmin }, role: superRole })
    rows.userRoles.push({ id: uuidOf(4, 91), user: { id: inOrgC }, role: otherRole })
    rows.userAcls.push({ id: uuidOf(5, 1), user: { id: withUserAcl }, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['sales.*'], organizationsJson: null })
    const key = (index: number, overrides: Partial<FakeRows['apiKeys'][number]> = {}) => {
      const id = uuidOf(6, index)
      rows.apiKeys.push({ id, tenantId: TENANT, organizationId: null, rolesJson: [role.id], deletedAt: null, expiresAt: null, sessionUserId: null, name: `key ${index}`, keyPrefix: `omk_${index}`, ...overrides })
      return id
    }
    const liveKey = key(1, { organizationId: ORG_B })
    key(2, { sessionUserId: plain })
    key(3, { expiresAt: new Date('2020-01-01T00:00:00Z') })
    key(4, { deletedAt: new Date('2020-01-01T00:00:00Z') })
    key(5, { tenantId: OTHER_TENANT })
    return { rows, role, foreignRole, plain, hiddenSuperAdmin, withUserAcl, inOrgC, requester, liveKey }
  }

  const ids = (preview: RoleAclChangePreview | null, type: 'user' | 'api_key') => (preview?.cohorts ?? [])
    .filter((cohort) => cohort.principalType === type)
    .flatMap((cohort) => cohort.principals.map((principal) => principal.id))
    .sort()

  it('lists users holding the role without a user ACL and live API keys; super administrators and ephemeral, expired, deleted or foreign keys never appear', async () => {
    const { rows, role, plain, inOrgC, requester, liveKey } = fixture()
    const em = createFakeEntityManager(rows)
    const preview = await new RbacService(em as never).previewRoleAclChange(TENANT, role.id, { isSuperAdmin: false, features: ['sales.orders.view'], organizations: null }, { em: em as never })
    expect(ids(preview, 'user')).toEqual([plain, inOrgC, requester].sort())
    expect(ids(preview, 'api_key')).toEqual([liveKey])
    expect(preview!.current).toEqual({ isSuperAdmin: false, features: ['sales.orders.view', 'auth.acl.manage'], organizations: null })
    expect(preview!.currentExists).toBe(true)
    for (const write of [em.persist, em.flush, em.nativeUpdate, em.nativeDelete, em.insert, em.remove, em.create, em.transactional]) expect(write).not.toHaveBeenCalled()
  })

  it('is wildcard-aware: a wildcard grant expands to every concrete feature it covers', async () => {
    const { rows, role, plain } = fixture()
    const em = createFakeEntityManager(rows)
    const preview = await new RbacService(em as never).previewRoleAclChange(TENANT, role.id, { isSuperAdmin: false, features: ['sales.*'], organizations: null }, { em: em as never })
    const access = accessByPrincipal(preview!).get(plain)!.get(ORG_A)!
    expect(access.before).toEqual(['auth.acl.manage', 'sales.orders.view'])
    expect(access.after).toEqual(['sales.orders.manage', 'sales.orders.view', 'sales.quotes.view'])
  })

  it('evaluates only the requested organizations and principals of the requested home organizations ([] = none)', async () => {
    const { rows, role, plain, requester, inOrgC, liveKey } = fixture()
    const em = createFakeEntityManager(rows)
    const service = new RbacService(em as never)
    const proposal = { isSuperAdmin: false, features: ['sales.orders.view'], organizations: null }
    const scoped = await service.previewRoleAclChange(TENANT, role.id, proposal, { em: em as never, organizationIds: [ORG_A], principalOrganizationIds: [ORG_A] })
    expect(scoped!.organizationIds).toEqual([ORG_A])
    expect(ids(scoped, 'user')).toEqual([plain, requester].sort())
    expect(ids(scoped, 'user')).not.toContain(inOrgC)
    expect(ids(scoped, 'api_key')).not.toContain(liveKey)
    const denied = await service.previewRoleAclChange(TENANT, role.id, proposal, { em: em as never, organizationIds: [], principalOrganizationIds: [] })
    expect(denied!.organizationIds).toEqual([])
    expect(denied!.cohorts).toEqual([])
    const foreignOrganization = await service.previewRoleAclChange(TENANT, role.id, proposal, { em: em as never, organizationIds: [ORG_OTHER] })
    expect(foreignOrganization!.organizationIds).toEqual([])
  })

  it('evaluates the requester at the selected organization even when the requester is a hidden super administrator', async () => {
    const { rows, role, requester, hiddenSuperAdmin } = fixture()
    const em = createFakeEntityManager(rows)
    const service = new RbacService(em as never)
    const removeManage = { isSuperAdmin: false, features: ['sales.orders.view'], organizations: null }
    const preview = await service.previewRoleAclChange(TENANT, role.id, removeManage, { em: em as never, selfUserId: requester, selfOrganizationId: ORG_A })
    expect(preview!.featureSets[preview!.self!.before]).toContain('auth.acl.manage')
    expect(preview!.featureSets[preview!.self!.after]).not.toContain('auth.acl.manage')
    expect(preview!.self).toEqual(expect.objectContaining({ organizationId: ORG_A, organizationAllowedBefore: true, organizationAllowedAfter: true }))
    const restricted = await service.previewRoleAclChange(TENANT, role.id, { isSuperAdmin: false, features: ['sales.orders.view'], organizations: [ORG_C] }, { em: em as never, selfUserId: requester, selfOrganizationId: ORG_A })
    expect(restricted!.self).toEqual(expect.objectContaining({ organizationAllowedBefore: true, organizationAllowedAfter: false }))
    expect(restricted!.featureSets[restricted!.self!.after]).toEqual([])
    const superAdminSelf = await service.previewRoleAclChange(TENANT, role.id, removeManage, { em: em as never, selfUserId: hiddenSuperAdmin, selfOrganizationId: ORG_A })
    expect(superAdminSelf!.self!.before).toBe(superAdminSelf!.self!.after)
    expect(ids(superAdminSelf, 'user')).not.toContain(hiddenSuperAdmin)
  })

  it('answers null for a role of another tenant or a deleted role', async () => {
    const { rows, role, foreignRole } = fixture()
    const em = createFakeEntityManager(rows)
    const service = new RbacService(em as never)
    const proposal = { isSuperAdmin: false, features: [], organizations: null }
    expect(await service.previewRoleAclChange(TENANT, foreignRole.id, proposal, { em: em as never })).toBeNull()
    role.deletedAt = new Date()
    expect(await service.previewRoleAclChange(TENANT, role.id, proposal, { em: em as never })).toBeNull()
  })

  it('lists a per-user ACL holder only when the proposal makes the role an unrestricted super-admin role (that grant precedes the user ACL)', async () => {
    const { rows, role, withUserAcl } = fixture()
    const em = createFakeEntityManager(rows)
    const preview = await new RbacService(em as never).previewRoleAclChange(TENANT, role.id, { isSuperAdmin: true, features: [], organizations: null }, { em: em as never })
    expect(ids(preview, 'user')).toContain(withUserAcl)
    const access = accessByPrincipal(preview!).get(withUserAcl)!.get(ORG_A)!
    expect(access.after.length).toBeGreaterThan(access.before.length)
  })

  it('leaves API keys out on request', async () => {
    const { rows, role, liveKey } = fixture()
    const em = createFakeEntityManager(rows)
    const preview = await new RbacService(em as never).previewRoleAclChange(TENANT, role.id, { isSuperAdmin: false, features: [], organizations: null }, { em: em as never, includeApiKeys: false })
    expect(ids(preview, 'api_key')).toEqual([])
    expect(ids(preview, 'api_key')).not.toContain(liveKey)
    expect(preview!.truncated.apiKeys).toBe(false)
  })

  it('replaces only the ACL row the save updates when a role has duplicate rows', async () => {
    const { rows, role, plain } = fixture()
    rows.roleAcls.push({ id: uuidOf(2, 9), role, tenantId: TENANT, isSuperAdmin: false, featuresJson: ['catalog.products.view'], organizationsJson: null })
    const em = createFakeEntityManager(rows)
    const service = new RbacService(em as never)
    const proposal = { isSuperAdmin: false, features: ['customers.deals.view'], organizations: null }
    const preview = await service.previewRoleAclChange(TENANT, role.id, proposal, { em: em as never })
    const first = rows.roleAcls.find((row) => row.role.id === role.id)!
    first.featuresJson = [...proposal.features]
    first.organizationsJson = null
    const after = accessByPrincipal(preview!).get(plain)!.get(ORG_A)!.after
    expect(after).toEqual(await loaderEffective(service, em, plain, ORG_A))
    expect(after).toEqual(['catalog.products.view', 'customers.deals.view'])
  })

  it('reports truncation and evaluates the first organizations by id', async () => {
    const rows = emptyRows()
    const role: FakeRole = { id: uuidOf(8, 1), tenantId: TENANT, name: 'Wide', deletedAt: null }
    rows.roles.push(role)
    for (let index = 0; index < ROLE_ACL_PREVIEW_LIMITS.organizations + 5; index += 1) {
      rows.organizations.push({ id: uuidOf(9, index), tenant: { id: TENANT }, tenantId: TENANT, name: `Org ${index}`, ancestorIds: [], deletedAt: null })
    }
    const em = createFakeEntityManager(rows)
    const preview = await new RbacService(em as never).previewRoleAclChange(TENANT, role.id, { isSuperAdmin: false, features: [], organizations: null }, { em: em as never })
    expect(preview!.organizationIds).toHaveLength(ROLE_ACL_PREVIEW_LIMITS.organizations)
    expect(preview!.truncated).toEqual({ users: false, apiKeys: false, organizations: true })
    expect(preview!.organizationIds[0]).toBe(uuidOf(9, 0))
  })
})
