import { test, expect } from '@playwright/test'

/**
 * TC-UI-8792: real-browser coverage for the `FrontendLayout` footer
 * `empty:hidden` collapse (#8412, follow-up #8792), exercised through the
 * real `AuthFooter` consumer across viewport, color-scheme and locale.
 *
 * `Layout.test.tsx` already proves in JSDOM that the wrapper div collapses
 * when its `footer` prop renders nothing. `AuthFooter` (`packages/ui/src/frontend/AuthFooter.tsx`)
 * is the one real, first-party consumer of that slot: it renders content
 * only on `/login` and `/onboarding*`, and null everywhere else — so every
 * other `(frontend)` page is a real "empty target" for this wrapper. `/privacy`
 * is a static, DB-independent content page, which keeps this deterministic.
 */
const WRAPPER_SELECTOR = 'div.min-h-svh.flex.flex-col > div.border-t'

test.describe('TC-UI-8792: auth footer wrapper collapses off /login, in a real browser', () => {
  test('collapses on a non-login frontend page and renders visibly on /login', async ({ page }) => {
    test.setTimeout(60_000)

    await page.goto('/privacy', { waitUntil: 'domcontentloaded' })
    const emptyWrapper = page.locator(WRAPPER_SELECTOR)
    await expect(emptyWrapper).toHaveCount(1)
    await expect(emptyWrapper).toBeHidden()
    expect(
      await emptyWrapper.boundingBox(),
      'AuthFooter renders null off /login and /onboarding, so the wrapper must compute to zero size',
    ).toBeNull()

    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    const visibleWrapper = page.locator(WRAPPER_SELECTOR)
    await expect(visibleWrapper).toHaveCount(1)
    await expect(visibleWrapper).toBeVisible()
    const box = await visibleWrapper.boundingBox()
    expect(box, 'AuthFooter renders real content on /login').not.toBeNull()
    expect(box!.height).toBeGreaterThan(0)
    await expect(visibleWrapper.getByRole('link', { name: /terms/i })).toBeVisible()
    await expect(visibleWrapper.getByRole('link', { name: /privacy/i })).toBeVisible()
  })

  test('stays visible on /login at a mobile viewport and in dark color scheme', async ({ page }) => {
    test.setTimeout(60_000)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/login', { waitUntil: 'domcontentloaded' })

    const wrapper = page.locator(WRAPPER_SELECTOR)
    await expect(wrapper).toBeVisible()
    const box = await wrapper.boundingBox()
    expect(box, 'the footer must still compute a real size on a narrow dark-mode viewport').not.toBeNull()
    expect(box!.height).toBeGreaterThan(0)
    await expect(wrapper.getByRole('link', { name: /terms/i })).toBeVisible()
  })

  test('stays visible on /login once the locale is switched to Polish', async ({ page }) => {
    test.setTimeout(60_000)

    // `page.request` shares the page's own cookie jar, so the `locale`
    // cookie this sets is already active for the next `page.goto`.
    const localeResponse = await page.request.post('/api/auth/locale', { data: { locale: 'pl' } })
    if (localeResponse.status() === 409) {
      // OM_FORCE_LOCALE pins the app locale for this environment — switching
      // is a documented no-op, not a defect. Nothing to disclose beyond this.
      test.skip(true, 'Locale is pinned via OM_FORCE_LOCALE in this environment; locale switching is disabled')
      return
    }
    expect(localeResponse.ok(), `POST /api/auth/locale should accept "pl": ${localeResponse.status()}`).toBeTruthy()

    try {
      await page.goto('/login', { waitUntil: 'domcontentloaded' })

      const wrapper = page.locator(WRAPPER_SELECTOR)
      await expect(wrapper).toBeVisible()
      const box = await wrapper.boundingBox()
      expect(box, 'the footer must still compute a real size under the Polish locale').not.toBeNull()
      expect(box!.height).toBeGreaterThan(0)
    } finally {
      await page.request.post('/api/auth/locale', { data: { locale: 'en' } })
    }
  })
})
