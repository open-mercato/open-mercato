/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { RoleAcl, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { ALL_ORGANIZATIONS_COOKIE_VALUE } from '@open-mercato/core/modules/directory/constants'
import {
  resolveFeatureCheckContext,
  resolveOrganizationScope,
  resolveOrganizationScopeForRequest,
} from '../organizationScope'

/**
 * Creates a mock EntityManager whose `find` returns Organization-like rows
 * that match the requested ids.
 */
function createMockEm(rows: Array<{ id: string; descendantIds: string[] }>) {
  return {
    find: jest.fn((_entity: unknown, filter: { id?: { $in: string[] }; tenant?: string }) => {
      const requestedIds = filter?.id?.$in
      return Promise.resolve(
        requestedIds ? rows.filter((row) => requestedIds.includes(row.id)) : rows,
      )
    }),
  } as unknown as EntityManager
}

function createMockRbac(aclResult: { isSuperAdmin: boolean; features: string[]; organizations: string[] | null }) {
  return {
    loadAcl: jest.fn().mockResolvedValue(aclResult),
  } as unknown as RbacService
}

const HOME_ID = '00000000-0000-4000-8000-000000000001'
const ORG_A_ID = '00000000-0000-4000-8000-000000000002'
const ORG_B_ID = '00000000-0000-4000-8000-000000000003'
const DEAD_ORG_ID = '00000000-0000-4000-8000-000000000004'
const DELETED_ORG_ID = '00000000-0000-4000-8000-000000000005'
const TARGET_ORG_ID = '00000000-0000-4000-8000-000000000006'

function createAuth(overrides: Partial<AuthContext> & { sub: string }): AuthContext {
  return {
    tenantId: 'tenant-1',
    orgId: HOME_ID,
    isSuperAdmin: false,
    ...overrides,
  } as AuthContext
}

const ORG_HOME = { id: HOME_ID, descendantIds: ['org-home-child'] }
const ORG_A = { id: ORG_A_ID, descendantIds: [] }
const ORG_B = { id: ORG_B_ID, descendantIds: ['org-b-child'] }
const ALL_ORGS = [ORG_HOME, ORG_A, ORG_B]

function createAllOrganizationsRequest() {
  return {
    headers: {
      get: (name: string) => name === 'cookie'
        ? `om_selected_org=${ALL_ORGANIZATIONS_COOKIE_VALUE}`
        : null,
    },
  }
}

function createFeatureNarrowingContainer(options: {
  approvedOrganizationIds: string[]
  acl?: { isSuperAdmin: boolean; features: string[]; organizations: string[] | null }
}) {
  const em = createMockEm(ALL_ORGS)
  const rbac = {
    loadAcl: jest.fn(async () => options.acl ?? { isSuperAdmin: false, features: [], organizations: null }),
    resolveFeatureOrganizationAccess: jest.fn(async () => ({
      unrestricted: false,
      filterOrganizationIds: () => options.approvedOrganizationIds,
    })),
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'rbacService') return rbac
      throw new Error(`Unexpected dependency: ${name}`)
    },
  } as unknown as AwilixContainer
  return { container, rbac }
}

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
      expect(result.allowedIds).toBeNull()
    })

    it('scopes to specific org + descendants when superAdmin selects one', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: true, features: ['*'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: true }),
        selectedId: ORG_B_ID,
      })
      expect(result.selectedId).toBe(ORG_B_ID)
      expect(result.filterIds).toEqual(expect.arrayContaining([ORG_B_ID, 'org-b-child']))
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
        selectedId: ORG_A_ID,
      })
      expect(result.selectedId).toBe(ORG_A_ID)
      expect(result.filterIds).toEqual(expect.arrayContaining([ORG_A_ID]))
    })

    it('falls back to home org when user with unrestricted ACL has no selection', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: false, features: ['some.feature'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false }),
      })
      expect(result.selectedId).toBe(HOME_ID)
      expect(result.filterIds).toEqual(expect.arrayContaining([HOME_ID, 'org-home-child']))
      expect(result.allowedIds).toBeNull()
    })
  })

  describe('non-superAdmin with restricted ACL (specific org list)', () => {
    it('preserves an explicit empty ACL as deny-all instead of falling back to the home org', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: [],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
      })

      expect(result.selectedId).toBeNull()
      expect(result.filterIds).toEqual([])
      expect(result.allowedIds).toEqual([])
    })

    it('rejects an explicitly selected organization when the ACL is deny-all', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: [],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
        selectedId: HOME_ID,
      })

      expect(result.selectedId).toBeNull()
      expect(result.filterIds).toEqual([])
      expect(result.allowedIds).toEqual([])
      expect(result.selectionRejected).toBe(true)
    })

    it('allows the home organization when it is explicitly present in the ACL', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: [HOME_ID],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
        selectedId: HOME_ID,
      })

      expect(result.selectedId).toBe(HOME_ID)
      expect(result.filterIds).toEqual([HOME_ID, 'org-home-child'])
      expect(result.allowedIds).toEqual([HOME_ID, 'org-home-child'])
      expect(result.selectionRejected).toBeFalsy()
    })

    it('does not widen to all orgs when "All Organizations" is selected but ACL is restricted', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: [ORG_A_ID, ORG_B_ID],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false }),
        selectedId: ALL_ORGANIZATIONS_COOKIE_VALUE,
      })
      expect(result.filterIds).not.toBeNull()
      expect(result.filterIds).toEqual(expect.arrayContaining([ORG_A_ID, ORG_B_ID, 'org-b-child']))
    })

    it('scopes to selected org when it is in the allowed list', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: [ORG_A_ID, ORG_B_ID],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false }),
        selectedId: ORG_B_ID,
      })
      expect(result.selectedId).toBe(ORG_B_ID)
      expect(result.filterIds).toEqual(expect.arrayContaining([ORG_B_ID, 'org-b-child']))
    })

    it('falls back to allowed set when selected org is not in ACL', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: [ORG_A_ID],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
        selectedId: ORG_B_ID,
      })
      expect(result.selectedId).not.toBe(ORG_B_ID)
      expect(result.filterIds).toEqual(expect.arrayContaining([ORG_A_ID]))
    })
  })

  // Regression: a selected-org cookie / JWT org that no longer
  // resolves to a real organization (e.g. after a DB reset reassigns the org a
  // new UUID) must NOT be honored as the write target. Otherwise writes derived
  // from `selectedId` land under a dead org while reads filter by `filterIds`,
  // silently orphaning the record. The write target (`selectedId`) and read
  // scope (`filterIds`) must always agree on a real, accessible org.
  describe('stale / non-existent selected org', () => {
    it('drops a dead selection for an unrestricted user and falls back to the account org', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: false, features: ['some.feature'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
        selectedId: DEAD_ORG_ID,
      })
      expect(result.selectedId).not.toBe(DEAD_ORG_ID)
      // read scope degrades gracefully to a real, accessible org
      expect(result.selectedId).toBe(HOME_ID)
      expect(result.filterIds).toEqual(expect.arrayContaining([HOME_ID, 'org-home-child']))
      expect(result.filterIds).toContain(result.selectedId)
      expect(result.filterIds).not.toContain(DEAD_ORG_ID)
      // ...but the explicit selection was rejected, so writes must fail loud
      expect(result.selectionRejected).toBe(true)
    })

    it('flags a dead selection as rejected for a superAdmin', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: true, features: ['*'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: true, orgId: HOME_ID }),
        selectedId: DEAD_ORG_ID,
      })
      expect(result.selectedId).not.toBe(DEAD_ORG_ID)
      expect(result.selectionRejected).toBe(true)
    })

    it('flags a selection outside a restricted ACL as rejected', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: false, features: ['some.feature'], organizations: [ORG_A_ID] })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
        selectedId: ORG_B_ID,
      })
      expect(result.selectedId).not.toBe(ORG_B_ID)
      expect(result.selectionRejected).toBe(true)
    })

    it('does NOT flag when no organization was explicitly selected', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: false, features: ['some.feature'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
      })
      expect(result.selectionRejected).toBeFalsy()
    })

    it('does NOT flag a valid, resolvable selection', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: false, features: ['some.feature'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
        selectedId: ORG_A_ID,
      })
      expect(result.selectedId).toBe(ORG_A_ID)
      expect(result.selectionRejected).toBeFalsy()
    })

    it('does not scope a superAdmin to a non-existent selected org', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: true, features: ['*'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: true, orgId: HOME_ID }),
        selectedId: DEAD_ORG_ID,
      })
      expect(result.selectedId).not.toBe(DEAD_ORG_ID)
      if (result.filterIds !== null) {
        expect(result.filterIds).not.toContain(DEAD_ORG_ID)
      }
    })

    it('still honors a real selection for an unrestricted user', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({ isSuperAdmin: false, features: ['some.feature'], organizations: null })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
        selectedId: ORG_A_ID,
      })
      expect(result.selectedId).toBe(ORG_A_ID)
      expect(result.filterIds).toEqual(expect.arrayContaining([ORG_A_ID]))
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

  // Regression for issue #2228: scope resolution previously issued one
  // `organizations` SELECT per collectWithDescendants call (accessible set,
  // fallback set, selected set) — up to 3-4 sequential round-trips per request.
  // It must now consolidate every descendant expansion into a single query.
  describe('single-query consolidation (issue #2228)', () => {
    it('issues exactly one organizations query when a selected org is inside a restricted ACL', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: [ORG_A_ID, ORG_B_ID],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
        selectedId: ORG_B_ID,
      })
      expect((em.find as jest.Mock)).toHaveBeenCalledTimes(1)
      expect(result.selectedId).toBe(ORG_B_ID)
      expect([...(result.filterIds ?? [])].sort()).toEqual([ORG_B_ID, 'org-b-child'])
      expect([...(result.allowedIds ?? [])].sort()).toEqual([ORG_A_ID, ORG_B_ID, 'org-b-child'])
    })

    it('issues exactly one organizations query when falling back from a disallowed selection', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: [ORG_A_ID],
      })
      const result = await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
        selectedId: ORG_B_ID,
      })
      expect((em.find as jest.Mock)).toHaveBeenCalledTimes(1)
      expect(result.selectedId).not.toBe(ORG_B_ID)
      expect(result.filterIds).toEqual(expect.arrayContaining([ORG_A_ID]))
    })

    it('batches accessible, selected, and fallback ids into one $in query', async () => {
      const em = createMockEm(ALL_ORGS)
      const rbac = createMockRbac({
        isSuperAdmin: false,
        features: ['some.feature'],
        organizations: [ORG_A_ID, ORG_B_ID],
      })
      await resolveOrganizationScope({
        em,
        rbac,
        auth: createAuth({ sub: 'user-1', isSuperAdmin: false, orgId: HOME_ID }),
        selectedId: ORG_B_ID,
      })
      expect((em.find as jest.Mock)).toHaveBeenCalledTimes(1)
      const [, filter] = (em.find as jest.Mock).mock.calls[0]
      expect(filter).toMatchObject({ tenant: 'tenant-1', deletedAt: null })
      expect(filter.id.$in).toEqual(expect.arrayContaining([ORG_A_ID, ORG_B_ID, HOME_ID]))
    })
  })
})

