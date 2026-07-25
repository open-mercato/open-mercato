import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

/**
 * TC-SEARCH-012: the global (top-bar) search results panel escapes the sticky
 * header's stacking context so page content can never paint over it (#3097).
 *
 * The backend top bar is `position: sticky; z-index: 10`, which establishes a
 * stacking context. Rendered inline, the results panel's `z-index` (z-popover)
 * only ranked *within* that context, so relative to the page it was capped at the
 * header's z-index — any page element with its own stacking context above 10
 * (sticky table cells, cards, positioned widgets) bled over the results. The fix
 * portals the panel to <body> with fixed positioning.
 *
 * Self-contained: needs no indexed data. A below-minimum query (< 3 chars) opens
 * the panel in its "type more" hint state without issuing a search request, which
 * is enough to assert both structure and stacking. A synthetic z-index:30 overlay
 * proves the panel is painted on top — on the pre-fix inline markup that overlay
 * painted over the trapped panel instead.
 */
test.describe('TC-SEARCH-012: global search results escape the sticky header stacking context', () => {
  test('the results panel is portaled to <body> and stays above high z-index page content', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend')
    await page.waitForLoadState('domcontentloaded')

    // Open the collapsed top-bar search (icon button) and focus its input.
    await page.locator('header').getByRole('button', { name: 'Open global search' }).click()
    const input = page.locator('input[aria-controls="topbar-search-results"]')
    await expect(input).toBeVisible()

    // A 2-char query (below the 3-char minimum) opens the panel in its hint state
    // — no search API call, so the assertion never depends on indexed records.
    await input.fill('au')
    const panel = page.locator('#topbar-search-results')
    await expect(panel).toBeVisible()

    // -- Structural guard: portaled to <body>, not nested inside the sticky header.
    const structure = await panel.evaluate((el) => ({
      parentIsBody: el.parentElement === document.body,
      insideHeader: Boolean(el.closest('header')),
      position: getComputedStyle(el).position,
    }))
    expect(structure.parentIsBody, 'results panel should be portaled directly under <body>').toBe(true)
    expect(structure.insideHeader, 'results panel must not live inside the sticky header').toBe(false)
    expect(structure.position, 'portaled panel is positioned relative to the viewport').toBe('fixed')

    // -- Stacking guard: page content at z-index 30 overlapping the panel stays
    //    BELOW it. Pre-fix, the panel was trapped at the header's z-index (10) and
    //    this overlay painted over it.
    const stacking = await panel.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const x = Math.round(rect.left + rect.width / 2)
      const y = Math.round(rect.top + rect.height / 2)
      const probe = document.createElement('div')
      probe.id = '__zorder_probe__'
      Object.assign(probe.style, {
        position: 'fixed',
        top: `${y - 25}px`,
        left: `${x - 25}px`,
        width: '50px',
        height: '50px',
        zIndex: '30',
        background: 'rgba(255,0,0,0.5)',
      })
      document.body.appendChild(probe)
      const stack = document.elementsFromPoint(x, y)
      const panelIdx = stack.findIndex((node) => node === el || el.contains(node))
      const probeIdx = stack.findIndex((node) => (node as HTMLElement).id === '__zorder_probe__')
      probe.remove()
      return { panelIdx, probeIdx }
    })
    // The panel must be present at the point and painted ABOVE the z-index:30
    // overlay. Asserting the relative order (rather than "topmost") keeps the
    // guard precise if some unrelated top-layer element ever overlaps the centre.
    expect(stacking.panelIdx, 'the results panel should be hit at its own centre').toBeGreaterThanOrEqual(0)
    expect(
      stacking.probeIdx === -1 || stacking.panelIdx < stacking.probeIdx,
      'a z-index:30 page element must not paint over the results panel',
    ).toBe(true)
  })
})
