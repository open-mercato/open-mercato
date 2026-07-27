import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-UX-P0-003: destructive deletes confirm before firing.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-p0-hotfixes.md
 * (§4 delete confirmations, Testing Strategy).
 *
 * Creates a throwaway agentic task + eval assertion over the API, then drives
 * the UI: the task-delete row action must open the shared ConfirmDialog
 * (no DELETE before confirmation), Cancel keeps the row, Confirm removes it;
 * the eval-assertion delete shows the dialog too (cancelled — row stays).
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-UX-P0-003: delete confirmations', () => {
  test('task delete confirms (cancel keeps, confirm removes); assertion delete confirms', async ({ page, request }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const taskName = `TC-UX-P0-003 task ${stamp}`
    const assertionKey = `tc-ux-p0-003-${stamp}`
    let taskId: string | null = null
    let assertionId: string | null = null

    try {
      const taskResponse = await apiRequest(request, 'POST', '/api/agent_orchestrator/tasks', {
        token,
        data: {
          name: taskName,
          targetType: 'agent',
          targetAgentId: 'deals.health_check',
          enabled: false,
        },
      })
      expect(taskResponse.ok(), 'seed task create must succeed').toBeTruthy()
      taskId = (await readJsonSafe<{ id?: string }>(taskResponse))?.id ?? null
      expect(taskId).toBeTruthy()

      const assertionResponse = await apiRequest(request, 'POST', '/api/agent_orchestrator/eval-assertions', {
        token,
        data: {
          key: assertionKey,
          title: taskName,
          type: 'deterministic',
          config: { path: '$.ok', expected: true },
          severity: 'warn',
          appliesTo: '*',
          enabled: false,
        },
      })
      expect(assertionResponse.ok(), 'seed assertion create must succeed').toBeTruthy()
      assertionId = (await readJsonSafe<{ id?: string }>(assertionResponse))?.id ?? null

      await loginAsAdmin(page)

      // --- Task delete: dialog first, cancel keeps the row.
      await page.goto('/backend/agentic-tasks', { waitUntil: 'domcontentloaded' })
      const taskRow = page.getByRole('row', { name: new RegExp(taskName) })
      await expect(taskRow).toBeVisible({ timeout: 10_000 })

      let sawDelete = false
      page.on('request', (req) => {
        if (req.method() === 'DELETE' && req.url().includes('agent_orchestrator/tasks')) sawDelete = true
      })

      await taskRow.getByRole('button').last().click()
      await page.getByRole('menuitem', { name: /delete/i }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      expect(sawDelete, 'no DELETE may fire before confirmation').toBe(false)
      await dialog.getByRole('button', { name: /cancel/i }).click()
      await expect(dialog).toBeHidden()
      await expect(taskRow).toBeVisible()

      // --- Confirm actually deletes.
      await taskRow.getByRole('button').last().click()
      await page.getByRole('menuitem', { name: /delete/i }).click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: /confirm/i }).click()
      await expect(page.getByRole('row', { name: new RegExp(taskName) })).toHaveCount(0, { timeout: 10_000 })
      taskId = null

      // --- Eval-assertion delete: dialog appears; cancelled, row stays.
      await page.goto('/backend/eval-assertions', { waitUntil: 'domcontentloaded' })
      const assertionRow = page.getByRole('row', { name: new RegExp(assertionKey) })
      await expect(assertionRow).toBeVisible({ timeout: 10_000 })
      await assertionRow.getByRole('button').last().click()
      await page.getByRole('menuitem', { name: /delete/i }).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await page.getByRole('alertdialog').getByRole('button', { name: /cancel/i }).click()
      await expect(assertionRow).toBeVisible()
    } finally {
      if (taskId) {
        await apiRequest(request, 'DELETE', `/api/agent_orchestrator/tasks?id=${encodeURIComponent(taskId)}`, { token }).catch(() => {})
      }
      if (assertionId) {
        await apiRequest(request, 'DELETE', `/api/agent_orchestrator/eval-assertions?id=${encodeURIComponent(assertionId)}`, { token }).catch(() => {})
      }
    }
  })
})
