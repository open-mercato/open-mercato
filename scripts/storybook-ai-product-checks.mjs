import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'

export async function checkAiProduct(page, render, artifacts) {
  const checks = []
  const geometry = []
  const contrast = []
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    const show = async id => {
      await render(page, `primitives-navigation-${id}`, globals)
      await page.locator('.om-entry-stage').evaluate(node => { for (const animation of node.getAnimations({ subtree: true })) if (animation.effect?.getTiming().iterations !== Infinity) animation.finish() })
    }
    for (const [variant, width, height, radius] of [['desktop', 700, 146, 20], ['desktop-file', 700, 203, 20], ['desktop-image', 700, 239, 20], ['mobile', 374, 114, 18], ['mobile-file', 374, 184, 18], ['mobile-image', 374, 220, 18]]) {
      await show(`prompt-area--variant-${variant}`)
      const prompt = page.locator('[data-slot="prompt-area"]')
      const measure = await prompt.evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, radius: parseFloat(getComputedStyle(node).borderRadius), font: getComputedStyle(node.querySelector('textarea')).fontSize }))
      assert.deepEqual([measure.width, measure.height, measure.radius], [width, height, radius], `${theme}/${variant}`)
      assert.equal(measure.font, variant.startsWith('mobile') ? '14px' : '15px')
      await expect(page.getByRole('button', { name: 'Save local draft', exact: true })).toBeDisabled()
      assert.ok(await prompt.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)))
      geometry.push({ theme, component: 'prompt-area', variant, ...measure })
      if (artifacts && variant === 'desktop-image') await prompt.screenshot({ path: path.join(artifacts, `ai-prompt-${theme}.png`), animations: 'disabled' })
      if (variant.includes('-')) {
        await page.getByRole('button', { name: /^Remove / }).focus()
        await page.keyboard.press('Enter')
        await expect(page.locator('[data-slot="prompt-area-attachments"]')).toHaveCount(0)
        assert.equal((await prompt.boundingBox()).height, variant.startsWith('mobile') ? 114 : 146)
      }
    }
    checks.push(`All six PromptArea compositions match source geometry and remove local attachments with the keyboard in ${theme}`)

    await show('prompt-area--variant-desktop')
    const promptInput = page.getByRole('textbox', { name: 'Message', exact: true })
    await promptInput.fill('First line')
    await promptInput.press('Shift+Enter')
    await promptInput.pressSequentially('Second line')
    assert.equal((await promptInput.boundingBox()).height, 48)
    await expect(page.locator('output')).toHaveCount(0)
    await promptInput.press('Enter')
    await expect(page.locator('output')).toHaveText('Saved draft: GPT-4: First line\nSecond line')
    await expect(promptInput).toHaveValue('')
    await page.locator('[data-slot="ai-model-select"]').click()
    await page.getByRole('option', { name: 'GPT-3.5', exact: true }).click()
    await promptInput.fill('Changed model label')
    await page.getByRole('button', { name: 'Save local draft', exact: true }).click()
    await expect(page.locator('output')).toHaveText('Saved draft: GPT-3.5: Changed model label')
    await page.locator('input[type="file"]').setInputFiles({ name: 'local-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Local example only') })
    await expect(page.locator('[data-slot="prompt-area-attachments"]')).toContainText('local-note.txt')
    await page.getByRole('button', { name: 'Remove local-note.txt', exact: true }).click()
    await expect(page.locator('[data-slot="prompt-area-attachments"]')).toHaveCount(0)
    checks.push(`Prompt Enter/Shift+Enter, autosize, model selection and actual local attachment input work in ${theme}`)

    await show('ai-controls--variant-icon-buttons')
    const icons = page.locator('[data-slot="ai-icon-button"]')
    await expect(icons).toHaveCount(8)
    const sizes = await icons.evaluateAll(nodes => nodes.map(node => ({ size: Number(node.dataset.size), tone: node.dataset.tone, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, glyph: node.querySelector('svg').getBoundingClientRect().width })))
    for (const item of sizes) assert.deepEqual([item.width, item.height, item.glyph], [item.size, item.size, item.size === 24 ? 18 : 20])
    geometry.push({ theme, component: 'ai-icon-buttons', measurements: sizes })
    await icons.first().focus()
    await page.keyboard.press('Space')
    await expect(icons.first()).toHaveAttribute('aria-pressed', 'true')
    const pairs = await icons.evaluateAll(nodes => {
      const context = document.createElement('canvas').getContext('2d')
      const rgba = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data) }
      const luminance = value => value.slice(0, 3).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
      return nodes.map(node => {
        const layers = []
        for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) layers.unshift(rgba(getComputedStyle(ancestor).backgroundColor))
        const background = layers.reduce((base, layer) => base.map((channel, index) => channel * (1 - layer[3] / 255) + layer[index] * layer[3] / 255), [255, 255, 255])
        const values = [luminance(rgba(getComputedStyle(node).color)), luminance(background)].sort((left, right) => left - right)
        return { size: node.dataset.size, tone: node.dataset.tone, ratio: (values[1] + 0.05) / (values[0] + 0.05) }
      })
    })
    for (const pair of pairs) assert.ok(pair.ratio >= 3, `${theme}/${pair.tone} glyph contrast ${pair.ratio}`)
    contrast.push({ theme, pairs })
    await show('ai-controls--variant-chat-buttons')
    assert.ok(await page.locator('[data-slot="ai-icon-button"]').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().width === 28 && getComputedStyle(node).borderRadius === '9px')))
    await show('ai-controls--variant-search')
    const searches = page.getByRole('searchbox')
    await expect(searches).toHaveCount(2)
    await searches.first().fill('Project')
    await expect(searches.last()).toHaveValue('Project')
    await show('ai-controls--variant-navigation-items')
    const items = page.locator('[data-slot="ai-nav-item"]')
    await expect(items).toHaveCount(4)
    assert.ok(await items.evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().width === 244 && node.getBoundingClientRect().height === 32)))
    await items.first().click()
    await expect(items.first()).toHaveAttribute('aria-current', 'page')
    await show('ai-controls--variant-new-chat')
    await page.getByRole('button', { name: 'New chat', exact: true }).click()
    await expect(page.locator('output')).toHaveText('Local drafts: 1')
    checks.push(`All custom control size, tone, style and navigation axes have native interactions and adequate glyph contrast in ${theme}`)

    await show('ai-controls--variant-auth-icons')
    const artwork = page.locator('.om-entry-stage img')
    await expect(artwork).toHaveCount(8)
    assert.ok(await artwork.evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width === 32 && image.parentElement.getBoundingClientRect().width === 56)))
    await show('ai-controls--variant-social-google')
    await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click()
    await expect(page.locator('output')).toContainText('Local example.')
    await show('ai-controls--variant-text-input')
    const emails = page.getByRole('textbox', { name: 'Email address', exact: true })
    await expect(emails.last()).toBeDisabled()
    await emails.first().fill('local@example.com')
    await expect(emails.first()).toHaveValue('local@example.com')
    assert.ok(await page.locator('[data-slot="ai-text-input"]').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height === 88 && node.getBoundingClientRect().width === 332)))
    await show('ai-controls--variant-digit-input')
    const cells = page.locator('input')
    await expect(cells).toHaveCount(8)
    assert.ok(await cells.evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().width === 48 && node.getBoundingClientRect().height === 48 && getComputedStyle(node).borderRadius === '12px')))
    await cells.first().fill('5')
    await expect(cells.nth(1)).toBeFocused()
    await expect(cells.last()).toBeDisabled()
    await show('ai-controls--variant-settings')
    await page.getByRole('button', { name: 'Increase history limit', exact: true }).click()
    await expect(page.getByRole('spinbutton')).toHaveValue('31')
    await page.getByRole('button', { name: 'James Brown', exact: true }).click()
    await expect(page.getByRole('button', { name: 'James Brown', exact: true })).toHaveAttribute('aria-pressed', 'true')
    geometry.push({ theme, component: 'ai-settings', measurements: await page.locator('[data-slot="ai-size-select"], [data-slot="counter-input"], [data-slot="ai-model-select"]').evaluateAll(nodes => nodes.map(node => ({ slot: node.dataset.slot, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }))) })
    checks.push(`Authentication artwork, real text/digit states and controlled settings remain functional in ${theme}`)

    for (const variant of ['search-01', 'search-02', 'search-03', 'collapsed']) {
      await show(`ai-sidebar--variant-${variant}`)
      const sidebar = page.locator('[data-slot="sidebar"]')
      const bounds = await sidebar.boundingBox()
      assert.deepEqual([bounds.width, bounds.height], [variant === 'collapsed' ? 72 : 272, 900])
      geometry.push({ theme, component: 'ai-sidebar', variant, width: bounds.width, height: bounds.height })
      if (variant === 'collapsed') {
        await page.getByRole('button', { name: 'Expand sidebar', exact: true }).focus()
        await page.keyboard.press('Enter')
        await expect(sidebar).toHaveAttribute('data-collapsed', 'false')
      } else {
        if (variant !== 'search-01') await page.getByRole('button', { name: 'Search', exact: true }).click()
        await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('Quarterly')
        await expect(sidebar.getByRole('button', { name: 'Quarterly report', exact: true })).toBeVisible()
        await expect(sidebar.getByRole('button', { name: 'Meeting notes', exact: true })).toHaveCount(0)
        if (variant !== 'search-01') await page.keyboard.press('Escape')
        await sidebar.getByRole('button', { name: 'Quarterly report', exact: true }).click()
        await expect(page.locator('output')).toContainText('Selected: Quarterly report')
        await sidebar.getByRole('button', { name: 'New chat', exact: true }).click()
        await expect(page.locator('output')).toContainText('Local drafts: 1')
      }
    }
    await show('ai-sidebar--variant-search-01')
    if (artifacts) await page.locator('[data-slot="sidebar"]').screenshot({ path: path.join(artifacts, `ai-sidebar-${theme}.png`), animations: 'disabled' })
    checks.push(`All four sidebars match source sizes and support filtering, navigation, drafts and expansion in ${theme}`)

    for (const kind of ['default', 'in-projects', 'projects', 'project-details']) {
      await show(`ai-mobile-navigation--variant-${kind}`)
      const header = page.locator('[data-slot="ai-mobile-navigation"]')
      const bounds = await header.boundingBox()
      assert.deepEqual([bounds.width, bounds.height], [390, 64])
      geometry.push({ theme, component: 'ai-mobile-navigation', kind, width: bounds.width, height: bounds.height })
      if (kind === 'projects') {
        await page.getByRole('button', { name: 'Add project', exact: true }).click()
        await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Local roadmap')
        await page.keyboard.press('Control+Enter')
        await expect(page.locator('output')).toContainText('Created local project: Local roadmap')
      } else {
        await page.getByRole('button', { name: 'New chat', exact: true }).click()
        await expect(page.locator('output')).toContainText('Local drafts: 1')
        await page.getByRole('button', { name: 'More actions', exact: true }).click()
        await page.getByRole('checkbox', { name: 'Pin project', exact: true }).check()
        await page.keyboard.press('Escape')
        await expect(page.locator('output')).toContainText('Pin project')
      }
    }
    checks.push(`All four mobile headers retain source geometry and local project creation, drafts and pinning in ${theme}`)
  }
  if (artifacts) fs.writeFileSync(path.join(artifacts, 'ai-product-browser-validation.json'), JSON.stringify({ checks, geometry, contrast }, null, 2) + '\n')
  return checks
}
