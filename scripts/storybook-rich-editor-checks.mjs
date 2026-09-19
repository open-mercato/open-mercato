import { expect } from '@playwright/test'

const expectedLayouts = {
  '01': ['Header', 'Font size', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Align', 'Add comment', 'Link', 'Mention', 'More'],
  '02': ['Header', 'Font size', 'More'],
  '03': ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Align', 'More'],
  '04': ['Add comment', 'Link', 'Mention', 'More'],
}

export async function checkSourceRichEditor(page, render, artifacts, themes = ['light', 'dark']) {
  const results = []
  for (const theme of themes) {
    for (const [design, labels] of Object.entries(expectedLayouts)) {
      await render(page, `primitives-inputs-rich-editor--variant-source-${design}`, `theme:${theme}`)
      const toolbar = page.getByRole('toolbar')
      await expect(toolbar.getByRole('button')).toHaveCount(labels.length)
      const metrics = await toolbar.evaluate(element => ({
        height: element.getBoundingClientRect().height,
        width: element.getBoundingClientRect().width,
        buttons: [...element.querySelectorAll('button')].map(button => ({
          label: button.getAttribute('aria-label'),
          height: button.getBoundingClientRect().height,
          radius: getComputedStyle(button).borderRadius,
          icons: [...button.querySelectorAll('svg')].map(icon => icon.getBoundingClientRect().width),
        })),
      }))
      expect(metrics.height).toBe(32)
      expect(metrics.buttons.map(button => button.label)).toEqual(labels)
      for (const button of metrics.buttons) {
        expect(button.height).toBe(28)
        expect(button.radius).toBe('6px')
        for (const icon of button.icons) expect(icon).toBe(20)
      }
      await page.screenshot({ path: `${artifacts}/rich-editor-source${design}-${theme}.png` })
      await toolbar.getByRole('button', { name: 'More', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Numbered list', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      results.push({ theme, design, ...metrics })
    }
    await render(page, 'primitives-inputs-rich-editor--variant-source-02', `theme:${theme}`)
    const content = page.getByRole('textbox')
    await content.fill('Release notes')
    await content.press('ControlOrMeta+A')
    await content.press('ControlOrMeta+B')
    await page.getByRole('button', { name: 'Font size', exact: true }).click()
    await page.getByRole('menuitem', { name: '20px', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Font size', exact: true })).toContainText('20px')
    await expect(content).toContainText('Release notes')
    const format = await content.locator('span').evaluateAll(elements => elements.map(element => ({ fontSize: getComputedStyle(element).fontSize, weight: getComputedStyle(element).fontWeight })))
    expect(format.some(item => item.fontSize === '20px' && Number(item.weight) >= 600)).toBe(true)
    await page.keyboard.press('Escape')
    await render(page, 'primitives-inputs-rich-editor--variant-counter', `theme:${theme}`)
    await page.getByRole('textbox').fill('Draft text')
    await expect(page.locator('[data-slot="rich-editor-counter"]')).toHaveText('10/100')
    await render(page, 'primitives-inputs-rich-editor--variant-palette', `theme:${theme}`)
    await expect(page.getByRole('option')).toHaveCount(12)
    await page.getByRole('option', { name: 'Black', exact: true }).click()
    await expect(page.getByRole('option', { name: 'Black', exact: true })).toHaveAttribute('aria-selected', 'true')
    await render(page, 'primitives-inputs-rich-editor--variant-disabled', `theme:${theme}`)
    for (const button of await page.getByRole('toolbar').getByRole('button').all()) await expect(button).toBeDisabled()
    await render(page, 'primitives-inputs-rich-editor--variant-source-01', `theme:${theme}`)
    await page.setViewportSize({ width: 320, height: 900 })
    await expect.poll(() => page.getByRole('toolbar').getByRole('button').count()).toBeLessThan(11)
    await page.getByRole('toolbar').getByRole('button', { name: 'More', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Mention', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1280, height: 1000 })
    await expect(page.getByRole('toolbar').getByRole('button')).toHaveCount(11)
  }
  return results
}
