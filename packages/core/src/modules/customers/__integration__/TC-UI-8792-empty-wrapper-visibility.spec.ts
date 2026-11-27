import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-UI-8792: real-browser coverage for the `empty:hidden` DataTable
 * injection-spot wrapper collapse behavior (#8412, follow-up #8792).
 *
 * `AppShell.test.tsx` / `DataTable.extensions.test.tsx` already assert the
 * collapse in JSDOM via `toBeEmptyDOMElement()`, which only proves the
 * wrapper has no child nodes — not that a real browser actually computes it
 * to zero size. This spec proves the computed-layout half in a live browser:
 *
 *  - On the customers "People" list no widget targets the DataTable footer
 *    injection spot, so `[data-table-footer]` must render with zero
 *    computed size (`display: none` via the `empty:hidden` Tailwind
 *    variant) instead of leaving a visible empty bordered strip.
 *  - On the catalog products list the real `example.injection.catalog-seo-report`
 *    widget — registered against `data-table:catalog.products:header`
 *    (`apps/mercato/src/modules/example/widgets/injection-table.ts`), the
 *    one widget in this repository that actually targets a DataTable
 *    `:header` spot — fetches its data asynchronously and populates that
 *    same wrapper mechanism, so it must report a nonzero computed size
 *    once the widget mounts. (The catalog merchandising-assistant trigger
 *    proven by `TC-AI-INJECT-013` targets `:search-trailing`, a plain
 *    conditional-render slot in `FilterBar.tsx` — a different mechanism
 *    from the `empty:hidden` wrapper this spec is about, so it is not
 *    reused here.)
 *
 * The staff time-entries footer widget (`staff.injection.time-entries-summary-footer`)
 * already gets equivalent real-browser, nonzero-size coverage from
 * `TC-STAFF-047-time-entries-totals.spec.ts` (`[data-table-footer] [data-staff-entries-summary-footer]`
 * visible with real fixtures) — this spec does not duplicate that setup.
 */
test.describe('TC-UI-8792: empty DataTable injection wrappers collapse in a real browser', () => {
  test('footer wrapper is zero-size with no widget; header wrapper is nonzero once a real widget mounts', async ({ page }) => {
    test.setTimeout(90_000)

    await login(page, 'superadmin')

    await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('columnheader').first()).toBeVisible({ timeout: 30_000 })

    const emptyFooterWrapper = page.locator('[data-table-footer]')
    await expect(emptyFooterWrapper).toHaveCount(1)
    await expect(emptyFooterWrapper).toBeHidden()
    expect(
      await emptyFooterWrapper.boundingBox(),
      'an empty injection-spot wrapper must compute to zero size, not just have no DOM children',
    ).toBeNull()

    await page.goto('/backend/catalog/products', { waitUntil: 'domcontentloaded' })
    const seoReportWidget = page.getByText('Catalog SEO Report').first()
    await expect(seoReportWidget).toBeVisible({ timeout: 30_000 })

    // A visible descendant cannot sit inside a `display: none` ancestor, so
    // this real, asynchronously-loaded widget's own nonzero computed size
    // already proves the `empty:hidden` header wrapper did NOT collapse
    // once it populated that spot — the exact contract the zero-size
    // assertion above guards for the empty case.
    const box = await seoReportWidget.boundingBox()
    expect(box, 'the header wrapper must not have collapsed once the async widget mounted into it').not.toBeNull()
    expect(box!.height).toBeGreaterThan(0)
    expect(box!.width).toBeGreaterThan(0)
  })
})
