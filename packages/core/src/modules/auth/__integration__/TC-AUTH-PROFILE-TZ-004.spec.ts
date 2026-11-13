import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { expectConflictBanner } from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'

/**
 * TC-AUTH-PROFILE-TZ-004: Two tabs editing the personal time zone
 * Source: `.ai/specs/2026-05-18-date-locale-settings.md` + root AGENTS.md optimistic locking rule
 *
 * Both tabs load Profile → Time zone. The first tab saves; the second tab's save carries the
 * version it loaded, so it must surface the record-changed conflict bar instead of silently
 * overwriting the first tab's choice. The first tab keeps saving because each save refreshes
 * the version it holds. Restores the original profile time zone.
 */
const PROFILE_PATH = '/api/auth/profile'

async function chooseZone(page: Page, zone: string) {
  await page.getByRole('combobox').first().fill(zone)
  await page.getByRole('option', { name: zone, exact: true }).click()
  await page.getByRole('button', { name: 'Save time zone' }).first().click()
}

test.describe('TC-AUTH-PROFILE-TZ-004: Profile time zone concurrent edits', () => {
  test('a stale tab gets the conflict bar instead of overwriting the newer zone', async ({ page, request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const originalProfile = (await (await apiRequest(request, 'GET', PROFILE_PATH, { token })).json()) as {
      timezone?: string | null
    }
    const readProfileZone = async () =>
      ((await (await apiRequest(request, 'GET', PROFILE_PATH, { token })).json()) as { timezone?: string | null }).timezone ?? null

    try {
      expect((await apiRequest(request, 'PUT', PROFILE_PATH, { token, data: { timezone: null } })).status()).toBe(200)

      await login(page, 'admin')
      const secondTab = await page.context().newPage()
      await page.goto('/backend/profile/time-zone')
      await secondTab.goto('/backend/profile/time-zone')
      await expect(page.getByTestId('profile-time-zone-preview')).toBeVisible()
      await expect(secondTab.getByTestId('profile-time-zone-preview')).toBeVisible()

      await chooseZone(page, 'Asia/Tokyo')
      await expect(page.getByText('Time zone saved.')).toBeVisible()
      await expect.poll(readProfileZone).toBe('Asia/Tokyo')

      await chooseZone(secondTab, 'Europe/Warsaw')
      await expectConflictBanner(secondTab)
      expect(await readProfileZone()).toBe('Asia/Tokyo')

      await chooseZone(page, 'Europe/Berlin')
      await expect.poll(readProfileZone).toBe('Europe/Berlin')
    } finally {
      await apiRequest(request, 'PUT', PROFILE_PATH, { token, data: { timezone: originalProfile.timezone ?? null } }).catch(() => {})
    }
  })
})
