import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { checkSelectionFields } from './storybook-field-checks.mjs'
import { checkPasswordAndScroll } from './storybook-password-scroll-checks.mjs'
import { checkRatings } from './storybook-rating-checks.mjs'
import { checkOverlayCompositions } from './storybook-overlay-checks.mjs'
import { checkFigmaLibrary } from './storybook-figma-checks.mjs'
import { checkSourceMenus } from './storybook-menu-checks.mjs'
import { checkSourceNotices } from './storybook-notice-checks.mjs'
import { checkFileUploads } from './storybook-upload-checks.mjs'
import { checkSourceControls } from './storybook-controls-checks.mjs'
import { checkNavigationMenus } from './storybook-navigation-menus-checks.mjs'
import { checkCompoundExamples } from './storybook-compound-checks.mjs'
import { checkSourceSelectionCards } from './storybook-selection-source-checks.mjs'
import { checkRatingCellsAndReviews } from './storybook-rating-cell-checks.mjs'
import { checkSourceRichEditor } from './storybook-rich-editor-checks.mjs'
import { checkShellCompositions } from './storybook-shell-checks.mjs'
import { checkSourceFilters } from './storybook-filter-checks.mjs'
import { checkSourceTextInputs } from './storybook-text-input-checks.mjs'
import { checkSourceIcons } from './storybook-source-icon-checks.mjs'
import { checkSourceLibraries } from './storybook-source-library-checks.mjs'

import { checkKeyComponents } from './storybook-key-components-checks.mjs'

import { checkHrWidgets } from './storybook-hr-widget-checks.mjs'

