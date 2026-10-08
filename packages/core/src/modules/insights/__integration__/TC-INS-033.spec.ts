import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createQaDeal, deleteQaDealIfExists, uniqueSuffix, updateQaDeal } from './helpers/explainApi'
import { attachScreenshot } from './helpers/whyUi'

const FIELD_EXPLAIN_TOGGLE_ID = 'insights_field_explain'
const STATUS_TRIGGER_NAME = 'Why does Status have this value?'

type FeatureToggleListBody = {
  items?: Array<{ identifier?: string; type?: string; defaultValue?: unknown }>
}

/**
 * At the default 1280px viewport the deal form panel may start collapsed into an icon rail, and the
 * CrudForm is only mounted once the panel is expanded (the expanded state is remembered).
 */
async function showDealForm(page: Page): Promise<void> {
  const statusField = page.locator('[data-crud-field-id="status"]:visible').first()
  const expandPanel = page.getByRole('button', { name: /expand form panel/i })
  await expect(statusField.or(expandPanel).first()).toBeVisible({ timeout: 20_000 })
  if (!(await statusField.isVisible().catch(() => false))) {
    await expandPanel.click()
  }
  await expect(statusField).toBeVisible({ timeout: 20_000 })
}

/**
 * TC-INS-033: CrudForm per-field "Why?" in explain mode
 * Covers:
 *   - UI /backend/customers/deals/:id → "Explain fields" switch (crud-form:customers.deal:header)
 *     → "?" after the status field (crud-form:customers.deal:field:status:after) → status chain drawer
 *   - GET /api/insights/explain/descriptors, GET /api/insights/explain?field=status
 *   - GET /api/feature_toggles/global (kill switch `insights_field_explain` seeded, default on)
 *
 * Explain mode is off by default, so the field buttons only appear after the switch is turned on;
 * the choice survives a reload, and turning the switch off hides the buttons again.
 */
test.describe('TC-INS-033: per-field "Why?" on the deal edit form', () => {
  test('enables explain mode, explains the status field, and hides the buttons again', async ({ page, request }, testInfo) => {
    test.slow()
    let token: string | null = null
    let dealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const toggleResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global?identifier=${FIELD_EXPLAIN_TOGGLE_ID}&page=1&pageSize=10`,
        { token },
      )
      expect(toggleResponse.ok(), `GET /api/feature_toggles/global should succeed: ${toggleResponse.status()}`).toBeTruthy()
      const toggleBody = await readJsonSafe<FeatureToggleListBody>(toggleResponse)
      const toggle = toggleBody?.items?.find((item) => item.identifier === FIELD_EXPLAIN_TOGGLE_ID)
      expect(toggle, 'the insights kill switch is seeded with the module defaults').toBeTruthy()
      expect(toggle?.type).toBe('boolean')
      expect(toggle?.defaultValue).toBe(true)

      const title = `QA INS-033 ${uniqueSuffix()}`
      dealId = await createQaDeal(request, token, { title, status: 'open' })
      await updateQaDeal(request, token, dealId, { status: 'qa_in_progress' })
      await updateQaDeal(request, token, dealId, { status: 'qa_negotiation' })

      await login(page, 'admin')
      await page.goto(`/backend/customers/deals/${dealId}`)
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 })
      await showDealForm(page)

      const explainSwitch = page.getByRole('switch', { name: 'Explain fields' })
      await expect(explainSwitch).toBeVisible({ timeout: 20_000 })
      await expect(explainSwitch).toHaveAttribute('aria-checked', 'false')
      await expect(page.getByRole('button', { name: STATUS_TRIGGER_NAME })).toHaveCount(0)

      await explainSwitch.click()
      await expect(explainSwitch).toHaveAttribute('aria-checked', 'true')
      const statusTrigger = page.locator('[data-crud-field-id="status"]:visible').getByRole('button', { name: STATUS_TRIGGER_NAME })
      await expect(statusTrigger).toBeVisible()
      await expect(page.locator('[data-crud-field-id="title"] [data-testid="insights-field-why-trigger"]')).toHaveCount(0)
      await attachScreenshot(page, testInfo, 'ins-033-explain-mode')

      await statusTrigger.click()
      const drawer = page.getByRole('dialog', { name: 'Why?' })
      await expect(drawer).toBeVisible()
      await expect(drawer.getByRole('heading', { name: 'Status', exact: true })).toBeVisible()
      await expect(drawer.getByText('Recorded changes', { exact: true })).toBeVisible()
      await expect(drawer.getByText('qa_negotiation').first()).toBeVisible()
      await expect(drawer.getByText('qa_in_progress').first()).toBeVisible()
      await expect(drawer.getByText('by You').first()).toBeVisible()
      await expect(drawer.getByText('Proven').first()).toBeVisible()
      await expect(drawer.getByRole('link', { name: 'Open as page' })).toHaveAttribute(
        'href',
        `/backend/insights/why?resourceKind=customers.deal&resourceId=${dealId}&field=status`,
      )
      await attachScreenshot(page, testInfo, 'ins-033-status-drawer')

      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await page.reload()
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 })
      await showDealForm(page)
      const reloadedSwitch = page.getByRole('switch', { name: 'Explain fields' })
      await expect(reloadedSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 })
      await expect(page.getByRole('button', { name: STATUS_TRIGGER_NAME })).toBeVisible()

      await reloadedSwitch.click()
      await expect(reloadedSwitch).toHaveAttribute('aria-checked', 'false')
      await expect(page.getByTestId('insights-field-why-trigger')).toHaveCount(0)
    } finally {
      await deleteQaDealIfExists(request, token, dealId)
    }
  })
})