describe('resolveOrganizationScopeForRequest', () => {
  it('trims whitespace-padded selected organization cookies during superadmin tenant override', async () => {
    const em = {
      find: jest.fn(async (_entity: unknown, where: { id?: { $in?: string[] } }) => {
        const ids = Array.isArray(where.id?.$in) ? where.id.$in : []
        if (!ids.includes(TARGET_ORG_ID)) return []
        return [{ id: TARGET_ORG_ID, descendantIds: ['org-1-child'] }]
      }),
    }
    const rbac = {
      loadAcl: jest.fn(async () => ({ isSuperAdmin: true, organizations: null })),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbac
        throw new Error(`Unexpected dependency: ${name}`)
      },
    }

    const scope = await resolveOrganizationScopeForRequest({
      container: container as unknown as AwilixContainer,
      auth: {
        sub: 'superadmin-user',
        tenantId: 'actor-tenant',
        orgId: 'actor-org',
        isSuperAdmin: true,
        roles: ['superadmin'],
      } as unknown as AuthContext,
      request: {
        headers: {
          get: (name: string) => name === 'cookie'
            ? `om_selected_tenant=target-tenant; om_selected_org=%20${TARGET_ORG_ID}%20`
            : null,
        },
      },
    })

    expect(rbac.loadAcl).toHaveBeenCalledWith('superadmin-user', {
      tenantId: 'target-tenant',
      organizationId: null,
    })
    expect(em.find).toHaveBeenCalledWith(expect.anything(), {
      tenant: 'target-tenant',
      id: { $in: [TARGET_ORG_ID] },
      deletedAt: null,
    })
    expect(scope).toEqual({
      selectedId: TARGET_ORG_ID,
      filterIds: [TARGET_ORG_ID, 'org-1-child'],
      allowedIds: null,
      tenantId: 'target-tenant',
    })
  })
})

