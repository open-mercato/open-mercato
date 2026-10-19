import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkKeyComponents(page, render, artifacts) {
  const checks = []
  const geometry = []
  const contrast = []
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    await render(page, 'primitives-inputs-label--variant-normal', globals)
    const fieldLabel = page.locator('[data-slot="field-label"]')
    assert.equal((await fieldLabel.boundingBox()).height, 20)
    await page.locator('label').click()
    await expect(page.getByRole('textbox', { name: 'Label', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Help?', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Help?', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('textbox', { name: 'Label', exact: true })).toHaveAccessibleDescription('Enter a short label that helps your team identify this item.')
    assert.equal(await fieldLabel.locator('label button').count(), 0)
    await render(page, 'primitives-inputs-label--variant-disabled', globals)
    await expect(page.getByRole('textbox')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Help?', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Field information', exact: true })).toBeDisabled()
    await render(page, 'primitives-inputs-label--variant-form-field', globals)
    await expect(page.getByRole('textbox').first()).toBeEnabled()
    await expect(page.getByRole('textbox').last()).toBeDisabled()
    await expect(page.getByRole('textbox').last()).toHaveAccessibleDescription('This is a hint text to help user.')
    checks.push(`Field labels retain input association, keyboard help and native disabled controls in ${theme}`)

    for (const state of ['default', 'error', 'disabled', 'text-only']) {
      await render(page, `primitives-inputs-hint-text--variant-${state}`, globals)
      const hint = page.locator('[data-slot="hint-text"]')
      assert.equal((await hint.boundingBox()).height, 16)
      if (state === 'error') await expect(page.getByRole('alert')).toHaveText('This is a hint text to help user.')
      if (state === 'text-only') await expect(hint.locator('[aria-hidden="true"]')).toHaveCount(0)
    }
    checks.push(`All hint text states keep 16px geometry and correct error announcements in ${theme}`)

    for (const size of [40, 48]) {
      for (const kind of ['basic', 'icon', 'avatar', 'brand', 'company']) {
        await render(page, `primitives-display-content-label--variant-${kind}-${size}`, globals)
        const content = page.locator('[data-slot="content-label"]')
        const bounds = await content.boundingBox()
        assert.equal(bounds.width, 300, `${kind}/${size}`)
        assert.equal(bounds.height, size, `${kind}/${size}`)
        await expect(content.locator('[data-slot="content-label-leading"]')).toHaveCount(kind === 'basic' ? 0 : 1)
        assert.ok(await content.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)))
        geometry.push({ theme, component: 'content-label', kind, size, width: bounds.width, height: bounds.height })
      }
    }
    await render(page, 'primitives-display-content-label--variant-options', globals)
    await page.getByRole('checkbox', { name: 'Badge', exact: true }).check()
    await expect(page.locator('[data-slot="badge"]')).toHaveText('New')
    await page.getByRole('checkbox', { name: 'Toggle', exact: true }).check()
    await page.getByRole('switch', { name: 'Enabled', exact: true }).focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('switch')).toBeChecked()
    await expect(page.locator('output')).toHaveText('Enabled')
    await page.getByRole('checkbox', { name: 'Sublabel', exact: true }).uncheck()
    await expect(page.locator('[data-slot="content-label"]')).not.toContainText('(Sublabel)')
    checks.push(`All ten content labels have source geometry and functional optional slots in ${theme}`)

    for (const kind of ['basic', 'icon', 'avatar', 'provider', 'brand', 'company']) {
      await render(page, `primitives-display-content-card--variant-${kind}`, globals)
      const card = page.locator('[data-slot="content-card"]')
      const bounds = await card.boundingBox()
      assert.equal(bounds.width, 360)
      assert.equal(bounds.height, 72)
      assert.equal(await card.evaluate(node => getComputedStyle(node).borderRadius), '12px')
      assert.ok(await card.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)))
      geometry.push({ theme, component: 'content-card', kind, width: bounds.width, height: bounds.height })
      if (artifacts && kind === 'provider') await card.screenshot({ path: path.join(artifacts, `key-content-card-${theme}.png`) })
      await page.getByRole('button', { name: 'Dismiss content card', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(card).toHaveCount(0)
      await page.getByRole('button', { name: 'Restore card', exact: true }).click()
      await expect(card).toBeVisible()
    }
    await render(page, 'primitives-display-content-card--variant-disabled', globals)
    await expect(page.getByRole('button', { name: 'Dismiss content card', exact: true })).toBeDisabled()
    checks.push(`Six 360×72 content cards retain original assets, keyboard dismissal, restore and disabled behavior in ${theme}`)

    for (const appearance of ['stroke', 'lighter']) {
      await render(page, `primitives-display-key-icon--variant-${appearance}`, globals)
      const icons = page.locator('[data-slot="key-icon"]')
      await expect(icons).toHaveCount(45)
      const measures = await icons.evaluateAll(nodes => nodes.map(node => {
        const glyph = node.querySelector('[data-slot="key-icon-glyph"]')
        return { color: node.getAttribute('data-color'), size: Number(node.getAttribute('data-size')), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, glyph: glyph.getBoundingClientRect().width, mask: getComputedStyle(glyph.firstElementChild).maskImage }
      }))
      for (const item of measures) {
        assert.equal(item.width, item.size)
        assert.equal(item.height, item.size)
        assert.equal(item.glyph, item.size === 32 ? 20 : item.size / 2)
        assert.ok(item.mask.includes('data:image/svg+xml'))
      }
      geometry.push({ theme, component: 'key-icon', appearance, measurements: measures.map(({ mask, ...item }) => item) })
      const pairs = await icons.evaluateAll(nodes => {
        const context = document.createElement('canvas').getContext('2d')
        const rgba = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data) }
        const luminance = value => value.slice(0, 3).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
        const backdrop = node => {
          const layers = []
          for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) layers.unshift(rgba(getComputedStyle(ancestor).backgroundColor))
          return layers.reduce((base, layer) => base.map((channel, index) => channel * (1 - layer[3] / 255) + layer[index] * layer[3] / 255), [255, 255, 255])
        }
        return nodes.filter(node => node.getAttribute('data-size') === '40').map(node => {
          const style = getComputedStyle(node)
          const compositedBackground = backdrop(node)
          const values = [luminance(rgba(style.color)), luminance(compositedBackground)].sort((left, right) => left - right)
          return { color: node.getAttribute('data-color'), foreground: style.color, background: style.backgroundColor, compositedBackground, ratio: (values[1] + 0.05) / (values[0] + 0.05) }
        })
      })
      for (const pair of pairs) assert.ok(pair.ratio >= 3, `${theme}/${appearance}/${pair.color} glyph contrast ${pair.ratio}`)
      contrast.push({ theme, appearance, pairs })
      if (artifacts && appearance === 'lighter') await page.locator('.om-entry-stage').screenshot({ path: path.join(artifacts, `key-icons-${theme}.png`) })
    }
    await render(page, 'primitives-display-payment-icon--variant-categories', globals)
    await expect(page.locator('[data-slot="payment-icon"]')).toHaveCount(8)
    assert.ok(await page.locator('[data-slot="payment-icon"]').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().width === 40 && node.getBoundingClientRect().height === 40)))
    checks.push(`All 90 key icons and eight payment categories match sizes and named glyphs meet 3:1 contrast in ${theme}`)

    await render(page, 'primitives-display-chart-legend--variant-colors', globals)
    await expect(page.locator('[data-slot="chart-legend"]')).toHaveCount(12)
    assert.ok(await page.locator('[data-slot="chart-legend"]').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height === 16)))
    for (const size of [16, 20]) {
      await render(page, `primitives-display-chart-legend-dot--variant-size-${size}`, globals)
      const dots = page.locator('[data-slot="chart-legend-dot"]')
      await expect(dots).toHaveCount(11)
      assert.ok(await dots.evaluateAll((nodes, size) => nodes.every(node => node.getBoundingClientRect().width === size && node.firstElementChild.getBoundingClientRect().width === 12 && getComputedStyle(node.firstElementChild).borderWidth === '2px'), size))
    }
    await render(page, 'primitives-display-chart-legend--variant-interactive', globals)
    await expect(page.getByRole('listitem')).toHaveCount(11)
    await page.getByRole('button', { name: 'Blue', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('listitem')).toHaveCount(10)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('listitem')).toHaveCount(11)
    checks.push(`All 12 legends and 22 decorative dots retain source dimensions and keyboard series toggling in ${theme}`)
  }
  if (artifacts) fs.writeFileSync(path.join(artifacts, 'key-components-browser-validation.json'), JSON.stringify({ checks, geometry, contrast }, null, 2) + '\n')
  return checks
}
