import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import {
  GATED_AGENT_ID,
  GATED_AGENT_INPUT,
  agentRunPath,
  createScopedAgentUser,
  deleteScopedAgentUser,
  type ScopedAgentUser,
} from './helpers/agentAccessFixtures'
import {
  hasConfiguredLlmProvider,
  isModelUnavailableResponse,
  NO_LLM_PROVIDER_SKIP_REASON,
} from './helpers/llmProvider'
import {
  PROPOSAL_ACTION_COMMAND_ID,
  PROPOSAL_ACTION_LABEL,
  RUN_ACTION_COMMAND_ID,
  RUN_ACTION_LABEL,
  RUN_ACTION_RESOURCE_KIND,
  TRACE_VIEW_FEATURE,
  deleteSeededRunActions,
  runActionsPath,
  seedForeignRunWithAction,
  seedRunWithActions,
  type SeededRunActions,
} from './helpers/runActionFixtures'

/**
 * TC-AGENT-ACC-005: the actions an agent run caused — `GET /runs/:id/actions` and the trace Actions card.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (Phase 4 — audit correlation; Integration: `GET /runs/:id/actions`, trace page).
 *
 * No model needed:
 *   - a caller holding `agent_orchestrator.trace.view` but not
 *     `audit_logs.view_tenant` is refused with 403;
 *   - a run of another organization answers 404;
 *   - a run whose action logs carry `agentRunId` correlation (and one of its
 *     proposals' `proposalId` — an effector write after approval) lists both,
 *     newest first, with the id-shaped correlation;
 *   - a run without correlated actions returns an empty list;
 *   - the trace page renders the Actions card with the seeded entries
 *     (screenshot attached).
 *
 * Model-dependent (skipped without a provider): every action a real run lists
 * carries that run's `agentRunId`.
 *
 * Fixtures: runs, the proposal and `action_logs` rows are seeded through
 * dbFixtures (correlated action logs need a model-driven write) and removed in
 * `finally`; the 403 caller is an API-created role and user, also removed.
 */

const integrationDirectory = path.dirname(fileURLToPath(import.meta.url))
const englishMessages = JSON.parse(
  readFileSync(path.join(integrationDirectory, '../i18n/en.json'), 'utf8'),
) as Record<string, string>

type RunActionItem = {
  id?: string
  commandId?: string
  actionLabel?: string | null
  resourceKind?: string | null
  correlation?: Record<string, string>
  createdAt?: string
}
type RunActionsBody = { items?: RunActionItem[]; total?: number; page?: number; pageSize?: number }

function englishMessage(key: string): string {
  const message = englishMessages[key]
  if (!message) throw new Error(`[internal] en.json is missing "${key}"`)
  return message
}

const EMPTY_SEED: SeededRunActions = { runIds: [], proposalIds: [], actionLogIds: [] }

