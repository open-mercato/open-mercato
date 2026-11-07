import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createReportContainmentFixtures } from './support/reportContainmentFixtures'

export const integrationMeta = { dependsOnModules: ['customers'] }

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }
const VIEWPORTS = [PHONE, DESKTOP, PHONE]

async function containment(page: Page, card: Locator) {
  const geometry = await card.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
      left: bounds.left, right: bounds.right, width: bounds.width,
    }
  })
  await test.info().attach(`containment-${page.viewportSize()?.width}`, { body: JSON.stringify(geometry), contentType: 'application/json' })
  expect(geometry.document, 'The report must not widen the document').toBeLessThanOrEqual(geometry.viewport + 1)
  expect(geometry.body, 'The report must not widen the body').toBeLessThanOrEqual(geometry.viewport + 1)
  expect(geometry.left, 'Card left edge stays in the viewport').toBeGreaterThanOrEqual(-1)
  expect(geometry.right, 'Card right edge stays in the viewport').toBeLessThanOrEqual(geometry.viewport + 1)
}

async function reachableColumns(page: Page, card: Locator) {
  const scrollport = card.getByTestId('report-locked-entries-scroll')
  const table = card.getByRole('table')
  await expect(table.getByRole('columnheader')).toHaveCount(6)
  await scrollport.evaluate((element) => { element.scrollLeft = 0 })
  await scrollport.hover()
  const measure = () => scrollport.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const headers = Array.from(element.querySelectorAll('thead th'))
    const cells = Array.from(element.querySelectorAll('tbody tr:first-child td'))
    return {
      left: element.scrollLeft, max: element.scrollWidth - element.clientWidth, width: element.clientWidth,
      columns: headers.map((header, index) => {
        const heading = header.getBoundingClientRect()
        const cell = cells[index]?.getBoundingClientRect()
        return { index, label: header.textContent, left: heading.left, right: heading.right,
          reachable: heading.left >= bounds.left - 1 && heading.right <= bounds.right + 1
            && Boolean(cell && cell.left >= bounds.left - 1 && cell.right <= bounds.right + 1) }
      }),
    }
  })
  const samples: Awaited<ReturnType<typeof measure>>[] = []
  const seen = new Set<number>()
  const record = async () => {
    const geometry = await measure()
    samples.push(geometry)
    for (const column of geometry.columns) if (column.reachable) seen.add(column.index)
    return geometry
  }
  const initial = await record()
  expect(initial.max, 'Phone table must scroll internally').toBeGreaterThan(100)
  for (let step = 0; step < 10; step += 1) {
    const before = await measure()
    await page.mouse.wheel(80, 0)
    await expect.poll(async () => (await measure()).left).toBeGreaterThan(before.left)
    const current = await record()
    if (current.left >= current.max - 1) break
  }
  expect((await measure()).left, 'Wheel reaches the last column').toBeGreaterThanOrEqual(initial.max - 1)
  expect([...seen].sort(), 'Every header and its first data cell is fully reachable').toEqual([0, 1, 2, 3, 4, 5])
  await scrollport.focus()
  await expect(scrollport, 'Native scrollport receives keyboard focus').toBeFocused()
  const keyboardSeen = new Set<number>()
  for (let step = 0; step < 30; step += 1) {
    const before = await record()
    for (const column of before.columns) if (column.reachable) keyboardSeen.add(column.index)
    if (before.left <= 1) break
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await measure()).left).toBeLessThan(before.left)
  }
  const atLeft = await record()
  for (const column of atLeft.columns) if (column.reachable) keyboardSeen.add(column.index)
  expect(atLeft.left, 'Keyboard reaches the first column').toBeLessThanOrEqual(1)
  expect([...keyboardSeen].sort(), 'Every column is also reachable by keyboard').toEqual([0, 1, 2, 3, 4, 5])
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await measure()).left).toBeGreaterThan(atLeft.left)
  await record()
  expect(await page.evaluate(() => scrollX), 'Scrolling stays inside the report card').toBe(0)
  await test.info().attach('column-reachability', { body: JSON.stringify(samples), contentType: 'application/json' })
}

async function feedbackClearance(page: Page, content: Locator, atBottom = false) {
  const feedback = page.getByRole('button', { name: 'Open feedback form', exact: true })
  const requireFeedback = process.env.OM_STAFF_REPORT_REQUIRE_FEEDBACK === '1'
  if (requireFeedback) await expect(page.locator('body')).toHaveAttribute('data-demo-feedback-fab', 'visible')
  if (await feedback.count() === 0) {
    expect(requireFeedback, 'Demo-required runs must render the real feedback CTA').toBe(false)
    test.info().annotations.push({ type: 'demo', description: 'Feedback CTA is disabled in this runtime; run with DEMO_MODE=true and OM_STAFF_REPORT_REQUIRE_FEEDBACK=1 for active-CTA coverage.' })
    return
  }
  await expect(feedback).toBeVisible()
  await content.evaluate((element, bottom) => element.scrollIntoView({ block: bottom ? 'end' : 'center' }), atBottom)
  if (atBottom) await page.evaluate(() => {
    document.querySelector('main')?.scrollTo(0, document.querySelector('main')?.scrollHeight ?? 0)
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  for (let sample = 0; sample < 4; sample += 1) {
    const cta = await feedback.boundingBox()
    const geometry = await content.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, hit: Boolean(hit && element.contains(hit)), height: innerHeight }
    })
    expect(cta).not.toBeNull()
    expect(geometry.top).toBeGreaterThanOrEqual(0)
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height)
    expect(geometry.hit, 'Content center is not covered by another surface').toBe(true)
    if (!cta) throw new Error('[internal] Feedback CTA bounds unavailable')
    const overlap = geometry.left < cta.x + cta.width && geometry.right > cta.x
      && geometry.top < cta.y + cta.height && geometry.bottom > cta.y
    expect(overlap, 'The active animated feedback CTA must not cover report totals/history').toBe(false)
    await test.info().attach(`feedback-clearance-${sample}`, { body: JSON.stringify({ content: geometry, cta }), contentType: 'application/json' })
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  }
}

