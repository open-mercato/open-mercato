import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

const locales = [
  { locale: 'en', title: 'Search Settings', baseUrl: 'Base URL', apply: 'Apply', cancel: 'Cancel', confirm: 'Confirm', confirmation: 'Confirm Provider Change' },
  { locale: 'pl', title: 'Ustawienia wyszukiwania', baseUrl: 'Adres bazowy (URL)', apply: 'Zastosuj', cancel: 'Anuluj', confirm: 'Potwierdź', confirmation: 'Potwierdź zmianę dostawcy' },
]

for (const copy of locales) {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    test(`TC-SEARCH-019: repeated Apply preserves provider confirmation in ${copy.locale} at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      await login(page, 'superadmin')
      await page.context().addCookies([{ name: 'locale', value: copy.locale, url: new URL(page.url()).origin }])
      const writes: unknown[] = []
      await page.route('**/api/search/embeddings', async (route) => {
        if (route.request().method() !== 'GET') {
          writes.push(route.request().postDataJSON())
          await route.fulfill({ status: 200, json: { ok: true } })
          return
        }
        await route.fulfill({
          json: {
            settings: {
              openaiConfigured: true,
              autoIndexingEnabled: false,
              autoIndexingLocked: false,
              lockReason: null,
              embeddingConfigSource: 'tenant',
              embeddingConfig: {
                providerId: 'ollama', model: 'nomic-embed-text', dimension: 768,
                baseUrl: 'https://search-fixture.invalid/old', updatedAt: '2026-07-26T12:00:00.000Z',
              },
              configuredProviders: ['ollama'],
              providerAvailability: [{ providerId: 'ollama', available: true }],
              indexedDimension: null,
              reindexRequired: false,
              documentCount: 0,
            },
          },
        })
      })

      await page.goto('/backend/config/search')
      await expect(page.getByRole('heading', { name: copy.title, exact: true })).toBeVisible()
      const baseUrlInput = page.getByLabel(copy.baseUrl, { exact: true })
      await baseUrlInput.fill('https://search-fixture.invalid/new')
      const applyButton = page.getByRole('button', { name: copy.apply, exact: true })
      const confirmation = page.getByRole('dialog', { name: copy.confirmation, exact: true })
      await applyButton.dblclick()
      await expect(confirmation).toBeVisible()
      expect(writes).toHaveLength(0)
      await testInfo.attach('provider-confirmation-after-double-apply', {
        body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
      })

      await confirmation.getByRole('button', { name: copy.cancel, exact: true }).click()
      await expect(confirmation).toBeHidden()
      await expect(baseUrlInput).toHaveValue('https://search-fixture.invalid/new')
      expect(writes).toHaveLength(0)

      await applyButton.click()
      await expect(confirmation).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(confirmation).toBeHidden()
      expect(writes).toHaveLength(0)

      await applyButton.click()
      await expect(confirmation).toBeVisible()
      await confirmation.getByRole('button', { name: copy.confirm, exact: true }).dblclick()
      await expect(confirmation).toBeHidden()
      expect(writes).toHaveLength(1)
      expect(writes[0]).toMatchObject({
        embeddingConfig: { providerId: 'ollama', model: 'nomic-embed-text', dimension: 768, baseUrl: 'https://search-fixture.invalid/new' },
      })
    })
  }
}
