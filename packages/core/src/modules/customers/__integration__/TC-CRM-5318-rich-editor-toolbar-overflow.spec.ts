import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-CRM-5318: a `full`-variant RichEditor in a narrow column must not make the
 * document scroll sideways, and clipping its hidden measurement row must not
 * clip the visible toolbar's own drop shadow (PR #5318).
 *
 * `RichEditorAutoToolbar` renders an `absolute`/`invisible` twin of the whole
 * toolbar to measure how many items fit. `visibility: hidden` keeps the layout
 * box and an out-of-flow box still contributes to its ancestors' scrollable
 * overflow, so the twin used to widen the document by several hundred pixels
 * and push the app sidebar off-screen. jsdom has no layout engine and reports
 * `offsetWidth` as 0, so this can only be pinned in a real browser.
 *
 * The surface is `/backend/customers/companies/create`, which renders the
 * seeded `executive_notes` multiline custom field as `<RichEditor variant="full" />`
 * inside the `3fr` column of the form's `lg:grid-cols-[7fr_3fr]` layout. No
 * fixtures are needed and the form is never submitted, so there is nothing to
 * clean up.
 */
test.describe('TC-CRM-5318: RichEditor toolbar measurement row stays contained (#5318)', () => {
  const gotoCompaniesCreate = async (page: Page) => {
    await page.goto('/backend/customers/companies/create')
    const toolbar = page.locator('[data-slot="rich-editor-toolbar"]').first()
    await expect(toolbar).toBeVisible({ timeout: 30_000 })
    // The item split is driven by a ResizeObserver callback, so wait for the
    // measure pass to settle before reading document width.
    await expect.poll(async () => toolbar.locator('button').count(), { timeout: 15_000 }).toBeGreaterThan(0)
    await page.waitForTimeout(500)
    return toolbar
  }

  const readDocumentOverflow = async (page: Page) =>
    page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))

  test('the companies create form cannot be scrolled sideways on desktop or mobile', async ({ page }) => {
    test.slow()

    await login(page, 'admin')

    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoCompaniesCreate(page)

    const desktop = await readDocumentOverflow(page)
    expect(desktop.scrollWidth).toBeLessThanOrEqual(desktop.clientWidth)

    const scrolledX = await page.evaluate(() => {
      window.scrollTo(9999, 0)
      return window.scrollX
    })
    expect(scrolledX, 'the document must not scroll horizontally').toBe(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await gotoCompaniesCreate(page)

    const mobile = await readDocumentOverflow(page)
    expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.clientWidth)
  })

  test('the toolbar still collapses overflowing items into the ⋮ menu', async ({ page }) => {
    test.slow()

    await login(page, 'admin')
    await page.setViewportSize({ width: 1440, height: 900 })
    const toolbar = await gotoCompaniesCreate(page)

    const measurementRow = page.locator('[data-slot="rich-editor-toolbar-measure-clip"]').first()
    await expect(measurementRow).toHaveCount(1)

    const measuredItems = await measurementRow.locator('button').count()
    const visibleItems = await toolbar.locator('button').count()

    expect(measuredItems, 'the measurement row must carry every toolbar item').toBeGreaterThan(visibleItems)
    await expect(toolbar.getByRole('button', { name: 'More' })).toBeVisible()
  })

  test('clipping the measurement row does not clip the visible toolbar', async ({ page }) => {
    test.slow()

    await login(page, 'admin')
    await page.setViewportSize({ width: 1440, height: 900 })
    const toolbar = await gotoCompaniesCreate(page)

    // The measurement row must be clipped — that is what fixes the overflow.
    const clipOverflow = await page
      .locator('[data-slot="rich-editor-toolbar-measure-clip"]')
      .first()
      .evaluate((node) => window.getComputedStyle(node).overflowX)
    expect(clipOverflow).toBe('hidden')

    // The visible toolbar must NOT be inside that clip, and no ancestor whose
    // box coincides with the toolbar's own box may clip it — otherwise the
    // toolbar's `shadow-xs`, which paints outside its border box, disappears.
    const shadowState = await toolbar.evaluate((node) => {
      const styles = window.getComputedStyle(node)
      const toolbarBox = node.getBoundingClientRect()
      let clippedByCoincidentAncestor = false
      let ancestor = node.parentElement
      while (ancestor && ancestor !== document.documentElement) {
        const ancestorStyles = window.getComputedStyle(ancestor)
        if (ancestorStyles.overflowX !== 'visible' || ancestorStyles.overflowY !== 'visible') {
          const ancestorBox = ancestor.getBoundingClientRect()
          const coincides =
            Math.abs(ancestorBox.top - toolbarBox.top) < 2 &&
            Math.abs(ancestorBox.bottom - toolbarBox.bottom) < 2
          if (coincides) {
            clippedByCoincidentAncestor = true
            break
          }
        }
        ancestor = ancestor.parentElement
      }
      return { boxShadow: styles.boxShadow, clippedByCoincidentAncestor }
    })

    expect(shadowState.boxShadow).not.toBe('none')
    expect(
      shadowState.clippedByCoincidentAncestor,
      'an ancestor sharing the toolbar box clips its drop shadow',
    ).toBe(false)
  })
})
