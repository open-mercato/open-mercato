import { expect, test, type APIRequestContext, type Locator, type Page, type Response } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrderLineFixture, createSalesOrderFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type DashboardSize = 'sm' | 'md' | 'lg' | 'full'

type DashboardLayoutItem = {
  id: string
  widgetId: string
  order: number
  priority?: number
  size?: DashboardSize
  settings?: Record<string, unknown> | null
}

type DashboardLayoutPreferences = {
  dateRange?: {
    preset: 'last_30_days' | 'custom'
    from?: string
    to?: string
    compare: 'previous_period' | 'previous_year' | 'none'
  }
}

type DashboardLayoutState = {
  layout?: {
    items?: DashboardLayoutItem[]
    preferences?: DashboardLayoutPreferences
  } | DashboardLayoutItem[]
}

const API = {
  layout: '/api/dashboards/layout',
}

const CUSTOM_METRIC_WIDGET_ID = 'dashboards.analytics.customMetric'

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function dateOnly(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function lastDaysRange(days: number): { from: string; to: string } {
  const today = new Date()
  return {
    from: dateOnly(addDays(today, -(days - 1))),
    to: dateOnly(today),
  }
}

function normalizeLayoutPayload(state: DashboardLayoutState): { items: DashboardLayoutItem[]; preferences?: DashboardLayoutPreferences } {
  if (Array.isArray(state.layout)) return { items: state.layout }
  return {
    items: state.layout?.items ?? [],
    ...(state.layout?.preferences ? { preferences: state.layout.preferences } : {}),
  }
}

async function readLayout(request: APIRequestContext, token: string): Promise<DashboardLayoutState> {
  const response = await apiRequest(request, 'GET', API.layout, { token })
  const body = await readJsonSafe<DashboardLayoutState>(response)
  expect(response.status()).toBe(200)
  return body ?? {}
}

async function putLayout(
  request: APIRequestContext,
  token: string,
  payload: { items: DashboardLayoutItem[]; preferences?: DashboardLayoutPreferences },
): Promise<void> {
  const response = await apiRequest(request, 'PUT', API.layout, { token, data: payload })
  expect(response.status(), 'PUT /api/dashboards/layout should return 200').toBe(200)
}

async function createOrderForDate(
  request: APIRequestContext,
  token: string,
  input: { placedAt: string; gross: number; label: string },
): Promise<string> {
  const orderId = await createSalesOrderFixture(request, token, 'USD')
  await createOrderLineFixture(request, token, orderId, {
    name: input.label,
    quantity: 1,
    unitPriceNet: input.gross,
    unitPriceGross: input.gross,
    currencyCode: 'USD',
  })
  const updateResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
    token,
    data: { id: orderId, placedAt: input.placedAt },
  })
  expect(updateResponse.status()).toBe(200)
  return orderId
}

async function waitForLayoutPut(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) => response.url().includes(API.layout) && response.request().method() === 'PUT',
    { timeout: 30_000 },
  )
}

async function selectWizardOption(page: Page, wizard: Locator, label: string | RegExp, option: string | RegExp): Promise<void> {
  await wizard.getByLabel(label).click()
  await page.getByRole('option', { name: option }).click()
}

// Adding a Custom Metric opens the guided setup wizard; the widget is only
// persisted (layout PUT) once the wizard is finished with "Add to dashboard".
async function addCustomMetricWidget(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Add widget$/i }).click()
  const dialog = page.getByRole('dialog', { name: /^Add widget$/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Custom metric/i }).click()
  await dialog.getByRole('button', { name: /^Add widget$/i }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('dialog', { name: /^Create custom metric$/i })).toBeVisible()
}

async function configureLineMetric(page: Page): Promise<void> {
  const wizard = page.getByRole('dialog', { name: /^Create custom metric$/i })
  await selectWizardOption(page, wizard, /^Data source$/i, /Sales orders/i)
  await wizard.getByRole('button', { name: /^Next$/i }).click()
  await selectWizardOption(page, wizard, /^Aggregation$/i, /^Count$/i)
  await wizard.getByRole('button', { name: /^Next$/i }).click()
  await selectWizardOption(page, wizard, /^Visualization$/i, /^Line$/i)
  await selectWizardOption(page, wizard, /^Group by$/i, /Placed at/i)
  await selectWizardOption(page, wizard, /^Granularity$/i, /^Day$/i)
  await wizard.getByRole('button', { name: /^Next$/i }).click()
  await wizard.getByLabel(/^Title$/i).fill('Orders by day')
  const save = waitForLayoutPut(page)
  await wizard.getByRole('button', { name: /^Add to dashboard$/i }).click()
  await expect(wizard).toBeHidden()
  await save
}

