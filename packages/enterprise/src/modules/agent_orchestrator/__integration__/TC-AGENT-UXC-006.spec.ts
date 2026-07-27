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
import { deleteAgentGuardrailChecksByIds, insertAgentGuardrailCheckFixtures } from './helpers/agentUxFixtures'

/**
 * TC-AGENT-UXC-006: PL locale smoke for the consistency pass (spec 5, Phase 4).
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-consistency-pass.md
 *
 * With the `pl` locale: the caseload view toggle reads „Skrzynka", the flagged
 * guardrail line renders the translated „Zabezpieczenie …" copy with its
 * interpolation applied (no raw `{kind}` template leaking), and the trace
 * inspector's guardrail badge shows the translated result („Ostrzeżenie"),
 * never the raw `warn` enum.
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

test.describe('TC-AGENT-UXC-006: PL locale smoke', () => {
  test('caseload and trace guardrail vocabulary renders in Polish with interpolation applied', async ({ page, request }) => {
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
    let checkIds: string[] = []
    const email = `tc-uxc-006-${stamp}@example.com`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-UXC-006 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-uxc-006-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: [
          'agent_orchestrator.agents.view',
          'agent_orchestrator.proposals.view',
          'agent_orchestrator.proposals.dispose',
          'agent_orchestrator.trace.view',
        ],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: orgId,
        roles: [roleId],
        name: 'QA TC-AGENT-UXC-006',
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
          guardResults: [{ kind: 'pii', result: 'warn' }],
          createdAt: new Date(base),
        },
      ])
      checkIds = await insertAgentGuardrailCheckFixtures([
        {
          tenantId: tenantId!,
          organizationId: orgId!,
          agentRunId: runIds[0],
          proposalId: proposalIds[0],
          phase: 'output',
          kind: 'pii',
          result: 'warn',
        },
      ])

      await loginAs(page, email, password)
      // Switch the session to Polish AFTER login (the login helper relies on
      // the English form labels); the server reads the `locale` cookie.
      await page.context().addCookies([
        { name: 'locale', value: 'pl', url: new URL('/', page.url()).toString() },
      ])

      // 1. Caseload — the view toggle reads „Skrzynka" (was untranslated "Inbox").
      await page.goto('/backend/caseload', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: 'Skrzynka' })).toBeVisible({ timeout: 15_000 })

      // 2. Flagged-guardrail copy is translated AND interpolated — open the
      //    seeded proposal's pane and check the reasoning/guard section.
      const queue = page.getByRole('listbox')
      await expect(queue.getByRole('option')).toHaveCount(1, { timeout: 15_000 })
      await queue.getByRole('option').first().click()
      const guardLine = page.getByText(/Zabezpieczenie\s+pii/i).first()
      await expect(guardLine).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('body')).not.toContainText('{kind}')

      // 3. Trace inspector — the guardrail badge shows the translated result,
      //    never the raw enum. Scope the negative to the check's own row (a
      //    body-wide negative would be brittle against unrelated copy).
      await page.goto(`/backend/traces/${runIds[0]}`, { waitUntil: 'domcontentloaded' })
      const checkRow = page.locator('li', { hasText: 'pii' }).first()
      await expect(checkRow).toBeVisible({ timeout: 15_000 })
      await expect(checkRow).toContainText('Ostrzeżenie')
      await expect(checkRow).toContainText('Wyjście')
      await expect(checkRow).not.toContainText(/\bwarn\b/)
    } finally {
      await deleteAgentGuardrailChecksByIds(checkIds)
      await deleteAgentProposalsByIds(proposalIds)
      await deleteAgentRunsByIds(runIds)
      if (userId) await deleteUserIfExists(request, superadminToken, userId)
      if (roleId) await deleteRoleIfExists(request, superadminToken, roleId)
      if (orgId) await deleteOrganizationIfExists(request, superadminToken, orgId)
    }
  })
})
