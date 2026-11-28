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
  aovKpi: 'dashboards.analytics.aovKpi',
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

test.describe('TC-DB2-007: drag-to-resize snapping', () => {
  test('dragging a widget edge handle snaps to a larger size and persists', async ({ page, request }) => {
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
      // Edit mode remounts the cards with resize handles (md+ only) — let them attach.
      const handle = page.getByRole('separator', { name: /Resize widget/i }).first()
      await expect(handle).toBeVisible()

      const persistedSizes = async () => normalizeLayoutPayload(await readLayout(request, adminToken)).items.map((item) => item.size ?? 'md')

      // Pointer-drag the first card's right edge far to the right. The fraction of the
      // grid width clamps to 1.0, which snaps to the full-width size.
      await expect(async () => {
        const box = await handle.boundingBox()
        if (!box) throw new Error('[internal] resize handle geometry unavailable')
        const viewport = page.viewportSize()
        const targetX = (viewport?.width ?? 1280) - 8
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(targetX, box.y + box.height / 2, { steps: 16 })
        await page.waitForTimeout(150)
        await page.mouse.up()
        expect((await persistedSizes()).includes('full')).toBe(true)
      }).toPass({ timeout: 30_000 })

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /^Orders$/i })).toBeVisible({ timeout: 30_000 })
      expect((await persistedSizes()).includes('full')).toBe(true)
    } finally {
      await putLayout(request, adminToken, originalLayout)
    }
  })
})