async function configureKpiMetric(page: Page): Promise<void> {
  const wizard = page.getByRole('dialog', { name: /^Create custom metric$/i })
  await selectWizardOption(page, wizard, /^Data source$/i, /Sales orders/i)
  await wizard.getByRole('button', { name: /^Next$/i }).click()
  await selectWizardOption(page, wizard, /^Aggregation$/i, /^Count$/i)
  await wizard.getByRole('button', { name: /^Next$/i }).click()
  await selectWizardOption(page, wizard, /^Visualization$/i, /^KPI$/i)
  await wizard.getByRole('button', { name: /^Next$/i }).click()
  await wizard.getByLabel(/^Title$/i).fill('Orders count')
  const save = waitForLayoutPut(page)
  await wizard.getByRole('button', { name: /^Add to dashboard$/i }).click()
  await expect(wizard).toBeHidden()
  await save
}

// Authenticate the browser context by transplanting the auth cookies that the API
// login (cached in the request-context jar via getAuthToken) already holds — both
// auth_token and session_token, so the SSR session/refresh flow keeps working. The
// login endpoint is rate-limited to 5 attempts/minute per email; a browser-suite's
// worth of UI logins alone can trip it.
async function loginWithToken(page: Page, request: APIRequestContext, token: string): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const state = await request.storageState()
  const jarCookies = state.cookies.filter((cookie) => ['auth_token', 'session_token'].includes(cookie.name))
  const cookies = jarCookies.length > 0
    ? jarCookies.map((cookie) => ({ name: cookie.name, value: cookie.value, url: baseUrl }))
    : [{ name: 'auth_token', value: token, url: baseUrl }]
  await page.context().addCookies(cookies)
}

test.describe('TC-DB2-005: custom metric widget', () => {
  test('adds a line custom metric and a second KPI custom metric instance that coexist after reload', async ({ page, request }) => {
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const originalLayout = normalizeLayoutPayload(await readLayout(request, adminToken))
    const orderIds: string[] = []

    try {
      const lastThirty = lastDaysRange(30)
      orderIds.push(
        await createOrderForDate(request, adminToken, {
          placedAt: lastThirty.to,
          gross: 80,
          label: `QA DB2 custom metric today ${Date.now()}`,
        }),
      )
      orderIds.push(
        await createOrderForDate(request, adminToken, {
          placedAt: dateOnly(addDays(new Date(), -1)),
          gross: 70,
          label: `QA DB2 custom metric yesterday ${Date.now()}`,
        }),
      )

      await putLayout(request, adminToken, {
        items: [],
        preferences: { dateRange: { preset: 'last_30_days', compare: 'previous_period' } },
      })

      await loginWithToken(page, request, adminToken)
      await page.goto('/backend', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/i })).toBeVisible()

      await page.getByRole('button', { name: /^Customize$/i }).click()
      await addCustomMetricWidget(page)
      await configureLineMetric(page)

      const lineChartHeading = page.getByRole('heading', { name: /^Orders by day$/i })
      await expect(lineChartHeading).toBeVisible()
      await expect(lineChartHeading.locator('xpath=ancestor::div[contains(@class, "rounded-lg")]').locator('svg').first()).toBeVisible()

      await addCustomMetricWidget(page)
      await configureKpiMetric(page)
      await expect(page.getByText(/^Orders count$/i)).toBeVisible()

      await page.getByRole('button', { name: /^Done$/i }).click()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /^Orders by day$/i })).toBeVisible()
      await expect(page.getByText(/^Orders count$/i)).toBeVisible()

      const persisted = normalizeLayoutPayload(await readLayout(request, adminToken))
      const customMetricItems = persisted.items.filter((item) => item.widgetId === CUSTOM_METRIC_WIDGET_ID)
      expect(customMetricItems).toHaveLength(2)
      expect(customMetricItems.map((item) => item.settings?.visualization).sort()).toEqual(['kpi', 'line'])
      expect(customMetricItems.map((item) => item.settings?.title).sort()).toEqual(['Orders by day', 'Orders count'])
    } finally {
      await putLayout(request, adminToken, originalLayout)
      for (const orderId of orderIds) {
        await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      }
    }
  })
})
