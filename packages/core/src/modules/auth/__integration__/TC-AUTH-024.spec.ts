import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

test.describe('TC-AUTH-024: Role list stays tenant-scoped', () => {
  test('returns only tenant-scoped roles for a tenant admin search', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)
    const roleName = `qa-role-list-scope-${Date.now()}`
    let roleId: string | null = null

    try {
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
      const items = listBody?.items ?? []

      expect(items.length).toBeGreaterThan(0)
      expect(items.some((item) => item.id === roleId)).toBe(true)
      expect(items.every((item) => item.tenantId === tenantId)).toBe(true)
      expect(items.some((item) => item.tenantId === null)).toBe(false)
    } finally {
      if (roleId) {
        await apiRequest(request, 'DELETE', `/api/auth/roles?id=${encodeURIComponent(roleId)}`, {
          token: adminToken,
        }).catch(() => {})
      }
    }
  })
})
