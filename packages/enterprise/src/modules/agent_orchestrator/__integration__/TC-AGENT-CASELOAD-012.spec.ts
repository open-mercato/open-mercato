import { expect, test, type Page, type APIRequestContext } from '@playwright/test'
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
 * TC-AGENT-CASELOAD-012: risk chip + undo window for warn-flagged approves.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-caseload-operator-throughput.md
 * (Phase 3 — risk-aware approve).
 *
 * A warn-flagged proposal shows the guardrail chip in its row; `a` shows the
 * undo bar WITHOUT disposing (the proposal stays `pending` server-side for the
 * whole window), Undo cancels locally and the row returns to the pending
 * queue. A second pass lets the (test-shortened) window elapse and asserts the
 * proposal was disposed exactly once.
 *
 * Window shortening: the page reads `window.__omCaseloadUndoWindowMs` (see
 * `resolveUndoWindowMs` in backend/caseload/hooks.ts) — an env var cannot
 * reach the client bundle, so `addInitScript` sets the override before the app
 * boots.
 */

const AGENT_ID = 'deals.health_check'
// Short enough for pass 2's elapse wait, long enough that pass 1's Undo click
// reliably lands inside the window on a slow CI runner.
const TEST_UNDO_WINDOW_MS = 4_000

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

async function fetchDisposition(
  request: APIRequestContext,
  token: string,
  proposalId: string,
): Promise<{ disposition: string | null; total: number }> {
  const response = await apiRequest(request, 'GET', `/api/agent_orchestrator/proposals?ids=${proposalId}&page=1&pageSize=1`, {
    token,
  })
  const body = await readJsonSafe<{ items?: Array<{ disposition?: string }>; total?: number }>(response)
  return { disposition: body?.items?.[0]?.disposition ?? null, total: body?.total ?? 0 }
}

test.describe('TC-AGENT-CASELOAD-012: risk chip + undo window', () => {
  test('warn-flagged approve defers behind undo; elapse disposes exactly once', async ({ page, request }) => {
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
    const email = `tc-caseload-012-${stamp}@example.com`

    // Shorten the undo window before any app script runs.
    await page.addInitScript((ms) => {
      ;(window as { __omCaseloadUndoWindowMs?: number }).__omCaseloadUndoWindowMs = ms
    }, TEST_UNDO_WINDOW_MS)

    try {
      orgId = await createOrganizationFixture(request, superadminToken, {
        name: `TC-CASELOAD-012 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, {
        name: `tc-caseload-012-${stamp}`,
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
        name: 'QA TC-AGENT-CASELOAD-012',
      })

      const base = Date.now() - 30 * 60_000
      const runIds = await insertAgentRunFixtures([
        { tenantId: tenantId!, organizationId: orgId!, agentId: AGENT_ID, createdAt: new Date(base) },
      ])
      const [proposalId] = await insertAgentProposalFixtures([
        {
          tenantId: tenantId!,
          organizationId: orgId!,
          agentId: AGENT_ID,
          runId: runIds[0],
          disposition: 'pending' as const,
          guardResults: [
            { kind: 'schema', result: 'pass' },
            { kind: 'pii', result: 'warn' },
          ],
          createdAt: new Date(base),
        },
      ])
      const memberToken = await getAuthToken(request, email, password)

      await loginAs(page, email, password)
      await page.goto('/backend/caseload', { waitUntil: 'domcontentloaded' })

      const queue = page.getByRole('listbox')
      const options = queue.getByRole('option')
      await expect(options).toHaveCount(1, { timeout: 15_000 })

      // The warn verdict renders the guardrail chip on the row (1 flag).
      const riskChip = options.nth(0).getByLabel(/Guardrail flags: 1/)
      await expect(riskChip).toBeVisible()

      // Pass 1 — `a` defers: the undo bar appears and NO dispose is sent yet.
      // (Scoped by text — Spinner/Skeleton also carry role="status".)
      const undoBar = page.getByRole('status').filter({ hasText: 'Approved:' })
      await page.keyboard.press('a')
      await expect(undoBar).toBeVisible()

      // Undo cancels locally (clicked immediately, well inside the window) —
      // the row returns to the pending queue and stays pending server-side
      // even after the window would have elapsed, proving nothing was sent.
      await undoBar.getByRole('button', { name: 'Undo' }).click()
      await expect(undoBar).toHaveCount(0)
      await expect(options).toHaveCount(1)
      await page.waitForTimeout(TEST_UNDO_WINDOW_MS + 500)
      const afterUndo = await fetchDisposition(request, memberToken, proposalId)
      expect(afterUndo.disposition).toBe('pending')

      // Pass 2 — approve again and let the window elapse: disposed exactly
      // once (disposition flips to approved; a second dispose of a non-pending
      // proposal would have 409/conflicted and left an error toast).
      await page.keyboard.press('a')
      await expect(undoBar).toBeVisible()
      await expect
        .poll(async () => (await fetchDisposition(request, memberToken, proposalId)).disposition, {
          timeout: TEST_UNDO_WINDOW_MS + 10_000,
        })
        .toBe('approved')
      await expect(undoBar).toHaveCount(0, { timeout: 10_000 })
      // The row left the pending queue after the single commit; a duplicate
      // dispose would have 409-conflicted and left the row (or an error bar).
      await expect(page.getByText('Your caseload is clear.')).toBeVisible({ timeout: 15_000 })
      const finalState = await fetchDisposition(request, memberToken, proposalId)
      expect(finalState.disposition).toBe('approved')
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => {})
      await deleteUserIfExists(request, superadminToken, userId).catch(() => {})
      await deleteRoleIfExists(request, superadminToken, roleId).catch(() => {})
      await deleteOrganizationIfExists(request, superadminToken, orgId).catch(() => {})
    }
  })
})
