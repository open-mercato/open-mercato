import { expect, test, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  readWarrantyClaimSettings,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  type WarrantyClaimSettingsResult,
} from './helpers'

export const integrationMeta = { dependsOnModules: ['warranty_claims'] }

/**
 * TC-WC-9430: the warranty auto-approve limit typed with a Polish decimal comma is saved as typed (#9430).
 *
 * The limit input was `type="number"`, so `150,5` under the `pl` UI locale was dropped or saved as
 * 1505. This drives the real settings form in a browser and reads the saved limit back from the
 * API and the reloaded field. Reverting the input to `type="number"` makes `fill('150,5')` fail, and
 * disconnecting `parseAutoApproveMaxAmount` makes the API value assertion fail. The tenant settings
 * are snapshotted before the test and restored in `finally`.
 */

const LIMIT_LABEL = 'Maksymalna kwota automatycznego zatwierdzania'

async function openSettings(page: Page) {
  await page.goto('/backend/warranty_claims/settings', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl')
  const input = page.getByLabel(LIMIT_LABEL, { exact: true })
  await expect(input).toBeEnabled({ timeout: 30_000 })
  return input
}

async function saveSettings(page: Page) {
  await page.getByRole('button', { name: 'Zapisz ustawienia', exact: true }).first().click()
}

test('TC-WC-9430: pl settings form saves auto-approve limit 150,5 as 150.5', async ({ page, request }) => {
  test.slow()
  const token = await getAuthToken(request, 'admin')
  let snapshot: WarrantyClaimSettingsResult | null = null
  let originalLocale = 'en'

  try {
    snapshot = await readWarrantyClaimSettings(request, token)
    // Auto-approve needs both a limit and a currency, so seed a known limit the form then replaces.
    const SEED_LIMIT = 999
    const enable = (current: WarrantyClaimSettingsResult) =>
      saveWarrantyClaimSettings(request, token, {
        autoApproveEnabled: true,
        autoApproveMaxAmount: SEED_LIMIT,
        autoApproveCurrencyCode: 'PLN',
      }, current.updatedAt)
    await enable(snapshot)

    await login(page, 'admin')
    originalLocale = (await page.context().cookies()).find((cookie) => cookie.name === 'locale')?.value ?? 'en'
    expect((await page.request.post('/api/auth/locale', { data: { locale: 'pl' } })).status()).toBe(200)

    const settingsWrites: string[] = []
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/warranty_claims/settings-general' && req.method() === 'PUT') {
        settingsWrites.push(req.method())
      }
    })

    // Invalid input: form error, no write.
    let input = await openSettings(page)
    await input.fill('150,5,1')
    await saveSettings(page)
    await expect(page.getByText('Sprawdź wyróżnione limity liczbowe i walutowe.').first()).toBeVisible()
    expect(settingsWrites, 'invalid limit must not reach the API').toEqual([])
    expect((await readWarrantyClaimSettings(request, token)).autoApproveMaxAmount).toBe(SEED_LIMIT)

    // Polish decimal comma.
    input = await openSettings(page)
    await input.fill('150,5')
    await saveSettings(page)
    await expect.poll(async () => (await readWarrantyClaimSettings(request, token)).autoApproveMaxAmount, { timeout: 15_000 }).toBe(150.5)
    input = await openSettings(page)
    await expect(input).toHaveValue('150,5')

    // Equivalent dot input, starting again from the seeded limit.
    await enable(await readWarrantyClaimSettings(request, token))
    input = await openSettings(page)
    await expect(input).toHaveValue(String(SEED_LIMIT))
    await input.fill('150.5')
    await saveSettings(page)
    await expect.poll(async () => (await readWarrantyClaimSettings(request, token)).autoApproveMaxAmount, { timeout: 15_000 }).toBe(150.5)
    input = await openSettings(page)
    await expect(input).toHaveValue('150,5')
  } finally {
    try {
      await restoreWarrantyClaimSettings(request, token, snapshot)
    } finally {
      await page.request.post('/api/auth/locale', { data: { locale: originalLocale } }).catch(() => undefined)
    }
  }
})
