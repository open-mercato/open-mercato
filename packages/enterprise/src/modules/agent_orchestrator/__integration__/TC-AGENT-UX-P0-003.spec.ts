import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-UX-P0-003: destructive deletes confirm before firing.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-p0-hotfixes.md
 * (§4 delete confirmations, Testing Strategy).
 *
 * Creates a throwaway process definition + eval assertion over the API, then
 * drives the UI: the definition-delete row action must open the shared
 * ConfirmDialog (no DELETE before confirmation), Cancel keeps the row, Confirm
 * removes it. The eval-assertion leg then asserts the surface that REPLACED the
 * deleted `/backend/eval-assertions` list — a reversible toggle inside the
 * owning agent's workspace, with no destructive delete to confirm (see the leg
 * for why that removal was deliberate).
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

    // Assertions are managed inside the owning agent's workspace, so the
    // second leg needs a registered agent to open. Any one will do — the
    // seeded assertion applies to all of them.
    const agentsResponse = await apiRequest(request, 'GET', '/api/agent_orchestrator/agents', { token })
    expect(agentsResponse.status(), await agentsResponse.text()).toBe(200)
    const agentId = (await readJsonSafe<{ items?: Array<{ id?: string }> }>(agentsResponse))?.items?.[0]?.id ?? null
    expect(agentId, 'at least one registered agent is required').toBeTruthy()

    try {
      const taskResponse = await apiRequest(request, 'POST', '/api/agent_orchestrator/process-definitions', {
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
          // `scorerKey` selects the registry scorer; `key` is this assertion's
          // own id and resolves to no scorer, which the write boundary rejects.
          scorerKey: 'json_path_compare',
          config: { path: '$.ok', operator: 'eq', value: 'true' },
          severity: 'warn',
          appliesTo: '*',
          enabled: false,
        },
      })
      expect(assertionResponse.ok(), 'seed assertion create must succeed').toBeTruthy()
      assertionId = (await readJsonSafe<{ id?: string }>(assertionResponse))?.id ?? null

      await loginAsAdmin(page)

      // --- Task delete: dialog first, cancel keeps the row.
      await page.goto('/backend/processes/definitions', { waitUntil: 'domcontentloaded' })
      const taskRow = page.getByRole('row', { name: new RegExp(taskName) })
      await expect(taskRow).toBeVisible({ timeout: 10_000 })

      let sawDelete = false
      page.on('request', (req) => {
        if (req.method() === 'DELETE' && req.url().includes('agent_orchestrator/process-definitions')) sawDelete = true
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

      // --- Eval assertions: the per-agent action is a reversible toggle, and
      // there is deliberately NO destructive delete to confirm.
      //
      // This leg used to drive a delete row action on `/backend/eval-assertions`.
      // That page was folded into the owning agent's workspace by the
      // 2026-07-24 agent-centric-workspace-and-eval-consolidation, which also
      // decided NOT to re-expose the delete: an assertion is shared (this one is
      // `appliesTo: '*'`), so removing it from one agent's page would silently
      // unscore every other agent. The rule now guarded at the unit level by
      // `__tests__/p0-honesty-safety.test.ts`. §4's requirement — a destructive
      // delete must confirm first — is therefore exercised above on the process
      // definition; here we assert the replacement contract holds in the real
      // app: the row is present, its control is the enable/disable switch, and
      // no delete affordance is offered on it.
      await page.goto(
        `/backend/agents/${encodeURIComponent(agentId!)}?tab=evaluation&section=assertions`,
        { waitUntil: 'domcontentloaded' },
      )
      const assertionRow = page
        .locator('[data-slot="accordion-item"]')
        .filter({ hasText: taskName })
      await expect(assertionRow).toBeVisible({ timeout: 15_000 })
      await expect(assertionRow.getByRole('switch', { name: 'Enabled' })).toBeVisible()
      await expect(
        assertionRow.getByRole('button', { name: /delete/i }),
        'a shared assertion must not be deletable from one agent’s workspace',
      ).toHaveCount(0)
    } finally {
      if (taskId) {
        await apiRequest(request, 'DELETE', `/api/agent_orchestrator/process-definitions?id=${encodeURIComponent(taskId)}`, { token }).catch(() => {})
      }
      if (assertionId) {
        await apiRequest(request, 'DELETE', `/api/agent_orchestrator/eval-assertions?id=${encodeURIComponent(assertionId)}`, { token }).catch(() => {})
      }
    }
  })
})
