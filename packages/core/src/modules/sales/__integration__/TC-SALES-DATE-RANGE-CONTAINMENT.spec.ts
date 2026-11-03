import { expect, test, type Locator } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

async function expectHorizontallyContained(locator: Locator, viewportWidth: number) {
  await expect.poll(async () => {
    const bounds = await locator.boundingBox()
    return Boolean(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewportWidth)
  }).toBe(true)
}

for (const locale of ['en', 'pl'] as const) {
  for (const width of [390, 1440]) {
    test(`date range calendar and actions stay reachable at ${width}px in ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await login(page, 'admin')
      await page.context().request.get(`/api/auth/locale?locale=${locale}&redirect=/backend/sales/orders`, { maxRedirects: 0 })
      await page.goto('/backend/sales/orders')
      await page.getByRole('button', { name: locale === 'pl' ? 'Perspektywy' : 'Views', exact: true }).waitFor()
      await page.getByRole('button', { name: locale === 'pl' ? 'Filtry' : 'Filters', exact: true }).click()
      await page.locator('[data-slot="date-range-picker-trigger"]').click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expectHorizontallyContained(dialog, width)
      const grids = dialog.getByRole('grid')
      await expect(grids).toHaveCount(2)
      for (const grid of await grids.all()) {
        await grid.scrollIntoViewIfNeeded()
        await expect(grid).toBeVisible()
        await expectHorizontallyContained(grid, width)
      }
      const cancel = dialog.getByRole('button', { name: locale === 'pl' ? 'Anuluj' : 'Cancel', exact: true })
      const apply = dialog.getByRole('button', { name: locale === 'pl' ? 'Zastosuj' : 'Apply', exact: true })
      await expectHorizontallyContained(cancel, width)
      await expectHorizontallyContained(apply, width)
      await cancel.click()
      await expect(dialog).not.toBeVisible()

      await page.locator('[data-slot="date-range-picker-trigger"]').click()
      await dialog.locator('[data-slot="date-range-presets"] button').first().click()
      await apply.click()
      await expect(dialog).not.toBeVisible()
      await expect(page.locator('[data-slot="date-range-picker-trigger"]')).not.toHaveText(locale === 'pl' ? 'Wybierz zakres dat' : 'Pick a date range')
    })
  }
}
