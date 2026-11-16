/**
 * TC-STAFF-SUP-016: Settings → Support tab.
 *
 * As an admin on `/backend/staff/time-tracking/settings?tab=support`: create, edit
 * and delete a support category; add, pause and delete a routing rule (the project
 * is picked through the searchable project picker); repoint the fallback project;
 * save the reference prefix. An unsaved edit on the "Time tracking" tab survives a
 * prefix save on the Support tab, and saving it afterwards does not revert the
 * prefix.
 */
import { expect, test, type Page } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { uniqueSuffix } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { Cleanup, adminToken, createProject, dismissNotices, ensureFallback, routingPreview } from './fixtures'
import {
  SETTINGS_PATH,
  currentFallbackProjectId,
  deleteRoutingRuleForCategory,
  deleteSupportCategoryByValue,
  findRoutingRuleForCategory,
  findSupportCategoryEntry,
  readTimeTrackingSettings,
  restoreTimeTrackingSettings,
} from './backofficeFixtures'

async function pickProject(page: Page, testId: string, projectName: string) {
  const input = page.getByTestId(testId).getByRole('combobox')
  await input.click()
  await input.fill(projectName)
  await page.getByRole('option', { name: new RegExp(projectName) }).first().click()
}

async function confirmDestructive(page: Page) {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByRole('button', { name: /^Delete$|^Confirm$/i }).click()
}

test.describe('TC-STAFF-SUP-016: Settings Support tab', () => {
  test('manages categories, routing, the fallback project and the reference prefix', async ({ page, request }) => {
    test.setTimeout(240_000)
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const originalSettings = await readTimeTrackingSettings(request, admin)
      cleanup.add(() => restoreTimeTrackingSettings(request, admin, originalSettings))
      const fallback = await ensureFallback(request, admin)
      const originalFallbackProjectId = fallback.timeProjectId

      const routedProject = await createProject(request, admin, cleanup, 'settings-routed')
      const fallbackProject = await createProject(request, admin, cleanup, 'settings-fallback')
      cleanup.add(async () => {
        const current = await routingPreview(request, admin)
        if (current.fallback && current.fallback.project.id !== originalFallbackProjectId) {
          await apiRequest(request, 'PUT', '/api/staff/timesheets/support-routing-rules', {
            token: admin,
            data: { id: current.fallback.ruleId, timeProjectId: originalFallbackProjectId },
          })
        }
      })

      const suffix = uniqueSuffix().toLowerCase().replace(/[^a-z0-9]/g, '').slice(-8)
      const categoryValue = `qa-settings-${suffix}`
      const categoryLabel = `QA Settings ${suffix}`
      const renamedLabel = `QA Settings renamed ${suffix}`
      cleanup.add(() => deleteSupportCategoryByValue(request, admin, categoryValue))
      cleanup.add(() => deleteRoutingRuleForCategory(request, admin, categoryValue))

      await login(page, 'admin')
      await page.goto(`${SETTINGS_PATH}?tab=support`, { waitUntil: 'domcontentloaded' })
      await dismissNotices(page)
      await expect(page.getByRole('tab', { name: 'Support' })).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 })

      await page.getByRole('button', { name: 'Add category' }).click()
      const createDialog = page.getByRole('dialog')
      await createDialog.locator('[data-crud-field-id="value"] input').first().fill(categoryValue)
      await createDialog.locator('[data-crud-field-id="label"] input').first().fill(categoryLabel)
      await createDialog.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByRole('row').filter({ hasText: categoryLabel }).first()).toBeVisible({ timeout: 30_000 })
      await expect.poll(async () => (await findSupportCategoryEntry(request, admin, categoryValue))?.label).toBe(categoryLabel)

      await page.getByRole('row').filter({ hasText: categoryLabel }).first().click()
      const editDialog = page.getByRole('dialog')
      await editDialog.locator('[data-crud-field-id="label"] input').first().fill(renamedLabel)
      await editDialog.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByRole('row').filter({ hasText: renamedLabel }).first()).toBeVisible({ timeout: 30_000 })
      await expect.poll(async () => (await findSupportCategoryEntry(request, admin, categoryValue))?.label).toBe(renamedLabel)

      await page.getByRole('button', { name: 'Add rule' }).click()
      const ruleDialog = page.getByRole('dialog')
      await ruleDialog.locator('#support-rule-category').click()
      await page.getByRole('option', { name: renamedLabel, exact: true }).click()
      await pickProject(page, 'support-rule-project', routedProject.name)
      await ruleDialog.getByRole('button', { name: 'Save' }).click()
      await expect
        .poll(async () => (await findRoutingRuleForCategory(request, admin, categoryValue))?.project.id, { timeout: 30_000 })
        .toBe(routedProject.id)

      const ruleRow = page.getByRole('row').filter({ hasText: renamedLabel }).filter({ hasText: routedProject.name })
      await ruleRow.getByRole('switch', { name: 'Active' }).click()
      await expect
        .poll(async () => (await findRoutingRuleForCategory(request, admin, categoryValue))?.isActive, { timeout: 30_000 })
        .toBe(false)

      await ruleRow.getByRole('button', { name: 'Delete' }).click()
      await confirmDestructive(page)
      await expect
        .poll(async () => findRoutingRuleForCategory(request, admin, categoryValue), { timeout: 30_000 })
        .toBeNull()

      await pickProject(page, 'support-fallback-project', fallbackProject.name)
      await expect
        .poll(async () => currentFallbackProjectId(request, admin), { timeout: 30_000 })
        .toBe(fallbackProject.id)

      const categoryRow = page.getByRole('row').filter({ hasText: renamedLabel }).first()
      await categoryRow.getByRole('button', { name: 'Open actions' }).click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()
      await confirmDestructive(page)
      await expect.poll(async () => findSupportCategoryEntry(request, admin, categoryValue), { timeout: 30_000 }).toBeNull()

      const originalDaily = originalSettings.targets?.dailyHours ?? null
      const draftDaily = originalDaily === 7 ? 6 : 7
      const prefix = `QA${suffix.replace(/[^0-9]/g, '').slice(-4) || '1'}`.toUpperCase()

      await page.getByRole('tab', { name: 'Time tracking' }).click()
      const dailyField = page.getByLabel('Daily hours target')
      await dailyField.fill(String(draftDaily))

      await page.getByRole('tab', { name: 'Support' }).click()
      const prefixField = page.locator('#support-reference-prefix')
      await prefixField.fill(prefix)
      const prefixSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Reference prefix' }) })
      await prefixSection.getByRole('button', { name: 'Save' }).click()
      await expect
        .poll(async () => (await readTimeTrackingSettings(request, admin)).support?.referencePrefix, { timeout: 30_000 })
        .toBe(prefix)
      expect((await readTimeTrackingSettings(request, admin)).targets?.dailyHours ?? null).toBe(originalDaily)

      await page.getByRole('tab', { name: 'Time tracking' }).click()
      await expect(page.getByLabel('Daily hours target')).toHaveValue(String(draftDaily))
      await page.getByTestId('save-settings').click()
      await expect
        .poll(async () => (await readTimeTrackingSettings(request, admin)).targets?.dailyHours, { timeout: 30_000 })
        .toBe(draftDaily)
      expect((await readTimeTrackingSettings(request, admin)).support?.referencePrefix).toBe(prefix)
    } finally {
      await cleanup.run()
    }
  })
})
