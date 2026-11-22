import { expect, test } from '@playwright/test'
import { buildMyWorkBrowserFixture, mountMyWorkBrowserFixture } from './helpers/myWorkBrowserFixture'

let fixture: Awaited<ReturnType<typeof buildMyWorkBrowserFixture>>

test.beforeAll(async () => {
  fixture = await buildMyWorkBrowserFixture()
})

test('TC-STAFF-055: My work fits 390 px while Today’s entries scrolls within its card', async ({ page }) => {
  const { card, table, tableContainer } = await mountMyWorkBrowserFixture(page, fixture, 390)
  await expect(table.getByText('Review implementation', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)

  const geometry = await tableContainer.evaluate((element) => ({
    viewportWidth: element.clientWidth,
    contentWidth: element.scrollWidth,
  }))
  expect(geometry.contentWidth).toBeGreaterThan(geometry.viewportWidth)
  await tableContainer.scrollIntoViewIfNeeded()
  await tableContainer.evaluate((element) => { element.scrollLeft = element.scrollWidth })
  await expect.poll(() => tableContainer.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)

  const edit = table.getByRole('button', { name: 'Edit', exact: true })
  await expect(table.getByRole('columnheader', { name: 'Duration', exact: true })).toBeInViewport()
  await expect(edit).toBeInViewport()
  const cardBounds = await card.boundingBox()
  const editBounds = await edit.boundingBox()
  expect(cardBounds).not.toBeNull()
  expect(editBounds).not.toBeNull()
  expect(editBounds!.x).toBeGreaterThanOrEqual(cardBounds!.x)
  expect(editBounds!.x + editBounds!.width).toBeLessThanOrEqual(cardBounds!.x + cardBounds!.width)
  await expect.poll(() => page.evaluate(() => ({ width: document.documentElement.scrollWidth, left: window.scrollX })))
    .toEqual({ width: 390, left: 0 })

  await expect(card.getByRole('button', { name: 'Copy yesterday', exact: true })).toBeVisible()
  await expect(card.getByRole('link', { name: 'All entries', exact: true })).toHaveAttribute('href', '/backend/staff/time-tracking/entries')
  await expect(card.getByRole('combobox', { name: 'Project or task', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
})

for (const width of [767, 768]) {
  test(`TC-STAFF-055: My work table overflow at ${width} px`, async ({ page }) => {
    const { table, tableContainer } = await mountMyWorkBrowserFixture(page, fixture, width)
    await expect(table.getByText('Review implementation', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expect(tableContainer).toHaveCSS('overflow-x', width < 768 ? 'auto' : 'visible')
    await expect(tableContainer).toHaveCSS('overflow-y', width < 768 ? 'auto' : 'visible')
  })
}

test('TC-STAFF-055: the desktop table header remains sticky while the page scrolls', async ({ page }) => {
  const { table, tableContainer } = await mountMyWorkBrowserFixture(page, fixture, 1440, 24)
  await expect(table.getByText('Review implementation', { exact: true })).toHaveCount(24)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440)
  await expect(tableContainer).toHaveCSS('overflow-x', 'visible')
  await expect(tableContainer).toHaveCSS('overflow-y', 'visible')

  const tableTop = await table.evaluate((element) => element.getBoundingClientRect().top + window.scrollY)
  await page.evaluate((top) => { window.scrollTo(0, top + 80) }, tableTop)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(tableTop)
  await expect.poll(() => table.locator('thead').evaluate((element) => Math.abs(element.getBoundingClientRect().top)))
    .toBeLessThanOrEqual(1)
})
