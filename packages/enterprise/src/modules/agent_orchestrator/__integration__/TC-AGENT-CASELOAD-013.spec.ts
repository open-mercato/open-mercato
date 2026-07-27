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
 * TC-AGENT-CASELOAD-013: queue state round-trips through the URL.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-caseload-operator-throughput.md
 * (Phase 5 — URL-encoded queue state, explicit query-string passthrough).
 *
 * A deep link with view/sort/page/pageSize renders that exact queue slice;
 * opening a detail forwards the params on the link, and disposing there
 * redirects back to the SAME slice (not the bare default queue).
 */

const AGENT_ID = 'deals.health_check'
const QUEUE_QUERY = 'view=list&sort=agentAsc&page=2&pageSize=10'

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-CASELOAD-013: URL queue-state round-trip', () => {
  test('deep link renders the slice; detail dispose returns to the same segment/sort/page', async ({ page, request }) => {
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
    const email = `tc-caseload-013-${stamp}@example.com`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-CASELOAD-013 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-caseload-013-${stamp}`,
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
        name: 'QA TC-AGENT-CASELOAD-013',
      })

      // 12 pending → pageSize 10 puts 2 rows on page 2.
      const base = Date.now() - 2 * 60 * 60_000
      const runSeeds = Array.from({ length: 12 }, (_, index) => ({
        tenantId: tenantId!,
        organizationId: orgId!,
        agentId: AGENT_ID,
        createdAt: new Date(base + index * 60_000),
      }))
      const runIds = await insertAgentRunFixtures(runSeeds)
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

      await loginAs(page, email, password)
      await page.goto(`/backend/caseload?${QUEUE_QUERY}`, { waitUntil: 'domcontentloaded' })

      // The deep link renders that exact slice: list view, page 2 of 12 → 2 rows,
      // and the sort select reflects Agent A–Z (not the default).
      const rows = page.locator('table tbody tr')
      await expect(rows).toHaveCount(2, { timeout: 15_000 })
      await expect(page.getByText('Agent A–Z')).toBeVisible()
      // The mount-time page reset must NOT clobber the deep-linked page=2.
      await expect(page).toHaveURL(new RegExp('page=2'), { timeout: 10_000 })

      // Opening a detail forwards the queue params on the link.
      await rows.nth(0).click()
      await expect(page).toHaveURL(/\/backend\/caseload\/[0-9a-f-]+\?/, { timeout: 15_000 })
      for (const param of QUEUE_QUERY.split('&')) {
        expect(page.url()).toContain(param)
      }

      // Disposing from the detail returns to the SAME queue slice.
      await page.getByRole('button', { name: 'Approve', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/backend/caseload\\?`), { timeout: 15_000 })
      for (const param of QUEUE_QUERY.split('&')) {
        expect(page.url()).toContain(param)
      }
      // Page 2 now holds the single remaining overflow row — still the
      // deep-linked slice, not the default first page of the inbox view.
      await expect(page.locator('table tbody tr')).toHaveCount(1, { timeout: 15_000 })
      await expect(page.getByText('Agent A–Z')).toBeVisible()
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => {})
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
