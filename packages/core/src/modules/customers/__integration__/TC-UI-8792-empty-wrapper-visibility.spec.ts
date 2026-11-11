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
 *  - On the catalog products list the real
 *    `catalog.injection.merchandising-assistant-trigger` widget (already
 *    proven to render asynchronously by `TC-AI-INJECT-013`) populates the
 *    DataTable header injection spot, so that same wrapper mechanism must
 *    report a nonzero computed size once the widget mounts.
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
    const trigger = page.locator('[data-ai-merchandising-trigger]').first()
    await expect(trigger).toBeVisible({ timeout: 60_000 })

    // A visible descendant cannot sit inside a `display: none` ancestor, so
    // the trigger's own nonzero computed size already proves the
    // `empty:hidden` header wrapper did NOT collapse once this real,
    // asynchronously-mounted widget populated it — the exact contract the
    // zero-size assertion above guards for the empty case.
    const box = await trigger.boundingBox()
    expect(box, 'the header wrapper must not have collapsed once the async widget mounted into it').not.toBeNull()
    expect(box!.height).toBeGreaterThan(0)
    expect(box!.width).toBeGreaterThan(0)
  })
})
