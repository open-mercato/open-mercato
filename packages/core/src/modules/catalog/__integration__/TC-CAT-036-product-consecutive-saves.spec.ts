import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

test.describe('TC-CAT-036: consecutive product saves (#5985)', () => {
  test('refreshes the lock version and preserves both successive title edits', async ({ page, request }, testInfo) => {
    let token: string | null = null
    let productId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      await login(page, 'admin')
      const stamp = Date.now()
      const initialTitle = `QA repeated save ${stamp}`
      productId = await createProductFixture(request, token, {
        title: initialTitle,
        sku: `qa-repeated-save-${stamp}`,
      })
      await page.goto(`/backend/catalog/products/${productId}`)
      const titleInput = page.getByRole('textbox', { name: 'e.g., Summer sneaker', exact: true })
      const saveButton = page.getByRole('button', { name: 'Save changes', exact: true }).first()
      await expect(titleInput).toHaveValue(initialTitle)
      let previousSavedVersion: string | null = null
      const savedTitles = [`QA first rename ${stamp}`, `QA second rename ${stamp}`]
      for (const title of savedTitles) {
        await titleInput.fill(title)
        const updateResponse = page.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/catalog/products' && response.request().method() === 'PUT',
        )
        const productReload = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return url.pathname === '/api/catalog/products' && url.searchParams.get('id') === productId && response.request().method() === 'GET'
        })
        await saveButton.click()
        const updated = await updateResponse
        expect(updated.status()).toBe(200)
        const expectedVersion = updated.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME]
        expect(expectedVersion).toBeTruthy()
        if (previousSavedVersion) {
          expect(Date.parse(expectedVersion)).toBe(Date.parse(previousSavedVersion))
        }
        const reloaded = await productReload
        expect(reloaded.status()).toBe(200)
        const body = await reloaded.json() as { items: Array<{ title: string; updatedAt?: string; updated_at?: string }> }
        expect(body.items[0].title).toBe(title)
        const savedVersion = body.items[0].updatedAt ?? body.items[0].updated_at
        expect(typeof savedVersion).toBe('string')
        expect(Date.parse(savedVersion!)).toBeGreaterThan(Date.parse(expectedVersion))
        previousSavedVersion = savedVersion!
        await expect(titleInput).toHaveValue(title)
        await expect(saveButton).toBeEnabled()
      }
      await page.reload()
      await expect(titleInput).toHaveValue(savedTitles[1])
      await page.screenshot({ path: testInfo.outputPath('consecutive-product-saves.png'), fullPage: true })
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
      if (token && productId) {
        const response = await apiRequest(request, 'GET', `/api/catalog/products?id=${productId}&withDeleted=false`, { token })
        expect(response.ok()).toBeTruthy()
        const body = await response.json() as { items: unknown[] }
        expect(body.items).toHaveLength(0)
      }
    }
  })
})
