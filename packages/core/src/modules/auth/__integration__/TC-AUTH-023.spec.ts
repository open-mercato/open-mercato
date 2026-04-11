import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

test.describe('TC-AUTH-023: Role API enforces tenant-scoped creation', () => {
  test('rejects tenantId: null and defaults omitted tenantId to the actor tenant', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)
    const roleName = `qa-role-scope-${Date.now()}`
    let roleId: string | null = null

    try {
      const invalidResponse = await apiRequest(request, 'POST', '/api/auth/roles', {
        token: superadminToken,
        data: {
          name: `${roleName}-invalid`,
          tenantId: null,
        },
      })
      expect(invalidResponse.status()).toBe(400)
      const invalidBody = await readJsonSafe<{ error?: string }>(invalidResponse)
      expect(typeof invalidBody?.error).toBe('string')

      const createResponse = await apiRequest(request, 'POST', '/api/auth/roles', {
        token: adminToken,
        data: {
          name: roleName,
        },
      })
      expect(createResponse.status()).toBe(201)
      const createBody = await readJsonSafe<{ id?: string }>(createResponse)
      roleId = typeof createBody?.id === 'string' ? createBody.id : null
      expect(roleId).toBeTruthy()

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/auth/roles?pageSize=100&search=${encodeURIComponent(roleName)}`,
        { token: adminToken },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{
        items?: Array<{ id?: string; name?: string; tenantId?: string | null }>
      }>(listResponse)
      const createdRole = (listBody?.items ?? []).find((item) => item.id === roleId)
      expect(createdRole).toBeTruthy()
      expect(createdRole?.name).toBe(roleName)
      expect(createdRole?.tenantId).toBe(tenantId)
    } finally {
      if (roleId) {
        await apiRequest(request, 'DELETE', `/api/auth/roles?id=${encodeURIComponent(roleId)}`, {
          token: adminToken,
        }).catch(() => {})
      }
    }
  })
})