describe('malformed organization selections', () => {
  it.each([null, ORG_HOME.id])('rejects a malformed cookie with account organization %s', async (orgId) => {
    const em = createMockEm(ALL_ORGS)
    const rbac = createMockRbac({ isSuperAdmin: true, features: [], organizations: null })
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbac
        throw new Error(`Unexpected dependency: ${name}`)
      },
    } as unknown as AwilixContainer
    const auth = createAuth({ sub: 'user-malformed-selection', orgId, isSuperAdmin: true })
    const request = new Request('http://localhost', { headers: { cookie: 'om_selected_org=none' } })

    await expect(resolveOrganizationScopeForRequest({ container, auth, request, selectedId: null }))
      .resolves.toMatchObject({ selectedId: null, filterIds: null })
    jest.mocked(em.find).mockClear()

    await expect(resolveOrganizationScopeForRequest({ container, auth, request })).resolves.toEqual({
      selectedId: orgId,
      filterIds: orgId ? [orgId, ...ORG_HOME.descendantIds] : [],
      allowedIds: null,
      tenantId: 'tenant-1',
      selectionRejected: true,
    })
    if (orgId) {
      expect(em.find).toHaveBeenCalledTimes(1)
      expect(em.find).toHaveBeenCalledWith(Organization, {
        tenant: 'tenant-1',
        id: { $in: [orgId] },
        deletedAt: null,
      })
    } else {
      expect(em.find).not.toHaveBeenCalled()
    }
  })
})

