import { expect, test, type APIRequestContext, type Page, type Request, type Response } from '@playwright/test'
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
  settings?: unknown
}

type DashboardLayoutPreferences = {
  dateRange?: {
    preset: 'last_7_days' | 'last_30_days' | 'custom'
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

type WidgetDataBatchPayload = {
  requests?: Array<{
    id?: string
    request?: {
      dateRange?: {
        from?: string
        to?: string
      }
    }
  }>
}

const API = {
  layout: '/api/dashboards/layout',
  widgetDataBatch: '/api/dashboards/widgets/data/batch',
}

const WIDGET_IDS = {
  ordersKpi: 'dashboards.analytics.ordersKpi',
  revenueKpi: 'dashboards.analytics.revenueKpi',
  aovKpi: 'dashboards.analytics.aovKpi',
  customMetric: 'dashboards.analytics.customMetric',
}

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

function layoutItems(widgetIds: string[]): DashboardLayoutItem[] {
  return widgetIds.map((widgetId, index) => ({
    id: randomUUID(),
    widgetId,
    order: index,
    priority: index,
    size: index < 3 ? 'sm' : 'md',
    settings: null,
  }))
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

function hasBatchRange(request: Request, range: { from: string; to: string }): boolean {
  if (!request.url().includes(API.widgetDataBatch) || request.method() !== 'POST') return false
  const payload = request.postDataJSON() as WidgetDataBatchPayload | null
  return (payload?.requests ?? []).some((entry) => {
    const dateRange = entry.request?.dateRange
    return dateRange?.from === range.from && dateRange?.to === range.to
  })
}

async function waitForLayoutPut(page: Page, timeout = 20_000): Promise<Response> {
  return page.waitForResponse(
    (response) => response.url().includes(API.layout) && response.request().method() === 'PUT',
    { timeout },
  )
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

test.describe('TC-DB2-004: /backend dashboard v2 UI', () => {
  test('renders KPI cards with skeletons and sparklines, and refetches on global date-range change', async ({ page, request }) => {
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const originalLayout = normalizeLayoutPayload(await readLayout(request, adminToken))
    const orderIds: string[] = []

    try {
      const lastThirty = lastDaysRange(30)
      orderIds.push(
        await createOrderForDate(request, adminToken, {
          placedAt: lastThirty.to,
          gross: 90,
          label: `QA DB2 UI current ${Date.now()}`,
        }),
      )
      orderIds.push(
        await createOrderForDate(request, adminToken, {
          placedAt: lastThirty.from,
          gross: 40,
          label: `QA DB2 UI older ${Date.now()}`,
        }),
      )

      await putLayout(request, adminToken, {
        items: layoutItems([WIDGET_IDS.ordersKpi, WIDGET_IDS.revenueKpi, WIDGET_IDS.aovKpi]),
        preferences: { dateRange: { preset: 'last_30_days', compare: 'previous_period' } },
      })

      await loginWithToken(page, request, adminToken)

      let delayedLayout = false
      await page.route('**/api/dashboards/layout', async (route) => {
        if (!delayedLayout && route.request().method() === 'GET') {
          delayedLayout = true
          await new Promise((resolve) => setTimeout(resolve, 750))
        }
        await route.continue().catch(() => {})
      })

      // Register BEFORE navigating so a fast initial batch cannot slip past the waiter.
      const initialBatchSettled = page.waitForResponse(
        (response) => response.url().includes('/api/dashboards/widgets/data') && response.request().method() === 'POST' && response.ok(),
        { timeout: 30_000 },
      )
      await page.goto('/backend', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('.animate-pulse').first()).toBeVisible()
      await page.unroute('**/api/dashboards/layout')

      await expect(page.getByRole('heading', { name: /^Orders$/i })).toBeVisible()
      await expect(page.getByRole('heading', { name: /^Revenue$/i })).toBeVisible()
      await expect(page.getByRole('img', { name: /KPI trend/i }).first()).toBeVisible()
      // Interacting with the picker while the initial widget-data batch is still in
      // flight on a cold server races the range-change refetch — settle first.
      await initialBatchSettled

      const lastSeven = lastDaysRange(7)
      const batchRequestPromise = page.waitForRequest((batchRequest) => hasBatchRange(batchRequest, lastSeven), { timeout: 60_000 })
      // The popover interaction is retried as ONE complete attempt (open → select →
      // settle → apply → label committed). Rationale: an instant option→Apply click can
      // race Radix's post-draft re-measure and land as an outside-dismiss (popover closes
      // without applying); the settle pause plus the strict trigger-label postcondition
      // make each attempt self-verifying. The network assertion below stays strict.
      await expect(async () => {
        // .first() everywhere: when the popover is open, its preset option ALSO matches
        // the trigger's label text, and a bare getByRole click is a strict-mode violation.
        const option = page.getByRole('button', { name: /^Last 7 days$/i }).first()
        if (!(await option.isVisible().catch(() => false))) {
          await page.getByRole('button', { name: /^Last (7|30) days /i }).first().click({ timeout: 3_000 })
          await expect(option).toBeVisible({ timeout: 1_500 })
        }
        await option.click()
        await expect(page.locator('#dashboard-v2-range-from')).toHaveValue(lastSeven.from, { timeout: 1_000 })
        await page.waitForTimeout(350)
        await page.getByRole('button', { name: /^Apply$/i }).click({ timeout: 3_000 })
        await expect(
          page.getByRole('button', { name: new RegExp(`^Last 7 days ${lastSeven.from} - ${lastSeven.to}$`, 'i') }),
        ).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 45_000 })
      await batchRequestPromise
      await expect(page.getByRole('button', { name: new RegExp(`Last 7 days ${lastSeven.from} - ${lastSeven.to}`, 'i') })).toBeVisible()
      await expect(page.getByRole('heading', { name: /^Orders$/i })).toBeVisible()
    } finally {
      await putLayout(request, adminToken, originalLayout)
      for (const orderId of orderIds) {
        await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      }
    }
  })

  test('persists customization (reorder, resize, add widget) and opens the legacy dashboard', async ({ page, request }) => {
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const originalLayout = normalizeLayoutPayload(await readLayout(request, adminToken))

    try {
      await putLayout(request, adminToken, {
        items: layoutItems([WIDGET_IDS.ordersKpi, WIDGET_IDS.revenueKpi, WIDGET_IDS.aovKpi]),
        preferences: { dateRange: { preset: 'last_30_days', compare: 'previous_period' } },
      })

      await loginWithToken(page, request, adminToken)
      await page.goto('/backend', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /^Orders$/i })).toBeVisible({ timeout: 30_000 })

      await page.getByRole('button', { name: /^Customize$/i }).click()
      // Customize mode remounts the cards with drag handles — let listeners attach.
      await expect(page.getByRole('button', { name: /^Move widget$/i }).first()).toBeVisible()
      await page.waitForTimeout(500)

      // Persistence is asserted by polling the API state after each action instead of
      // racing PUT response events — immune to save-queue timing on a busy machine.
      const persistedItems = async () => normalizeLayoutPayload(await readLayout(request, adminToken)).items

      // Pointer-based dnd-kit drag (the reliable way to drive dnd-kit in Playwright;
      // the KeyboardSensor remains wired for a11y). Retries until the DOM order provably
      // changed (first card heading flips from Orders to Revenue).
      await expect(async () => {
        const handleBox = await page.getByRole('button', { name: /^Move widget$/i }).first().boundingBox()
        const targetBox = await page.getByRole('heading', { name: /^Revenue$/ }).boundingBox()
        if (!handleBox || !targetBox) throw new Error('[internal] drag geometry unavailable')
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(targetBox.x + targetBox.width / 2 + 60, targetBox.y + targetBox.height / 2, { steps: 12 })
        await page.waitForTimeout(250)
        await page.mouse.up()
        await expect(page.getByRole('heading', { name: /^(Orders|Revenue)$/ }).first()).toHaveText('Revenue', { timeout: 1_500 })
      }).toPass({ timeout: 30_000 })
      await expect
        .poll(async () => (await persistedItems())[0]?.widgetId, { timeout: 20_000 })
        .toBe(WIDGET_IDS.revenueKpi)

      await page.getByRole('button', { name: /^Size$/i }).first().click()
      await page.getByRole('button', { name: /^Full width$/i }).click()
      await expect
        .poll(async () => (await persistedItems()).some((item) => item.size === 'full'), { timeout: 20_000 })
        .toBe(true)

      await page.getByRole('button', { name: /^Add widget$/i }).click()
      const dialog = page.getByRole('dialog', { name: /^Add widget$/i })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: /Custom metric/i }).click()
      await dialog.getByRole('button', { name: /^Add widget$/i }).click()

      // Adding Custom metric now opens a guided setup wizard instead of dropping an
      // empty card at the bottom. Configure the minimum (a data source) and finish.
      const wizard = page.getByRole('dialog', { name: /Create custom metric/i })
      await expect(wizard).toBeVisible()
      await wizard.getByLabel('Data source').click()
      await page.getByRole('option').first().click()
      for (let stepIndex = 0; stepIndex < 3; stepIndex++) {
        await wizard.getByRole('button', { name: /^Next$/i }).click()
      }
      await wizard.getByRole('button', { name: /Add to dashboard/i }).click()
      await expect(wizard).toBeHidden()
      await expect
        .poll(async () => (await persistedItems()).some((item) => item.widgetId === WIDGET_IDS.customMetric), { timeout: 20_000 })
        .toBe(true)

      await page.getByRole('button', { name: /^Done$/i }).click()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /^Orders$/i })).toBeVisible()

      const persisted = normalizeLayoutPayload(await readLayout(request, adminToken))
      expect(persisted.items.some((item) => item.size === 'full')).toBe(true)
      expect(persisted.items.some((item) => item.widgetId === WIDGET_IDS.customMetric)).toBe(true)

      await page.goto('/backend/dashboard/legacy', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /^Dashboard$/i })).toBeVisible()
      await expect(page.getByText(/Arrange and personalize the widgets/i)).toBeVisible()
    } finally {
      await putLayout(request, adminToken, originalLayout)
    }
  })
})
