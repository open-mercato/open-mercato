import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteAgentProposalsByIds,
  deleteAgentRunsByIds,
  insertAgentProposalFixtures,
  insertAgentRunFixtures,
} from './helpers/agentPerfFixtures'
import {
  RUN_ACTIONS_AGENT_ID,
  RUN_ACTION_RESOURCE_KIND,
  deleteActionLogsByIds,
  insertActionLogFixtures,
  runActionsPath,
} from './helpers/runActionFixtures'

/**
 * TC-AGENT-ACC-012: a proposal id forged into a workflow context never links an audit entry
 * to a proposal (roadmap gap B-12).
 *
 * An effector write stamps the proposal id it read from the (user-writable) workflow context.
 * Rows written before the write-side check — or by any path that skips it — must still be
 * refused on read: a proposal id counts only when the proposal belongs to the run or the
 * workflow instance named on the same entry.
 *
 * No model needed. Fixtures: one run, its proposal raised by workflow instance W, and two
 * effector `action_logs` rows on behalf of the admin — one carrying the proposal id with W
 * (verified), one carrying it with another instance id (forged). Seeded through dbFixtures with
 * both `correlation_keys` and `context_json.correlation`, as a command-bus write stores them,
 * and removed in `finally`.
 *
 *   - `GET /api/audit_logs/audit-logs/actions` marks only the verified row with
 *     `_agent_orchestrator.proposalVerified: true`;
 *   - `GET /api/agent_orchestrator/runs/:id/actions` lists the verified row only;
 *   - `GET /api/agent_orchestrator/audit/by-instigator/:id` returns `proposalId` for the verified
 *     row and null for the forged one;
 *   - the core audit table offers "Open proposal" on the verified row only, and the by-instigator
 *     page renders the proposal link on the verified entry only.
 */

const integrationDirectory = path.dirname(fileURLToPath(import.meta.url))
const englishMessages = JSON.parse(
  readFileSync(path.join(integrationDirectory, '../i18n/en.json'), 'utf8'),
) as Record<string, string>

function englishMessage(key: string): string {
  const message = englishMessages[key]
  if (!message) throw new Error(`[internal] en.json is missing "${key}"`)
  return message
}

type AuditActionItem = { id?: string; _agent_orchestrator?: { proposalVerified?: boolean } }
type InstigatorItem = { id?: string; proposalId?: string | null }
type RunActionItem = { id?: string }

type Seeded = { runIds: string[]; proposalIds: string[]; actionLogIds: string[] }
const EMPTY: Seeded = { runIds: [], proposalIds: [], actionLogIds: [] }

async function seedForgedTrail(scope: { tenantId: string; organizationId: string; humanUserId: string }) {
  const seeded: Seeded = { runIds: [], proposalIds: [], actionLogIds: [] }
  const suffix = randomUUID().slice(0, 8)
  const labels = { verified: `IT B12 verified effector ${suffix}`, forged: `IT B12 forged effector ${suffix}` }
  try {
    const now = Date.now()
    const workflowInstanceId = randomUUID()
    const forgedInstanceId = randomUUID()
    const [runId] = await insertAgentRunFixtures([
      { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId: RUN_ACTIONS_AGENT_ID, createdAt: new Date(now) },
    ])
    seeded.runIds.push(runId)
    const [proposalId] = await insertAgentProposalFixtures([
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentId: RUN_ACTIONS_AGENT_ID,
        runId,
        disposition: 'approved',
        workflowInstanceId,
        createdAt: new Date(now),
      },
    ])
    seeded.proposalIds.push(proposalId)
    const base = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      resourceKind: RUN_ACTION_RESOURCE_KIND,
      commandId: 'it_agent_acc.ticket.updated',
      actorUserId: scope.humanUserId,
      onBehalfOfUserId: scope.humanUserId,
    }
    const [verifiedLogId, forgedLogId] = await insertActionLogFixtures([
      {
        ...base,
        actionLabel: labels.verified,
        resourceId: randomUUID(),
        correlationKeys: [`proposalId:${proposalId}`, `workflowInstanceId:${workflowInstanceId}`],
        contextJson: { source: 'workflow', correlation: { proposalId, workflowInstanceId } },
        createdAt: new Date(now - 1_000),
      },
      {
        ...base,
        actionLabel: labels.forged,
        resourceId: randomUUID(),
        correlationKeys: [`proposalId:${proposalId}`, `workflowInstanceId:${forgedInstanceId}`],
        contextJson: { source: 'workflow', correlation: { proposalId, workflowInstanceId: forgedInstanceId } },
        createdAt: new Date(now - 500),
      },
    ])
    seeded.actionLogIds.push(verifiedLogId, forgedLogId)
    return { seeded, runId, proposalId, verifiedLogId, forgedLogId, labels }
  } catch (error) {
    await cleanup(seeded).catch(() => undefined)
    throw error
  }
}