describe('resolveFeatureCheckContext', () => {
  it.each([ORG_B_ID, DELETED_ORG_ID])('preserves rejection of selection %s when narrowing feature access', async (selectedOrganizationId) => {
    const { container } = createFeatureNarrowingContainer({
      approvedOrganizationIds: [ORG_A_ID],
      acl: { isSuperAdmin: false, features: ['auth.users.edit'], organizations: [ORG_A_ID] },
    })
    const auth = createAuth({ sub: 'user-stale-selection', orgId: ORG_A_ID })
    const request = {
      headers: {
        get: (name: string) => name === 'cookie'
          ? `om_selected_org=${selectedOrganizationId}`
          : null,
      },
    }

    const originalScope = await resolveOrganizationScopeForRequest({ container, auth, request })
    expect(originalScope.selectionRejected).toBe(true)
    expect(originalScope.selectedId).toBeNull()

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request,
      requiredFeatures: ['auth.users.edit'],
    })

    expect(featureContext.scope).toEqual({
      selectedId: null,
      filterIds: [ORG_A_ID],
      allowedIds: [ORG_A_ID],
      tenantId: 'tenant-1',
      selectionRejected: true,
    })
    await expect(resolveOrganizationScopeForRequest({ container, auth, request }))
      .resolves.toEqual(featureContext.scope)
    await expect(resolveFeatureCheckContext({ container, auth, request }))
      .resolves.toMatchObject({ scope: featureContext.scope })
  })

  it('binds a feature-authorized organization subset to an all-organizations request', async () => {
    const em = createMockEm(ALL_ORGS)
    const rbac = {
      loadAcl: jest.fn(async () => ({
        isSuperAdmin: false,
        features: ['eudr.statements.view', 'eudr.risk.view'],
        organizations: null,
      })),
      resolveFeatureOrganizationAccess: jest.fn(async () => ({
        unrestricted: false,
        filterOrganizationIds: () => [ORG_A_ID],
      })),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbac
        throw new Error(`Unexpected dependency: ${name}`)
      },
    } as unknown as AwilixContainer
    const auth = createAuth({ sub: 'user-1' })
    const request = {
      headers: {
        get: (name: string) => name === 'cookie'
          ? `om_selected_org=${ALL_ORGANIZATIONS_COOKIE_VALUE}`
          : null,
      },
    }

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request,
      requiredFeatures: ['eudr.risk.view'],
    })

    expect(rbac.resolveFeatureOrganizationAccess).toHaveBeenCalledWith(
      'user-1',
      ['eudr.risk.view'],
      { tenantId: 'tenant-1' },
    )
    expect((em.find as jest.Mock).mock.calls[1]?.[1]).toMatchObject({ tenant: 'tenant-1', deletedAt: null })
    expect(featureContext.organizationId).toBe(HOME_ID)
    expect(featureContext.allowedOrganizationIds).toEqual([ORG_A_ID])
    expect(featureContext.scope).toEqual({
      selectedId: null,
      filterIds: [ORG_A_ID],
      allowedIds: [ORG_A_ID],
      tenantId: 'tenant-1',
    })

    const handlerScope = await resolveOrganizationScopeForRequest({ container, auth, request })
    expect(handlerScope).toEqual(featureContext.scope)

    const handlerFeatureContext = await resolveFeatureCheckContext({ container, auth, request })
    expect(handlerFeatureContext.organizationId).toBe(HOME_ID)
    expect(handlerFeatureContext.scope).toEqual(featureContext.scope)

    const otherRequestScope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request: {
        headers: request.headers,
      },
    })
    expect(otherRequestScope.filterIds).toBeNull()
    expect(otherRequestScope.allowedIds).toBeNull()
  })

  it('does not enumerate organizations when feature access is unrestricted', async () => {
    const em = createMockEm(ALL_ORGS)
    const rbac = {
      loadAcl: jest.fn(async () => ({
        isSuperAdmin: false,
        features: ['eudr.risk.view'],
        organizations: null,
      })),
      resolveFeatureOrganizationAccess: jest.fn(async () => ({
        unrestricted: true,
        filterOrganizationIds: () => [],
      })),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbac
        throw new Error(`Unexpected dependency: ${name}`)
      },
    } as unknown as AwilixContainer
    const auth = createAuth({ sub: 'user-global' })
    const request = {
      headers: {
        get: (name: string) => name === 'cookie'
          ? `om_selected_org=${ALL_ORGANIZATIONS_COOKIE_VALUE}`
          : null,
      },
    }

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request,
      requiredFeatures: ['eudr.risk.view'],
    })

    expect(featureContext.scope.filterIds).toBeNull()
    expect(featureContext.scope.allowedIds).toBeNull()
    expect(em.find).toHaveBeenCalledTimes(1)
  })

  it('binds an empty scope when the feature is authorized in no visible organization', async () => {
    const em = createMockEm(ALL_ORGS)
    const rbac = {
      loadAcl: jest.fn(async () => ({
        isSuperAdmin: false,
        features: ['api_keys.view'],
        organizations: [],
      })),
      resolveFeatureOrganizationAccess: jest.fn(async () => ({
        unrestricted: false,
        filterOrganizationIds: () => [],
      })),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbac
        throw new Error(`Unexpected dependency: ${name}`)
      },
    } as unknown as AwilixContainer
    const auth = createAuth({ sub: 'user-empty-scope', orgId: null })
    const request = {
      headers: {
        get: () => null,
      },
    }

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request,
      requiredFeatures: ['api_keys.view'],
    })

    expect(featureContext.organizationId).toBeNull()
    expect(featureContext.allowedOrganizationIds).toEqual([])
    expect(featureContext.scope).toEqual({
      selectedId: null,
      filterIds: [],
      allowedIds: [],
      tenantId: 'tenant-1',
    })
    expect(featureContext.featureApprovedNoOrganization).toBe(false)
    await expect(resolveOrganizationScopeForRequest({ container, auth, request }))
      .resolves.toEqual(featureContext.scope)
  })

  it('still narrows an authenticated super-admin flag when RBAC proves only restricted access', async () => {
    const em = createMockEm(ALL_ORGS)
    const rbac = {
      loadAcl: jest.fn(async () => ({
        isSuperAdmin: true,
        features: ['*'],
        organizations: null,
      })),
      resolveFeatureOrganizationAccess: jest.fn(async () => ({
        unrestricted: false,
        filterOrganizationIds: () => [ORG_A_ID],
      })),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbac
        throw new Error(`Unexpected dependency: ${name}`)
      },
    } as unknown as AwilixContainer

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth: createAuth({ sub: 'super-user', isSuperAdmin: true }),
      request: {
        headers: {
          get: () => `om_selected_org=${ALL_ORGANIZATIONS_COOKIE_VALUE}`,
        },
      },
      requiredFeatures: ['eudr.risk.view'],
    })

    expect(featureContext.scope.filterIds).toEqual([ORG_A_ID])
    expect(featureContext.scope.allowedIds).toEqual([ORG_A_ID])
    expect(rbac.resolveFeatureOrganizationAccess).toHaveBeenCalledWith(
      'super-user',
      ['eudr.risk.view'],
      { tenantId: 'tenant-1' },
    )
  })
})

