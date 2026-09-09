import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

const EUDR_LIST_PAGES = [
  {
    path: '/backend/eudr/product-mappings',
    title: 'Product mappings',
    loadError: 'Could not load product mappings.',
  },
  {
    path: '/backend/eudr/evidence-submissions',
    title: 'Evidence submissions',
    loadError: 'Could not load evidence submissions.',
  },
  {
    path: '/backend/eudr/statements',
    title: 'Statements',
    loadError: 'Could not load statements.',
  },
] as const

async function expectNoErrorState(page: Page, loadError: string): Promise<void> {
  await expect(
    page.getByRole('heading', {
      name: /Application error: a client-side exception has occurred|Something went wrong/i,
    }).first(),
  ).not.toBeVisible()
  await expect(page.getByText(loadError, { exact: true })).not.toBeVisible()
}

/**
 * TC-EUDR-004: Backend EUDR list-page smoke coverage.
 */
test.describe('TC-EUDR-004: Backend EUDR UI smoke', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
  })

  for (const target of EUDR_LIST_PAGES) {
    test(`renders ${target.title} without an error state`, async ({ page }) => {
      await page.goto(target.path, { waitUntil: 'domcontentloaded' })

      await expect(
        page.getByRole('heading', { name: target.title, level: 2 }).first(),
      ).toBeVisible()
      await page.getByText('Loading data...', { exact: true }).first()
        .waitFor({ state: 'hidden', timeout: 10_000 })
        .catch(() => undefined)

      await expectNoErrorState(page, target.loadError)
    })
  }
})
