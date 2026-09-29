import assert from 'node:assert/strict'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkSourceFilters(page, render, artifacts) {
  const checks = []
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    await page.setViewportSize({ width: 1440, height: 1000 })
    await render(page, 'primitives-display-table--variant-header-states', globals)
    const headers = page.locator('#storybook-root thead th')
    assert.deepEqual(await headers.evaluateAll(nodes => nodes.map(node => ({ width: node.offsetWidth, height: node.offsetHeight }))), [{ width: 256, height: 36 }, { width: 256, height: 36 }, { width: 64, height: 36 }])
    await expect(headers.nth(1).getByRole('button')).toBeDisabled()
    await expect(headers.nth(1).getByRole('checkbox')).toBeDisabled()
    for (const sort of ['ascending', 'descending', 'none']) {
      await headers.first().getByRole('button').click()
      await expect(headers.first()).toHaveAttribute('aria-sort', sort)
    }
    await headers.first().getByRole('checkbox').click()
    await expect(page.getByRole('status')).toHaveText('1 rows selected')
    checks.push(`Table header ${theme}: 256/256/64×36px, disabled controls, three sorting states and selection`)

    await render(page, 'backend-filters-filter-toolbar--variant-table', globals)
    const rows = page.locator('#storybook-root tbody tr')
    await expect(rows).toHaveCount(4)
    await page.getByRole('radio', { name: 'Income', exact: true }).click()
    await expect(rows).toHaveCount(2)
    await page.getByRole('searchbox').fill('apex')
    await expect(rows).toHaveCount(1)
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    await page.getByRole('radio', { name: 'All', exact: true }).click()
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    const panel = page.locator('[data-example="filter-panel"]')
    await panel.getByRole('button', { name: 'Status', exact: true }).click()
    await panel.getByRole('checkbox', { name: 'Pending', exact: true }).click()
    await expect(rows).toHaveCount(4)
    await panel.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(rows).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeFocused()
    await page.getByRole('combobox', { name: 'Sort transactions', exact: true }).click()
    await page.getByRole('option', { name: 'Amount', exact: true }).click()
    await expect(rows.first()).toContainText('Synergy')
    await page.getByRole('button', { name: 'Display settings', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Show amount', exact: true }).click()
    await expect(page.locator('#storybook-root thead th')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Reset example', exact: true }).click()
    await expect(rows).toHaveCount(4)
    await expect(page.locator('#storybook-root thead th')).toHaveCount(3)
    await page.screenshot({ path: path.join(artifacts, `filter-table-${theme}.png`), animations: 'disabled' })
    checks.push(`Table filter ${theme}: search, category, draft/apply, sorting, column visibility and reset`)

    await render(page, 'backend-filters-filter-toolbar--variant-calendar', globals)
    await expect(rows).toHaveCount(4)
    await page.getByRole('combobox', { name: 'Period', exact: true }).click()
    await page.getByRole('option', { name: 'Today', exact: true }).click()
    await expect(rows).toHaveCount(2)
    await page.getByRole('button', { name: 'Date range', exact: true }).click()
    const day = page.getByRole('button', { name: /August 10th, 2023/ })
    await day.click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Spotify')
    await page.getByRole('button', { name: 'Reset example', exact: true }).click()
    await expect(rows).toHaveCount(4)
    checks.push(`Calendar filter ${theme}: period and date selection filter local rows`)

    await render(page, 'backend-filters-filter-toolbar--variant-vertical-parts', globals)
    const items = page.locator('[data-slot="filter-panel-item"]')
    assert.deepEqual(await items.evaluateAll(nodes => nodes.map(node => [node.offsetWidth, node.offsetHeight, getComputedStyle(node).borderRadius])), Array(3).fill([200, 36, '8px']))
    assert.equal(await page.locator('[data-slot="filter-panel-header"]').evaluate(node => node.offsetHeight), 52)
    assert.equal(await page.locator('[data-slot="filter-panel-footer"]').evaluate(node => node.offsetHeight), 68)
    await items.nth(1).hover()
    await expect.poll(() => items.nth(1).evaluate(node => getComputedStyle(node).backgroundColor)).toBe(await items.nth(2).evaluate(node => getComputedStyle(node).backgroundColor))
    await page.screenshot({ path: path.join(artifacts, `filter-parts-${theme}.png`), animations: 'disabled' })
    checks.push(`Vertical filter ${theme}: 200×36px items, hover/active, 52px header and 68px footer`)

    await page.setViewportSize({ width: 375, height: 850 })
    for (const variant of ['table', 'calendar', 'vertical-panel']) {
      await render(page, `backend-filters-filter-toolbar--variant-${variant}`, globals)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${variant} ${theme} mobile overflow`)
    }
    await page.screenshot({ path: path.join(artifacts, `filter-mobile-${theme}.png`), animations: 'disabled' })
    checks.push(`Filters ${theme}: all compositions fit 375px`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  return checks
}