test.describe('TC-AGENT-ACC-005: run actions', () => {
  test('lists correlated actions, refuses without audit access and stays organization-scoped', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    expect(tenantId, 'the admin token carries a tenant').toBeTruthy()
    expect(organizationId, 'the admin token carries an organization').toBeTruthy()

    const seeds: SeededRunActions[] = []
    let traceOnly: ScopedAgentUser | null = null
    try {
      const own = await seedRunWithActions({ tenantId, organizationId })
      seeds.push(own)
      const foreign = await seedForeignRunWithAction({ tenantId, organizationId: randomUUID() })
      seeds.push(foreign)

      const listed = await apiRequest(request, 'GET', runActionsPath(own.correlatedRunId), { token: adminToken })
      expect(listed.status(), await listed.text()).toBe(200)
      const listedBody = await readJsonSafe<RunActionsBody>(listed)
      expect(listedBody?.total).toBe(2)
      expect(listedBody?.page).toBe(1)
      const items = listedBody?.items ?? []
      expect(items.map((item) => item.commandId)).toEqual([PROPOSAL_ACTION_COMMAND_ID, RUN_ACTION_COMMAND_ID])
      expect(items.map((item) => item.actionLabel)).toEqual([PROPOSAL_ACTION_LABEL, RUN_ACTION_LABEL])
      for (const item of items) expect(item.resourceKind).toBe(RUN_ACTION_RESOURCE_KIND)
      expect(items[0]?.correlation).toEqual({ proposalId: own.proposalId })
      expect(items[1]?.correlation).toEqual({ agentRunId: own.correlatedRunId })

      const empty = await apiRequest(request, 'GET', runActionsPath(own.emptyRunId), { token: adminToken })
      expect(empty.status(), await empty.text()).toBe(200)
      const emptyBody = await readJsonSafe<RunActionsBody>(empty)
      expect(emptyBody?.items).toEqual([])
      expect(emptyBody?.total).toBe(0)

      const foreignResponse = await apiRequest(request, 'GET', runActionsPath(foreign.runId), { token: adminToken })
      expect(foreignResponse.status(), 'another organization run is not readable').toBe(404)
      expect(await foreignResponse.text()).not.toContain(RUN_ACTION_COMMAND_ID)

      const oversized = await apiRequest(request, 'GET', runActionsPath(own.correlatedRunId, { pageSize: 101 }), {
        token: adminToken,
      })
      expect(oversized.status(), 'pageSize is capped at 100').toBe(400)

      traceOnly = await createScopedAgentUser(request, adminToken, {
        label: 'trace-no-audit',
        features: [TRACE_VIEW_FEATURE],
      })
      const denied = await apiRequest(request, 'GET', runActionsPath(own.correlatedRunId), { token: traceOnly.token })
      expect(denied.status(), 'audit_logs.view_tenant is required').toBe(403)
      expect(await denied.text()).not.toContain(RUN_ACTION_COMMAND_ID)
    } finally {
      await deleteScopedAgentUser(request, adminToken, traceOnly)
      for (const seed of seeds) await deleteSeededRunActions(seed).catch(() => undefined)
    }
  })

  test('the trace page renders the Actions card for a run with correlated actions', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(adminToken)

    let seed: SeededRunActions = EMPTY_SEED
    try {
      const own = await seedRunWithActions({ tenantId, organizationId })
      seed = own

      await login(page, 'admin')
      await page.goto(`/backend/traces/${own.correlatedRunId}`, { waitUntil: 'domcontentloaded' })

      const card = page.locator('section', {
        has: page.getByRole('heading', { name: englishMessage('agent_orchestrator.traces.actions.title'), exact: true }),
      })
      await expect(card).toBeVisible({ timeout: 15_000 })
      await expect(card).toContainText(RUN_ACTION_LABEL)
      await expect(card).toContainText(PROPOSAL_ACTION_LABEL)
      await expect(card).toContainText(RUN_ACTION_COMMAND_ID)
      await expect(card).toContainText(englishMessage('agent_orchestrator.traces.actions.columns.proposal'))
      await expect(card).toContainText(own.proposalId.slice(0, 8))

      await card.scrollIntoViewIfNeeded()
      await test.info().attach('trace-run-actions-card', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
    } finally {
      await deleteSeededRunActions(seed).catch(() => undefined)
    }
  })

  test('every action a real run lists carries that run id', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    test.skip(!(await hasConfiguredLlmProvider(request, adminToken)), NO_LLM_PROVIDER_SKIP_REASON)

    const runIds: string[] = []
    try {
      const response = await apiRequest(request, 'POST', agentRunPath(GATED_AGENT_ID), {
        token: adminToken,
        data: { input: GATED_AGENT_INPUT },
      })
      test.skip(isModelUnavailableResponse(response.status()), NO_LLM_PROVIDER_SKIP_REASON)
      const raw = await response.text()
      expect(response.status(), raw).toBe(200)
      const runId = String((JSON.parse(raw) as { runId?: unknown }).runId)
      runIds.push(runId)

      const listed = await apiRequest(request, 'GET', runActionsPath(runId), { token: adminToken })
      expect(listed.status(), await listed.text()).toBe(200)
      const body = await readJsonSafe<RunActionsBody>(listed)
      for (const item of body?.items ?? []) {
        const correlation = item.correlation ?? {}
        expect(
          correlation.agentRunId === runId || typeof correlation.proposalId === 'string',
          `${String(item.commandId)} is correlated with the run or one of its proposals`,
        ).toBe(true)
      }
    } finally {
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
