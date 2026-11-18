import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type NotificationSettingsResponse = {
  settings?: Record<string, unknown>
}

test.describe('TC-NOTIF-002: Notification settings APIs', () => {
  test('should update delivery settings and restore the original configuration', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')

    const originalResponse = await apiRequest(request, 'GET', '/api/notifications/settings', { token })
    expect(originalResponse.status()).toBe(200)
    const originalBody = await readJsonSafe<NotificationSettingsResponse>(originalResponse)
    const originalSettings = originalBody?.settings ?? {}

    const updatedSettings = {
      ...originalSettings,
      panelPath: '/backend/notifications',
      strategies: {
        database: { enabled: true },
        email: {
          enabled: false,
          from: 'qa@example.test',
          replyTo: 'support@example.test',
          subjectPrefix: '[QA]',
        },
        custom: {
          webhook: {
            enabled: true,
            config: {
              endpoint: 'https://example.test/hooks/notifications',
            },
          },
        },
      },
    }

    try {
      const rejectedResponse = await apiRequest(request, 'POST', '/api/notifications/settings', {
        token,
        data: { ...updatedSettings, appUrl: 'https://refused-notifications.example.test' },
      })
      expect(rejectedResponse.status()).toBe(400)
      const unchangedResponse = await apiRequest(request, 'GET', '/api/notifications/settings', { token })
      expect(unchangedResponse.status()).toBe(200)
      expect((await readJsonSafe<NotificationSettingsResponse>(unchangedResponse))?.settings).toEqual(originalSettings)

      const updateResponse = await apiRequest(request, 'POST', '/api/notifications/settings', {
        token,
        data: updatedSettings,
      })
      expect(updateResponse.status()).toBe(200)

      const verifyResponse = await apiRequest(request, 'GET', '/api/notifications/settings', { token })
      expect(verifyResponse.status()).toBe(200)
      const verifyBody = await readJsonSafe<NotificationSettingsResponse>(verifyResponse)
      expect(verifyBody?.settings).toMatchObject(updatedSettings)
    } finally {
      const restoreResponse = await apiRequest(request, 'POST', '/api/notifications/settings', {
        token,
        data: originalSettings,
      })
      expect(restoreResponse.ok()).toBeTruthy()
    }
  })
})
