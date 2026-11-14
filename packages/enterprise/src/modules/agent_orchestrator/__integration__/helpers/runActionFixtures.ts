import { randomUUID } from 'node:crypto'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  deleteAgentProposalsByIds,
  deleteAgentRunsByIds,
  insertAgentProposalFixtures,
  insertAgentRunFixtures,
} from './agentPerfFixtures'

/**
 * Fixtures for the run-actions specs (TC-AGENT-ACC-005).
 *
 * Action logs carry `agentRunId` / `proposalId` correlation only when an agent
 * run or an approved proposal writes through the command bus, which needs a real
 * model. The no-model specs therefore seed the run, its proposal and the
 * correlated `action_logs` rows directly through the shared dbFixtures client —
 * the same precedent and DATABASE_URL caveat as agentPerfFixtures.ts. Rows are
 * plaintext; the action-log service keeps a value it cannot decrypt as-is.
 * Every seed is returned as ids so the caller removes it in `finally`.
 */

export const RUN_ACTIONS_AGENT_ID = 'support.ticket_triage'
export const AUDIT_VIEW_TENANT_FEATURE = 'audit_logs.view_tenant'
export const TRACE_VIEW_FEATURE = 'agent_orchestrator.trace.view'
export const RUN_ACTION_COMMAND_ID = 'it_agent_acc.ticket.updated'
export const RUN_ACTION_LABEL = 'IT agent run action'
export const PROPOSAL_ACTION_COMMAND_ID = 'it_agent_acc.ticket.resolved'
export const PROPOSAL_ACTION_LABEL = 'IT agent proposal action'
export const RUN_ACTION_RESOURCE_KIND = 'it_agent_acc.ticket'

export type ActionLogSeed = {
  tenantId: string
  organizationId: string
  commandId: string
  actionLabel: string
  resourceKind: string
  resourceId: string
  correlationKeys: string[]
  createdAt: Date
}

export type SeededRunActions = {
  runIds: string[]
  proposalIds: string[]
  actionLogIds: string[]
}

export function runActionsPath(runId: string, query?: { pageSize?: number }): string {
  const base = `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/actions`
  return query?.pageSize ? `${base}?pageSize=${query.pageSize}` : base
}

export async function insertActionLogFixtures(rows: ActionLogSeed[]): Promise<string[]> {
  const ids: string[] = []
  await withClient(async (client) => {
    for (const row of rows) {
      const id = randomUUID()
      ids.push(id)
      await client.query(
        `insert into action_logs (
           id, tenant_id, organization_id, command_id, action_label, resource_kind, resource_id,
           execution_state, correlation_keys, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, 'done', $8::text[], $9, $9)`,
        [
          id,
          row.tenantId,
          row.organizationId,
          row.commandId,
          row.actionLabel,
          row.resourceKind,
          row.resourceId,
          row.correlationKeys,
          row.createdAt,
        ],
      )
    }
  })
  return ids
}

export async function deleteActionLogsByIds(ids: string[]): Promise<void> {
  if (!ids.length) return
  await withClient(async (client) => {
    await client.query('delete from action_logs where id = any($1::uuid[])', [ids])
  })
}

/**
 * Seeds one run with a proposal plus two correlated action logs (one stamped
 * with the run id, one with the proposal id — an effector write after approval),
 * and a second run with no correlated actions. The second run is the empty case
 * and proves the first run's actions do not leak into another run's list.
 */
export async function seedRunWithActions(scope: {
  tenantId: string
  organizationId: string
}): Promise<SeededRunActions & { correlatedRunId: string; emptyRunId: string; proposalId: string }> {
  const seeded: SeededRunActions = { runIds: [], proposalIds: [], actionLogIds: [] }
  try {
    const now = Date.now()
    const runIds = await insertAgentRunFixtures([
      { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId: RUN_ACTIONS_AGENT_ID, createdAt: new Date(now) },
      { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId: RUN_ACTIONS_AGENT_ID, createdAt: new Date(now) },
    ])
    seeded.runIds.push(...runIds)
    const [correlatedRunId, emptyRunId] = runIds
    const proposalIds = await insertAgentProposalFixtures([
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentId: RUN_ACTIONS_AGENT_ID,
        runId: correlatedRunId,
        disposition: 'approved',
        createdAt: new Date(now),
      },
    ])
    seeded.proposalIds.push(...proposalIds)
    const [proposalId] = proposalIds
    const actionLogIds = await insertActionLogFixtures([
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        commandId: RUN_ACTION_COMMAND_ID,
        actionLabel: RUN_ACTION_LABEL,
        resourceKind: RUN_ACTION_RESOURCE_KIND,
        resourceId: randomUUID(),
        correlationKeys: [`agentRunId:${correlatedRunId}`],
        createdAt: new Date(now - 2_000),
      },
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        commandId: PROPOSAL_ACTION_COMMAND_ID,
        actionLabel: PROPOSAL_ACTION_LABEL,
        resourceKind: RUN_ACTION_RESOURCE_KIND,
        resourceId: randomUUID(),
        correlationKeys: [`proposalId:${proposalId}`],
        createdAt: new Date(now - 1_000),
      },
    ])
    seeded.actionLogIds.push(...actionLogIds)
    return { ...seeded, correlatedRunId, emptyRunId, proposalId }
  } catch (error) {
    await deleteSeededRunActions(seeded).catch(() => undefined)
    throw error
  }
}

/** Seeds one run under another organization with an action log correlated to it. */
export async function seedForeignRunWithAction(scope: {
  tenantId: string
  organizationId: string
}): Promise<SeededRunActions & { runId: string }> {
  const seeded: SeededRunActions = { runIds: [], proposalIds: [], actionLogIds: [] }
  try {
    const [runId] = await insertAgentRunFixtures([
      { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId: RUN_ACTIONS_AGENT_ID, createdAt: new Date() },
    ])
    seeded.runIds.push(runId)
    const actionLogIds = await insertActionLogFixtures([
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        commandId: RUN_ACTION_COMMAND_ID,
        actionLabel: RUN_ACTION_LABEL,
        resourceKind: RUN_ACTION_RESOURCE_KIND,
        resourceId: randomUUID(),
        correlationKeys: [`agentRunId:${runId}`],
        createdAt: new Date(),
      },
    ])
    seeded.actionLogIds.push(...actionLogIds)
    return { ...seeded, runId }
  } catch (error) {
    await deleteSeededRunActions(seeded).catch(() => undefined)
    throw error
  }
}

export async function deleteSeededRunActions(seeded: SeededRunActions): Promise<void> {
  await deleteActionLogsByIds(seeded.actionLogIds)
  await deleteAgentProposalsByIds(seeded.proposalIds)
  await deleteAgentRunsByIds(seeded.runIds)
}
