import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type DashboardSize = 'sm' | 'md' | 'lg' | 'full'
type DashboardLayoutItem = { id: string; widgetId: string; order: number; priority?: number; size?: DashboardSize; settings?: unknown }
type DashboardLayoutPreferences = { dateRange?: { preset: 'last_30_days' | 'custom'; from?: string; to?: string; compare: 'previous_period' | 'previous_year' | 'none' } }
type DashboardLayoutState = { layout?: { items?: DashboardLayoutItem[]; preferences?: DashboardLayoutPreferences } | DashboardLayoutItem[] }

const API = { layout: '/api/dashboards/layout' }
const WIDGET_IDS = {
  ordersKpi: 'dashboards.analytics.ordersKpi',
  revenueKpi: 'dashboards.analytics.revenueKpi',
  customMetric: 'dashboards.analytics.customMetric',
}

function layoutItems(widgetIds: string[]): DashboardLayoutItem[] {
  return widgetIds.map((widgetId, index) => ({ id: randomUUID(), widgetId, order: index, priority: index, size: 'sm', settings: null }))
}

function normalizeLayoutPayload(state: DashboardLayoutState): { items: DashboardLayoutItem[]; preferences?: DashboardLayoutPreferences } {
  if (Array.isArray(state.layout)) return { items: state.layout }
  return { items: state.layout?.items ?? [], ...(state.layout?.preferences ? { preferences: state.layout.preferences } : {}) }
}

async function readLayout(request: APIRequestContext, token: string): Promise<DashboardLayoutState> {
  const response = await apiRequest(request, 'GET', API.layout, { token })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<DashboardLayoutState>(response)) ?? {}
}

async function putLayout(request: APIRequestContext, token: string, payload: { items: DashboardLayoutItem[]; preferences?: DashboardLayoutPreferences }): Promise<void> {
  const response = await apiRequest(request, 'PUT', API.layout, { token, data: payload })
  expect(response.status(), 'PUT /api/dashboards/layout should return 200').toBe(200)
}

async function loginWithToken(page: Page, request: APIRequestContext, token: string): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const state = await request.storageState()
  const jarCookies = state.cookies.filter((cookie) => ['auth_token', 'session_token'].includes(cookie.name))
  const cookies = jarCookies.length > 0
    ? jarCookies.map((cookie) => ({ name: cookie.name, value: cookie.value, url: baseUrl }))
    : [{ name: 'auth_token', value: token, url: baseUrl }]
  await page.context().addCookies(cookies)
}

test.describe('TC-DB2-006: Custom Metric setup wizard', () => {
  test('adding Custom Metric opens a guided wizard with a live preview and persists a configured widget', async ({ page, request }) => {
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const originalLayout = normalizeLayoutPayload(await readLayout(request, adminToken))

    try {
      await putLayout(request, adminToken, {
        items: layoutItems([WIDGET_IDS.ordersKpi, WIDGET_IDS.revenueKpi]),
        preferences: { dateRange: { preset: 'last_30_days', compare: 'previous_period' } },
      })

      await loginWithToken(page, request, adminToken)
      await page.goto('/backend', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /^Orders$/i })).toBeVisible({ timeout: 30_000 })

      await page.getByRole('button', { name: /^Customize$/i }).click()
      await page.getByRole('button', { name: /^Add widget$/i }).click()
      const addDialog = page.getByRole('dialog', { name: /^Add widget$/i })
      await expect(addDialog).toBeVisible()
      await addDialog.getByRole('button', { name: /Custom metric/i }).click()
      await addDialog.getByRole('button', { name: /^Add widget$/i }).click()

      // The guided wizard opens instead of silently dropping an empty card.
      const wizard = page.getByRole('dialog', { name: /Create custom metric/i })
      await expect(wizard).toBeVisible()
      await expect(wizard.getByText(/Live preview/i)).toBeVisible()

      // Choose a data source; the metric defaults (count of records) make the request valid.
      await wizard.getByLabel('Data source').click()
      await page.getByRole('option', { name: 'Sales orders', exact: true }).click()

      // Walk through the remaining steps and add it to the dashboard.
      for (let stepIndex = 0; stepIndex < 3; stepIndex++) {
        await wizard.getByRole('button', { name: /^Next$/i }).click()
      }
      const finish = wizard.getByRole('button', { name: /Add to dashboard/i })
      await expect(finish).toBeEnabled()
      await finish.click()
      await expect(wizard).toBeHidden()

      // A CONFIGURED custom metric is persisted (entityType set — not an empty default).
      await expect
        .poll(async () => {
          const items = normalizeLayoutPayload(await readLayout(request, adminToken)).items
          const added = items.find((item) => item.widgetId === WIDGET_IDS.customMetric)
          return (added?.settings as { entityType?: string } | null)?.entityType ?? null
        }, { timeout: 20_000 })
        .toBe('sales:orders')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /^Orders$/i })).toBeVisible({ timeout: 30_000 })
      const persisted = normalizeLayoutPayload(await readLayout(request, adminToken))
      const configured = persisted.items.find((item) => item.widgetId === WIDGET_IDS.customMetric)
      expect((configured?.settings as { entityType?: string } | null)?.entityType).toBe('sales:orders')
    } finally {
      await putLayout(request, adminToken, originalLayout)
    }
  })
})
