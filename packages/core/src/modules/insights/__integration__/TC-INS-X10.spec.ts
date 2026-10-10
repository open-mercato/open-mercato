import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { DEAL_PROCESS_KEY } from './helpers/xrayApi'
import {
  DEAL_ACTOR_FEATURES,
  cleanupXrayAnalyticsFixture,
  createXrayAnalyticsFixture,
  createXrayOrganization,
  createXrayRole,
  createXrayUser,
  seedDealProcess,
} from './helpers/xrayAnalyticsApi'
import { attachScreenshot, loginWithCredentials } from './helpers/whyUi'

export const integrationMeta = {
  description: 'Process X-Ray backend pages and the "Process health" dashboard widget (UI smoke)',
  dependsOnModules: ['insights', 'audit_logs', 'customers', 'dashboards'],
}

const PROCESS_WIDGET_ID = 'insights.dashboard.processHealth'
const LIST_PATH = '/backend/insights/process-xray'
const PROCESS_PATH = `${LIST_PATH}/${DEAL_PROCESS_KEY}`
const UI_FEATURES = [
  'insights.xray.view',
  'insights.xray.manage',
  'customers.deals.view',
  'dashboards.view',
  'dashboards.configure',
]
const DEALS_PER_ACTOR = 2
const ACTORS = 3
const UI_TIMEOUT_MS = 30_000
const TEST_TIMEOUT_MS = 360_000
const SETTLE_TIMEOUT_MS = 3_000

type LayoutState = { layout?: { items?: Array<Record<string, unknown>> }; allowedWidgetIds?: string[] }

/** Fails the step when the page shows the shared error banner (`ErrorMessage`, role="alert" with the destructive style). */
async function expectNoErrorBanner(page: Page, step: string): Promise<void> {
  await expect(page.locator('[role="alert"].text-destructive'), `${step}: no error banner`).toHaveCount(0)
}

/** The backend keeps an event-bridge stream open, so "network idle" may never come: wait briefly, then capture. */
async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)
  await attachScreenshot(page, testInfo, name)
}

async function putLayout(request: APIRequestContext, token: string, items: Array<Record<string, unknown>>): Promise<number> {
  const response = await apiRequest(request, 'PUT', '/api/dashboards/layout', { token, data: { items } })
  return response.status()
}

/**
 * TC-INS-X10: Process X-Ray pages and dashboard widget (UI smoke)
 * Covers:
 *   - UI /backend/insights/process-xray (process list: n, open cases, computedThrough)
 *   - UI /backend/insights/process-xray/customers.deal (KPIs; tabs Map, Variants, Bottlenecks,
 *     Rework, Conformance, Breakdown, Suggestions — each renders without an error banner)
 *   - UI /backend/insights/process-xray/customers.deal/cases (ids of the seeded deals)
 *   - UI /backend/insights/process-xray/settings (CrudForm values + projection status)
 *   - UI /backend/insights/process-xray/suggestions
 *   - UI /backend dashboard with the "Process health" widget (PUT /api/dashboards/layout)
 *   - GET /api/insights/xray/processes, /{processKey}/{map,variants,durations,bottlenecks,rework,conformance,breakdown,cases},
 *     /settings, /status, /suggestions (through the pages)
 *
 * An organization created for the test gets six deals (three actors, two each) walking
 * open → qa_review → win through the real API, k = 5 and a backfill (as TC-INS-X03). A user of
 * that organization holding only the X-Ray, deal-view and dashboard features signs in, so the
 * pages read exactly the fixture data. Screenshots (light, plus the list and map in dark mode)
 * are attached to the report.
 */
