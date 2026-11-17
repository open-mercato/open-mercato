import { expect } from '@playwright/test'

export async function checkSourceTextInputs(page, render, artifacts, themes = ['light', 'dark']) {
  const measurements = []
  for (const theme of themes) {
    for (const size of [32, 36, 40]) {
      await render(page, `primitives-inputs-input--variant-source-${size}`, `theme:${theme}`)
      await expect(page.locator('[data-input-kind]')).toHaveCount(12)
      const metrics = await page.locator('[data-input-kind]').evaluateAll(elements => elements.map(element => {
        const input = element.querySelector('input')
        const wrapper = input.closest('[data-slot$="input-wrapper"]')
        return { kind: element.getAttribute('data-input-kind'), height: wrapper.getBoundingClientRect().height, radius: getComputedStyle(wrapper).borderRadius, fontSize: getComputedStyle(input).fontSize, lineHeight: getComputedStyle(input).lineHeight, icons: [...element.querySelectorAll('svg')].map(icon => icon.getBoundingClientRect().width) }
      }))
      for (const row of metrics) {
        expect(row.height, row.kind).toBe(size)
        expect(row.radius, row.kind).toBe(size === 40 ? '10px' : '8px')
        expect(row.fontSize, row.kind).toBe('14px')
        expect(row.lineHeight, row.kind).toBe('20px')
        for (const width of row.icons) expect(width, row.kind).toBe(20)
      }
      measurements.push({ theme, size, fields: metrics })
      await page.screenshot({ path: `${artifacts}/text-input-source${size}-${theme}.png`, fullPage: true })
    }
    const phone = page.locator('[data-input-kind="phone"]')
    await phone.getByRole('combobox', { name: 'Country code', exact: true }).click()
    await page.getByRole('option', { name: /Poland/ }).click()
    await expect(phone.getByRole('combobox')).toContainText('+48')
    await phone.getByRole('textbox').fill('123 456 789')
    await phone.getByRole('textbox').press('Tab')
    await expect(phone.locator('output')).toHaveText('+48 123 456 789')
    const emoji = page.locator('[data-input-kind="emoji"]')
    await emoji.getByRole('button', { name: 'Choose an emoji', exact: true }).click()
    await page.getByRole('button', { name: '🚀', exact: true }).click()
    await expect(emoji.getByRole('textbox')).toHaveValue('🙂🚀')
    const permission = page.locator('[data-input-kind="dropdown"]')
    await permission.getByRole('combobox', { name: 'Permission', exact: true }).click()
    await page.getByRole('option', { name: 'Can edit', exact: true }).click()
    await expect(permission.getByRole('combobox')).toContainText('Can edit')
    const search = page.locator('[data-input-kind="search"]')
    await search.getByRole('button', { name: 'Clear search', exact: true }).click()
    await expect(search.getByRole('searchbox')).toHaveValue('')
    const password = page.locator('[data-input-kind="password"]')
    await password.getByRole('button', { name: 'Show password', exact: true }).click()
    await expect(password.locator('input')).toHaveAttribute('type', 'text')
    const date = page.locator('[data-input-kind="date"] input')
    await date.fill('2026-10-12')
    await expect(date).toHaveValue('2026-10-12')
    await page.locator('[data-input-kind="button"]').getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.locator('[data-input-kind="button"] output')).toHaveText('The action was applied in this local example.')
    await render(page, 'primitives-inputs-input--variant-source-disabled', `theme:${theme}`)
    for (const field of await page.locator('[data-input-kind] input').all()) await expect(field).toBeDisabled()
    for (const control of await page.locator('[data-input-kind] button').all()) await expect(control).toBeDisabled()
    await page.screenshot({ path: `${artifacts}/text-input-disabled-${theme}.png`, fullPage: true })
    await render(page, 'primitives-inputs-textarea--variant-source-states', `theme:${theme}`)
    const textareas = page.getByRole('textbox')
    await expect(textareas).toHaveCount(4)
    for (const field of await textareas.all()) {
      const geometry = await field.evaluate(element => ({ height: element.getBoundingClientRect().height, radius: getComputedStyle(element).borderRadius, font: getComputedStyle(element).fontSize, lineHeight: getComputedStyle(element).lineHeight, resize: getComputedStyle(element).resize }))
      expect(geometry).toEqual({ height: 112, radius: '12px', font: '14px', lineHeight: '20px', resize: 'vertical' })
    }
    await textareas.first().fill('Draft note')
    await expect(page.locator('[data-slot="textarea-counter"]').first()).toHaveText('10/200')
    await expect(textareas.last()).toBeDisabled()
    const disabledText = await textareas.last().evaluate(element => ({ color: getComputedStyle(element).color, placeholder: getComputedStyle(element, '::placeholder').color }))
    expect(disabledText.color).toBe(disabledText.placeholder)
    await page.screenshot({ path: `${artifacts}/textarea-source-${theme}.png`, fullPage: true })
  }
  return measurements
}
