import { expect, test } from '@playwright/test'
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

test.describe('TC-NOTIF-005: notifications.create gates create endpoints', () => {
  test('denies notification creation endpoints to a user without notifications.create', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Valid1!Pass'
    const email = `qa-notif-create-rbac-${stamp}@acme.com`
    const roleName = `qa_notif_create_rbac_${stamp}`

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

      const cases = [
        {
          path: '/api/notifications',
          data: {
            type: `qa.notifications.create.rbac.${stamp}`,
            title: 'Blocked direct notification',
            recipientUserId: scope.userId,
          },
          label: 'POST /api/notifications without notifications.create',
        },
        {
          path: '/api/notifications/batch',
          data: {
            type: `qa.notifications.batch.rbac.${stamp}`,
            title: 'Blocked batch notification',
            recipientUserIds: [scope.userId],
          },
          label: 'POST /api/notifications/batch without notifications.create',
        },
        {
          path: '/api/notifications/role',
          data: {
            type: `qa.notifications.role.rbac.${stamp}`,
            title: 'Blocked role notification',
            roleId,
          },
          label: 'POST /api/notifications/role without notifications.create',
        },
        {
          path: '/api/notifications/feature',
          data: {
            type: `qa.notifications.feature.rbac.${stamp}`,
            title: 'Blocked feature notification',
            requiredFeature: 'notifications.view',
          },
          label: 'POST /api/notifications/feature without notifications.create',
        },
      ]

      for (const entry of cases) {
        const response = await apiRequest(request, 'POST', entry.path, {
          token: restrictedToken,
          data: entry.data,
        })
        const body = await expectJsonError(response, 403, entry.label)
        expectRequiredFeature(body, 'notifications.create')
      }

      expect(userId, 'restricted user fixture should be created').toBeTruthy()
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
