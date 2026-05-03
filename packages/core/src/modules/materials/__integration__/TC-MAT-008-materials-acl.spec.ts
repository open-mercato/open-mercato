import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'

async function setRoleFeatures(
  request: APIRequestContext,
  token: string,
  roleId: string,
  tenantId: string,
  features: string[],
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token,
    data: { roleId, tenantId, features, isSuperAdmin: false },
  })
  expect(response.ok(), `PUT /api/auth/roles/acl failed: ${response.status()}`).toBeTruthy()
}

test.describe('TC-MAT-008: Materials ACL gating', () => {
  test('view-only role can list but cannot create materials', async ({ request }) => {
    test.setTimeout(180_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(superadminToken)
    const stamp = Date.now()
    const roleName = `qa_mat_view_${stamp}`
    const userEmail = `qa-mat-view-${stamp}@acme.com`
    const userPassword = 'Valid1!Pass'

    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, {
        name: roleName,
        tenantId: scope.tenantId,
      })
      await setRoleFeatures(request, superadminToken, roleId, scope.tenantId, [
        'materials.material.view',
      ])

      userId = await createUserFixture(request, superadminToken, {
        email: userEmail,
        password: userPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
      })

      const userToken = await getAuthToken(request, userEmail, userPassword)

      const listResponse = await apiRequest(
        request,
        'GET',
        '/api/materials?page=1&pageSize=10',
        { token: userToken },
      )
      expect(
        listResponse.status(),
        `View-only user must be able to GET materials list: ${listResponse.status()}`,
      ).toBe(200)

      const createResponse = await apiRequest(request, 'POST', '/api/materials', {
        token: userToken,
        data: { code: `MAT008-VIEW-${stamp}`, name: `Should fail ${stamp}`, kind: 'raw' },
      })
      expect(
        createResponse.ok(),
        `View-only user must NOT be able to create: ${createResponse.status()}`,
      ).toBeFalsy()
      expect([401, 403]).toContain(createResponse.status())
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })

  test('role with no materials.* features cannot list materials', async ({ request }) => {
    test.setTimeout(180_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(superadminToken)
    const stamp = Date.now()
    const roleName = `qa_mat_none_${stamp}`
    const userEmail = `qa-mat-none-${stamp}@acme.com`
    const userPassword = 'Valid1!Pass'

    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, superadminToken, {
        name: roleName,
        tenantId: scope.tenantId,
      })
      await setRoleFeatures(request, superadminToken, roleId, scope.tenantId, [])

      userId = await createUserFixture(request, superadminToken, {
        email: userEmail,
        password: userPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
      })

      const userToken = await getAuthToken(request, userEmail, userPassword)

      const listResponse = await apiRequest(
        request,
        'GET',
        '/api/materials?page=1&pageSize=10',
        { token: userToken },
      )
      expect(
        listResponse.ok(),
        `User without materials.* features must not list: ${listResponse.status()}`,
      ).toBeFalsy()
      expect([401, 403]).toContain(listResponse.status())
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
