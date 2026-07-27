import { expect, test, type Page } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

/**
 * TC-AGENT-NAV-006: the playground "Tools used" panel renders the run's ACTUAL
 * tool calls for a caller with trace access, and degrades to the "Declared
 * tools" framing for a caller holding `agents.run` without `trace.view`.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-navigation-pass.md
 * (§1 Real "Tools used", Integration Test Coverage).
 *
 * Executes REAL agent runs through the playground UI (LLM provider key
 * required); execution is env-gated.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'
const RESTRICTED_FEATURES = [
  'agent_orchestrator.agents.view',
  'agent_orchestrator.agents.run',
]

type AgentListItem = { id?: string; sampleInput?: unknown }

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

async function runFromPlayground(page: Page, agentId: string): Promise<void> {
  await page.goto(`/backend/playground?agent=${encodeURIComponent(agentId)}`, {
    waitUntil: 'domcontentloaded',
  })
  const insertSample = page.getByRole('button', { name: 'Insert sample' })
  await expect(insertSample).toBeVisible({ timeout: 15_000 })
  await insertSample.click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  // Wait for the result trace section to appear (LLM run — generous timeout).
  await expect(page.getByText('Tools & steps')).toBeVisible({ timeout: 120_000 })
  await page.getByText('Tools & steps').click()
}

test.describe('TC-AGENT-NAV-006: real tool calls vs declared-tools degrade', () => {
  test('admin sees the actual tool calls; a trace-view-less runner sees Declared tools', async ({ page, request }) => {
    test.slow()

    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const password = 'StrongSecret123!'

    const agentsRes = await apiRequest(request, 'GET', '/api/agent_orchestrator/agents', { token: adminToken })
    expect(agentsRes.status(), await agentsRes.text()).toBe(200)
    const agentsBody = await readJsonSafe<{ items?: AgentListItem[] }>(agentsRes)
    const agent = (agentsBody?.items ?? []).find(
      (item) => typeof item.id === 'string' && item.sampleInput !== undefined,
    )
    expect(agent, 'a registered agent with a declared sampleInput is required').toBeTruthy()

    let tenantId = getTokenContext(superadminToken).tenantId
    if (!tenantId) {
      const existing = await apiRequest(request, 'GET', '/api/directory/organizations?page=1&pageSize=1', { token: superadminToken })
      const body = await readJsonSafe<{ items?: Array<{ tenantId?: string | null; id?: string }> }>(existing)
      tenantId = body?.items?.[0]?.tenantId ?? ''
    }
    expect(tenantId, 'a tenant id is required for the restricted-role fixture').toBeTruthy()

    // The restricted user must belong to a real organization so the run route's
    // fail-closed single-org resolution succeeds; reuse the admin's org.
    const adminOrgId = getTokenContext(adminToken).organizationId
    expect(adminOrgId, 'the admin token must carry an organization id').toBeTruthy()

    let restrictedRoleId: string | null = null
    let restrictedUserId: string | null = null
    const restrictedEmail = `qa-tc-agent-nav-006-${stamp}@example.com`

    try {
      // Part A — admin (wildcard ACL incl. trace.view): actual tool calls.
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
      await runFromPlayground(page, agent!.id!)
      await expect(
        page.getByText('Tools used').or(page.getByText('No tool calls in this run.')).first(),
        'a trace-capable caller must see the real Tools used panel (rows or the honest empty state)',
      ).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Declared tools')).toHaveCount(0)
      await page.context().clearCookies()

      // Part B — agents.run WITHOUT trace.view: the panel degrades honestly.
      restrictedRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-agent-nav-006-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: restrictedRoleId,
        features: RESTRICTED_FEATURES,
        organizations: null,
      })
      restrictedUserId = await createUserFixture(request, superadminToken, {
        email: restrictedEmail,
        password,
        organizationId: adminOrgId!,
        roles: [restrictedRoleId],
        name: 'QA TC-AGENT-NAV-006 runner',
      })

      await login(page, restrictedEmail, password)
      await runFromPlayground(page, agent!.id!)
      await expect(
        page.getByText('Declared tools'),
        'a trace-view-less runner must see the Declared tools fallback, never the false Tools used framing',
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteUserIfExists(request, superadminToken, restrictedUserId)
      await deleteRoleIfExists(request, superadminToken, restrictedRoleId)
    }
  })
})
