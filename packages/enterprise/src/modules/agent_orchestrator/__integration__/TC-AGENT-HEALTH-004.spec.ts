import { expect, test, type Page } from '@playwright/test'

/**
 * TC-AGENT-HEALTH-004: the details panel fits its own content.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-08-14-system-health-verification-ux.md
 * (§3.5, Phase 1). The audit reproduced the defect at 320px: the state badge
 * wrapped onto two lines and pushed the adapter list into the label column, and
 * the "Installed but off: browser, searxng, serp-html, tavily, exa…" line was
 * clipped at the panel edge with no affordance. Both are layout regressions that
 * only a rendered panel can catch.
 *
 * Read-only: no fixtures, nothing to clean up.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-HEALTH-004: system health panel layout', () => {
  test('the panel opens, sections render, and nothing is clipped', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/backend/overview', { waitUntil: 'domcontentloaded' })

    const details = page.getByRole('button', { name: 'Details' })
    await expect(details).toBeVisible({ timeout: 15_000 })
    await details.click()

    const panel = page.getByTestId('system-health-panel')
    await expect(panel).toBeVisible({ timeout: 5_000 })

    // Both sections are present, so runtime dependencies and web-search adapters
    // no longer read as one flat list.
    await expect(panel.getByText('Runtime', { exact: true })).toBeVisible()

    // `PopoverContent` defaults to `p-0`, so the panel has to bring its own
    // inset. Without it every label and badge sits flush against the border.
    const padding = await panel.evaluate((node) => {
      const style = getComputedStyle(node)
      return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map((value) =>
        Number.parseFloat(value),
      )
    })
    expect(Math.min(...padding), 'content must not sit flush against the popover edge').toBeGreaterThanOrEqual(8)

    // The regression the screenshots showed: content wider than its container.
    const overflow = await panel.evaluate((node) => {
      const scan = (element: Element): string[] => {
        const offenders: string[] = []
        for (const child of Array.from(element.querySelectorAll('*'))) {
          if (child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).overflowX === 'visible') {
            offenders.push(child.textContent?.slice(0, 40) ?? '<unnamed>')
          }
        }
        return offenders
      }
      return { self: node.scrollWidth - node.clientWidth, children: scan(node) }
    })
    expect(overflow.self, 'the panel itself must not scroll horizontally').toBeLessThanOrEqual(1)
    expect(overflow.children, 'no row may overflow its column without a scroll container').toEqual([])

    // Escape closes it, per the shared overlay interaction rules.
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden({ timeout: 5_000 })
  })
})
