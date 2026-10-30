import assert from 'node:assert/strict'
import { expect } from '@playwright/test'

export async function checkPasswordAndScroll(page, render) {
  const checks = []
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    for (const [strength, level] of [['empty', 0], ['weak', 1], ['moderate', 2], ['strong', 3]]) {
      await render(page, `primitives-inputs-password-strength--variant-${strength}`, globals)
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(level))
      await expect(page.locator('[data-slot="password-strength"] li[data-met="true"]')).toHaveCount(level)
      const bounds = await page.locator('[data-slot="password-strength"]').boundingBox()
      assert.equal(bounds.width, 300)
      assert.equal(bounds.height, 106)
    }
    await render(page, 'primitives-inputs-password-strength--variant-interactive', globals)
    const input = page.locator('input[type="password"]')
    for (const [password, level] of [['A', 1], ['A1', 2], ['A1234567', 3], ['', 0]]) {
      await input.fill(password)
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(level))
      await expect(page.locator('[data-slot="password-strength"] li[data-met="true"]')).toHaveCount(level)
    }
    checks.push(`All four PasswordStrength states, source dimensions and live requirements work in ${theme}`)

    for (const variant of ['default', 'lighter']) {
      for (const [size, width] of [['md', 20], ['sm', 16], ['xs', 12]]) {
        await render(page, `primitives-display-scroll-area--variant-${variant}-${size}`, globals)
        const track = page.locator('[data-slot="scroll-area-scrollbar"]')
        await expect(track).toBeVisible()
        const thumb = page.locator('[data-slot="scroll-area-thumb"]')
        assert.equal((await track.boundingBox()).width, width)
        assert.equal((await thumb.boundingBox()).width, 4)
        const viewport = page.locator('[data-slot="scroll-area-viewport"]')
        await viewport.hover()
        await page.mouse.wheel(0, 160)
        await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
        const thumbBounds = await thumb.boundingBox()
        await page.mouse.move(thumbBounds.x + 2, thumbBounds.y + thumbBounds.height / 2)
        await page.mouse.down()
        await page.mouse.move(thumbBounds.x + 2, thumbBounds.y + thumbBounds.height / 2 + 30, { steps: 5 })
        await page.mouse.up()
        await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(160)
      }
    }
    await render(page, 'primitives-display-scroll-area--variant-horizontal-figma', globals)
    const horizontalTrack = page.locator('[data-slot="scroll-area-scrollbar"]')
    await expect(horizontalTrack).toBeVisible()
    assert.equal((await horizontalTrack.boundingBox()).height, 20)
    assert.equal((await page.locator('[data-slot="scroll-area-thumb"]').boundingBox()).height, 4)
    const viewport = page.locator('[data-slot="scroll-area-viewport"]')
    await viewport.hover()
    await page.mouse.wheel(200, 0)
    await expect.poll(() => viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
    checks.push(`ScrollArea Default/Lighter tracks match 20/16/12px and 4px thumbs, with wheel/drag and horizontal scrolling in ${theme}`)
  }
  return checks
}
