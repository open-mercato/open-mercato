import assert from 'node:assert/strict'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkRatingCellsAndReviews(page, render, artifacts) {
  const checks = []
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    for (const icon of ['star', 'heart']) {
      for (const state of ['default', 'selected']) {
        await render(page, `primitives-feedback-rating--variant-cell-${icon}-${state}`, globals)
        const choice = page.getByRole('radio')
        const bounds = await choice.boundingBox()
        assert.equal(bounds.width, 56)
        assert.equal(bounds.height, 56)
        assert.equal(await choice.evaluate(node => getComputedStyle(node).borderRadius), '10px')
        assert.equal((await choice.locator('svg').boundingBox()).width, 32)
        await expect(choice).toHaveAttribute('aria-checked', String(state === 'selected'))
        const fill = await choice.locator('svg').evaluate(node => getComputedStyle(node).fill)
        const background = await choice.evaluate(node => getComputedStyle(node).backgroundColor)
        await choice.hover()
        await expect.poll(() => choice.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(background)
        if (state === 'default') await expect.poll(() => choice.locator('svg').evaluate(node => getComputedStyle(node).fill)).not.toBe(fill)
        await choice.click()
        await expect(choice).toBeChecked()
        if (artifacts && state === 'default') await page.screenshot({ animations: 'disabled', path: path.join(artifacts, `rating-cell-${icon}-${theme}.png`) })
      }
      for (const alignment of ['vertical', 'horizontal']) {
        await render(page, `primitives-feedback-rating--variant-review-${icon}-${alignment}`, globals)
        const summary = page.locator('[data-slot="rating-review"]')
        assert.equal((await summary.boundingBox()).height, alignment === 'vertical' ? 48 : 20)
        const rating = summary.locator('[data-slot="rating"]')
        assert.equal((await rating.boundingBox()).width, 108)
        assert.equal((await rating.boundingBox()).height, 20)
        await expect(summary).toContainText('4.5 ∙ 5.2K Ratings')
        const reviews = summary.getByRole('button', { name: '18 reviews' })
        if (artifacts) await page.screenshot({ animations: 'disabled', path: path.join(artifacts, `rating-review-${icon}-${alignment}-${theme}.png`) })
        await reviews.focus()
        await page.keyboard.press('Enter')
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await expect(dialog.getByRole('listitem')).toHaveCount(18)
        const viewport = dialog.locator('[data-radix-scroll-area-viewport]')
        assert.ok(await viewport.evaluate(node => node.scrollHeight > node.clientHeight))
        await viewport.hover()
        await page.mouse.wheel(0, 300)
        await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(reviews).toBeFocused()
        await reviews.click()
        await page.keyboard.press('Control+Enter')
        await expect(dialog).toHaveCount(0)
      }
    }
    await render(page, 'primitives-feedback-rating--variant-cells-interactive', globals)
    const choices = page.getByRole('radio')
    await choices.nth(2).press('ArrowRight')
    await expect(choices.nth(3)).toBeFocused()
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1)
    await expect(choices.nth(3)).toBeChecked()
    await choices.nth(3).press('Home')
    await expect(choices.nth(0)).toBeChecked()
    await choices.nth(0).press('End')
    await expect(choices.nth(4)).toBeChecked()
    await render(page, 'primitives-feedback-rating--variant-cells-disabled', globals)
    assert.ok((await page.getByRole('radio').evaluateAll(nodes => nodes.map(node => node.disabled))).every(Boolean))
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1)
    checks.push(`Rating cells retain 56px shells, 32px glyphs, hover/selected/disabled states and keyboard focus in ${theme}; all four review summaries open an accessible scrollable local review dialog`)
  }
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  for (const variant of ['cells-interactive', 'review-heart-horizontal']) {
    await render(page, `primitives-feedback-rating--variant-${variant}`, 'theme:light;font:application')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  if (viewport) await page.setViewportSize(viewport)
  checks.push('Rating cells and review summaries fit a 390px mobile viewport')
  return checks
}