describe('resolveFeatureCheckContext authorization organization', () => {
  it('authorizes against the pre-narrowing home organization instead of an approved organization', async () => {
    const { container } = createFeatureNarrowingContainer({ approvedOrganizationIds: [ORG_B_ID] })
    const auth = createAuth({ sub: 'user-1', orgId: ORG_A_ID })
    const request = createAllOrganizationsRequest()

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request,
      requiredFeatures: ['business_rules.manage'],
    })

    expect(featureContext.organizationId).toBe(ORG_A_ID)
    expect(featureContext.scope.filterIds).toEqual([ORG_B_ID])
    expect(featureContext.allowedOrganizationIds).toEqual([ORG_B_ID])

    const handlerFeatureContext = await resolveFeatureCheckContext({ container, auth, request })
    expect(handlerFeatureContext.organizationId).toBe(ORG_A_ID)
    expect(handlerFeatureContext.scope).toEqual(featureContext.scope)
  })

  it('keeps the home organization when no organization is approved', async () => {
    const { container } = createFeatureNarrowingContainer({ approvedOrganizationIds: [] })
    const auth = createAuth({ sub: 'user-1', orgId: ORG_A_ID })

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request: createAllOrganizationsRequest(),
      requiredFeatures: ['business_rules.manage'],
    })

    expect(featureContext.organizationId).not.toBeNull()
    expect(featureContext.organizationId).toBe(ORG_A_ID)
    expect(featureContext.scope.filterIds).toEqual([])
    expect(featureContext.allowedOrganizationIds).toEqual([])
  })
})

