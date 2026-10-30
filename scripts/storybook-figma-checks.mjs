import assert from 'node:assert/strict'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkFigmaLibrary(page, render, artifacts) {
  const checks = []
  await render(page, 'design-system-figma-library--library')
  await page.getByRole('searchbox', { name: 'Search Figma library' }).fill('Opacity')
  await expect(page.getByRole('status')).toHaveText('1 of 84 pages')
  await page.locator('summary').click()
  await expect(page.getByText('Hue Slider · Opacity')).toBeVisible()
  await expect(page.getByRole('link', { name: /ColorPicker/ })).toHaveAttribute('href', /primitives-inputs-color-picker--overview/)
  await page.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('84 of 84 pages')
  await page.getByRole('button', { name: 'Without examples', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'sidebar', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Color Picker', exact: true })).toHaveCount(0)
  checks.push('Figma library searches variant values, clears and filters missing examples')
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'figma-library-gaps.png'), fullPage: false })

  await page.setViewportSize({ width: 375, height: 900 })
  await render(page, 'design-system-figma-library--library', 'theme:dark;font:application')
  await page.getByRole('searchbox', { name: 'Search Figma library' }).fill('Avatar')
  await page.locator('summary').filter({ has: page.getByRole('heading', { name: 'Avatar', exact: true }) }).click()
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  assert.equal(overflows, false, 'Figma library overflows the mobile viewport')
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'figma-library-mobile.png'), fullPage: false })
  checks.push('Figma library expanded variant axes fit a narrow dark viewport')
  await page.setViewportSize({ width: 1440, height: 1000 })

  for (const theme of ['light', 'dark']) {
    await render(page, 'primitives-inputs-color-picker--variant-opacity', `theme:${theme};font:application`)
    await page.getByRole('button', { name: 'Pick color', exact: true }).click()
    const slider = page.getByRole('slider', { name: 'Opacity', exact: true })
    await expect(slider).toHaveValue('75')
    await slider.focus()
    await slider.press('Home')
    await expect(slider).toHaveValue('0')
    await slider.press('ArrowRight')
    await expect(slider).toHaveValue('1')
    await expect(slider).toHaveAttribute('aria-valuetext', '1%')
    await expect(page.locator('[data-slot="color-picker-preview"]')).toHaveCSS('opacity', '0.01')
    await expect(page.locator('[data-slot="color-picker-hex"]')).toHaveValue('#6366F1')
    await slider.press('End')
    await expect(slider).toHaveValue('100')
    await page.screenshot({ animations: 'disabled', path: path.join(artifacts, `color-picker-opacity-${theme}.png`), fullPage: false })
    checks.push(`ColorPicker ${theme}: keyboard controls alpha from 0 to 100 without changing RGB`)
  }

  await render(page, 'primitives-inputs-input--variant-sizes')
  const sizes = await page.locator('[data-slot="input-wrapper"]').evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, radius: getComputedStyle(node).borderRadius, font: getComputedStyle(node.querySelector('input')).fontSize })))
  sizes.sort((a, b) => a.height - b.height)
  assert.deepEqual(sizes.map(item => item.height), [32, 36, 40])
  assert.deepEqual(sizes.map(item => item.font), ['14px', '14px', '14px'])
  assert.equal(sizes[2].radius, '10px')
  await render(page, 'playgrounds-input--playground')
  await expect(page.locator('[data-slot="form-field"]')).toHaveCSS('row-gap', '4px')
  checks.push('Input source sizes retain 32/36/40px heights, use 14px type, 10px large radius and 4px field spacing')
  return checks
}
