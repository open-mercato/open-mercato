import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { restoreDateLocaleSettingsAfterEach } from '@open-mercato/core/helpers/integration/dateLocaleFixtures'

/**
 * TC-CONF-007: Tenant date & locale settings API
 * Source: `.ai/specs/2026-05-18-date-locale-settings.md` (Phase 3)
 *
 * GET/PUT /api/configs/date-locale — read stored + effective settings, update with
 * normalization, reject invalid zones/patterns, detect stale writes, and keep the
 * write behind configs.date_locale.manage. Restores the tenant's original settings.
 *
 * The API has no delete, so a tenant that had no settings row is restored with an all-empty one.
 * That is equivalent: every empty field inherits the env default, exactly as a missing row does
 * (pinned by `configs/lib/__tests__/date-locale-settings.test.ts`).
 */
type DateLocaleBody = {
  settings: Record<string, unknown>
  effective: Record<string, unknown>
  sources: Record<string, string>
  updatedAt: string | null
}

const PATH = '/api/configs/date-locale'

async function readSettings(request: APIRequestContext, token: string): Promise<DateLocaleBody> {
  const response = await apiRequest(request, 'GET', PATH, { token })
  expect(response.status()).toBe(200)
  return (await response.json()) as DateLocaleBody
}

test.describe('TC-CONF-007: Date & locale settings API', () => {
  // These tests change tenant-wide date settings; keep them from overlapping anything else that
  // renders dates if the suite's single worker is ever raised.
  test.describe.configure({ mode: 'serial' })
  restoreDateLocaleSettingsAfterEach()

  test('reads, updates and restores tenant settings', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const original = await readSettings(request, token)

    try {
      const putResponse = await apiRequest(request, 'PUT', PATH, {
        token,
        data: { dateFormat: 'DD.MM.YYYY', timeZone: 'europe/warsaw', firstDayOfWeek: 1, timeFormat: 'HH:mm' },
      })
      expect(putResponse.status()).toBe(200)
      const saved = (await putResponse.json()) as DateLocaleBody
      expect(saved.settings).toMatchObject({
        dateFormat: 'dd.MM.yyyy',
        timeZone: 'Europe/Warsaw',
        firstDayOfWeek: 1,
        timeFormat: 'HH:mm',
      })
      expect(saved.effective.dateTimeFormat).toBe('dd.MM.yyyy HH:mm')
      expect(saved.sources.dateFormat).toBe('tenant')
      expect(typeof saved.updatedAt).toBe('string')

      const confirmed = await readSettings(request, token)
      expect(confirmed.settings.timeZone).toBe('Europe/Warsaw')
    } finally {
      await apiRequest(request, 'PUT', PATH, { token, data: original.settings }).catch(() => {})
    }
  })

  test('rejects an invalid time zone or pattern with field errors', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'PUT', PATH, {
      token,
      data: { timeZone: 'Mars/Olympus', dateFormat: 'dd<MM' },
    })
    expect(response.status()).toBe(400)
    const body = (await response.json()) as { fieldErrors?: Record<string, string> }
    expect(Object.keys(body.fieldErrors ?? {})).toEqual(expect.arrayContaining(['timeZone', 'dateFormat']))
  })

  test('returns 409 for a write based on a stale version', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const original = await readSettings(request, token)
    try {
      const first = await apiRequest(request, 'PUT', PATH, { token, data: { ...original.settings, firstDayOfWeek: 0 } })
      expect(first.status()).toBe(200)
      const stale = await apiRequest(request, 'PUT', PATH, {
        token,
        data: { ...original.settings, firstDayOfWeek: 6 },
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': '2000-01-01T00:00:00.000Z' },
      })
      expect(stale.status()).toBe(409)
    } finally {
      await apiRequest(request, 'PUT', PATH, { token, data: original.settings }).catch(() => {})
    }
  })

  test('lets employees read but not change the settings', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const read = await apiRequest(request, 'GET', PATH, { token })
    expect(read.status()).toBe(200)
    const write = await apiRequest(request, 'PUT', PATH, { token, data: { timeZone: 'UTC' } })
    expect(write.status()).toBe(403)
  })
})
