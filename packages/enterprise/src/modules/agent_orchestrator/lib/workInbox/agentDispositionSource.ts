/**
 * Work Inbox — the `agent_disposition` source.
 *
 * ## Why this source exists
 *
 * `dispositionService` raises a proposal for a human when the auto-approve rule
 * declines to act. That work belongs to nobody in particular: the module cannot
 * pick a tenant user without inventing routing policy that belongs in the
 * workflow definition, and it cannot name a role because `assignedToRoles` holds
 * tenant role NAMES that a rename would orphan silently. Under §6.4 —
 * "you see a task iff it is yours" — an item with no owner is an item nobody
 * sees, so without a visibility class of its own the whole queue would go dark.
 *
 * The class is `administrativeQueueFeature`: an ACL feature that admits a
 * principal to a source's unassigned rows, declaring "this kind is an
 * administrative queue, not personal work". Here it is
 * `agent_orchestrator.proposals.view`, which the seeded `admin`, `employee`,
 * `operator` and `engineer` roles already hold — so the population that can see
 * disposition work is exactly the population that could act on it before, while
 * a workflows-only user with no orchestrator grant stops seeing it. That is the
 * intended narrowing.
 *
 * ## What it lists, and why not the `UserTask` rows
 *
 * The `AgentProposal` rows awaiting human disposition — NOT the shadow
 * `UserTask` rows `dispositionService` also writes. Three reasons:
 *
 * 1. **Disposing the proposal is what unblocks the run.** A parked
 *    `INVOKE_AGENT` resumes from the dispose path, never from the task row, so
 *    the proposal is the work item and the task row is a pointer at it.
 * 2. **Listing the task rows here would double-list them.** They are ordinary
 *    `user_tasks`, already served by core's `user_task` source, and core cannot
 *    exclude them without learning an enterprise-owned discriminator — exactly
 *    the coupling the provider contract exists to avoid. A tenant `admin` holds
 *    both grants and would see every disposition item twice.
 * 3. **`dispositionService.ts` stays untouched.** The auto-approve boundary it
 *    guards is not moved, so its Ask-First gate does not fire.
 *
 * The shadow `UserTask` rows therefore remain visible to `workflows.tasks.view_all`
 * holders through core's source, which is the correct reading of what they are:
 * administrative residue. Nothing closes them today — that is defect A7, filed
 * separately and deliberately not fixed here.
 */

import type { EntityManager, FilterQuery } from '@mikro-orm/core'
import type {
  WorkInboxAction,
  WorkInboxQuery,
  WorkInboxRow,
  WorkInboxScope,
  WorkInboxSourceContext,
  WorkInboxSourceProvider,
  WorkInboxSourceResult,
} from '@open-mercato/core/modules/workflows/lib/work-inbox/provider'
import {
  deriveWorkInboxOverdue,
  normalizeWorkInboxPriority,
} from '@open-mercato/core/modules/workflows/lib/work-inbox/provider'
import { AgentProposal } from '../../data/entities'

export const AGENT_ORCHESTRATOR_MODULE_ID = 'agent_orchestrator'

export const AGENT_DISPOSITION_INBOX_KIND = 'agent_disposition'

/**
 * The queue feature. Concrete rather than a wildcard, and matched with the
 * platform's wildcard-aware matcher wherever it is checked, so `admin`'s
 * `agent_orchestrator.*` satisfies it.
 */
export const AGENT_DISPOSITION_QUEUE_FEATURE = 'agent_orchestrator.proposals.view'

/**
 * One action, and it is a navigation rather than a POST: disposing needs the
 * operator to read the payload and choose approve / edit / reject, which is the
 * Caseload's job. A one-shot endpoint here would be a second, unreviewed way to
 * dispose.
 */
export const AGENT_DISPOSITION_ACTIONS: WorkInboxAction[] = []

/** Proposals a human still has to answer for. */
const PENDING_DISPOSITION = 'pending'