test.describe('TC-INS-X10: Process X-Ray pages and dashboard widget', () => {
  test('renders every X-Ray page and the Process health widget for seeded data', async ({ page, request }, testInfo) => {
    test.setTimeout(TEST_TIMEOUT_MS)
    const fixture = createXrayAnalyticsFixture()
    let uiToken: string | null = null
    try {
      const organizationId = await createXrayOrganization(request, fixture, 'INS-X10')
      const actorRole = await createXrayRole(request, fixture, { label: 'INS-X10 actor', features: DEAL_ACTOR_FEATURES, organizations: [organizationId] })
      const actors: string[] = []
      for (let index = 0; index < ACTORS; index += 1) {
        actors.push((await createXrayUser(request, fixture, { label: `INS-X10 actor ${index}`, organizationId, roleId: actorRole })).token)
      }
      await seedDealProcess(request, fixture, { organizationId, actorTokens: actors, dealsPerActor: DEALS_PER_ACTOR, label: 'INS-X10' })
      const uiRole = await createXrayRole(request, fixture, { label: 'INS-X10 analyst', features: UI_FEATURES, organizations: [organizationId] })
      const analyst = await createXrayUser(request, fixture, { label: 'INS-X10 analyst', organizationId, roleId: uiRole })
      uiToken = analyst.token
      const seededDealIds = fixture.deals.map((deal) => deal.id)
      expect(seededDealIds).toHaveLength(ACTORS * DEALS_PER_ACTOR)

      await loginWithCredentials(page, analyst.email, analyst.password)

      await test.step('process list', async () => {
        await page.goto(`${LIST_PATH}?w=30d`, { waitUntil: 'domcontentloaded' })
        const list = page.getByTestId('xray-process-list')
        await expect(list.getByRole('heading', { name: 'Process X-Ray' })).toBeVisible({ timeout: UI_TIMEOUT_MS })
        const dealRow = list.getByRole('row').filter({ hasText: 'Deal' }).first()
        await expect(dealRow).toBeVisible({ timeout: UI_TIMEOUT_MS })
        await expect(dealRow).toContainText(String(ACTORS * DEALS_PER_ACTOR))
        await expect(page.getByTestId('xray-computed-through')).toBeVisible()
        await expectNoErrorBanner(page, 'process list')
        await screenshot(page, testInfo, 'x10-process-list-light')
      })

      await test.step('process page — map', async () => {
        await page.goto(`${PROCESS_PATH}?w=30d`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('xray-process-page')).toBeVisible({ timeout: UI_TIMEOUT_MS })
        await expect(page.getByTestId('xray-kpis')).toContainText('Cases')
        await expect(page.getByTestId('xray-process-map')).toBeVisible({ timeout: UI_TIMEOUT_MS })
        await expect(page.getByTestId('xray-result-n').first()).toContainText(`${ACTORS * DEALS_PER_ACTOR} cases`)
        await expect(page.locator('[data-testid="xray-map-node-activity"][data-activity-key="status:win"]')).toBeVisible()
        await page.getByRole('radio', { name: 'Raw' }).click()
        await expect(page.getByRole('radio', { name: 'Raw' })).toHaveAttribute('aria-checked', 'true')
        await expectNoErrorBanner(page, 'map')
        await screenshot(page, testInfo, 'x10-process-map-light')
      })

      const tabs: Array<{ name: string; ready: (scope: Page) => Promise<void> }> = [
        {
          name: 'Variants',
          ready: async (scope) => {
            await expect(scope.getByRole('row').filter({ hasText: 'status: qa_review' }).first()).toBeVisible({ timeout: UI_TIMEOUT_MS })
          },
        },
        {
          name: 'Bottlenecks',
          ready: async (scope) => {
            await expect(scope.getByRole('columnheader', { name: 'Median wait' })).toBeVisible({ timeout: UI_TIMEOUT_MS })
          },
        },
        {
          name: 'Rework',
          ready: async (scope) => {
            await expect(scope.getByText('Rework rate')).toBeVisible({ timeout: UI_TIMEOUT_MS })
          },
        },
        {
          name: 'Conformance',
          ready: async (scope) => {
            await expect(scope.getByText('No designed process configured')).toBeVisible({ timeout: UI_TIMEOUT_MS })
          },
        },
        {
          name: 'Breakdown',
          ready: async (scope) => {
            await expect(scope.getByRole('radiogroup', { name: 'Group by' })).toBeVisible({ timeout: UI_TIMEOUT_MS })
            await expect(scope.getByTestId('xray-breakdown-user-unavailable')).toBeVisible()
            await expect(scope.getByTestId('xray-result-meta')).toBeVisible({ timeout: UI_TIMEOUT_MS })
          },
        },
        {
          name: 'Suggestions',
          ready: async (scope) => {
            await expect(scope.getByTestId('xray-suggestions')).toBeVisible({ timeout: UI_TIMEOUT_MS })
            await expect(scope.getByRole('radiogroup', { name: 'Suggestion status' })).toBeVisible()
          },
        },
      ]
      for (const tab of tabs) {
        await test.step(`process page — ${tab.name} tab`, async () => {
          await page.getByRole('tab', { name: tab.name }).click()
          await expect(page.getByRole('tab', { name: tab.name })).toHaveAttribute('aria-selected', 'true')
          await tab.ready(page)
          await expectNoErrorBanner(page, tab.name)
          if (tab.name === 'Variants') await screenshot(page, testInfo, 'x10-variants-light')
        })
      }

      await test.step('cases page', async () => {
        await page.goto(`${PROCESS_PATH}/cases?w=30d`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('xray-cases-page')).toBeVisible({ timeout: UI_TIMEOUT_MS })
        await expect(page.getByText(seededDealIds[0], { exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS })
        for (const dealId of seededDealIds) await expect(page.getByText(dealId, { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled()
        await expectNoErrorBanner(page, 'cases')
        await screenshot(page, testInfo, 'x10-cases-light')
      })

      await test.step('settings page', async () => {
        await page.goto(`${LIST_PATH}/settings`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('xray-settings-page')).toBeVisible({ timeout: UI_TIMEOUT_MS })
        await expect(page.locator('[data-crud-field-id="kAnonymity"] input')).toHaveValue('5', { timeout: UI_TIMEOUT_MS })
        await expect(page.getByTestId('xray-status-panel')).toContainText('Projection status')
        await expect(page.getByTestId('xray-backfill')).toBeEnabled({ timeout: UI_TIMEOUT_MS })
        await expectNoErrorBanner(page, 'settings')
        await screenshot(page, testInfo, 'x10-settings-light')
      })

      await test.step('suggestions page', async () => {
        await page.goto(`${LIST_PATH}/suggestions`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('xray-suggestions-page')).toBeVisible({ timeout: UI_TIMEOUT_MS })
        await expect(page.getByRole('button', { name: 'Look for suggestions now' })).toBeVisible()
        await expectNoErrorBanner(page, 'suggestions')
      })

      await test.step('dashboard widget', async () => {
        const layoutResponse = await apiRequest(request, 'GET', '/api/dashboards/layout', { token: analyst.token })
        expect(layoutResponse.status()).toBe(200)
        const layout = await readJsonSafe<LayoutState>(layoutResponse)
        expect(layout?.allowedWidgetIds ?? [], 'the widget is available with dashboards.view + insights.xray.view').toContain(PROCESS_WIDGET_ID)
        expect(await putLayout(request, analyst.token, [{ id: randomUUID(), widgetId: PROCESS_WIDGET_ID, order: 0, size: 'md' }])).toBe(200)
        await page.goto('/backend', { waitUntil: 'domcontentloaded' })
        const widget = page.getByTestId('xray-process-health')
        await expect(widget).toBeVisible({ timeout: UI_TIMEOUT_MS })
        const dealRow = widget.locator(`[data-testid="xray-process-health-row"][data-process-key="${DEAL_PROCESS_KEY}"]`)
        await expect(dealRow).toContainText(String(ACTORS * DEALS_PER_ACTOR))
        await expect(dealRow).toContainText('Median cycle time')
        await expectNoErrorBanner(page, 'dashboard')
        await screenshot(page, testInfo, 'x10-dashboard-widget-light')
      })

      await test.step('dark mode', async () => {
        await page.emulateMedia({ colorScheme: 'dark' })
        await page.goto(`${PROCESS_PATH}?w=30d`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('xray-process-map')).toBeVisible({ timeout: UI_TIMEOUT_MS })
        await expect(page.locator('html')).toHaveClass(/dark/)
        await screenshot(page, testInfo, 'x10-process-map-dark')
        await page.goto(`${LIST_PATH}?w=30d`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('xray-process-list').getByRole('row').filter({ hasText: 'Deal' }).first()).toBeVisible({ timeout: UI_TIMEOUT_MS })
        await screenshot(page, testInfo, 'x10-process-list-dark')
        await page.emulateMedia({ colorScheme: 'light' })
      })
    } finally {
      if (uiToken) await putLayout(request, uiToken, []).catch(() => undefined)
      await cleanupXrayAnalyticsFixture(request, fixture)
    }
  })
})