describe('resolveFeatureCheckContext with a feature granted only outside the home organization', () => {
  type RbacGrantEm = {
    fork: () => RbacGrantEm
    findOne: jest.Mock
    find: jest.Mock
  }

  const requiredFeature = 'business_rules.manage'
  const organizations = [
    { id: ORG_A_ID, descendantIds: [], ancestorIds: [] },
    { id: ORG_B_ID, descendantIds: [], ancestorIds: [] },
  ]

  function createRbacContainer(restrictedOrganizationIds: string[]) {
    const user = { id: 'user-split', tenantId: 'tenant-1', organizationId: ORG_A_ID }
    const visibilityRole = { id: 'role-visibility' }
    const restrictedRole = { id: 'role-restricted' }
    const roleAcls = [
      {
        role: visibilityRole,
        isSuperAdmin: false,
        featuresJson: ['business_rules.view'],
        organizationsJson: null,
      },
      {
        role: restrictedRole,
        isSuperAdmin: false,
        featuresJson: [requiredFeature],
        organizationsJson: restrictedOrganizationIds,
      },
    ]
    const em: RbacGrantEm = {
      fork: () => em,
      findOne: jest.fn(async (entity: unknown) => (entity === User ? user : null)),
      find: jest.fn(async (entity: unknown, where: { id?: { $in?: string[] } } | undefined) => {
        if (entity === UserRole) return [{ role: visibilityRole }, { role: restrictedRole }]
        if (entity === RoleAcl) return roleAcls
        if (entity === Organization) {
          const requestedIds = where?.id?.$in
          return requestedIds
            ? organizations.filter((organization) => requestedIds.includes(organization.id))
            : organizations
        }
        return []
      }),
    }
    const rbac = new RbacService(em as unknown as EntityManager)
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbac
        throw new Error(`Unexpected dependency: ${name}`)
      },
    } as unknown as AwilixContainer
    return { container, rbac }
  }

  it('rejects the gate check even though the feature narrows the scope to another organization', async () => {
    const { container, rbac } = createRbacContainer([ORG_B_ID])
    const auth = createAuth({ sub: 'user-split', orgId: ORG_A_ID })
    const request = createAllOrganizationsRequest()

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request,
      requiredFeatures: [requiredFeature],
    })

    expect(featureContext.scope.filterIds).toEqual([ORG_B_ID])
    expect(featureContext.organizationId).toBe(ORG_A_ID)
    await expect(rbac.userHasAllFeatures('user-split', [requiredFeature], {
      tenantId: 'tenant-1',
      organizationId: featureContext.organizationId,
    })).resolves.toBe(false)
    await expect(rbac.userHasAllFeatures('user-split', [requiredFeature], {
      tenantId: 'tenant-1',
      organizationId: ORG_B_ID,
    })).resolves.toBe(true)

    const handlerFeatureContext = await resolveFeatureCheckContext({ container, auth, request })
    expect(handlerFeatureContext.organizationId).toBe(ORG_A_ID)
  })

  it('never falls back to a null organization that would union every role when nothing is approved', async () => {
    const { container, rbac } = createRbacContainer(['org-outside'])
    const auth = createAuth({ sub: 'user-split', orgId: ORG_A_ID })

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request: createAllOrganizationsRequest(),
      requiredFeatures: [requiredFeature],
    })

    expect(featureContext.scope.filterIds).toEqual([])
    expect(featureContext.organizationId).toBe(ORG_A_ID)
    await expect(rbac.userHasAllFeatures('user-split', [requiredFeature], {
      tenantId: 'tenant-1',
      organizationId: featureContext.organizationId,
    })).resolves.toBe(false)
    await expect(rbac.userHasAllFeatures('user-split', [requiredFeature], {
      tenantId: 'tenant-1',
      organizationId: null,
    })).resolves.toBe(true)
  })
})

