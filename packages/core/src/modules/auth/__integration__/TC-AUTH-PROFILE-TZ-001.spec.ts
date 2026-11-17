import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { restoreDateLocaleSettingsAfterEach } from '@open-mercato/core/helpers/integration/dateLocaleFixtures'

/**
 * TC-AUTH-PROFILE-TZ-001: Personal time zone overrides the tenant default
 * Source: `.ai/specs/2026-05-18-date-locale-settings.md` (Q2 — user override is timezone only)
 *
 * PUT /api/auth/profile { timezone } stores the user's zone; GET /api/configs/date-locale then
 * reports it as the effective zone with source "user", over the tenant setting. Clearing it with
 * null returns to the tenant zone. Restores both values.
 */
test.describe('TC-AUTH-PROFILE-TZ-001: Personal time zone', () => {
  // These tests change tenant-wide date settings; keep them from overlapping anything else that
  // renders dates if the suite's single worker is ever raised.
  test.describe.configure({ mode: 'serial' })
  restoreDateLocaleSettingsAfterEach()

  test('a personal zone wins over the tenant zone and can be cleared', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const originalProfile = (await (await apiRequest(request, 'GET', '/api/auth/profile', { token })).json()) as {
      timezone?: string | null
    }
    const originalSettings = (await (await apiRequest(request, 'GET', '/api/configs/date-locale', { token })).json()) as {
      settings: Record<string, unknown>
    }

    try {
      await apiRequest(request, 'PUT', '/api/configs/date-locale', {
        token,
        data: { ...originalSettings.settings, timeZone: 'Europe/Warsaw' },
      })

      const setResponse = await apiRequest(request, 'PUT', '/api/auth/profile', { token, data: { timezone: 'asia/tokyo' } })
      expect(setResponse.status()).toBe(200)
      expect(((await setResponse.json()) as { timezone?: string }).timezone).toBe('Asia/Tokyo')

      const withOverride = (await (await apiRequest(request, 'GET', '/api/configs/date-locale', { token })).json()) as {
        effective: { timeZone: string }
        sources: { timeZone: string }
      }
      expect(withOverride.effective.timeZone).toBe('Asia/Tokyo')
      expect(withOverride.sources.timeZone).toBe('user')

      const clear = await apiRequest(request, 'PUT', '/api/auth/profile', { token, data: { timezone: null } })
      expect(clear.status()).toBe(200)
      const cleared = (await (await apiRequest(request, 'GET', '/api/configs/date-locale', { token })).json()) as {
        effective: { timeZone: string }
        sources: { timeZone: string }
      }
      expect(cleared.effective.timeZone).toBe('Europe/Warsaw')
      expect(cleared.sources.timeZone).toBe('tenant')

      const invalid = await apiRequest(request, 'PUT', '/api/auth/profile', { token, data: { timezone: 'Mars/Olympus' } })
      expect(invalid.status()).toBe(400)
    } finally {
      await apiRequest(request, 'PUT', '/api/auth/profile', { token, data: { timezone: originalProfile.timezone ?? null } }).catch(() => {})
      await apiRequest(request, 'PUT', '/api/configs/date-locale', { token, data: originalSettings.settings }).catch(() => {})
    }
  })
})
