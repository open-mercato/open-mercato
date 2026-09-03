import { expect, test, type Page } from '@playwright/test'
import { randomInt, randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteAgentOrchestratorRowsForOrganization,
  insertAgentProposalFixtures,
  insertAgentRunFixtures,
} from './helpers/agentPerfFixtures'
import { deleteAgentProcessesForOrganization, insertAgentProcessFixture } from './helpers/agentUxFixtures'

/**
 * TC-AGENT-NAV-003: Overview stuck queue "Open process" is processId-gated.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-navigation-pass.md
 * (§3 processId-gated "Open process", Integration Test Coverage).
 *
 * A workflow-born pending proposal's row navigates to the REAL process detail
 * (the old code pushed the proposal id, landing on the degraded banner); a
 * processless proposal's row renders no "Open process" affordance at all.
 */

const AGENT_ID = 'deals.health_check'

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-NAV-003: overview open-process gating', () => {
  test('workflow-born row opens the real process; processless row has no link', async ({ page, request }) => {
    test.slow()

    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const password = 'StrongSecret123!'
    let tenantId = getTokenContext(superadminToken).tenantId
    if (!tenantId) {
      const existing = await apiRequest(request, 'GET', '/api/directory/organizations?page=1&pageSize=1', { token: superadminToken })
      const body = await readJsonSafe<{ items?: Array<{ tenantId?: string | null }> }>(existing)
      tenantId = body?.items?.[0]?.tenantId ?? ''
    }
    expect(tenantId, 'a tenant id is required to place the throwaway org').toBeTruthy()

    let orgId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    const email = `tc-nav-003-${stamp}@example.com`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-NAV-003 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-nav-003-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: [
          'agent_orchestrator.proposals.view',
          'agent_orchestrator.proposals.dispose',
          'agent_orchestrator.agents.view',
          'agent_orchestrator.trace.view',
          'agent_orchestrator.processes.view',
        ],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: orgId,
        roles: [roleId],
        name: 'QA TC-AGENT-NAV-003',
      })

      const processId = randomUUID()
      const subjectLabel = `TC-NAV-003 ${stamp}`
      await insertAgentProcessFixture({
        tenantId: tenantId!,
        organizationId: orgId!,
        processId,
        status: 'waiting_on_you',
        subjectLabel,
      })

      const olderAt = new Date(Date.now() - 90 * 60_000)
      const newerAt = new Date(Date.now() - 30 * 60_000)
      const [workflowRunId, plainRunId] = await insertAgentRunFixtures([
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, createdAt: olderAt },
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, createdAt: newerAt },
      ])
      await insertAgentProposalFixtures([
        {
          tenantId: tenantId!,
          organizationId: orgId!,
          agentId: AGENT_ID,
          runId: workflowRunId,
          disposition: 'pending' as const,
          processId,
          createdAt: olderAt,
        },
        {
          tenantId: tenantId!,
          organizationId: orgId!,
          agentId: AGENT_ID,
          runId: plainRunId,
          disposition: 'pending' as const,
          createdAt: newerAt,
        },
      ])

      await loginAs(page, email, password)
      await page.goto('/backend/overview', { waitUntil: 'domcontentloaded' })

      // Stuck rows fall back to the run-id prefix as their reference; use it to
      // address each row unambiguously.
      const workflowRow = page.locator('tr', { hasText: workflowRunId.slice(0, 12) })
      const plainRow = page.locator('tr', { hasText: plainRunId.slice(0, 12) })
      await expect(workflowRow).toBeVisible({ timeout: 15_000 })
      await expect(plainRow).toBeVisible({ timeout: 15_000 })

      await expect(
        plainRow.getByRole('button', { name: /open process/i }),
        'a processless proposal must not offer an Open process link',
      ).toHaveCount(0)

      const openProcess = workflowRow.getByRole('button', { name: /open process/i })
      await expect(openProcess).toBeVisible()
      await openProcess.click()
      await expect(page).toHaveURL(new RegExp(`/backend/processes/${processId}`), { timeout: 10_000 })
      await expect(
        page.getByText(subjectLabel).first(),
        'the link must land on the REAL projection-backed process detail',
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => {})
      await deleteAgentProcessesForOrganization(orgId).catch(() => {})
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