test.describe('TC-TT-029: owned report containment across responsive states', () => {
  let api: APIRequestContext
  let fixtures: Awaited<ReturnType<typeof createReportContainmentFixtures>> | undefined

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: process.env.BASE_URL })
    fixtures = await createReportContainmentFixtures(api, await getAuthToken(api))
  })
  test.afterAll(async () => {
    try { if (fixtures) await fixtures.cleanup() } finally { await api?.dispose() }
  })
  test.beforeEach(async ({ page }) => {
    const baseUrl = process.env.BASE_URL
    if (!baseUrl) throw new Error('[internal] Repository runner BASE_URL is required')
    await page.context().addCookies([{ name: 'locale', value: 'en', url: baseUrl }])
    await login(page)
  })

  test('closed report retains six rows and totals; phone wheel/keyboard reaches every column', async ({ page }) => {
    if (!fixtures) throw new Error('[internal] Report fixtures unavailable')
    await page.setViewportSize(PHONE)
    await page.goto(`/backend/staff/time-tracking/reports/${fixtures.closedId}`)
    await expect(page.getByRole('heading', { name: fixtures.closedTitle, exact: true })).toBeVisible()
    const card = page.getByRole('heading', { name: 'Locked entries', exact: true }).locator('../..')
    const sheet = page.locator('section').filter({ has: page.getByText('Time and cost statement', { exact: true }) })
    for (const [viewportIndex, viewport] of VIEWPORTS.entries()) {
      await page.setViewportSize(viewport)
      await expect(card.locator('tbody tr')).toHaveCount(6)
      await expect(card).toContainText('6 entries · 6:00')
      for (let index = 0; index < 6; index += 1) {
        const row = card.locator('tbody tr').nth(index)
        await expect(row).toContainText(`2026-03-${10 + index}`)
        await expect(row).toContainText(fixtures.taskName)
        await expect(row).toContainText(fixtures.memberName)
        await expect(row).toContainText('€120.00')
      }
      await expect(sheet.locator('footer')).toContainText('€720.00')
      await containment(page, card)
      await containment(page, sheet)
      if (viewport.width === PHONE.width) await reachableColumns(page, card)
      await feedbackClearance(page, sheet.locator('footer'))
      const history = page.getByRole('heading', { name: 'History', exact: true }).locator('..').getByRole('listitem').last()
      await expect(history).toContainText('Closed the report and locked its entries.')
      await feedbackClearance(page, history, true)
      await page.screenshot({ path: test.info().outputPath(`closed-${viewport.width}-${viewportIndex}.png`), fullPage: true })
    }
  })

  for (const branch of ['draft', 'empty'] as const) {
    test(`${branch} report retains its content and total through phone-desktop-phone resize`, async ({ page }) => {
      if (!fixtures) throw new Error('[internal] Report fixtures unavailable')
      const reportId = branch === 'draft' ? fixtures.draftId : fixtures.emptyId
      await page.setViewportSize(PHONE)
      await page.goto(`/backend/staff/time-tracking/reports/${reportId}`)
      await expect(page.getByRole('button', { name: 'Close & lock', exact: true })).toBeVisible()
      const sheet = page.locator('section').filter({ has: page.getByText('Time and cost statement', { exact: true }) })
      for (const [viewportIndex, viewport] of VIEWPORTS.entries()) {
        await page.setViewportSize(viewport)
        await expect(page.getByRole('heading', { name: 'Locked entries', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Unlock entries', exact: true })).toHaveCount(0)
        await expect(sheet.locator('footer')).toContainText(branch === 'draft' ? '€120.00' : '€0.00')
        if (branch === 'draft') {
          await expect(sheet.locator('tbody tr')).toHaveCount(1)
          await expect(sheet).toContainText(fixtures.taskName)
          await expect(sheet.locator('footer')).toContainText('1:00 billable')
        } else {
          await expect(sheet.getByRole('table')).toHaveCount(0)
          await expect(sheet).toContainText('No time was logged in this period for the selected projects.')
        }
        await containment(page, sheet)
        await feedbackClearance(page, sheet.locator('footer'), true)
        await page.screenshot({ path: test.info().outputPath(`${branch}-${viewport.width}-${viewportIndex}.png`), fullPage: true })
      }
    })
  }
})
