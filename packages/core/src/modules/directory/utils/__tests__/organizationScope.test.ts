/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { ALL_ORGANIZATIONS_COOKIE_VALUE } from '@open-mercato/core/modules/directory/constants'
import { resolveOrganizationScope } from '../organizationScope'

/**
 * Creates a mock EntityManager whose `find` returns Organization-like rows
 * that match the requested ids.
 */
function createMockEm(rows: Array<{ id: string; descendantIds: string[] }>) {
  return {
    find: jest.fn((_entity: unknown, filter: { id?: { $in: string[] }; tenant?: string }) => {
      const requestedIds = filter?.id?.$in ?? []
      return Promise.resolve(
        rows.filter((row) => requestedIds.includes(row.id)),
      )
    }),
  } as unknown as EntityManager
}

function createMockRbac(aclResult: { isSuperAdmin: boolean; features: string[]; organizations: string[] | null }) {
  return {
    loadAcl: jest.fn().mockResolvedValue(aclResult),
  } as unknown as RbacService
}

function createAuth(overrides: Partial<AuthContext> & { sub: string }): AuthContext {
  return {
    tenantId: 'tenant-1',
    orgId: 'org-home',
    isSuperAdmin: false,
    ...overrides,
  } as AuthContext
}

const ORG_HOME = { id: 'org-home', descendantIds: ['org-home-child'] }
const ORG_A = { id: 'org-a', descendantIds: [] }
const ORG_B = { id: 'org-b', descendantIds: ['org-b-child'] }
const ALL_ORGS = [ORG_HOME, ORG_A, ORG_B]

describe('resolveOrganizationScope', () => {
  describe('unauthenticated / missing context', () => {
    it('returns null scope when auth.sub is missing', async () => {
      const em = createMockEm([])
      const rbac = createMockRbac({ isSuperAdmin: false, features: [], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: {} as AuthContext,
      })
      expect(result).toEqual({ selectedId: null, filterIds: null, allowedIds: null, tenantId: null })
    })

    it('returns null scope when tenantId is empty', async () => {
      const em = createMockEm([])
      const rbac = createMockRbac({ isSuperAdmin: false, features: [], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', tenantId: '' }),
      })
      expect(result).toEqual({ selectedId: null, filterIds: null, allowedIds: null, tenantId: null })
    })
  })

  describe('superAdmin behavior', () => {
    it('returns null filterIds when superAdmin selects "All Organizations"', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: true, features: ['*'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: true }),
        selectedId: ALL_ORGANIZATIONS_COOKIE_VALUE,
      })
      expect(result.filterIds).toBeNull()
      expect(result.selectedId).toBeNull()
      expect(result.tenantId).toBe('tenant-1')
    })

    it('returns null filterIds when superAdmin has no org selection', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: true, features: ['*'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: true }),
      })
      expect(result.filterIds).toBeNull()
      expect(result.selectedId).toBeNull()
    })

    it('scopes to specific org + descendants when superAdmin selects one', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: true, features: ['*'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: true }),
        selectedId: 'org-b',
      })
      expect(result.selectedId).toBe('org-b')
      expect(result.filterIds).toEqual(expect.arrayContaining(['org-b', 'org-b-child']))
    })
  })

  describe('non-superAdmin with __all__ ACL access (issue #1112)', () => {
    it('returns null filterIds when user with unrestricted ACL selects "All Organizations"', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: false, features: ['some.feature'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false }),
        selectedId: ALL_ORGANIZATIONS_COOKIE_VALUE,
      })
      expect(result.filterIds).toBeNull()
      expect(result.selectedId).toBeNull()
      expect(result.allowedIds).toBeNull()
      expect(result.tenantId).toBe('tenant-1')
    })

    it('returns null filterIds when ACL organizations array contains __all__ token', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: [ALL_ORGANIZATIONS_COOKIE_VALUE],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false }),
        selectedId: ALL_ORGANIZATIONS_COOKIE_VALUE,
      })
      expect(result.filterIds).toBeNull()
      expect(result.selectedId).toBeNull()
      expect(result.allowedIds).toBeNull()
    })

    it('scopes to specific org when user with unrestricted ACL selects one', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: false, features: ['some.feature'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false }),
        selectedId: 'org-a',
      })
      expect(result.selectedId).toBe('org-a')
      expect(result.filterIds).toEqual(expect.arrayContaining(['org-a']))
    })

    it('falls back to home org when user with unrestricted ACL has no selection', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: false, features: ['some.feature'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false }),
      })
      expect(result.selectedId).toBe('org-home')
      expect(result.filterIds).toEqual(expect.arrayContaining(['org-home', 'org-home-child']))
    })
  })

  describe('non-superAdmin with restricted ACL (specific org list)', () => {
    it('does not widen to all orgs when "All Organizations" is selected but ACL is restricted', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: ['org-a', 'org-b'],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false }),
        selectedId: ALL_ORGANIZATIONS_COOKIE_VALUE,
      })
      expect(result.filterIds).not.toBeNull()
      expect(result.filterIds).toEqual(expect.arrayContaining(['org-a', 'org-b', 'org-b-child']))
    })

    it('scopes to selected org when it is in the allowed list', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: ['org-a', 'org-b'],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false }),
        selectedId: 'org-b',
      })
      expect(result.selectedId).toBe('org-b')
      expect(result.filterIds).toEqual(expect.arrayContaining(['org-b', 'org-b-child']))
    })

    it('falls back to allowed set when selected org is not in ACL', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: ['org-a'],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: 'org-home' }),
        selectedId: 'org-b',
      })
      expect(result.selectedId).not.toBe('org-b')
      expect(result.filterIds).toEqual(expect.arrayContaining(['org-a']))
    })
  })

  describe('ACL-level superAdmin flag', () => {
    it('treats ACL-level isSuperAdmin same as auth-level for org scope widening', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: true, features: ['*'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false }),
        selectedId: ALL_ORGANIZATIONS_COOKIE_VALUE,
      })
      expect(result.filterIds).toBeNull()
      expect(result.selectedId).toBeNull()
    })
  })
})
