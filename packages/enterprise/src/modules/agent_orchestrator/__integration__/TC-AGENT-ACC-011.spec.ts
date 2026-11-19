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
} from './helpers/runActionFixtures'

/**
 * TC-AGENT-ACC-011: from an audit entry back to the agent run that caused it (roadmap gap B-5).
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (§D — run correlation on audit; changelog 2026-11-16).
 *
 * No model needed:
 *   - `GET /api/audit_logs/audit-logs/actions?ids=` narrows to the requested entries and returns their
 *     `context.correlation`;
 *   - the core audit table offers "Open agent run" / "Open proposal" only on correlated rows, and the
 *     run action lands on the run trace;
 *   - `/backend/audit-logs?logId=` opens that entry's details dialog;
 *   - the trace Actions card links each row to its audit entry;
 *   - the by-instigator page links an agent entry to its run and proposal.
 *
 * Fixtures: one run, its proposal and three `action_logs` rows (run-correlated, proposal-correlated,
 * uncorrelated) are seeded through dbFixtures with both `correlation_keys` and `context_json.correlation`,
 * as a real command-bus write stores them, and removed in `finally`.
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

type AuditActionItem = { id?: string; context?: { correlation?: Record<string, string> } | null }
type AuditActionsBody = { items?: AuditActionItem[]; total?: number }

type Seeded = {
  runIds: string[]
  proposalIds: string[]
  actionLogIds: string[]
}

async function seedAuditTrail(scope: { tenantId: string; organizationId: string; humanUserId: string }) {
  const seeded: Seeded = { runIds: [], proposalIds: [], actionLogIds: [] }
  const suffix = randomUUID().slice(0, 8)
  const labels = {
    run: `IT B5 run action ${suffix}`,
    proposal: `IT B5 proposal action ${suffix}`,
    human: `IT B5 human action ${suffix}`,
  }
  const agentActorId = randomUUID()
  try {
    const now = Date.now()
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
        createdAt: new Date(now),
      },
    ])
    seeded.proposalIds.push(proposalId)
    const base = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      resourceKind: RUN_ACTION_RESOURCE_KIND,
    }
    const [runLogId, proposalLogId, humanLogId] = await insertActionLogFixtures([
      {
        ...base,
        commandId: 'it_agent_acc.ticket.updated',
        actionLabel: labels.run,
        resourceId: randomUUID(),
        correlationKeys: [`agentRunId:${runId}`],
        contextJson: { source: 'agent', correlation: { agentRunId: runId } },
        actorUserId: agentActorId,
        onBehalfOfUserId: scope.humanUserId,
        createdAt: new Date(now - 1_000),
      },
      {
        ...base,
        commandId: 'it_agent_acc.ticket.resolved',
        actionLabel: labels.proposal,
        resourceId: randomUUID(),
        correlationKeys: [`agentRunId:${runId}`, `proposalId:${proposalId}`],
        contextJson: { source: 'agent', correlation: { agentRunId: runId, proposalId } },
        actorUserId: agentActorId,
        onBehalfOfUserId: scope.humanUserId,
        createdAt: new Date(now - 500),
      },
      {
        ...base,
        commandId: 'it_agent_acc.ticket.edited',
        actionLabel: labels.human,
        resourceId: randomUUID(),
        correlationKeys: [],
        contextJson: null,
        actorUserId: scope.humanUserId,
        createdAt: new Date(now),
      },
    ])
    seeded.actionLogIds.push(runLogId, proposalLogId, humanLogId)
    return { seeded, runId, proposalId, runLogId, proposalLogId, humanLogId, labels }
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

const EMPTY: Seeded = { runIds: [], proposalIds: [], actionLogIds: [] }

test.describe('TC-AGENT-ACC-011: audit entry → agent run links', () => {
  test('the audit API narrows by ids and returns the run correlation', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId, userId } = getTokenScope(adminToken)
    let seeded: Seeded = EMPTY
    try {
      const trail = await seedAuditTrail({ tenantId, organizationId, humanUserId: userId })
      seeded = trail.seeded

      const one = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?ids=${trail.runLogId}`, { token: adminToken })
      expect(one.status(), await one.text()).toBe(200)
      const oneBody = await readJsonSafe<AuditActionsBody>(one)
      expect(oneBody?.items?.map((item) => item.id)).toEqual([trail.runLogId])
      expect(oneBody?.items?.[0]?.context?.correlation?.agentRunId).toBe(trail.runId)

      const two = await apiRequest(
        request,
        'GET',
        `/api/audit_logs/audit-logs/actions?ids=${trail.runLogId},${trail.humanLogId},not-a-uuid`,
        { token: adminToken },
      )
      expect(two.status(), await two.text()).toBe(200)
      const twoIds = ((await readJsonSafe<AuditActionsBody>(two))?.items ?? []).map((item) => item.id).sort()
      expect(twoIds).toEqual([trail.runLogId, trail.humanLogId].sort())

      const unknown = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?ids=${randomUUID()}`, { token: adminToken })
      expect(unknown.status()).toBe(200)
      expect((await readJsonSafe<AuditActionsBody>(unknown))?.items).toEqual([])
    } finally {
      await cleanup(seeded).catch(() => undefined)
    }
  })

  test('audit table, deep link, trace card and instigator page link the entry and the run', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId, userId } = getTokenScope(adminToken)
    const openRun = englishMessage('agent_orchestrator.audit.links.openRun')
    const openProposal = englishMessage('agent_orchestrator.audit.links.openProposal')
    const openEntry = englishMessage('agent_orchestrator.audit.links.openEntry')
    let seeded: Seeded = EMPTY
    try {
      const trail = await seedAuditTrail({ tenantId, organizationId, humanUserId: userId })
      seeded = trail.seeded
      await login(page, 'admin')

      await page.goto('/backend/audit-logs', { waitUntil: 'domcontentloaded' })
      const humanRow = page.getByRole('row').filter({ hasText: trail.labels.human })
      await expect(humanRow).toBeVisible({ timeout: 15_000 })
      await expect(humanRow.getByRole('button', { name: 'Open actions' })).toHaveCount(0)

      await openRowMenu(page, trail.labels.proposal)
      await expect(page.getByRole('menuitem', { name: openRun })).toBeVisible()
      await expect(page.getByRole('menuitem', { name: openProposal })).toBeVisible()
      await page.keyboard.press('Escape')

      await openRowMenu(page, trail.labels.run)
      await expect(page.getByRole('menuitem', { name: openProposal })).toHaveCount(0)
      await test.info().attach('audit-row-open-run-menu', { body: await page.screenshot(), contentType: 'image/png' })
      await page.getByRole('menuitem', { name: openRun }).click()
      await expect(page).toHaveURL(new RegExp(`/backend/traces/${trail.runId}$`), { timeout: 15_000 })

      const card = page.locator('section', {
        has: page.getByRole('heading', { name: englishMessage('agent_orchestrator.traces.actions.title'), exact: true }),
      })
      await expect(card).toBeVisible({ timeout: 15_000 })
      const entryLinks = card.getByRole('link', { name: openEntry })
      await expect(entryLinks).toHaveCount(2)
      const hrefs = await entryLinks.evaluateAll((links) => links.map((link) => link.getAttribute('href')))
      expect(hrefs.sort()).toEqual([
        `/backend/audit-logs?logId=${trail.proposalLogId}`,
        `/backend/audit-logs?logId=${trail.runLogId}`,
      ].sort())

      await page.goto(`/backend/audit-logs?logId=${trail.runLogId}`, { waitUntil: 'domcontentloaded' })
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(dialog).toContainText(trail.labels.run)
      await test.info().attach('audit-deep-link-dialog', { body: await page.screenshot(), contentType: 'image/png' })

      await page.goto(`/backend/audit/by-instigator/${userId}`, { waitUntil: 'domcontentloaded' })
      const entry = page.getByRole('listitem').filter({ hasText: trail.labels.proposal })
      await expect(entry).toBeVisible({ timeout: 15_000 })
      await expect(entry.getByRole('link', { name: openRun })).toHaveAttribute('href', `/backend/traces/${trail.runId}`)
      await expect(entry.getByRole('link', { name: openProposal })).toHaveAttribute('href', `/backend/caseload/${trail.proposalId}`)
      await expect(entry.getByRole('link', { name: openEntry })).toHaveAttribute('href', `/backend/audit-logs?logId=${trail.proposalLogId}`)
      await test.info().attach('instigator-entry-links', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    } finally {
      await cleanup(seeded).catch(() => undefined)
    }
  })
})