/**
 * Rows produced by an eval replay are a record of what the agent proposed, not
 * work for an operator — the same `source: 'runtime'` floor the proposals list
 * route applies, and for the same reason: an allowlist keeps the queue closed by
 * default, so a future source has to opt in rather than silently appear in
 * somebody's inbox.
 */
const RUNTIME_SOURCE = 'runtime'

export function buildAgentDispositionWhere(
  query: WorkInboxQuery,
  scope: WorkInboxScope,
): FilterQuery<AgentProposal> {
  const where: Record<string, unknown> = {
    tenantId: scope.tenantId,
    disposition: PENDING_DISPOSITION,
    source: RUNTIME_SOURCE,
    deletedAt: null,
  }

  if (scope.organizationIds) {
    where.organizationId = { $in: scope.organizationIds }
  }

  if (query.workflowInstanceId) {
    where.processId = query.workflowInstanceId
  }

  return where as FilterQuery<AgentProposal>
}

/**
 * A proposal has no assignee, no claimant, no queue and no due date — every one
 * of those is `null` on purpose rather than invented, because a fabricated
 * assignee is what the whole administrative-queue class exists to avoid. The
 * source's `administrativeQueueFeature` is what makes the row visible.
 */
export function toAgentDispositionRow(proposal: AgentProposal, now: Date): WorkInboxRow {
  const createdAt = proposal.createdAt.toISOString()
  return {
    id: proposal.id,
    kind: AGENT_DISPOSITION_INBOX_KIND,
    moduleId: AGENT_ORCHESTRATOR_MODULE_ID,
    title: `Dispose agent proposal (${proposal.agentId})`,
    description: null,
    status: 'PENDING',
    priority: normalizeWorkInboxPriority(null),
    dueDate: null,
    overdue: deriveWorkInboxOverdue(null, 'PENDING', now),
    createdAt,
    updatedAt: proposal.updatedAt.toISOString(),
    assignedTo: null,
    assignedToRoles: null,
    claimedBy: null,
    entityTypes: [],
    entityBindings: [],
    detailHref: `/backend/caseload/${proposal.id}`,
    actions: AGENT_DISPOSITION_ACTIONS,
    // `proposalId` is what the existing "Review proposal" row action reads, and
    // the API spreads `details` UNDER the common fields so it survives onto the
    // wire without shadowing anything.
    details: {
      proposalId: proposal.id,
      agentId: proposal.agentId,
      runId: proposal.runId,
      processId: proposal.processId ?? null,
      stepId: proposal.stepId ?? null,
      confidence: proposal.confidence ?? null,
    },
  }
}

async function listAgentDispositionWorkItems(
  query: WorkInboxQuery,
  context: WorkInboxSourceContext,
): Promise<WorkInboxSourceResult> {
  // The source is dropped entirely for a caller without the queue feature
  // (`selectWorkInboxSources`), so reaching here already means admitted. Tenant
  // and organization scoping is still applied on every query — the queue feature
  // says which KIND of work you may see, never whose.
  const em = context.resolve<EntityManager>('em')
  const [proposals, total] = await em.findAndCount(
    AgentProposal,
    buildAgentDispositionWhere(query, context.scope),
    {
      orderBy: [{ createdAt: 'DESC' }],
      limit: query.offset + query.limit,
      offset: 0,
    },
  )

  return {
    rows: proposals.map((proposal) => toAgentDispositionRow(proposal, query.now)),
    total,
  }
}

export const agentDispositionWorkInboxSource: WorkInboxSourceProvider = {
  kind: AGENT_DISPOSITION_INBOX_KIND,
  moduleId: AGENT_ORCHESTRATOR_MODULE_ID,
  administrativeQueueFeature: AGENT_DISPOSITION_QUEUE_FEATURE,
  actions: AGENT_DISPOSITION_ACTIONS,
  list: listAgentDispositionWorkItems,
}