describe('resolveFeatureCheckContext for a principal without a home organization', () => {
  type RbacGrantEm = {
    fork: () => RbacGrantEm
    findOne: jest.Mock
    find: jest.Mock
  }

  const requiredFeature = 'business_rules.manage'
  const organizations = [
    { id: 'org-a', descendantIds: [], ancestorIds: [] },
    { id: 'org-b', descendantIds: [], ancestorIds: [] },
    { id: 'org-c', descendantIds: [], ancestorIds: [] },
  ]

  function createNullOrgContainer(featureOrganizationIds: string[] | null) {
    const user = { id: 'user-no-org', tenantId: 'tenant-1', organizationId: null }
    const visibilityRole = { id: 'role-visibility' }
    const featureRole = { id: 'role-feature' }
    const roleAcls = [
      { role: visibilityRole, isSuperAdmin: false, featuresJson: ['business_rules.view'], organizationsJson: null },
      { role: featureRole, isSuperAdmin: false, featuresJson: [requiredFeature], organizationsJson: featureOrganizationIds },
    ]
    const em: RbacGrantEm = {
      fork: () => em,
      findOne: jest.fn(async (entity: unknown) => (entity === User ? user : null)),
      find: jest.fn(async (entity: unknown, where: { id?: { $in?: string[] } } | undefined) => {
        if (entity === UserRole) return [{ role: visibilityRole }, { role: featureRole }]
        if (entity === RoleAcl) return roleAcls
        if (entity === Organization) {
          const requestedIds = where?.id?.$in
          return requestedIds
            ? organizations.filter((organization) => requestedIds.includes(organization.id))
            : organizations
        }
        return []
      }),
    }
    const rbac = new RbacService(em as unknown as EntityManager)
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbac
        throw new Error(`Unexpected dependency: ${name}`)
      },
    } as unknown as AwilixContainer
    return { container, rbac }
  }

  const noCookieRequest = () => ({ headers: { get: () => null } })

  it('anchors the gate organization to the only approved organization', async () => {
    const { container, rbac } = createNullOrgContainer(['org-a'])
    const auth = createAuth({ sub: 'user-no-org', orgId: null })
    const request = noCookieRequest()

    const featureContext = await resolveFeatureCheckContext({ container, auth, request, requiredFeatures: [requiredFeature] })

    expect(featureContext.organizationId).toBe('org-a')
    expect(featureContext.scope.filterIds).toEqual(['org-a'])
    expect(featureContext.allowedOrganizationIds).toEqual(['org-a'])
    await expect(rbac.userHasAllFeatures('user-no-org', [requiredFeature], {
      tenantId: 'tenant-1',
      organizationId: featureContext.organizationId,
    })).resolves.toBe(true)
    await expect(rbac.userHasAllFeatures('user-no-org', [requiredFeature], {
      tenantId: 'tenant-1',
      organizationId: 'org-b',
    })).resolves.toBe(false)

    const handlerFeatureContext = await resolveFeatureCheckContext({ container, auth, request })
    expect(handlerFeatureContext.organizationId).toBe('org-a')
    expect(handlerFeatureContext.scope).toEqual(featureContext.scope)
  })

  it('anchors to the first approved organization and keeps every approved organization in the filter', async () => {
    const { container, rbac } = createNullOrgContainer(['org-a', 'org-b'])
    const auth = createAuth({ sub: 'user-no-org', orgId: null })

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request: noCookieRequest(),
      requiredFeatures: [requiredFeature],
    })

    expect(featureContext.organizationId).toBe('org-a')
    expect(featureContext.scope.filterIds).toEqual(['org-a', 'org-b'])
    await expect(rbac.userHasAllFeatures('user-no-org', [requiredFeature], {
      tenantId: 'tenant-1',
      organizationId: featureContext.organizationId,
    })).resolves.toBe(true)
  })

  it('anchors to the same approved organization whatever order the database returns them in', async () => {
    organizations.reverse()
    try {
      const { container } = createNullOrgContainer(['org-c', 'org-b'])
      const auth = createAuth({ sub: 'user-no-org', orgId: null })

      const featureContext = await resolveFeatureCheckContext({
        container,
        auth,
        request: noCookieRequest(),
        requiredFeatures: [requiredFeature],
      })

      expect(featureContext.organizationId).toBe('org-b')
      expect(featureContext.scope.filterIds).toEqual(['org-b', 'org-c'])
    } finally {
      organizations.reverse()
    }
  })

  it('keeps a null organization and an empty filter when nothing is approved', async () => {
    const { container } = createNullOrgContainer(['org-outside'])
    const auth = createAuth({ sub: 'user-no-org', orgId: null })

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request: noCookieRequest(),
      requiredFeatures: [requiredFeature],
    })

    expect(featureContext.organizationId).toBeNull()
    expect(featureContext.scope.filterIds).toEqual([])
    expect(featureContext.allowedOrganizationIds).toEqual([])
    expect(featureContext.featureApprovedNoOrganization).toBe(true)
  })

  it('leaves a tenant-wide grant unnarrowed with a null organization', async () => {
    const { container, rbac } = createNullOrgContainer(null)
    const auth = createAuth({ sub: 'user-no-org', orgId: null })

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request: noCookieRequest(),
      requiredFeatures: [requiredFeature],
    })

    expect(featureContext.organizationId).toBeNull()
    expect(featureContext.scope.filterIds).toBeNull()
    expect(featureContext.scope.allowedIds).toBeNull()
    await expect(rbac.userHasAllFeatures('user-no-org', [requiredFeature], {
      tenantId: 'tenant-1',
      organizationId: featureContext.organizationId,
    })).resolves.toBe(true)
  })
})

