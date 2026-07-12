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
 * TC-AGENT-CASELOAD-010: keyboard-only triage journey.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-caseload-operator-throughput.md
 * (Phase 2 — hotkeys; Phase 1 — advance-to-neighbor).
 *
 * Seeds 3 pending proposals and clears the whole queue without a single mouse
 * click on the queue: j/j/k moves the cursor, `a` approves the cursor row and
 * the cursor advances to its neighbor, a second `a` clears the tail, `r` opens
 * the mandatory-reason reject dialog which submits via Cmd/Ctrl+Enter, and the
 * emptied queue lands on the "caseload is clear" state.
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

test.describe('TC-AGENT-CASELOAD-010: keyboard-only journey', () => {
  test('j/k navigates, a approves + advances, r rejects via dialog, queue empties', async ({ page, request }) => {
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
    const email = `tc-caseload-010-${stamp}@example.com`

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-CASELOAD-010 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-caseload-010-${stamp}`,
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
        name: 'QA TC-AGENT-CASELOAD-010',
      })

      // Three pending proposals, a minute apart — default sort (oldest first)
      // renders them in seed order.
      const base = Date.now() - 30 * 60_000
      const runIds = await insertAgentRunFixtures(
        Array.from({ length: 3 }, (_, index) => ({
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

      await loginAs(page, email, password)
      await page.goto('/backend/caseload', { waitUntil: 'domcontentloaded' })

      const queue = page.getByRole('listbox')
      const options = queue.getByRole('option')
      await expect(options).toHaveCount(3, { timeout: 15_000 })
      // Cursor defaults to the first (oldest) row.
      await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')

      // The shortcut hint row is discoverable without opening anything.
      await expect(page.getByText('Navigate queue')).toBeVisible()

      // j / j / k → cursor on the middle row; the position indicator follows.
      await page.keyboard.press('j')
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('j')
      await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('k')
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByText('2 of 3')).toBeVisible()

      // `a` approves the cursor row (clean row — immediate) and the cursor
      // advances to the next pending neighbor.
      await page.keyboard.press('a')
      await expect(options).toHaveCount(2, { timeout: 15_000 })
      await expect(queue.getByRole('option', { selected: true })).toHaveCount(1)

      // Second `a` clears the row that slid into the slot; one row remains.
      await page.keyboard.press('a')
      await expect(options).toHaveCount(1, { timeout: 15_000 })
      await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')

      // `r` opens the mandatory-reason dialog; Cmd/Ctrl+Enter submits it.
      await page.keyboard.press('r')
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('textbox').fill('Keyboard-journey reject reason')
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(dialog).not.toBeVisible({ timeout: 10_000 })

      // Queue empties to the clear-state copy.
      await expect(page.getByText('Your caseload is clear.')).toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => {})
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
