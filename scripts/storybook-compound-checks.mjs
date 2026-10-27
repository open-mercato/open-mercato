import assert from 'node:assert/strict'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkCompoundExamples(page, render, artifacts) {
  const checks = []
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    for (const height of [48, 64]) {
      await render(page, `primitives-display-table--variant-cells-${height}`, globals)
      const table = page.locator('#storybook-root table')
      const rows = table.locator('tbody tr')
      await expect(rows).toHaveCount(12)
      assert.deepEqual(await rows.evaluateAll(nodes => nodes.map(node => node.offsetHeight)), Array(12).fill(height))
      await page.getByRole('checkbox', { name: 'Select Regular', exact: true }).click()
      await expect(page.getByRole('status')).toHaveText('2 rows selected')
      await page.getByRole('button', { name: 'Component', exact: true }).click()
      await expect(table.locator('[aria-sort]')).toHaveAttribute('aria-sort', 'ascending')
      await expect(rows.first()).toContainText('AvatarStack')
      await page.getByRole('button', { name: 'Component', exact: true }).click()
      await expect(table.locator('[aria-sort]')).toHaveAttribute('aria-sort', 'descending')
      await expect(rows.first()).toContainText('Switch')
      const enabled = page.getByRole('switch', { name: 'Enabled', exact: true })
      await enabled.click()
      await expect(enabled).toHaveAttribute('aria-checked', 'false')
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      await expect(page.getByRole('status')).toHaveText('Record opened in this local example.')
      await page.screenshot({ path: path.join(artifacts, `table-${height}-${theme}.png`), animations: 'disabled' })
    }
    checks.push(`Table ${theme}:12cell types in48/64px rows, selection, sorting, toggle and actions`)

    await render(page, 'primitives-display-activity-feed--variant-source-composition', globals)
    const activity = page.locator('[data-slot="activity-feed-item"]')
    await expect(activity).toHaveCount(5)
    await page.getByRole('button', { name: 'Files', exact: true }).click()
    await expect(activity).toHaveCount(1)
    await page.getByRole('button', { name: 'Open file preview', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Comments', exact: true }).click()
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save reply', exact: true })).toBeDisabled()
    await page.getByRole('textbox', { name: 'Reply', exact: true }).fill('Reviewed locally.')
    await page.getByRole('button', { name: 'Save reply', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Reviewed locally.')
    await page.getByRole('button', { name: 'Actions for Laura Perez', exact: true }).click()
    await page.getByRole('button', { name: 'Hide entry', exact: true }).click()
    await expect(activity).toHaveCount(0)
    await page.getByRole('button', { name: 'Restore examples', exact: true }).click()
    await expect(activity).toHaveCount(1)
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(activity).toHaveCount(5)
    checks.push(`ActivityFeed ${theme}:5types, filter, local file preview, reply validation and hide/restore`)

    for (const count of [2, 3, 4]) {
      await render(page, `primitives-feedback-notification-feed--variant-source-tabs-${count}`, globals)
      await expect(page.getByRole('tab')).toHaveCount(count)
      await expect(page.locator('[data-slot="notification-feed-item"]')).toHaveCount(4)
      const tab = page.getByRole('tab', { name: 'All', exact: true })
      const targetId = await tab.getAttribute('aria-controls')
      await expect(page.locator(`[id="${targetId}"]`)).toBeVisible()
      await page.getByRole('button', { name: 'Approve', exact: true }).click()
      await expect(page.getByRole('status')).toHaveText('Approved')
      await page.getByRole('tab', { name: 'Unread', exact: true }).click()
      await page.getByRole('button', { name: 'Mark all as read', exact: true }).click()
      await expect(page.locator('[data-slot="notification-feed-item"]')).toHaveCount(0)
      await page.getByRole('button', { name: 'Restore examples', exact: true }).click()
      await page.getByRole('button', { name: 'Archive all', exact: true }).click()
      await expect(page.locator('[data-slot="notification-feed-item"]')).toHaveCount(0)
    }
    checks.push(`NotificationFeed ${theme}:4row types,2/3/4tabs linked to panels, approval, read-state filtering and archive/restore`)

    await render(page, 'primitives-dates-time-picker--variant-source-statuses', globals)
    const statuses = page.locator('[data-slot="time-picker-status-chip"]')
    await expect(statuses).toHaveCount(16)
    await expect(statuses.locator(':scope:disabled')).toHaveCount(4)
    await statuses.first().click()
    await expect(statuses.first()).toHaveAttribute('aria-pressed', 'true')
    await statuses.first().press('Space')
    await expect(statuses.first()).toHaveAttribute('aria-pressed', 'false')
    await render(page, 'primitives-dates-time-picker--variant-source-durations', globals)
    const durations = page.locator('[data-slot="time-picker-duration-chip"]')
    await expect(durations).toHaveCount(4)
    await durations.first().click()
    await expect(durations.first()).toHaveAttribute('aria-pressed', 'true')
    await render(page, 'primitives-dates-time-picker--variant-source-slots', globals)
    const slots = page.locator('[data-slot="time-picker-slot"]')
    await expect(slots).toHaveCount(8)
    assert.deepEqual(await slots.evaluateAll(nodes => nodes.map(node => node.offsetHeight)), Array(8).fill(36))
    const centered = slots.nth(6)
    const bounds = await centered.boundingBox()
    const check = await centered.locator('[data-slot="time-picker-slot-check"]').boundingBox()
    assert.ok(Math.abs(check.x + check.width / 2 - bounds.x - bounds.width / 2) < 1)
    await centered.click()
    await expect(centered).toHaveAttribute('aria-pressed', 'false')
    checks.push(`TimePicker ${theme}:16status/4duration/8slot states with36px rows, centered indicator and keyboard toggles`)

    await page.setViewportSize({ width: 375, height: 900 })
    for (const id of ['primitives-display-table--variant-cells-64', 'primitives-display-activity-feed--variant-source-composition', 'primitives-feedback-notification-feed--variant-source-tabs-4', 'primitives-dates-time-picker--variant-source-statuses']) {
      await render(page, id, globals)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${id} has mobile overflow`)
      await page.screenshot({ path: path.join(artifacts, `${id}-${theme}-mobile.png`), animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    checks.push(`Compound examples ${theme}:375px mobile without page overflow`)
  }
  return checks
}
