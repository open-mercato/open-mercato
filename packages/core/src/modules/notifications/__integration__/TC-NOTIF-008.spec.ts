import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectJsonError } from './helpers/notificationsApi'

test.describe('TC-NOTIF-008: Notification create payload validation', () => {
  test('rejects create and batch payloads missing both title and titleKey', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(token)
    const stamp = Date.now()

    const createResponse = await apiRequest(request, 'POST', '/api/notifications', {
      token,
      data: {
        type: `qa.notifications.validation.single.${stamp}`,
        recipientUserId: scope.userId,
      },
    })
    const createBody = await expectJsonError(
      createResponse,
      400,
      'POST /api/notifications without title or titleKey',
    )
    expect(String(createBody.error ?? createBody.message)).toMatch(/titleKey|title/i)

    const batchResponse = await apiRequest(request, 'POST', '/api/notifications/batch', {
      token,
      data: {
        type: `qa.notifications.validation.batch.${stamp}`,
        recipientUserIds: [scope.userId],
      },
    })
    const batchBody = await expectJsonError(
      batchResponse,
      400,
      'POST /api/notifications/batch without title or titleKey',
    )
    expect(String(batchBody.error ?? batchBody.message)).toMatch(/titleKey|title/i)
  })
})
