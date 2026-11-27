import { expect, test, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'

const NARROW_VIEWPORT = { width: 390, height: 844 }
const DESKTOP_VIEWPORT = { width: 1440, height: 900 }

const LOCALES = [
  { code: 'en', expand: 'Show metadata', add: 'Add entry' },
  { code: 'pl', expand: 'Pokaż metadane', add: 'Dodaj wpis' },
] as const

async function switchLocale(page: Page, locale: string): Promise<boolean> {
  const response = await page.request.post('/api/auth/locale', { data: { locale } })
  if (response.status() === 409) return false
  expect(response.ok(), `POST /api/auth/locale should accept "${locale}": ${response.status()}`).toBeTruthy()
  return true
}

async function expectMetadataHeaderInsideCard(
  page: Page,
  labels: { expand: string; add: string },
  viewportWidth: number,
): Promise<void> {
  const toggle = page.getByRole('button', { name: labels.expand, exact: true })
  const addEntry = page.getByRole('button', { name: labels.add, exact: true })
  await expect(toggle).toBeVisible()
  await expect(addEntry).toBeVisible()
  await toggle.scrollIntoViewIfNeeded()

  const headerRow: Locator = addEntry.locator('xpath=../..')
  const rowBox = await headerRow.boundingBox()
  expect(rowBox, 'Metadata header row has no layout box').not.toBeNull()
  expect(rowBox!.x + rowBox!.width, 'Metadata header row ends outside the viewport').toBeLessThanOrEqual(viewportWidth)

  for (const [name, control] of [[labels.expand, toggle], [labels.add, addEntry]] as const) {
    const box = await control.boundingBox()
    expect(box, `${name} has no layout box`).not.toBeNull()
    expect(box!.x, `${name} starts before its card`).toBeGreaterThanOrEqual(rowBox!.x - 0.5)
    expect(box!.x + box!.width, `${name} ends outside its card`).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 0.5)
    expect(box!.x + box!.width, `${name} ends outside the viewport`).toBeLessThanOrEqual(viewportWidth)
  }

  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(addEntry).toBeVisible()
  await expect(page.getByRole('button', { name: labels.expand, exact: true })).toHaveCount(0)
}

test.describe('TC-CAT-9654: Metadata header actions stay inside phone-width cards', () => {
  for (const locale of LOCALES) {
    test(`product edit and variant create keep Metadata actions inside a 390px viewport (${locale.code})`, async ({ page, request }) => {
      test.setTimeout(120_000)
      const token = await getAuthToken(request, 'admin')
      const stamp = `${Date.now()}-${locale.code}`
      let productId: string | null = null
      let variantId: string | null = null
      let localeSwitched = false
      try {
        productId = await createProductFixture(request, token, {
          title: `QA Metadata Narrow ${stamp}`,
          sku: `QA-META-NARROW-${stamp}`,
        })
        variantId = await createVariantFixture(request, token, {
          productId,
          name: `QA Metadata Variant ${stamp}`,
          sku: `QA-META-VAR-${stamp}`,
          isDefault: true,
        })

        await page.setViewportSize(NARROW_VIEWPORT)
        await login(page, 'admin')
        if (locale.code !== 'en') {
          localeSwitched = await switchLocale(page, locale.code)
          test.skip(!localeSwitched, 'Locale is pinned via OM_FORCE_LOCALE in this environment')
        }

        await page.goto(`/backend/catalog/products/${productId}`)
        await expectMetadataHeaderInsideCard(page, locale, NARROW_VIEWPORT.width)
        await page.screenshot({ path: test.info().outputPath(`product-edit-metadata-390-${locale.code}.png`), fullPage: true })

        await page.goto(`/backend/catalog/products/${productId}/variants/create`)
        await expectMetadataHeaderInsideCard(page, locale, NARROW_VIEWPORT.width)
        await page.screenshot({ path: test.info().outputPath(`variant-create-metadata-390-${locale.code}.png`), fullPage: true })

        await page.setViewportSize(DESKTOP_VIEWPORT)
        await page.goto(`/backend/catalog/products/${productId}`)
        await expectMetadataHeaderInsideCard(page, locale, DESKTOP_VIEWPORT.width)
        const desktopActions = page.getByRole('button', { name: locale.add, exact: true }).locator('xpath=..')
        const desktopTitle = desktopActions.locator('xpath=..').locator('p').first()
        const actionsBox = await desktopActions.boundingBox()
        const titleBox = await desktopTitle.boundingBox()
        expect(actionsBox && titleBox, 'desktop Metadata header has no layout boxes').toBeTruthy()
        expect(actionsBox!.y, 'desktop Metadata actions stay on the title row').toBeLessThan(titleBox!.y + titleBox!.height)
      } finally {
        if (localeSwitched) await switchLocale(page, 'en').catch(() => undefined)
        if (variantId) {
          await apiRequest(request, 'DELETE', `/api/catalog/variants?id=${encodeURIComponent(variantId)}`, { token }).catch(() => undefined)
        }
        await deleteCatalogProductIfExists(request, token, productId)
      }
    })
  }
})
