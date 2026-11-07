import { expect, test, type Locator } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

async function waitForChart(chart: Locator) {
  let previous = ''
  let unchanged = 0
  await expect.poll(async () => {
    const paths = await chart.locator('.recharts-bar-rectangle path').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d')).join('|'))
    unchanged = paths && paths === previous ? unchanged + 1 : 0
    previous = paths
    return unchanged
  }, { intervals: [100, 200, 300, 500] }).toBeGreaterThanOrEqual(3)
}

test('dashboard, screen search and list filters work at desktop and mobile widths', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await login(page, 'superadmin')
  await page.goto('/backend/finance-preview#s1')
  await expect(page.getByTestId('finance-preview')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: 'Scenariusze', exact: true }).click()
  await expect(page.getByTestId('scenario-guide')).toBeVisible()
  await page.keyboard.press('Escape')
  const dashboard = page.getByTestId('finance-dashboard')
  await expect(dashboard).toBeVisible()
  await expect(
    dashboard.getByTestId('finance-dashboard-cashflow'),
  ).toHaveAttribute('data-months', '9')
  await dashboard
    .getByRole('combobox', { name: 'Zakres wykresu przepływów' })
    .click()
  await page
    .getByRole('option', { name: 'III kwartał 2026', exact: true })
    .click()
  await expect(
    dashboard.getByTestId('finance-dashboard-cashflow'),
  ).toHaveAttribute('data-months', '3')
  await dashboard
    .getByRole('button', {
      name: 'Pokaż szczegóły operacji: FS/2026/088',
      exact: true,
    })
    .click()
  const operation = page.getByRole('dialog')
  await expect(
    operation.getByText('FS/2026/088', { exact: true }),
  ).toBeVisible()
  await expect(operation.getByText(/\+8\s?400/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(operation).not.toBeVisible()
  await expect(dashboard.locator('img')).toHaveCount(3)
  for (const image of await dashboard.locator('img').all()) {
    await expect
      .poll(() =>
        image.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
      )
      .toBe(true)
  }
  await dashboard.getByRole('combobox', { name: 'Zakres wykresu przepływów' }).click()
  await page.getByRole('option', { name: '2026 do września', exact: true }).click()
  await expect(dashboard.locator('.recharts-bar-rectangle path')).toHaveCount(18)
  await expect.poll(async () => (await dashboard.locator('.recharts-bar-rectangle path').first().boundingBox())?.height ?? 0).toBeGreaterThan(20)
  await page.mouse.move(0, 0)
  await waitForChart(dashboard)
  await page.screenshot({
    path: test.info().outputPath('finance-dashboard-desktop.png'),
    fullPage: true,
  })
  await page
    .getByRole('button', { name: 'Wszystkie ekrany', exact: true })
    .click()
  await page
    .getByPlaceholder('Znajdź ekran lub zadanie…')
    .fill('Reguły alokacji')
  await page
    .getByRole('option', { name: 'Reguły alokacji', exact: true })
    .click()
  await expect(page).toHaveURL(/#s31$/)
  const financeNav = page.getByRole('navigation', {
    name: 'Finanse',
    exact: true,
  })
  await financeNav
    .getByRole('link', { name: 'Księga główna', exact: true })
    .click()
  await expect(page).toHaveURL(/#s2$/)
  const search = page.getByRole('searchbox', {
    name: 'Szukaj w tabeli',
    exact: true,
  })
  const filter = page.getByRole('combobox', {
    name: 'Wszystkie statusy',
    exact: true,
  })
  const searchBox = await search.locator('..').boundingBox()
  const filterBox = await filter.boundingBox()
  expect(Math.abs((searchBox?.y ?? 0) - (filterBox?.y ?? 100))).toBeLessThan(3)
  await filter.click()
  await page.getByRole('option', { name: 'Szkic', exact: true }).click()
  await expect(
    page.getByRole('cell', { name: 'Zaksięgowano', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('cell', { name: 'Szkic', exact: true }),
  ).toHaveCount(1)
  await page
    .getByRole('button', { name: 'Wyczyść filtry', exact: true })
    .click()
  await expect(
    page.getByRole('cell', { name: 'Zaksięgowano', exact: true }),
  ).toHaveCount(2)
  await page.screenshot({
    path: test.info().outputPath('finance-table-desktop.png'),
    fullPage: true,
  })
  await financeNav.getByRole('link', { name: 'Pulpit', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(dashboard).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true)
  await expect(dashboard.locator('.recharts-bar-rectangle path')).toHaveCount(18)
  await expect.poll(async () => (await dashboard.locator('.recharts-bar-rectangle path').first().boundingBox())?.height ?? 0).toBeGreaterThan(20)
  await waitForChart(dashboard)
  await page.screenshot({
    path: test.info().outputPath('finance-dashboard-mobile.png'),
    fullPage: true,
  })
})
