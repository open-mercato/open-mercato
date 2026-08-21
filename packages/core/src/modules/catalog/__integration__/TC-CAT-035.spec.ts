import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

/**
 * TC-CAT-035: Product SEO Helper save-block message is localized (#3299).
 *
 * The SEO helper widget injected on the product form blocks the save when the
 * metadata is weak and shows *why*. That save-block message lives in a plain
 * `onBeforeSave` handler (no React context), so #3299 threads the translator in
 * via the widget component. This test proves the whole path end-to-end: with the
 * app in Polish, saving a product with a too-short title is blocked and the
 * message renders in Polish ("Pomocnik SEO: …") rather than hardcoded English.
 *
 * Self-contained: the save is blocked client-side, so no product is created and
 * there is nothing to clean up.
 */
test.describe('TC-CAT-035: Product SEO Helper i18n save-block', () => {
  test('blocks a short-title save with a Polish SEO helper message', async ({ page }) => {
    test.setTimeout(120_000)
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000'

    // Log in first (default English chrome), then pin the locale to Polish so the
    // product form and the injected SEO helper render localized copy.
    await login(page, 'admin')
    await page.context().addCookies([
      { name: 'locale', value: 'pl', url: baseUrl, sameSite: 'Lax' },
      { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
      { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    ])

    await page.goto('/backend/catalog/products/create', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    })

    // A too-short title (< 10 chars) with an otherwise-valid long description, so
    // exactly one SEO issue (title) drives the localized validation.
    const titleInput = page.getByPlaceholder('np. Letnie trampki')
    const descriptionInput = page.getByPlaceholder('Opisz produkt...')
    const titleTooShortScore = page.getByText('Za krótki', { exact: true }).first()

    // Wait (web-first, no arbitrary timeout) until the SEO helper has processed the
    // short title — its title score flips to "Za krótki" — before saving, so the
    // block runs against the settled form state. The fills are retried inside the
    // poll because the product form is a client component: under CI load a fill()
    // that lands before it hydrates only writes the DOM value, which the controlled
    // input discards on mount, leaving the helper with an empty title forever.
    await expect(async () => {
      await titleInput.fill('Buty')
      await descriptionInput.fill('To jest wystarczająco długi opis produktu dla dobrego SEO i walidacji.')
      await expect(titleTooShortScore).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 45_000, intervals: [500, 1_000, 2_000] })

    await page.getByRole('button', { name: 'Utwórz produkt' }).first().click()

    // The injected SEO helper blocks the save and surfaces the localized per-field
    // error (validation.fieldError.titleTooShort) rendered by CrudForm — proving the
    // messages are routed through i18n (#3299) rather than hardcoded English.
    await expect(
      page.getByText('Tytuł jest za krótki dla dobrego SEO (min. 10 znaków).', { exact: false }).first(),
    ).toBeVisible()

    // Save was blocked — still on the create form.
    await expect(page).toHaveURL(/\/backend\/catalog\/products\/create/)
  })
})
