import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { chromium, expect } from '@playwright/test'

const files = new Set(['index.html', 'tokens.css', 'components.css', 'screens.css', 'prototype.css', 'prototype.js', 'comments.js'])
let browser
let server
let baseUrl

before(async () => {
  server = createServer(async (request, response) => {
    const filename = basename(new URL(request.url, 'http://localhost').pathname) || 'index.html'
    if (!files.has(filename)) {
      response.writeHead(404).end()
      return
    }
    const contentType = filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : 'text/html'
    response.setHeader('Content-Type', contentType)
    response.end(await readFile(new URL(filename, import.meta.url)))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true })
})

after(async () => {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
})

async function withPage(run) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  try {
    await page.goto(baseUrl)
    await run(page)
  } finally {
    await page.close()
  }
}

test('phase-filtered Calendar navigation reveals the earlier Timeline destination', { timeout: 10000 }, () => withPage(async page => {
  await page.getByRole('tablist', { name: 'Phase filter' }).getByRole('button', { name: '2', exact: true }).click()
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: '18 Calendar', exact: true }).click()
  await page.locator('#s18').getByRole('button', { name: 'Timeline', exact: true }).click()
  await expect(page.locator('#s2')).toBeVisible({ timeout: 1000 })
  await expect(page.getByRole('tablist', { name: 'Phase filter' }).getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-selected', 'true')
}))

test('Presentation toolbar navigation changes the visible screen', { timeout: 10000 }, () => withPage(async page => {
  await page.getByRole('button', { name: 'Presentation', exact: true }).click()
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: '18 Calendar', exact: true }).click()
  await expect(page.locator('#s18')).toBeVisible({ timeout: 1000 })
  await expect(page.locator('#s1')).toBeHidden()
}))

test('Presentation starts in the selected phase and preserves visible destinations across phase changes and Back', { timeout: 10000 }, () => withPage(async page => {
  const phases = page.getByRole('tablist', { name: 'Phase filter' })
  await phases.getByRole('button', { name: '2', exact: true }).click()
  await page.getByRole('button', { name: 'Presentation', exact: true }).click()
  await expect(page.locator('#s16')).toBeVisible()
  await phases.getByRole('button', { name: '4', exact: true }).click()
  await expect(page.locator('#s23')).toBeVisible()
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: '24 Public page', exact: true }).click()
  await expect(page.locator('#s24')).toBeVisible()
  await phases.getByRole('button', { name: '1', exact: true }).click()
  await expect(page.locator('#s1')).toBeVisible()
  await page.getByRole('button', { name: '← Back', exact: true }).click()
  await expect(page.locator('#s24')).toBeVisible()
  await expect(phases.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-selected', 'true')
}))

test('keyboard sidebar navigation reveals earlier destinations in Clickable and Presentation', { timeout: 10000 }, () => withPage(async page => {
  for (const presentation of [false, true]) {
    if (presentation) await page.getByRole('button', { name: 'Presentation', exact: true }).click()
    await page.getByRole('tablist', { name: 'Phase filter' }).getByRole('button', { name: '4', exact: true }).click()
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: '23 Pages', exact: true }).click()
    const timeline = page.locator('#s23').getByRole('link', { name: 'Timeline', exact: true })
    await timeline.focus()
    await timeline.press('Enter')
    await expect(page.locator('#s2')).toBeVisible()
  }
}))

for (const [screenId, emptyText, loadedText] of [
  ['s12', 'No categories yet', 'Excavators'],
  ['s23', 'No booking pages yet', 'Check-ups'],
]) {
  test(`${screenId} distinguishes loading, empty and failed reads and can retry`, { timeout: 10000 }, () => withPage(async page => {
    const screen = page.locator(`#${screenId}`)
    const states = screen.getByRole('tablist')
    await states.getByRole('button', { name: 'Loading', exact: true }).click({ timeout: 1000 })
    await expect(screen.getByText('Loading data…', { exact: true })).toBeVisible()
    await expect(screen.getByRole('cell', { name: loadedText, exact: true })).toBeHidden()
    await states.getByRole('button', { name: 'Empty', exact: true }).click()
    await expect(screen.getByText(emptyText, { exact: true })).toBeVisible()
    await states.getByRole('button', { name: 'Failed to load', exact: true }).click()
    await screen.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(screen.getByRole('cell', { name: loadedText, exact: true })).toBeVisible()
    await expect(states.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-selected', 'true')
  }))
}
