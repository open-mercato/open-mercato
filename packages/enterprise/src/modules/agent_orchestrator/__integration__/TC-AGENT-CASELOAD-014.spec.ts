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
  deleteAgentProposalsByIds,
  deleteAgentRunsByIds,
  insertAgentProposalFixtures,
  insertAgentRunFixtures,
} from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-CASELOAD-014: proposal summary correctness.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-caseload-operator-throughput.md
 * (Phase 4 — content correctness).
 *
 * A canonical `{actions:[{type:'set_stage',…}]}` payload renders "Set stage"
 * (the humanized action type) in the inbox headline, the list "Proposes"
 * column, and the decisions filter options — the rationale sentence must
 * never leak into any of them (the pre-spec-4 failure mode).
 */

const AGENT_ID = 'deals.health_check'
const RATIONALE_SENTINEL = 'RATIONALE-SENTINEL prose that must never render as a summary.'

const CANONICAL_PAYLOAD = {
  actions: [
    { type: 'set_stage', payload: { stage: 'negotiation', dealId: 'D-1' } },
    { type: 'notify_owner', payload: { channel: 'email' } },
  ],
  confidence: 0.82,
  rationale: RATIONALE_SENTINEL,
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-CASELOAD-014: summary correctness', () => {
  test('canonical payload renders the humanized action type, never rationale prose', async ({ page, request }) => {
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
    let runIds: string[] = []
    let proposalIds: string[] = []
    const email = `tc-caseload-014-${stamp}@example.com`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-CASELOAD-014 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-caseload-014-${stamp}`,
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
        name: 'QA TC-AGENT-CASELOAD-014',
      })

      const base = Date.now() - 30 * 60_000
      runIds = await insertAgentRunFixtures([
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, createdAt: new Date(base) },
      ])
      proposalIds = await insertAgentProposalFixtures([
        {
          tenantId: tenantId!,
          organizationId: orgId!,
          agentId: AGENT_ID,
          runId: runIds[0],
          disposition: 'pending' as const,
          confidence: 0.82,
          payload: CANONICAL_PAYLOAD,
          createdAt: new Date(base),
        },
      ])

      await loginAs(page, email, password)
      await page.goto('/backend/caseload', { waitUntil: 'domcontentloaded' })

      // Inbox: the row headline + decision-pane headline show the humanized
      // first action type with the extra-action count — no rationale prose.
      const queue = page.getByRole('listbox')
      const option = queue.getByRole('option').first()
      await expect(option).toBeVisible({ timeout: 15_000 })
      await expect(option).toContainText('Set stage')
      await expect(option).not.toContainText('RATIONALE-SENTINEL')
      await option.click()
      const paneHeadline = page.getByRole('heading', { level: 2 })
      await expect(paneHeadline).toContainText('Set stage')
      await expect(paneHeadline).not.toContainText('RATIONALE-SENTINEL')

      // Decisions filter options are the bounded humanized action vocabulary.
      await page.getByRole('button', { name: /All decisions/ }).click()
      const filterOption = page.getByRole('button', { name: 'Set stage' })
      await expect(filterOption).toBeVisible()
      await expect(page.getByRole('button', { name: /RATIONALE-SENTINEL/ })).toHaveCount(0)
      await page.keyboard.press('Escape')

      // List view: the Proposes column renders the same bounded summary.
      await page.getByRole('radio', { name: 'List' }).click()
      const proposesCell = page.locator('table').getByText('Set stage', { exact: false }).first()
      await expect(proposesCell).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('table')).not.toContainText('RATIONALE-SENTINEL')
    } finally {
      await deleteAgentProposalsByIds(proposalIds).catch(() => {})
      await deleteAgentRunsByIds(runIds).catch(() => {})
      if (userId) await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      if (roleId) await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      if (orgId) await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
