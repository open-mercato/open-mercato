import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkSourceNotices(page, render, artifacts) {
  const report = { checks: [], measurements: [] }
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    for (const [size, expectedHeight] of [['xs', 32], ['sm', 36], ['large', null]]) {
      await render(page, `primitives-feedback-alert--variant-source-${size}`, globals)
      const alerts = page.locator('[data-slot="alert"]')
      await expect(alerts).toHaveCount(20)
      const measurements = await alerts.evaluateAll(nodes => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d', { willReadFrequently: true })
        const rgba = color => {
          context.clearRect(0, 0, 1, 1)
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
          return [...context.getImageData(0, 0, 1, 1).data].map(value => value / 255)
        }
        const luminance = channels => channels.slice(0, 3).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
        return nodes.map(node => {
          const css = getComputedStyle(node)
          const foreground = rgba(css.color)
          const background = rgba(css.backgroundColor)
          const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b)
          return { status: node.dataset.status, appearance: node.dataset.style, height: node.offsetHeight, radius: css.borderRadius, contrast: (high + 0.05) / (low + 0.05), opaqueBackground: background[3] === 1 }
        })
      })
      measurements.forEach(item => {
        if (expectedHeight) assert.equal(item.height, expectedHeight)
        assert.equal(item.radius, size === 'large' ? '12px' : '8px')
        assert.ok(item.opaqueBackground, 'Contrast calculation expects an opaque notice background')
        assert.ok(item.contrast >= 4.5, `${theme}/${size}/${item.status}/${item.appearance}: ${item.contrast}`)
      })
      report.measurements.push({ theme, size, values: measurements })
      await alerts.first().locator('[data-slot="alert-dismiss"]').click()
      await expect(alerts).toHaveCount(19)
      await page.getByRole('button', { name: 'Restore examples', exact: true }).click()
      await expect(alerts).toHaveCount(20)
      await alerts.first().getByRole('button', { name: 'View details', exact: true }).click()
      await expect(page.getByRole('status')).toBeVisible()
      if (size === 'large') {
        await expect(alerts.locator('[data-slot="alert-footer"]')).toHaveCount(20)
        await page.screenshot({ path: path.join(artifacts, `source-alerts-${theme}.png`), fullPage: true, animations: 'disabled' })
      }
    }
    report.checks.push(`Alert ${theme}:60status/style/size combinations,32/36px rows,8/12px radii, all text contrast >=4.5, dismissal and footer actions`)

    for (const group of ['hr', 'finance']) {
      await render(page, `primitives-feedback-empty-state-illustration--variant-${group}`, globals)
      const illustrations = page.locator('[data-slot="empty-state-illustration"]')
      await expect(illustrations).toHaveCount(group === 'hr' ? 18 : 16)
      for (const artwork of await illustrations.all()) {
        await artwork.scrollIntoViewIfNeeded()
        await expect.poll(() => artwork.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true)
      }
    }
    report.checks.push(`Empty illustrations ${theme}:all34original source images decode correctly`)
  }
  fs.writeFileSync(path.join(artifacts, 'source-notices.json'), JSON.stringify(report, null, 2) + '\n')
  return report.checks
}