import { checkFinanceWidgets } from './storybook-finance-widget-checks.mjs'
import { checkAiProduct } from './storybook-ai-product-checks.mjs'
import { checkCryptocurrency } from './storybook-cryptocurrency-checks.mjs'
import { checkMarketingWidgets } from './storybook-marketing-checks.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const site = path.join(root, 'packages/ui/storybook-static')
const artifacts = path.join(root, 'tmp/storybook-validation')
const index = JSON.parse(fs.readFileSync(path.join(site, 'index.json'), 'utf8'))
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'packages/ui/.storybook/generated/catalogue.generated.json'), 'utf8'))
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const file = path.resolve(site, `.${name === '/' ? '/index.html' : name}`)
  if (!file.startsWith(site + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end('Not found')
    return
  }
  response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream')
  fs.createReadStream(file).pipe(response)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
fs.mkdirSync(artifacts, { recursive: true })
const browser = await chromium.launch({ headless: true })
const errors = []
const apiRequests = new Set()
const checked = []
const report = { catalogueEntries: catalogue.length, variants: catalogue.reduce((count, entry) => count + entry.variantCount, 0), checked, errors, interactions: [] }
function hasErrorBorder(node) {
  const probe = document.createElement('span')
  probe.style.color = 'var(--destructive)'
  document.body.appendChild(probe)
  const expected = getComputedStyle(probe).color
  probe.remove()
  return getComputedStyle(node.parentElement).borderColor === expected
}
async function render(page, id, globals = 'theme:light;font:application', args = '') {
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story&globals=${globals}&args=${encodeURIComponent(args)}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.body.classList.contains('sb-show-main') || document.body.classList.contains('sb-show-errordisplay'), { timeout: 15000 })
  if (await page.locator('body.sb-show-errordisplay').count()) throw new Error((await page.locator('body').innerText()).slice(0,1200))
  await page.locator('#storybook-root .om-story-surface').waitFor({ state: 'visible' })
}
try {
  for (const item of catalogue) assert.ok(index.entries[item.storyId], `Missing entry ${item.storyId}`)
  const stories = Object.values(index.entries).filter(entry => entry.type === 'story')
  let cursor = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    let current = ''
    page.on('pageerror', error => errors.push({ id: current, message: error.message }))
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.add(`${current}: ${request.url()}`) })
    while (cursor < stories.length) {
      const story = stories[cursor++]
      current = story.id
      try {
        await render(page, story.id)
        assert.ok(await page.locator('#storybook-root .om-story-surface').textContent(), 'Empty story')
        checked.push(story.id)
      } catch (error) { errors.push({ id: story.id, message: String(error) }) }
      if ((checked.length + errors.length) % 40 === 0) console.log(`Rendered ${checked.length}/${stories.length}; errors ${errors.length}`)
    }
    await page.close()
  }))
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push({ id: page.url(), message: error.message }))
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.add(request.url()) })
  const interactionChecks = [
    checkSelectionFields,
    checkFigmaLibrary,
    checkOverlayCompositions,
    checkRatings,
    checkPasswordAndScroll,
    checkFileUploads,
    checkSourceMenus,
    checkSourceNotices,
    checkCompoundExamples,
    checkSourceControls,
    checkNavigationMenus,
    checkSourceSelectionCards,
    checkRatingCellsAndReviews,
    checkSourceRichEditor,
    checkShellCompositions,
    checkSourceFilters,
    checkSourceTextInputs,
    checkSourceIcons,
    checkSourceLibraries,
    checkKeyComponents,
    checkHrWidgets,
    checkFinanceWidgets,
    checkAiProduct,
    checkCryptocurrency,
    checkMarketingWidgets,
  ]
  for (const check of interactionChecks) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    report.interactions.push(...await check(page, render, artifacts))
    console.log(`Passed ${check.name}`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await render(page, 'design-system-components--gallery')
  const search = page.getByRole('searchbox')
  await search.fill('button')
  await page.getByRole('link', { name: 'Button', exact: true }).waitFor()
  assert.ok(await page.locator('.om-catalogue-card').count() < catalogue.length)
  report.interactions.push('Catalogue search filters entries')
  await page.getByRole('link', { name: 'Button', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('path') === '/story/primitives-buttons-button--overview')
  await page.frameLocator('#storybook-preview-iframe').getByRole('heading', { name: 'Button', exact: true }).waitFor()
  report.interactions.push('Catalogue entry click opens the correct component inside the Storybook manager')
  await render(page, 'design-system-components--gallery')
  await page.getByRole('link', { name: 'Get started', exact: true }).click()
  await page.frameLocator('#storybook-preview-iframe').getByRole('heading', { name: /Build with Open Mercato/ }).waitFor()
  await page.frameLocator('#storybook-preview-iframe').getByRole('table').waitFor()
  report.interactions.push('Get started opens rendered documentation')
  await render(page, 'design-system-components--gallery')
  await search.fill('no-component-with-this-name')
  assert.equal(await page.locator('.om-catalogue-card').count(), 0)
  await search.fill('')
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'catalogue-light.png') })
  await page.getByRole('button', { name: 'Primitives', exact: true }).click()
  assert.ok(await page.locator('.om-catalogue-card').count() > 0)
  report.interactions.push('Category filter and empty search state')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'catalogue-mobile.png') })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile horizontal overflow')
  report.interactions.push('Mobile catalogue has no horizontal overflow')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await render(page, 'design-system-components--gallery', 'theme:dark;font:figma')
  assert.ok(await page.locator('html.dark').count())
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'catalogue-dark.png') })
  report.interactions.push('Dark theme and Figma typography selector')
  await render(page, 'playgrounds-button--playground')
  const button = page.getByRole('button', { name: 'Save changes', exact: true })
  assert.equal(await button.evaluate(node => node.getBoundingClientRect().height), 36)
  await page.keyboard.press('Tab')
  assert.ok(await button.evaluate(node => node === document.activeElement))
  await render(page, 'playgrounds-button--disabled')
  assert.ok(await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled())
  await render(page, 'playgrounds-button--keyboard-and-click')
  await page.getByRole('status').filter({ hasText: '2 selected' }).waitFor()
  report.interactions.push('Button size, disabled state and keyboard/click interaction')
  report.measurements = { button: [], input: [] }
  for (const [size, height] of [['2xs', 28], ['sm', 32], ['default', 36], ['lg', 40]]) {
    await render(page, 'playgrounds-button--playground', undefined, `size:${size}`)
    const dimensions = await page.getByRole('button', { name: 'Save changes', exact: true }).evaluate(node => ({ height: node.getBoundingClientRect().height, radius: getComputedStyle(node).borderRadius, fontSize: getComputedStyle(node).fontSize, lineHeight: getComputedStyle(node).lineHeight }))
    assert.equal(dimensions.height, height)
    report.measurements.button.push({ size, ...dimensions })
  }
  for (const [size, height] of [['sm', 32], ['default', 36], ['lg', 40]]) {
    await render(page, 'playgrounds-input--playground', undefined, `size:${size}`)
    const dimensions = await page.getByRole('textbox', { name: 'Customer name' }).evaluate(node => ({ height: node.parentElement.getBoundingClientRect().height, radius: getComputedStyle(node.parentElement).borderRadius, fontSize: getComputedStyle(node).fontSize, lineHeight: getComputedStyle(node).lineHeight }))
    assert.equal(dimensions.height, height)
    report.measurements.input.push({ size, ...dimensions })
  }
  report.interactions.push('All seven Button/Input heights match the inspected Figma sizes')
  for (const theme of ['light', 'dark']) {
    const globals = `theme:${theme};font:application`
    await render(page, 'playgrounds-input--playground', globals)
    const input = page.getByRole('textbox', { name: 'Customer name' })
    await input.fill('Acme')
    assert.equal(await input.inputValue(), 'Acme')
    const shadow = await input.evaluate(node => getComputedStyle(node.parentElement).boxShadow)
    assert.ok(shadow.includes('2px') && shadow.includes('4px'), `Missing input focus halo in ${theme}: ${shadow}`)
    await render(page, 'playgrounds-input--invalid', globals)
    const invalid = page.getByRole('textbox', { name: 'Customer name' })
    assert.equal(await invalid.getAttribute('aria-invalid'), 'true')
    assert.equal(await invalid.getAttribute('aria-describedby'), await page.getByRole('alert').getAttribute('id'))
    await expect.poll(() => invalid.evaluate(hasErrorBorder)).toBe(true)
    await render(page, 'playgrounds-input--read-only', globals)
    const readOnly = page.getByRole('textbox', { name: 'Customer name' })
    await readOnly.press('X')
    assert.equal(await readOnly.inputValue(), 'Open Mercato')
    assert.ok(await readOnly.evaluate(node => node.readOnly && node === document.activeElement))
    for (const story of ['input', 'searchinput', 'passwordinput']) {
      await render(page, `playgrounds-${story}--disabled`, globals)
      const disabled = page.locator('#storybook-root input')
      assert.ok(await disabled.isDisabled())
      const colors = await disabled.evaluate(node => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--text-disabled)'
        document.body.appendChild(probe)
        const expected = getComputedStyle(probe).color
        probe.remove()
        const field = node.closest('[data-slot="form-field"]')
        return { expected, text: getComputedStyle(node).color, placeholder: getComputedStyle(node, '::placeholder').color, icon: getComputedStyle(field.querySelector('svg')).color, hint: getComputedStyle(field.querySelector('p')).color, opacity: getComputedStyle(field).opacity }
      })
      for (const role of ['text', 'placeholder', 'icon', 'hint']) assert.equal(colors[role], colors.expected, `${story} ${theme} disabled ${role}`)
      assert.equal(colors.opacity, '1', 'Disabled tokens must not be dimmed again by FormField')
    }
    await page.screenshot({ animations: 'disabled', path: path.join(artifacts, `password-disabled-${theme}.png`) })
    await render(page, 'primitives-inputs-button-input--variant-copy-link', globals)
    const copyAction = page.getByRole('button', { name: 'Copy link' })
    const actionColor = await copyAction.locator('svg').evaluate(node => getComputedStyle(node).color)
    // ButtonInput forwards disabled only to the input. Isolate that DOM state to
    // ensure the shared wrapper CSS does not dim an independently enabled action.
    await page.locator('#storybook-root input').evaluate(node => { node.disabled = true })
    assert.ok(await copyAction.isEnabled())
    assert.equal(await copyAction.locator('svg').evaluate(node => getComputedStyle(node).color), actionColor)
    await render(page, 'playgrounds-searchinput--playground', globals)
    const searchInput = page.getByRole('searchbox', { name: 'Find a customer' })
    await searchInput.fill('Mercato')
    await page.keyboard.press('Tab')
    const clear = page.getByRole('button', { name: 'Clear search' })
    assert.ok(await clear.evaluate(node => node === document.activeElement))
    assert.ok((await clear.evaluate(node => getComputedStyle(node).boxShadow)).includes('4px'))
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('input[type="search"]')?.value === '')
    assert.equal(await clear.count(), 0)
    await render(page, 'playgrounds-passwordinput--playground', globals)
    const password = page.getByLabel('Password', { exact: true })
    await password.fill('Local-example')
    await page.keyboard.press('Tab')
    const reveal = page.getByRole('button', { name: 'Show password' })
    assert.ok(await reveal.evaluate(node => node === document.activeElement))
    assert.ok((await reveal.evaluate(node => getComputedStyle(node).boxShadow)).includes('4px'))
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Hide password' }).waitFor()
    assert.equal(await password.getAttribute('type'), 'text')
    assert.equal(await password.inputValue(), 'Local-example')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Show password' }).waitFor()
    assert.equal(await password.getAttribute('type'), 'password')
    report.interactions.push(`Input value/error/read-only/disabled and keyboard search/password actions in ${theme} mode`)
  }
  await page.goto(`${base}/?path=/story/playgrounds-input--playground`)
  const previewInput = page.frameLocator('#storybook-preview-iframe').getByRole('textbox', { name: 'Customer name' })
  const valueControl = page.getByRole('row', { name: /^value string/ }).getByRole('textbox')
  await previewInput.fill('Acme preview')
  await expect(valueControl).toHaveValue('Acme preview')
  await valueControl.fill('Updated in Controls')
  await expect(previewInput).toHaveValue('Updated in Controls')
  await page.getByRole('switch', { name: 'aria-invalid', exact: true }).press('Space')
  await page.frameLocator('#storybook-preview-iframe').getByRole('alert').waitFor()
  await expect.poll(() => previewInput.evaluate(hasErrorBorder)).toBe(true)
  assert.ok(await previewInput.evaluate(node => node.parentElement.getBoundingClientRect().width <= 512), 'Field playground should stay within its specimen width')
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'input-controls.png') })
  report.interactions.push('Manager Controls and preview synchronize in both directions, including error state')
  await page.getByRole('link', { name: 'Figma comparison', exact: true }).click()
  await page.frameLocator('#storybook-preview-iframe').getByRole('heading', { name: /Figma comparison/, level: 1 }).waitFor()
  await expect(page.frameLocator('#storybook-preview-iframe').getByRole('table')).toHaveCount(2)
  report.interactions.push('Figma comparison documentation renders measured tables and source-node references')
  const dialog = catalogue.find(entry => entry.id === 'dialog')
  if (dialog) {
    await render(page, dialog.storyId, 'theme:dark;font:application')
    await page.getByRole('button', { name: /open/i }).first().click()
    await page.getByRole('dialog').waitFor()
    assert.ok(await page.getByRole('dialog').evaluate(node => node.closest('html').classList.contains('dark')))
    await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'dialog-dark.png') })
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    report.interactions.push('Real dialog opens in dark mode and closes with Escape')
  }
  assert.equal(apiRequests.size, 0, `Unexpected tenant API requests: ${[...apiRequests].join(', ')}`)
  report.interactions.push('No tenant API requests during story rendering')
  if (errors.length) throw new Error(`${errors.length} story rendering errors`)
  console.log(`PASS: ${checked.length} stories; ${report.interactions.length} interaction checks`)
} catch (error) {
  report.failure = String(error)
  process.exitCode = 1
  console.error(error)
} finally {
  report.apiRequests = [...apiRequests]
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
