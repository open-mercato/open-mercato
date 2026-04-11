import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '../organizationScope'

describe('resolveOrganizationScopeForRequest', () => {
  it('trims whitespace-padded selected organization cookies during superadmin tenant override', async () => {
    const em = {
      find: jest.fn(async (_entity: unknown, where: { id?: { $in?: string[] } }) => {
        const ids = Array.isArray(where.id?.$in) ? where.id.$in : []
        if (!ids.includes('org-1')) return []
        return [{ id: 'org-1', descendantIds: ['org-1-child'] }]
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
            ? 'om_selected_tenant=target-tenant; om_selected_org=%20org-1%20'
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
      id: { $in: ['org-1'] },
      deletedAt: null,
    })
    expect(scope).toEqual({
      selectedId: 'org-1',
      filterIds: ['org-1', 'org-1-child'],
      allowedIds: null,
      tenantId: 'target-tenant',
    })
  })
})