describe('request-bound feature scope with explicit tenant overrides', () => {
  it('reuses the bound scope when the caller passes its own tenant explicitly', async () => {
    const { container, rbac } = createFeatureNarrowingContainer({ approvedOrganizationIds: [ORG_A_ID] })
    const auth = createAuth({ sub: 'user-1' })
    const request = createAllOrganizationsRequest()

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request,
      requiredFeatures: ['auth.users.edit'],
    })
    const loadAclCalls = rbac.loadAcl.mock.calls.length

    await expect(resolveOrganizationScopeForRequest({
      container,
      auth,
      request,
      tenantId: ' tenant-1 ',
    })).resolves.toEqual(featureContext.scope)

    const handlerFeatureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request,
      tenantId: 'tenant-1',
    })
    expect(handlerFeatureContext.scope).toEqual(featureContext.scope)
    expect(handlerFeatureContext.organizationId).toBe(featureContext.organizationId)
    expect(rbac.loadAcl).toHaveBeenCalledTimes(loadAclCalls)
  })

  it('bypasses the bound scope when a super admin targets a different tenant', async () => {
    const { container } = createFeatureNarrowingContainer({
      approvedOrganizationIds: [ORG_A_ID],
      acl: { isSuperAdmin: true, features: ['*'], organizations: null },
    })
    const auth = createAuth({ sub: 'super-user', isSuperAdmin: true })
    const request = createAllOrganizationsRequest()

    const featureContext = await resolveFeatureCheckContext({
      container,
      auth,
      request,
      requiredFeatures: ['auth.users.edit'],
    })
    expect(featureContext.scope.filterIds).toEqual([ORG_A_ID])

    await expect(resolveOrganizationScopeForRequest({
      container,
      auth,
      request,
      tenantId: 'tenant-2',
    })).resolves.toEqual({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 'tenant-2',
    })
  })

  it('bypasses the bound scope when an explicit organization is requested', async () => {
    const { container } = createFeatureNarrowingContainer({ approvedOrganizationIds: [ORG_A_ID] })
    const auth = createAuth({ sub: 'user-1' })
    const request = createAllOrganizationsRequest()

    await resolveFeatureCheckContext({
      container,
      auth,
      request,
      requiredFeatures: ['auth.users.edit'],
    })

    const explicitScope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request,
      selectedId: ORG_B_ID,
    })
    expect(explicitScope.selectedId).toBe(ORG_B_ID)
    expect(explicitScope.filterIds).toEqual([ORG_B_ID, 'org-b-child'])
  })
})
