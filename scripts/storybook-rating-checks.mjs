import assert from 'node:assert/strict'
import { expect } from '@playwright/test'

export async function checkRatings(page, render) {
  const checks = []
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    for (const variant of ['emoji', 'number', 'star', 'heart']) {
      await render(page, `primitives-feedback-rating-bar--variant-${variant}`, globals)
      const choices = page.getByRole('radio')
      await expect(choices).toHaveCount(5)
      await expect(page.getByRole('radio', { checked: true })).toHaveCount(0)
      await choices.nth(3).click()
      await expect(page.getByRole('radio', { checked: true })).toHaveCount(1)
      await choices.nth(3).press('ArrowLeft', { delay: 50 })
      await expect(choices.nth(2)).toBeChecked()
      await expect(choices.nth(2)).toBeFocused()
      if (variant === 'emoji') {
        const images = await page.locator('[data-slot="rating-bar"] img').evaluateAll(nodes => nodes.map(node => ({ complete: node.complete, width: node.naturalWidth })))
        assert.equal(images.length, 5)
        assert.ok(images.every(image => image.complete && image.width === 40), 'Every original Figma emoji must load locally')
      }
      await render(page, `primitives-feedback-rating-bar--variant-${variant}-selected`, globals)
      await expect(page.getByRole('radio').nth(3)).toBeChecked()
      await expect(page.getByRole('radio', { checked: true })).toHaveCount(1)
    }

    await render(page, 'primitives-feedback-rating-bar--variant-feedback-area', globals)
    await expect(page.getByRole('textbox')).toHaveCount(4)
    await page.getByRole('textbox').nth(0).fill('Delivery was easy to track.')
    await page.getByRole('radiogroup').first().getByRole('radio').nth(4).click()
    await expect(page.getByRole('textbox').nth(0)).toHaveValue('Delivery was easy to track.')
    await expect(page.getByRole('radiogroup').first().getByRole('radio').nth(4)).toBeChecked()

    await render(page, 'primitives-feedback-rating-bar--variant-disabled', globals)
    const disabled = page.getByRole('radio')
    await expect(disabled).toHaveCount(20)
    assert.ok((await disabled.evaluateAll(nodes => nodes.map(node => node.disabled))).every(Boolean))
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(4)

    await render(page, 'primitives-feedback-rating--variant-interactive', globals)
    const rating = page.getByRole('radio')
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1)
    await expect(rating.nth(2)).toBeChecked()
    await rating.nth(2).press('ArrowRight')
    await expect(rating.nth(3)).toBeChecked()
    await expect(rating.nth(3)).toBeFocused()
    await rating.nth(3).press('Home')
    await expect(rating.nth(0)).toBeFocused()
    await expect(rating.nth(0)).toBeChecked()
    await rating.nth(0).press('End')
    await expect(rating.nth(4)).toBeFocused()
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1)

    await render(page, 'primitives-feedback-rating--variant-interactive-half', globals)
    const halfChoice = page.getByRole('radio').nth(2)
    const bounds = await halfChoice.boundingBox()
    await page.mouse.click(bounds.x + bounds.width / 4, bounds.y + bounds.height / 2)
    await expect(halfChoice).toHaveAttribute('data-fill', 'half')
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1)
    await halfChoice.press('ArrowRight')
    await expect(halfChoice).toHaveAttribute('data-fill', 'full')

    await render(page, 'primitives-feedback-rating--variant-half-heart', globals)
    const glyphs = page.locator('[data-fill="half"] svg')
    await expect(glyphs).toHaveCount(2)
    const layers = await glyphs.evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, clip: getComputedStyle(node).clipPath })))
    assert.ok(layers.every(layer => layer.width === 20), 'Both layers of the half-heart must use the 20px source dimensions')
    assert.equal(layers[1].clip, 'inset(0px 50% 0px 0px)')
    checks.push(`Rating single selection, focus, half glyphs and all RatingBar states work in ${theme}`)
  }
  return checks
}
