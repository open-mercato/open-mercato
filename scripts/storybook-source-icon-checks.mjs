import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { expect } from '@playwright/test'

export async function checkSourceIcons(page, render, artifacts) {
  const artwork = JSON.parse(fs.readFileSync(new URL('../packages/ui/src/assets/source-icon-artwork.json', import.meta.url)))
  const checks = []
  for (const theme of ['light', 'dark']) {
    await render(page, 'foundations-icons-source-icons--variant-catalogue', `theme:${theme};font:application`)
    await expect(page.locator('#storybook-root [role="status"]').first()).toHaveText('1667 of 1667 icons')
    await expect(page.locator('#storybook-root button[aria-pressed]')).toHaveCount(96)
    await page.getByRole('button', { name: 'Next page', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Page 2, current page', exact: true })).toHaveAttribute('aria-current', 'page')
    for (const item of artwork) {
      await page.getByRole('searchbox').fill(item.name)
      await page.getByRole('button', { name: item.name, exact: true }).click()
      await expect(page.getByRole('button', { name: item.name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    }
    const decoded = await page.evaluate(async artwork => {
      return Promise.all(artwork.map(async item => {
        const image = new Image()
        image.src = `data:image/svg+xml;base64,${item.data}`
        await image.decode()
        return image.naturalWidth > 0 && image.naturalHeight > 0
      }))
    }, artwork)
    assert.ok(decoded.every(Boolean))
    await page.getByRole('searchbox').fill('')
    await page.screenshot({ path: path.join(artifacts, `source-icons-${theme}.png`), animations: 'disabled' })
    await page.setViewportSize({ width: 375, height: 850 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.setViewportSize({ width: 1440, height: 1000 })
    checks.push(`Source icon library ${theme}:1667 names,96per page, search/selection,20original SVGs decode and375px layout`)
  }
  return checks
}
