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
  insertAgentRunFixtures,
} from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-UXC-004: Traces run-id prefix search hits the full history.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-consistency-pass.md
 * (Area 6: `idPrefix` on the runs route as a uuid range filter, debounced UI).
 *
 * Seeds 30 runs so the OLDEST one sits beyond the default newest-first page —
 * finding it by id prefix therefore proves the search is server-side over the
 * whole history, not a quick filter over the loaded page. An unrelated prefix
 * must yield the table's empty result, not stale rows.
 */

const AGENT_ID = 'deals.health_check'
const RUN_COUNT = 30

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-UXC-004: run-id prefix search on Traces', () => {
  test('an id prefix finds the run beyond page 1; an unrelated prefix is empty', async ({ page, request }) => {
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
    const email = `tc-uxc-004-${stamp}@example.com`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-UXC-004 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-uxc-004-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: [
          'agent_orchestrator.trace.view',
          'agent_orchestrator.agents.view',
          'agent_orchestrator.proposals.view',
        ],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: orgId,
        roles: [roleId],
        name: 'QA TC-AGENT-UXC-004',
      })

      // Oldest-first seed: with newest-first default sort and pageSize 20, the
      // FIRST seeded run is off page 1 — the prefix search must still find it.
      const base = Date.now() - RUN_COUNT * 60_000
      const runIds = await insertAgentRunFixtures(
        Array.from({ length: RUN_COUNT }, (_, index) => ({
          tenantId: tenantId!,
          organizationId: orgId!,
          agentId: AGENT_ID,
          createdAt: new Date(base + index * 60_000),
        })),
      )
      const targetId = runIds[0]
      const targetPrefix = targetId.replace(/-/g, '').slice(0, 12)

      await loginAs(page, email, password)
      await page.goto('/backend/traces', { waitUntil: 'domcontentloaded' })

      const searchBox = page.getByPlaceholder(/run id/i)
      await expect(searchBox).toBeVisible({ timeout: 15_000 })

      // Positive leg: prefix finds exactly the target run, across page bounds.
      await searchBox.fill(targetPrefix)
      const bodyRows = page.locator('table tbody tr')
      await expect(bodyRows).toHaveCount(1, { timeout: 15_000 })
      await bodyRows.first().click()
      await expect(page).toHaveURL(new RegExp(`/backend/traces/${targetId}`), { timeout: 10_000 })

      // Negative leg: an unrelated prefix yields no rows (server-filtered).
      await page.goto('/backend/traces', { waitUntil: 'domcontentloaded' })
      await expect(page.getByPlaceholder(/run id/i)).toBeVisible({ timeout: 15_000 })
      await page.getByPlaceholder(/run id/i).fill('deadbeefdead')
      await expect(page.locator('table tbody tr')).toHaveCount(0, { timeout: 15_000 })
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => {})
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
