import { expect, test, type Page } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteAgentEvalCasesByIds,
  deleteAgentRunsByIds,
  insertAgentRunFixtures,
} from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-WORKSPACE-001: the agent workspace deep-links to Evaluation,
 * scopes assertions/cases to the selected agent, and keeps optimistic-lock
 * assertion toggles working after the standalone eval lists are consolidated.
 * Source: .ai/specs/enterprise/agent-orchestrator/
 * 2026-07-24-agent-centric-workspace-and-eval-consolidation.md
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

type AgentListItem = { id?: string; label?: string }

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-WORKSPACE-001: agent-centric evaluation workspace', () => {
  test('deep-links, scopes data, and persists an assertion toggle', async ({ page, request }) => {
    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const context = getTokenContext(token)
    expect(context.tenantId, 'admin token must carry a tenant id').toBeTruthy()
    expect(context.organizationId, 'admin token must carry an organization id').toBeTruthy()

    const agentsResponse = await apiRequest(request, 'GET', '/api/agent_orchestrator/agents', { token })
    expect(agentsResponse.status(), await agentsResponse.text()).toBe(200)
    const agentsBody = await readJsonSafe<{ items?: AgentListItem[] }>(agentsResponse)
    const agent = (agentsBody?.items ?? []).find((item) => typeof item.id === 'string' && item.id.length > 0)
    expect(agent?.id, 'at least one registered agent is required').toBeTruthy()

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const assertionTitle = `Workspace assertion ${stamp}`
    const assertionKey = `workspace-assertion-${stamp}`
    const seededRunIds: string[] = []
    const createdEvalCaseIds: string[] = []
    let assertionId: string | null = null

    try {
      const assertionResponse = await apiRequest(request, 'POST', '/api/agent_orchestrator/eval-assertions', {
        token,
        data: {
          key: assertionKey,
          title: assertionTitle,
          type: 'deterministic',
          // `scorerKey` selects the registry scorer; `key` is this assertion's
          // own id and resolves to no scorer, which the write boundary rejects.
          scorerKey: 'json_path_compare',
          config: { path: '$.ok', operator: 'eq', value: 'true' },
          severity: 'warn',
          appliesTo: agent!.id,
          enabled: true,
        },
      })
      expect(assertionResponse.ok(), await assertionResponse.text()).toBeTruthy()
      assertionId = (await readJsonSafe<{ id?: string }>(assertionResponse))?.id ?? null
      expect(assertionId).toBeTruthy()

      const [runId] = await insertAgentRunFixtures([
        {
          tenantId: context.tenantId!,
          organizationId: context.organizationId!,
          agentId: agent!.id!,
          status: 'ok',
          createdAt: new Date(),
        },
      ])
      seededRunIds.push(runId)

      const caseResponse = await apiRequest(
        request,
        'POST',
        `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/eval-case`,
        { token },
      )
      expect(caseResponse.ok(), await caseResponse.text()).toBeTruthy()
      const evalCaseId = (await readJsonSafe<{ evalCase?: { id?: string } }>(caseResponse))?.evalCase?.id
      expect(evalCaseId).toBeTruthy()
      createdEvalCaseIds.push(evalCaseId!)

      await loginAsAdmin(page)
      await page.goto(
        `/backend/agents/${encodeURIComponent(agent!.id!)}?tab=evaluation&section=assertions`,
        { waitUntil: 'domcontentloaded' },
      )

      await expect(page.getByRole('tab', { name: 'Evaluation' })).toHaveAttribute('data-state', 'active')
      await expect(page.getByRole('tab', { name: /Assertions/ })).toHaveAttribute('data-state', 'active')
      await expect(page.getByText(assertionTitle)).toBeVisible({ timeout: 15_000 })

      const enabledSwitch = page.getByRole('switch', { name: 'Enabled' }).first()
      await expect(enabledSwitch).toBeChecked()
      await enabledSwitch.click()
      await expect(enabledSwitch).not.toBeChecked()

      const assertionList = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/eval-assertions?appliesTo=${encodeURIComponent(agent!.id!)}&pageSize=100`,
        { token },
      )
      const assertionListBody = await readJsonSafe<{ items?: Array<{ id?: string; enabled?: boolean }> }>(assertionList)
      expect(assertionListBody?.items?.find((item) => item.id === assertionId)?.enabled).toBe(false)

      await page.getByRole('tab', { name: 'Overview' }).click()
      await page.getByRole('button', { name: 'Review' }).click()
      await expect(page.getByRole('tab', { name: 'Evaluation' })).toHaveAttribute('data-state', 'active')
      await expect(page.getByRole('tab', { name: /Cases/ })).toHaveAttribute('data-state', 'active')
    } finally {
      if (assertionId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/agent_orchestrator/eval-assertions?id=${encodeURIComponent(assertionId)}`,
          { token },
        ).catch(() => undefined)
      }
      await deleteAgentEvalCasesByIds(createdEvalCaseIds).catch(() => undefined)
      await deleteAgentRunsByIds(seededRunIds).catch(() => undefined)
    }
  })
})
