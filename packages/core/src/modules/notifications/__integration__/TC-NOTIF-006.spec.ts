import { test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectJsonError,
  expectRequiredFeature,
} from './helpers/notificationsApi'

test.describe('TC-NOTIF-006: notifications.manage gates settings endpoints', () => {
  test('denies notification settings management to a user without notifications.manage', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Valid1!Pass'
    const email = `qa-notif-settings-rbac-${stamp}@acme.com`
    const roleName = `qa_notif_settings_rbac_${stamp}`

    let superadminToken: string | null = null
    let restrictedToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      superadminToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(superadminToken)
      roleId = await createRoleFixture(request, superadminToken, {
        name: roleName,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['notifications.view'],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
      })
      restrictedToken = await getAuthToken(request, email, password)

      const getResponse = await apiRequest(request, 'GET', '/api/notifications/settings', {
        token: restrictedToken,
      })
      const getBody = await expectJsonError(
        getResponse,
        403,
        'GET /api/notifications/settings without notifications.manage',
      )
      expectRequiredFeature(getBody, 'notifications.manage')

      const postResponse = await apiRequest(request, 'POST', '/api/notifications/settings', {
        token: restrictedToken,
        data: {
          appUrl: 'https://qa.example.test',
          panelPath: '/backend/notifications',
          strategies: {
            database: { enabled: true },
          },
        },
      })
      const postBody = await expectJsonError(
        postResponse,
        403,
        'POST /api/notifications/settings without notifications.manage',
      )
      expectRequiredFeature(postBody, 'notifications.manage')
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
