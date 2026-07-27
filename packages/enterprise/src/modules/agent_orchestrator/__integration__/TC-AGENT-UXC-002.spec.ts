import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteAgentTaskRunsByTaskDefinitionIds,
  insertAgentTaskRunFixtures,
} from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-UXC-002: the Agentic Tasks list shows last-run health and
 * live-updates it — no manual reload.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-consistency-pass.md
 * (Area 1: `last_run` route projection + `task_run.*` subscription).
 *
 * Legs:
 * 1. Projection — a directly-seeded failed ledger row renders a "Failed"
 *    Last-run badge on the task's list row.
 * 2. Live — `POST /tasks/:id/run` (202, no worker needed) emits the
 *    `task_run.started` clientBroadcast; the open list flips the badge to
 *    "Running" without any reload.
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

test.describe('TC-AGENT-UXC-002: tasks list last-run health', () => {
  test('failed last run renders; Run-now flips the badge live', async ({ page, request }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const taskName = `TC-UXC-002 task ${stamp}`
    let taskId: string | null = null

    try {
      // Seed a task owned by the admin org (API create resolves the scope).
      const createResponse = await apiRequest(request, 'POST', '/api/agent_orchestrator/tasks', {
        token,
        data: {
          name: taskName,
          targetType: 'agent',
          targetAgentId: 'deals.health_check',
          enabled: true,
        },
      })
      expect(createResponse.ok(), 'seed task create must succeed').toBeTruthy()
      taskId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(taskId).toBeTruthy()

      // Resolve the task's scope from the list response (tenant/org of the row).
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/tasks?id=${encodeURIComponent(taskId!)}&page=1&pageSize=1`,
        { token },
      )
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      const row = listBody?.items?.[0] ?? null
      const tenantId = typeof row?.tenant_id === 'string' ? row.tenant_id : null
      const organizationId = typeof row?.organization_id === 'string' ? row.organization_id : null
      expect(tenantId && organizationId, 'task row must expose its scope').toBeTruthy()

      // Leg 1 — a failed ledger row from an hour ago drives the projection.
      const failedAt = new Date(Date.now() - 60 * 60_000)
      await insertAgentTaskRunFixtures([
        {
          tenantId: tenantId!,
          organizationId: organizationId!,
          taskDefinitionId: taskId!,
          targetAgentId: 'deals.health_check',
          status: 'failed',
          createdAt: failedAt,
          completedAt: failedAt,
          failureReason: '[integration-seed] deterministic failure',
        },
      ])

      await loginAsAdmin(page)
      await page.goto('/backend/agentic-tasks', { waitUntil: 'domcontentloaded' })
      const taskRow = page.getByRole('row', { name: new RegExp(taskName) })
      await expect(taskRow).toBeVisible({ timeout: 15_000 })
      await expect(taskRow.getByText('Failed', { exact: true })).toBeVisible({ timeout: 10_000 })

      // Leg 2 — Run-now via API (always-async 202, emits task_run.started with
      // clientBroadcast). The open list's coalesced subscription refetches the
      // projection: the newest ledger row is the running one. NO reload here.
      const runResponse = await apiRequest(
        request,
        'POST',
        `/api/agent_orchestrator/tasks/${encodeURIComponent(taskId!)}/run`,
        { token, data: { input: {} } },
      )
      expect(runResponse.status(), 'run-now must be accepted asynchronously').toBe(202)

      await expect(taskRow.getByText('Running', { exact: true })).toBeVisible({ timeout: 30_000 })
    } finally {
      if (taskId) {
        await deleteAgentTaskRunsByTaskDefinitionIds([taskId]).catch(() => {})
        await apiRequest(request, 'DELETE', `/api/agent_orchestrator/tasks?id=${encodeURIComponent(taskId)}`, { token }).catch(() => {})
      }
    }
  })
})
