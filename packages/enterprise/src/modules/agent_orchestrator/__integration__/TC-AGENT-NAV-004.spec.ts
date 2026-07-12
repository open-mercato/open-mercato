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
 * TC-AGENT-NAV-004: process detail links its pending decision to the Caseload.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-navigation-pass.md
 * (§4 Processes → Caseload, Integration Test Coverage).
 *
 * A waiting_on_you process must show the "Review in Caseload" CTA (header +
 * pending step panel) and land on the pending proposal's caseload detail.
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

test.describe('TC-AGENT-NAV-004: process detail review-in-caseload CTA', () => {
  test('waiting_on_you process links to the pending proposal decision', async ({ page, request }) => {
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
    const email = `tc-nav-004-${stamp}@example.com`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-NAV-004 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-nav-004-${stamp}`,
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
        name: 'QA TC-AGENT-NAV-004',
      })

      const processId = randomUUID()
      await insertAgentProcessFixture({
        tenantId: tenantId!,
        organizationId: orgId!,
        processId,
        status: 'waiting_on_you',
        subjectLabel: `TC-NAV-004 ${stamp}`,
      })
      const createdAt = new Date(Date.now() - 45 * 60_000)
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
          processId,
          stepId: 'review',
          createdAt,
        },
      ])

      await loginAs(page, email, password)
      await page.goto(`/backend/processes/${encodeURIComponent(processId)}`, { waitUntil: 'domcontentloaded' })

      // Header CTA (status waiting_on_you) and the pending step panel both link
      // to the decision; the auto-selected first step IS the pending proposal.
      const ctas = page.getByRole('button', { name: /review in caseload/i })
      await expect(ctas.first()).toBeVisible({ timeout: 15_000 })
      expect(await ctas.count(), 'header CTA + pending-step panel CTA expected').toBeGreaterThanOrEqual(2)

      await ctas.first().click()
      await expect(page).toHaveURL(new RegExp(`/backend/caseload/${proposalId}`), { timeout: 10_000 })
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => {})
      await deleteAgentProcessesForOrganization(orgId).catch(() => {})
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
