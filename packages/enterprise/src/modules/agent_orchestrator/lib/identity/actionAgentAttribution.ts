import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentProposal, AgentRun } from '../../data/entities'
import {
  AGENT_CORRELATION_KEY,
  AGENT_VERSION_CORRELATION_KEY,
  PROPOSAL_CORRELATION_KEY,
  RUN_CORRELATION_KEY,
  WORKFLOW_INSTANCE_CORRELATION_KEY,
} from './runActionCorrelation'

export type ActionAgentAttribution = {
  agentId: string | null
  agentVersion: string | null
  /** The entry's `proposalId` when a server record confirms it (see `isProposalVerified`); otherwise null. */
  verifiedProposalId: string | null
}

export type AttributionRun = {
  id: string
  agentId: string
  agentVersion?: string | null
}

export type AttributionProposal = {
  id: string
  runId: string
  agentId: string
  workflowInstanceId?: string | null
}

export type AttributionScope = {
  tenantId: string
  organizationId: string | null
  organizationIds?: readonly string[]
}

const uuidSchema = z.string().uuid()

function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && uuidSchema.safeParse(value).success
}

/**
 * A proposal-only entry is attributed to an agent only when the proposal it names
 * belongs to the same workflow instance the entry was written by. The proposal id
 * on an effector write is copied from the workflow context, which task completion
 * and the context PATCH can rewrite, so an unverified id must never name an agent.
 */
function verifiedProposal(
  correlation: Record<string, string>,
  proposalsById: Map<string, AttributionProposal>,
): AttributionProposal | null {
  const proposalId = correlation[PROPOSAL_CORRELATION_KEY]
  const workflowInstanceId = correlation[WORKFLOW_INSTANCE_CORRELATION_KEY]
  if (!proposalId || !workflowInstanceId) return null
  const proposal = proposalsById.get(proposalId)
  if (!proposal?.workflowInstanceId) return null
  return proposal.workflowInstanceId === workflowInstanceId ? proposal : null
}

/**
 * Whether the `proposalId` on an entry is backed by a server record: the proposal
 * was produced by the run the entry names (disposition writes stamp both), or it
 * belongs to the workflow instance the entry was written by (effector writes).
 * Neither `agentRunId` nor `workflowInstanceId` is copied from the user-writable
 * workflow context, so a forged id never passes.
 */
function verifiedProposalIdOf(
  correlation: Record<string, string>,
  proposalsById: Map<string, AttributionProposal>,
): string | null {
  const proposalId = correlation[PROPOSAL_CORRELATION_KEY]
  if (!proposalId) return null
  const proposal = proposalsById.get(proposalId)
  if (!proposal) return null
  const runId = correlation[RUN_CORRELATION_KEY]
  if (runId && proposal.runId === runId) return proposal.id
  const workflowInstanceId = correlation[WORKFLOW_INSTANCE_CORRELATION_KEY]
  if (workflowInstanceId && proposal.workflowInstanceId && proposal.workflowInstanceId === workflowInstanceId) {
    return proposal.id
  }
  return null
}

function scopeFilterOf(scope: AttributionScope) {
  return {
    tenantId: scope.tenantId,
    ...(scope.organizationId
      ? { organizationId: scope.organizationId }
      : scope.organizationIds ? { organizationId: { $in: [...scope.organizationIds] } } : {}),
  }
}

/**
 * Loads, in one scoped batch, every proposal an entry names next to a run or a
 * workflow instance id (the anchors verification compares against), skipping
 * proposals already known.
 */
