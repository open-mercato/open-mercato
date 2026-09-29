import assert from 'node:assert/strict'
import { expect } from '@playwright/test'

export async function checkSelectionFields(page, render) {
  const checks = []
  const fieldCases = [
    ['checkbox', 'default', 'left'],
    ['checkbox', 'flip', 'right'],
    ['radio', 'default', 'left'],
    ['radio', 'flip', 'right'],
    ['switch', 'default', 'right'],
    ['switch', 'flip', 'left'],
  ]
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    for (const [control, variant, side] of fieldCases) {
      await render(page, `primitives-inputs-${control}-field--variant-${variant}`, globals)
      const positions = await page.getByRole(control).first().evaluate(element => {
        const controlBounds = element.getBoundingClientRect()
        const label = element.parentElement.querySelector('label')
        const labelBounds = label.getBoundingClientRect()
        return { controlLeft: controlBounds.left, controlRight: controlBounds.right, labelLeft: labelBounds.left, labelRight: labelBounds.right }
      })
      assert.ok(side === 'right' ? positions.controlLeft >= positions.labelRight : positions.controlRight <= positions.labelLeft,
        `${control} ${variant} must render ${side} of its label in ${theme}: ${JSON.stringify(positions)}`)
    }
    checks.push(`Checkbox, Radio and Switch default/flip layouts have correct visual order in ${theme}`)

    for (const control of ['checkbox', 'radio', 'switch']) {
      await render(page, `primitives-inputs-${control}-field--variant-cards`, globals)
      const controls = page.getByRole(control)
      await expect(controls.nth(0)).toBeChecked()
      await expect(controls.nth(1)).not.toBeChecked()
      const bounds = await controls.nth(1).evaluate(element => {
        const card = element.parentElement.getBoundingClientRect()
        return { x: card.left + 20, y: card.bottom - 20 }
      })
      await page.mouse.click(bounds.x, bounds.y)
      await expect(controls.nth(1)).toBeChecked()
      if (control === 'radio') await expect(controls.nth(0)).not.toBeChecked()
      await controls.nth(1).focus()
      await controls.nth(1).press(control === 'radio' ? 'ArrowUp' : 'Space', { delay: 50 })
      await expect(controls.nth(1)).not.toBeChecked()
      if (control === 'radio') await expect(controls.nth(0)).toBeChecked()

      await render(page, `primitives-inputs-${control}-field--variant-cards-disabled`, globals)
      const disabled = page.getByRole(control)
      await expect(disabled.nth(0)).toBeDisabled()
      await expect(disabled.nth(1)).toBeDisabled()
      await expect(disabled.nth(0)).toBeChecked()
      await expect(disabled.nth(1)).not.toBeChecked()
      const disabledBounds = await disabled.nth(1).evaluate(element => {
        const card = element.parentElement.getBoundingClientRect()
        return { x: card.left + 20, y: card.bottom - 20 }
      })
      await page.mouse.click(disabledBounds.x, disabledBounds.y)
      await expect(disabled.nth(1)).not.toBeChecked()
    }
    checks.push(`Selection cards support full-card clicks, keyboard changes and disabled states in ${theme}`)
  }
  return checks
}
