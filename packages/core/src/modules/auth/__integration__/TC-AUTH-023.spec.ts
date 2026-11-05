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

test.describe('TC-AUTH-023: Sidebar preferences & features list API', () => {
  test('should read sidebar preferences', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/auth/sidebar/preferences', { token })
    expect(response.status(), 'GET /api/auth/sidebar/preferences should return 200').toBe(200)
    const body = await readJsonSafe<{
      locale?: string
      settings?: Record<string, unknown>
      canApplyToRoles?: boolean
      roles?: Array<Record<string, unknown>>
    }>(response)
    expect(typeof body?.locale).toBe('string')
    expect(body?.settings).toBeTruthy()
    expect(typeof body?.canApplyToRoles).toBe('boolean')
    expect(Array.isArray(body?.roles)).toBe(true)
  })

  test('should update sidebar preferences and restore', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Read current state
    const getResponse = await apiRequest(request, 'GET', '/api/auth/sidebar/preferences', { token })
    const original = await readJsonSafe<{
      settings?: { hiddenItems?: string[]; groupOrder?: string[] }
    }>(getResponse)

    // Update with a hidden item
    const putResponse = await apiRequest(request, 'PUT', '/api/auth/sidebar/preferences', {
      token,
      data: {
        hiddenItems: ['qa-hidden-item-test'],
      },
    })
    expect(putResponse.status(), 'PUT /api/auth/sidebar/preferences should return 200').toBe(200)
    const putBody = await readJsonSafe<{
      settings?: { hiddenItems?: string[] }
    }>(putResponse)
    expect(putBody?.settings?.hiddenItems).toContain('qa-hidden-item-test')

    // Restore original hidden items
    await apiRequest(request, 'PUT', '/api/auth/sidebar/preferences', {
      token,
      data: {
        hiddenItems: original?.settings?.hiddenItems ?? [],
      },
    })
  })

  test('should return all declared features', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/auth/features', { token })
    expect(response.status(), 'GET /api/auth/features should return 200').toBe(200)
    const body = await readJsonSafe<{
      items?: Array<{ id?: string; title?: string; module?: string }>
      modules?: Array<{ id?: string; title?: string }>
    }>(response)

    expect(Array.isArray(body?.items)).toBe(true)
    expect((body?.items?.length ?? 0) > 0, 'Should return at least one feature').toBe(true)
    expect(Array.isArray(body?.modules)).toBe(true)
    expect((body?.modules?.length ?? 0) > 0, 'Should return at least one module').toBe(true)

    // Verify structure of first feature
    const firstFeature = body?.items?.[0]
    expect(typeof firstFeature?.id).toBe('string')
    expect(typeof firstFeature?.title).toBe('string')
    expect(typeof firstFeature?.module).toBe('string')
  })

  test('should deny features list to employee without auth.acl.manage', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'GET', '/api/auth/features', { token })
    expect(response.status(), 'Employee GET /api/auth/features should be denied').toBeGreaterThanOrEqual(403)
  })
})