async function loadAnchoredProposals(
  em: EntityManager,
  scope: AttributionScope,
  correlations: Array<Record<string, string>>,
  proposalsById: Map<string, AttributionProposal>,
): Promise<void> {
  const proposalIdsToLoad = new Set<string>()
  for (const correlation of correlations) {
    const proposalId = correlation[PROPOSAL_CORRELATION_KEY]
    const anchored = isUuid(correlation[RUN_CORRELATION_KEY]) || isUuid(correlation[WORKFLOW_INSTANCE_CORRELATION_KEY])
    if (isUuid(proposalId) && anchored && !proposalsById.has(proposalId)) proposalIdsToLoad.add(proposalId)
  }
  if (proposalIdsToLoad.size === 0) return
  const proposals = await findWithDecryption(
    em,
    AgentProposal,
    { id: { $in: Array.from(proposalIdsToLoad) }, ...scopeFilterOf(scope) },
    { fields: ['id', 'runId', 'agentId', 'workflowInstanceId'] },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  for (const proposal of proposals) {
    proposalsById.set(proposal.id, {
      id: proposal.id,
      runId: proposal.runId,
      agentId: proposal.agentId,
      workflowInstanceId: proposal.workflowInstanceId ?? null,
    })
  }
}

/**
 * The verified `proposalId` of each entry (see `verifiedProposalIdOf`), or null.
 * Loads proposals only — no run lookup — for callers that need the link, not the agent.
 */
export async function resolveVerifiedProposalIds(
  em: EntityManager,
  scope: AttributionScope,
  correlations: Array<Record<string, string>>,
): Promise<Array<string | null>> {
  const proposalsById = new Map<string, AttributionProposal>()
  await loadAnchoredProposals(em, scope, correlations, proposalsById)
  return correlations.map((correlation) => verifiedProposalIdOf(correlation, proposalsById))
}

/**
 * Names the agent and version behind each action-log entry, in this order: the
 * values stamped on the entry by the run's own command context, the entry's run,
 * then a proposal verified against the entry's workflow instance. Every lookup is
 * scoped to the caller's tenant (and organization when set); anything that cannot
 * be verified resolves to null rather than to a guess.
 */
export async function resolveActionAgentAttribution(
  em: EntityManager,
  scope: AttributionScope,
  correlations: Array<Record<string, string>>,
  known: { runs?: AttributionRun[]; proposals?: AttributionProposal[] } = {},
): Promise<ActionAgentAttribution[]> {
  const runsById = new Map<string, AttributionRun>((known.runs ?? []).map((run) => [run.id, run]))
  const proposalsById = new Map<string, AttributionProposal>(
    (known.proposals ?? []).map((proposal) => [proposal.id, proposal]),
  )
  await loadAnchoredProposals(em, scope, correlations, proposalsById)
  const scopeFilter = scopeFilterOf(scope)
  const decryptionScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }

  const runIdsToLoad = new Set<string>()
  for (const correlation of correlations) {
    if (correlation[AGENT_CORRELATION_KEY] && correlation[AGENT_VERSION_CORRELATION_KEY]) continue
    const runId = correlation[RUN_CORRELATION_KEY] ?? verifiedProposal(correlation, proposalsById)?.runId
    if (isUuid(runId) && !runsById.has(runId)) runIdsToLoad.add(runId)
  }
  if (runIdsToLoad.size > 0) {
    const runs = await findWithDecryption(
      em,
      AgentRun,
      { id: { $in: Array.from(runIdsToLoad) }, ...scopeFilter },
      { fields: ['id', 'agentId', 'agentVersion'] },
      decryptionScope,
    )
    for (const run of runs) runsById.set(run.id, { id: run.id, agentId: run.agentId, agentVersion: run.agentVersion ?? null })
  }

  return correlations.map((correlation) => {
    const runId = correlation[RUN_CORRELATION_KEY]
    const proposal = runId ? null : verifiedProposal(correlation, proposalsById)
    const run = runsById.get(runId ?? proposal?.runId ?? '')
    return {
      agentId: correlation[AGENT_CORRELATION_KEY] ?? run?.agentId ?? proposal?.agentId ?? null,
      agentVersion: correlation[AGENT_VERSION_CORRELATION_KEY] ?? run?.agentVersion ?? null,
      verifiedProposalId: verifiedProposalIdOf(correlation, proposalsById),
    }
  })
}
