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

    // A too-short title (< 10 chars) with an otherwise-valid long description, so
    // exactly one SEO issue (title) drives the localized validation.
    await page.getByPlaceholder('np. Letnie trampki').fill('Buty')
    await page
      .getByPlaceholder('Opisz produkt...')
      .fill('To jest wystarczająco długi opis produktu dla dobrego SEO i walidacji.')

    // Wait (web-first, no arbitrary timeout) until the SEO helper has processed the
    // short title — its title score flips to "Za krótki" — before saving, so the
    // block runs against the settled form state.
    await expect(page.getByText('Za krótki', { exact: true }).first()).toBeVisible()

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