async function cleanup(seeded: Seeded): Promise<void> {
  await deleteActionLogsByIds(seeded.actionLogIds)
  await deleteAgentProposalsByIds(seeded.proposalIds)
  await deleteAgentRunsByIds(seeded.runIds)
}

async function openRowMenu(page: Page, label: string) {
  const row = page.getByRole('row').filter({ hasText: label })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.getByRole('button', { name: 'Open actions' }).click()
}

test.describe('TC-AGENT-ACC-012: forged proposal ids never link an audit entry', () => {
  test('the audit, run-actions and by-instigator APIs trust only a verified proposal id', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId, userId } = getTokenScope(adminToken)
    let seeded: Seeded = EMPTY
    try {
      const trail = await seedForgedTrail({ tenantId, organizationId, humanUserId: userId })
      seeded = trail.seeded

      const audit = await apiRequest(
        request,
        'GET',
        `/api/audit_logs/audit-logs/actions?ids=${trail.verifiedLogId},${trail.forgedLogId}`,
        { token: adminToken },
      )
      expect(audit.status(), await audit.text()).toBe(200)
      const auditItems = (await readJsonSafe<{ items?: AuditActionItem[] }>(audit))?.items ?? []
      const verifiedFlag = new Map(auditItems.map((item) => [item.id, item._agent_orchestrator?.proposalVerified]))
      expect(verifiedFlag.get(trail.verifiedLogId)).toBe(true)
      expect(verifiedFlag.get(trail.forgedLogId)).toBe(false)

      const runActions = await apiRequest(request, 'GET', runActionsPath(trail.runId), { token: adminToken })
      expect(runActions.status(), await runActions.text()).toBe(200)
      const runActionsBody = await readJsonSafe<{ items?: RunActionItem[]; total?: number }>(runActions)
      expect((runActionsBody?.items ?? []).map((item) => item.id)).toEqual([trail.verifiedLogId])
      expect(runActionsBody?.total).toBe(1)

      const instigator = await apiRequest(request, 'GET', `/api/agent_orchestrator/audit/by-instigator/${userId}`, {
        token: adminToken,
      })
      expect(instigator.status(), await instigator.text()).toBe(200)
      const instigatorItems = (await readJsonSafe<{ items?: InstigatorItem[] }>(instigator))?.items ?? []
      const proposalOf = new Map(instigatorItems.map((item) => [item.id, item.proposalId]))
      expect(proposalOf.get(trail.verifiedLogId)).toBe(trail.proposalId)
      expect(proposalOf.get(trail.forgedLogId)).toBeNull()
    } finally {
      await cleanup(seeded).catch(() => undefined)
    }
  })

  test('the audit table and the instigator page offer the proposal link on the verified entry only', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId, userId } = getTokenScope(adminToken)
    const openProposal = englishMessage('agent_orchestrator.audit.links.openProposal')
    let seeded: Seeded = EMPTY
    try {
      const trail = await seedForgedTrail({ tenantId, organizationId, humanUserId: userId })
      seeded = trail.seeded
      await login(page, 'admin')

      await page.goto('/backend/audit-logs', { waitUntil: 'domcontentloaded' })
      await openRowMenu(page, trail.labels.verified)
      await expect(page.getByRole('menuitem', { name: openProposal })).toBeVisible()
      await page.keyboard.press('Escape')

      const forgedRow = page.getByRole('row').filter({ hasText: trail.labels.forged })
      await expect(forgedRow).toBeVisible({ timeout: 15_000 })
      await expect(forgedRow.getByRole('button', { name: 'Open actions' })).toHaveCount(0)
      await test.info().attach('audit-forged-row-no-proposal-link', { body: await page.screenshot(), contentType: 'image/png' })

      await page.goto(`/backend/audit/by-instigator/${userId}`, { waitUntil: 'domcontentloaded' })
      const verifiedEntry = page.getByRole('listitem').filter({ hasText: trail.labels.verified })
      const forgedEntry = page.getByRole('listitem').filter({ hasText: trail.labels.forged })
      await expect(verifiedEntry).toBeVisible({ timeout: 15_000 })
      await expect(forgedEntry).toBeVisible()
      await expect(verifiedEntry.getByRole('link', { name: openProposal })).toHaveAttribute(
        'href',
        `/backend/caseload/${trail.proposalId}`,
      )
      await expect(forgedEntry.getByRole('link', { name: openProposal })).toHaveCount(0)
      await test.info().attach('instigator-forged-entry-no-proposal-link', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
    } finally {
      await cleanup(seeded).catch(() => undefined)
    }
  })
})
