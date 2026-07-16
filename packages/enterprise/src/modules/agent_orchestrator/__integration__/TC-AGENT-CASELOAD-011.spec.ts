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
 * TC-AGENT-CASELOAD-011: bulk selection survives live reloads.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-caseload-operator-throughput.md
 * (Phase 1 selection preservation, exercised end-to-end in Phase 5).
 *
 * Three phases against the list view (the view with visible checkboxes):
 * 1. select rows A+B, dispose the UNSELECTED row C — the `proposal.disposed`
 *    clientBroadcast drives an SSE reload (no manual refresh) and both
 *    checkboxes survive it;
 * 2. dispose the SELECTED row B — the disposed row leaves the selection,
 *    A stays;
 * 3. seed a brand-new proposal D directly (no event) and refresh — the reload
 *    with a new row present still keeps A selected.
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

test.describe('TC-AGENT-CASELOAD-011: selection survives live reloads', () => {
  test('checkboxes persist across SSE reloads; disposed rows drop out of the set', async ({ page, request }) => {
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
    const email = `tc-caseload-011-${stamp}@example.com`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-CASELOAD-011 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-caseload-011-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: [
          'agent_orchestrator.proposals.view',
          'agent_orchestrator.proposals.dispose',
          'agent_orchestrator.agents.view',
        ],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: orgId,
        roles: [roleId],
        name: 'QA TC-AGENT-CASELOAD-011',
      })

      // Default sort (waitingDesc) renders createdAt ASC → rows [A, B, C].
      const base = Date.now() - 60 * 60_000
      const runIds = await insertAgentRunFixtures([
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, createdAt: new Date(base) },
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, createdAt: new Date(base + 60_000) },
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, createdAt: new Date(base + 120_000) },
      ])
      await insertAgentProposalFixtures([
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, runId: runIds[0], disposition: 'pending', createdAt: new Date(base) },
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, runId: runIds[1], disposition: 'pending', createdAt: new Date(base + 60_000) },
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, runId: runIds[2], disposition: 'pending', createdAt: new Date(base + 120_000) },
      ])

      await loginAs(page, email, password)
      await page.goto('/backend/caseload?view=list', { waitUntil: 'domcontentloaded' })

      const rows = page.locator('table tbody tr')
      await expect(rows).toHaveCount(3, { timeout: 15_000 })

      // Select A (row 0) and B (row 1); the bulk bar confirms the count.
      await rows.nth(0).getByRole('checkbox').check()
      await rows.nth(1).getByRole('checkbox').check()
      await expect(page.getByText('2 selected')).toBeVisible()

      // Phase 1 — dispose the UNSELECTED row C via its hover approve action.
      // The proposal.disposed clientBroadcast triggers the coalesced SSE
      // reload: the row count drops WITHOUT any manual refresh, and the
      // half-built selection survives the reload.
      await rows.nth(2).hover()
      await rows.nth(2).getByRole('button', { name: 'Approve proposal' }).click()
      await expect(rows).toHaveCount(2, { timeout: 20_000 })
      await expect(page.getByText('2 selected')).toBeVisible()
      await expect(rows.nth(0).getByRole('checkbox')).toBeChecked()
      await expect(rows.nth(1).getByRole('checkbox')).toBeChecked()

      // Phase 2 — dispose the SELECTED row B: the disposed row leaves the
      // selection while A stays selected.
      await rows.nth(1).hover()
      await rows.nth(1).getByRole('button', { name: 'Approve proposal' }).click()
      await expect(rows).toHaveCount(1, { timeout: 20_000 })
      await expect(page.getByText('1 selected')).toBeVisible()
      await expect(rows.nth(0).getByRole('checkbox')).toBeChecked()

      // Phase 3 — a brand-new proposal appears (direct seed emits no event, so
      // the manual refresh stands in for the next reload): the new row renders
      // unselected and A's checkbox still survives.
      const extraRunIds = await insertAgentRunFixtures([
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, createdAt: new Date(base + 180_000) },
      ])
      await insertAgentProposalFixtures([
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, runId: extraRunIds[0], disposition: 'pending', createdAt: new Date(base + 180_000) },
      ])
      await page.getByRole('button', { name: 'Refresh' }).click()
      await expect(rows).toHaveCount(2, { timeout: 15_000 })
      await expect(page.getByText('1 selected')).toBeVisible()
      await expect(rows.nth(0).getByRole('checkbox')).toBeChecked()
      await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked()
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => {})
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
