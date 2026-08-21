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
import { deleteAgentProcessesForOrganization, insertAgentProcessFixture } from './helpers/agentUxFixtures'

/**
 * TC-AGENT-UX-P0-004: Caseload inbox pager + non-operable process stub actions.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-p0-hotfixes.md
 * (§3 stub actions, §6 inbox pager, Testing Strategy).
 *
 * Seeds 25 pending proposals into a throwaway org: the inbox (primary decision
 * view) must show a "1–20 of 25" range label and reach the remaining 5 rows on
 * page 2 — before this fix it hard-capped at the first 20 with no affordance.
 * A seeded agent_processes row then backs the detail-page assertion that
 * Pause/Reassign/Take-over are either hidden or disabled according to the
 * preview-UI flag, never enabled success-flashing no-ops.
 */

const AGENT_ID = 'deals.health_check'
const PENDING_COUNT = 25

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-UX-P0-004: inbox pager and non-operable process actions', () => {
  test('inbox pages past 20 rows and process actions cannot be invoked', async ({ page, request }) => {
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
    const email = `tc-ux-p0-004-${stamp}@example.com`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-UX-P0-004 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-ux-p0-004-${stamp}`,
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
        name: 'QA TC-AGENT-UX-P0-004',
      })

      const base = Date.now() - PENDING_COUNT * 60_000
      const runIds = await insertAgentRunFixtures(
        Array.from({ length: PENDING_COUNT }, (_, index) => ({
          tenantId: tenantId!,
          organizationId: orgId!,
          agentId: AGENT_ID,
          createdAt: new Date(base + index * 60_000),
        })),
      )
      await insertAgentProposalFixtures(
        runIds.map((runId, index) => ({
          tenantId: tenantId!,
          organizationId: orgId!,
          agentId: AGENT_ID,
          runId,
          disposition: 'pending' as const,
          createdAt: new Date(base + index * 60_000),
        })),
      )
      const processId = await insertAgentProcessFixture({
        tenantId: tenantId!,
        organizationId: orgId!,
        subjectLabel: `TC-UX-P0-004 ${stamp}`,
      })

      await loginAs(page, email, password)

      // --- Inbox range label + page 2 reachability.
      await page.goto('/backend/caseload', { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(`1–20 of ${PENDING_COUNT}`)).toBeVisible({ timeout: 15_000 })
      await page.getByRole('navigation', { name: /pagination/i }).getByRole('button', { name: /page 2/i }).click()
      await expect(page.getByText(`21–${PENDING_COUNT} of ${PENDING_COUNT}`)).toBeVisible({ timeout: 10_000 })

      // --- Preview stubs are hidden by default; when the preview flag enables
      // them they remain disabled and therefore cannot claim a real action.
      await page.goto(`/backend/processes/${encodeURIComponent(processId)}`, { waitUntil: 'domcontentloaded' })
      const actionButtons = [/pause/i, /reassign/i, /take over/i].map((name) => page.getByRole('button', { name }))
      const visibleActionCount = (await Promise.all(actionButtons.map((button) => button.count()))).reduce(
        (sum, count) => sum + count,
        0,
      )
      if (visibleActionCount > 0) {
        for (const button of actionButtons) await expect(button).toBeDisabled()
      } else {
        for (const button of actionButtons) await expect(button).toHaveCount(0)
      }
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => {})
      await deleteAgentProcessesForOrganization(orgId).catch(() => {})
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
