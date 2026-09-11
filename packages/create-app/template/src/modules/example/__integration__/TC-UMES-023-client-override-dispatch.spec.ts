/**
 * TC-UMES-023: `modules.ts` injection-widget overrides survive the client bootstrap.
 *
 * The server bootstrap applies `src/modules.ts` overrides before it registers the
 * injection registry, so the server-rendered HTML has always been correct. The browser
 * re-registers the same registry from `ClientBootstrap`; before #5152 it did so from the
 * raw generated entries, and a widget the app had disabled reappeared the moment
 * hydration finished. Nothing about that failure is observable from Node: it depends on
 * `@/modules` being re-evaluated in a real bundle, where Next inlines no server-only
 * `process.env.OM_*` value. Hence a browser test rather than another unit test (#5844).
 *
 * `example:override-probe` carries two widgets:
 *   - `example.injection.override-probe` — disabled in `apps/mercato/src/modules.ts`,
 *     keyed by its registry `key` rather than its `widgetId`, so the override has to
 *     travel through the alias resolution #5152 added to reach the injection table.
 *   - `example.injection.override-probe-control` — not overridden. Its visibility is the
 *     hydration barrier AND the second case the issue asks for: without it, an assertion
 *     on the first widget's absence would pass just as happily on a spot that renders
 *     nothing at all.
 */
import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * The client injection registry is re-registered asynchronously and `InjectionSpot`
 * re-renders on every registry change, so a widget removed by the server can still be
 * put back a beat later. Re-checking across this window is what separates "the override
 * held" from "the client bootstrap had not run yet when we looked".
 */
const POST_HYDRATION_SETTLE_CHECKS = 4
const POST_HYDRATION_SETTLE_INTERVAL_MS = 500

test.describe('TC-UMES-023: client-side module-override dispatch', () => {
  test.beforeEach(async ({ page }) => {
    // `/backend/umes-extensions` is one of the heaviest example pages, and against a dev
    // server its first compile alone can outlast the default per-test budget.
    test.slow()
    await login(page, 'admin')
    await page.goto('/backend/umes-extensions', { waitUntil: 'domcontentloaded' })
  })

  test('renders the non-overridden control widget on the probe spot', async ({ page }) => {
    await expect(page.getByTestId('phase-i-override-probe-spot')).toBeVisible()
    await expect(page.getByTestId('example-override-probe-control')).toBeVisible()
  })

  test('keeps the disabled widget absent after hydration settles', async ({ page }) => {
    // The control comes from the same registry as the disabled widget, so its arrival
    // means the browser registration has completed — the exact point at which the
    // pre-#5152 bug made the disabled widget reappear.
    await expect(page.getByTestId('example-override-probe-control')).toBeVisible()
    await page.waitForLoadState('networkidle')

    for (let check = 0; check < POST_HYDRATION_SETTLE_CHECKS; check += 1) {
      await expect(page.getByTestId('example-override-probe')).toHaveCount(0)
      await page.waitForTimeout(POST_HYDRATION_SETTLE_INTERVAL_MS)
    }

    // The control is still there at the end, so the loop above was not passing simply
    // because the spot had unmounted.
    await expect(page.getByTestId('example-override-probe-control')).toBeVisible()
  })

  test('survives a client-side navigation back onto the probe page', async ({ page }) => {
    await expect(page.getByTestId('example-override-probe-control')).toBeVisible()

    // A soft navigation re-runs the registry group loaders without a fresh document, so
    // it exercises the dispatch memoisation rather than the first-load path.
    await page.getByRole('link', { name: /Open customers table/i }).click()
    await page.waitForURL('**/backend/customers/people')
    await page.goBack()
    await page.waitForURL('**/backend/umes-extensions')

    await expect(page.getByTestId('example-override-probe-control')).toBeVisible()
    await expect(page.getByTestId('example-override-probe')).toHaveCount(0)
  })
})
