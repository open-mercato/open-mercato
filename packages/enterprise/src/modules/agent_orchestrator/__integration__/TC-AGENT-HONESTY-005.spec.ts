import { expect, test, type Page } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteAgentProposalsByIds,
  deleteAgentRunsByIds,
  insertAgentProposalFixtures,
  insertAgentRunFixtures,
} from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-HONESTY-005: per-panel Overview failure states + window round-trip.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-data-honesty-pass.md
 * (§3.4-§3.5, Integration Test Coverage).
 *
 * A role with `proposals.view` but WITHOUT `agents.view` opens the Overview:
 * the stuck/SLA panel must stay real (it renders the seeded pending proposal),
 * while the Agent-trust panel shows a forbidden note instead of the lying
 * "No agents yet" empty state. The window select round-trips through the URL
 * (?window=30d preselects "Last 30 days").
 */

const STAMP = `${Date.now()}-${randomInt(1000, 9999)}`
const AGENT_ID = `qa.tc-honesty-005-${STAMP}`

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-HONESTY-005: overview per-panel honesty', () => {
  test('trust panel is forbidden for a restricted role while the stuck panel stays real', async ({ page, request }) => {
    test.slow()

    const superadminToken = await getAuthToken(request, 'superadmin')
    const context = getTokenContext(superadminToken)
    const tenantId = context.tenantId!
    const organizationId = context.organizationId!
    expect(tenantId).toBeTruthy()
    expect(organizationId).toBeTruthy()

    const email = `qa-tc-honesty-005-${STAMP}@example.com`
    const password = 'Secret123!'
    let roleId: string | null = null
    let userId: string | null = null
    let runIds: string[] = []
    let proposalIds: string[] = []
    try {
      // One pending proposal so the stuck panel has a real row to show.
      runIds = await insertAgentRunFixtures([
        { tenantId, organizationId, agentId: AGENT_ID, status: 'ok', createdAt: new Date(Date.now() - 10 * 60_000) },
      ])
      proposalIds = await insertAgentProposalFixtures([
        {
          tenantId,
          organizationId,
          agentId: AGENT_ID,
          runId: runIds[0],
          disposition: 'pending',
          createdAt: new Date(Date.now() - 10 * 60_000),
        },
      ])

      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-honesty-005-${STAMP}`,
        tenantId,
      })
      // proposals.view only — deliberately no agents.view, so both the agents
      // registry and /metrics/agents 403 for this user.
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['agent_orchestrator.proposals.view'],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA TC-AGENT-HONESTY-005 runner',
      })

      await loginAs(page, email, password)
      await page.goto('/backend/overview?window=30d', { waitUntil: 'domcontentloaded' })

      // Window round-trip: ?window=30d preselects the 30-day option.
      await expect(page.getByText('Last 30 days').first()).toBeVisible({ timeout: 10_000 })

      // Stuck panel: real data (the seeded pending row), not an error and not empty.
      await expect(page.getByText('Stuck & breaching')).toBeVisible()
      await expect(page.getByText(AGENT_ID, { exact: false }).first()).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('Nothing stuck right now')).toHaveCount(0)

      // Trust panel: forbidden note — never the "No agents yet" all-clear.
      await expect(page.getByText("You don't have access to this data.")).toBeVisible()
      await expect(page.getByText('No agents yet')).toHaveCount(0)

      // Window select persists into the URL (30d → 24h round-trip).
      await page.getByRole('combobox', { name: 'Time window' }).click()
      await page.getByRole('option', { name: 'Last 24 hours' }).click()
      await expect(page).toHaveURL(/window=24h/, { timeout: 10_000 })
      await expect(page.getByText('Last 24 hours').first()).toBeVisible()
    } finally {
      if (userId) await deleteUserIfExists(request, superadminToken, userId)
      if (roleId) await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteAgentProposalsByIds(proposalIds)
      await deleteAgentRunsByIds(runIds)
    }
  })
})
