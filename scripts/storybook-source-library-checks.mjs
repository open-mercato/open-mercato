import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkSourceLibraries(page, render, artifacts) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const artwork = JSON.parse(fs.readFileSync(new URL('../packages/ui/src/assets/source-artwork.json', import.meta.url)))
  const checks = []
  for (const theme of ['light', 'dark']) {
    for (const [variant, group, count] of [['brands', 'brand', 439], ['flags', 'country-flags', 263], ['emoji', 'emojies', 607], ['store-badges', 'appstore-badges', 16], ['cursors', 'others', 10]]) {
      await render(page, `foundations-icons-source-artwork--variant-${variant}`, `theme:${theme};font:application`)
      const root = page.locator('[data-example="source-artwork-catalogue"]')
      await expect(root.getByRole('status').first()).toHaveText(`${count} of ${count} assets`)
      await expect(root.locator('button[aria-pressed]')).toHaveCount(Math.min(count, 96))
      const rows = artwork.filter(item => item.group === group)
      assert.equal(rows.length, count)
      const decoded = await page.evaluate(async rows => Promise.all(rows.map(async row => {
        const image = new Image()
        image.src = `data:image/png;base64,${row.data}`
        await image.decode()
        return image.naturalWidth > 0 && image.naturalHeight > 0
      })), rows)
      assert.ok(decoded.every(Boolean))
      if (count > 96) {
        await root.getByRole('button', { name: 'Next page', exact: true }).click()
        await expect(root.getByRole('button', { name: 'Page 2, current page', exact: true })).toHaveAttribute('aria-current', 'page')
      }
      const sample = rows.at(-1)
      await root.getByRole('searchbox').fill(sample.name)
      const sampleButton = root.locator(`button[data-source-node="${sample.id}"]`)
      await sampleButton.click()
      await expect(sampleButton).toHaveAttribute('aria-pressed', 'true')
      await root.getByRole('button', { name: 'Copy JSX', exact: true }).click()
      await expect(root.getByRole('status').last()).toHaveText('JSX copied')
      const snippet = await page.evaluate(() => navigator.clipboard.readText())
      assert.ok(snippet.includes(`loadSourceArtwork('${group}')`))
      assert.ok(snippet.includes(`item.id === '${sample.id}'`))
      await root.getByRole('searchbox').fill('no-source-artwork-matches-this')
      await expect(root.getByRole('status').first()).toHaveText(`0 of ${count} assets`)
      await expect(root.locator('button[aria-pressed]')).toHaveCount(0)
      await root.getByRole('searchbox').fill('')
      await page.setViewportSize({ width: 375, height: 850 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Artwork ${group} overflow in ${theme}`)
      await page.screenshot({ path: path.join(artifacts, `source-artwork-${group}-${theme}.png`), animations: 'disabled' })
      await page.setViewportSize({ width: 1440, height: 1000 })
      checks.push(`${group} ${theme}: ${count} original PNGs decoded; pagination, search, exact source selection, clipboard, empty and 375px layout`)
    }
    await render(page, 'foundations-foundations-source-library--variant-inventory', `theme:${theme};font:application`)
    const library = page.locator('[data-example="native-source-library"]')
    await expect(library.getByRole('status')).toHaveText('60 of 60 source pages')
    await expect(library.locator('details')).toHaveCount(12)
    await library.getByRole('button', { name: 'Next page', exact: true }).click()
    await expect(library.getByRole('button', { name: 'Page 2, current page', exact: true })).toHaveAttribute('aria-current', 'page')
    await library.getByRole('searchbox').fill('Cryptocurrency')
    await expect(library.locator('details')).toHaveCount(1)
    await library.locator('summary').click()
    await expect(library.getByRole('link', { name: 'Cryptocurrency', exact: true })).toHaveAttribute('href', '/backend/design-system?family=scaffolding&entry=cryptocurrency')
    await page.setViewportSize({ width: 375, height: 850 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: path.join(artifacts, `native-source-library-${theme}.png`), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    checks.push(`Native source library ${theme}: 60 pages, paginated search, source axes, and native related-example link`)
  }
  return checks
}
