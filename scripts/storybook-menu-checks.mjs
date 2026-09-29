import assert from 'node:assert/strict'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkSourceMenus(page, render, artifacts, themes = ['light', 'dark']) {
  const checks = []
  for (const theme of themes) {
    const globals = `theme:${theme};font:application`
    for (const [variant, size, radius] of [['sizes', 32, '8px'], ['groups-leading', 36, '8px'], ['medium', 40, '10px']]) {
      await render(page, `primitives-inputs-select--variant-${variant}`, globals)
      const triggers = page.getByRole('combobox')
      await expect(triggers).toHaveCount(6)
      const dimensions = await triggers.evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, radius: getComputedStyle(node).borderRadius })))
      assert.ok(dimensions.every(item => item.height === size && item.radius === radius))
      const brand = page.getByRole('combobox', { name: 'Brand', exact: true })
      await brand.click()
      await page.getByRole('option', { name: 'Google', exact: true }).click()
      await expect(brand).toHaveText('Google')
      await expect(brand.locator('img')).toHaveCount(1)
      await expect(brand).toBeFocused()
    }
    if (artifacts) await page.screenshot({ path: path.join(artifacts, `select-source-${theme}.png`) })
    await render(page, 'primitives-inputs-select--variant-states', globals)
    const disabled = page.getByRole('combobox')
    await expect(disabled).toHaveCount(6)
    for (const trigger of await disabled.all()) await expect(trigger).toBeDisabled()

    for (const [variant, height, radius] of [['small', 36, '8px'], ['large', 56, '10px']]) {
      await render(page, `primitives-inputs-dropdown--variant-${variant}`, globals)
      const trigger = page.getByRole('button', { name: 'Open dropdown', exact: true })
      await trigger.click()
      const rows = page.getByRole('option')
      await expect(rows).toHaveCount(7)
      await expect.poll(() => rows.evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, radius: getComputedStyle(node).borderRadius })))).toEqual(Array(7).fill({ height, radius }))
      if (artifacts) await page.screenshot({ path: path.join(artifacts, `dropdown-${variant}-${theme}.png`) })
      const input = page.getByRole('combobox', { name: 'Search options…', exact: true })
      await input.fill('zzzz')
      await expect(page.getByText('No results. Try another search.')).toBeVisible()
      await page.getByRole('button', { name: 'Clear search', exact: true }).click()
      await expect(input).toBeFocused()
      await expect(rows).toHaveCount(7)
      await input.fill('Spotify')
      await expect(rows).toHaveCount(1)
      await input.press('Enter')
      await expect(page.getByRole('status')).toHaveText('Selected: Spotify')
      await expect(trigger).toBeFocused()
      await trigger.click()
      await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
      await expect(page.getByText('1 example workspaces created')).toBeVisible()
    }

    for (const [variant, height] of [['default', 40], ['medium', 64], ['groups', 40]]) {
      await render(page, `primitives-overlays-command-menu--variant-${variant}`, globals)
      const trigger = page.getByRole('button', { name: 'Open command menu', exact: true })
      await trigger.click()
      const rows = page.getByRole('option')
      await expect(rows).toHaveCount(variant === 'groups' ? 7 : 6)
      await expect.poll(() => rows.evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, radius: getComputedStyle(node).borderRadius })))).toEqual(Array(variant === 'groups' ? 7 : 6).fill({ height, radius: '10px' }))
      if (artifacts) await page.screenshot({ path: path.join(artifacts, `command-${variant}-${theme}.png`) })
      const input = page.getByRole('combobox', { name: 'Search options…', exact: true })
      await input.fill('zzzz')
      await expect(page.getByText('No results. Try another search.')).toBeVisible()
      await page.getByRole('button', { name: 'Clear search', exact: true }).click()
      await expect(input).toBeFocused()
      await input.fill('Spotify')
      await expect(rows).toHaveCount(1)
      await input.press('Enter')
      await expect(page.getByRole('status')).toHaveText('Selected: Spotify')
      await expect(trigger).toBeFocused()
      await trigger.click()
      await page.getByRole('combobox').press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    checks.push(`Select 6 types and 3 sizes, Dropdown 36/56, CommandMenu 40/64, search/clear/empty, keyboard selection, disabled options, close/focus and local footer work in ${theme}`)
  }
  return checks
}
