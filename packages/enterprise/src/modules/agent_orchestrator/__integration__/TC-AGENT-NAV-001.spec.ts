import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-NAV-001: the playground run response carries `runId` + `proposalId`,
 * and both deep links render.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-navigation-pass.md
 * (§1 Playground → trace & proposal, Integration Test Coverage).
 *
 * Executes a REAL agent run (LLM provider key required in the environment —
 * same env expectation as the live-audit walkthrough); execution is env-gated.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

type AgentListItem = { id?: string; sampleInput?: unknown; resultKind?: string }
type RunResponse = { kind?: string; runId?: string | null; proposalId?: string | null }

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-NAV-001: playground response ids + deep links', () => {
  test('run returns {runId, proposalId}; trace and caseload deep links render', async ({ page, request }) => {
    test.slow()

    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)

    const agentsRes = await apiRequest(request, 'GET', '/api/agent_orchestrator/agents', { token })
    expect(agentsRes.status(), await agentsRes.text()).toBe(200)
    const agentsBody = await readJsonSafe<{ items?: AgentListItem[] }>(agentsRes)
    const agent = (agentsBody?.items ?? []).find(
      (item) => typeof item.id === 'string' && item.sampleInput !== undefined,
    )
    expect(agent, 'a registered agent with a declared sampleInput is required').toBeTruthy()

    const runRes = await apiRequest(
      request,
      'POST',
      `/api/agent_orchestrator/agents/${encodeURIComponent(agent!.id!)}/run`,
      { token, data: { input: agent!.sampleInput } },
    )
    expect(runRes.status(), await runRes.text()).toBe(200)
    const run = (await runRes.json()) as RunResponse

    expect(typeof run.runId, 'runId must be returned additively next to the result').toBe('string')
    expect(run.runId).toMatch(/^[0-9a-f-]{36}$/)
    if (run.kind === 'actionable') {
      expect(typeof run.proposalId, 'actionable runs must return the created proposal id').toBe('string')
    }

    await loginAsAdmin(page)

    await page.goto(`/backend/traces/${run.runId}`, { waitUntil: 'domcontentloaded' })
    await expect(
      page.getByRole('heading', { name: agent!.id! }),
      'the trace inspector must render the run for the returned runId',
    ).toBeVisible({ timeout: 15_000 })

    if (typeof run.proposalId === 'string') {
      await page.goto(`/backend/caseload/${run.proposalId}`, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(new RegExp(`/backend/caseload/${run.proposalId}`))
      await expect(
        page.getByText(agent!.id!).first(),
        'the caseload detail must render the proposal for the returned proposalId',
      ).toBeVisible({ timeout: 15_000 })
    }
  })
})
