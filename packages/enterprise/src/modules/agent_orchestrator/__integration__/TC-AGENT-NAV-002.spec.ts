import { expect, test, type Page } from '@playwright/test'
import { randomInt } from 'node:crypto'
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

/**
 * TC-AGENT-NAV-002: trace ↔ proposal roundtrip.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-navigation-pass.md
 * (§2 Trace ↔ proposal symmetry, Integration Test Coverage).
 *
 * A trace of a run with a proposal shows "Open proposal" and navigates to the
 * caseload detail; the caseload detail's trace link returns to the same run.
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

test.describe('TC-AGENT-NAV-002: trace to proposal and back', () => {
  test('Open proposal navigates to caseload; caseload trace link returns to the run', async ({ page, request }) => {
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
    const email = `tc-nav-002-${stamp}@example.com`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-NAV-002 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-nav-002-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: [
          'agent_orchestrator.proposals.view',
          'agent_orchestrator.proposals.dispose',
          'agent_orchestrator.agents.view',
          'agent_orchestrator.trace.view',
        ],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: orgId,
        roles: [roleId],
        name: 'QA TC-AGENT-NAV-002',
      })

      const createdAt = new Date(Date.now() - 60_000)
      const [runId] = await insertAgentRunFixtures([
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, createdAt },
      ])
      const [proposalId] = await insertAgentProposalFixtures([
        {
          tenantId: tenantId!,
          organizationId: orgId!,
          agentId: AGENT_ID,
          runId,
          disposition: 'pending' as const,
          createdAt,
        },
      ])

      await loginAs(page, email, password)

      // --- Trace inspector shows "Open proposal" and lands on the caseload detail.
      await page.goto(`/backend/traces/${runId}`, { waitUntil: 'domcontentloaded' })
      const openProposal = page.getByRole('button', { name: /open proposal/i })
      await expect(openProposal, 'trace of a run with a proposal must link to it').toBeVisible({ timeout: 15_000 })
      await openProposal.click()
      await expect(page).toHaveURL(new RegExp(`/backend/caseload/${proposalId}`), { timeout: 10_000 })

      // --- The caseload detail's trace link returns to the SAME run (roundtrip).
      const openTrace = page.getByRole('button', { name: /open full trace/i })
      await expect(openTrace).toBeVisible({ timeout: 10_000 })
      await openTrace.click()
      await expect(page).toHaveURL(new RegExp(`/backend/traces/${runId}`), { timeout: 10_000 })
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => {})
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
