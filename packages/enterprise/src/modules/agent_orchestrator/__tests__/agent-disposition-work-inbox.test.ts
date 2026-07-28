/**
 * The `agent_disposition` work-inbox source.
 *
 * Disposition work belongs to nobody: `dispositionService` cannot pick a tenant
 * user without inventing routing policy, and cannot name a role because
 * `assignedToRoles` holds mutable role NAMES. Under §6.4 ("you see a task iff it
 * is yours") an ownerless item is an item nobody sees, so this source declares
 * an `administrativeQueueFeature` — the visibility class that admits the
 * population which could already act on this kind of work, and only them.
 *
 * What is asserted here:
 *
 * - the declaration is exactly `agent_orchestrator.proposals.view`, the grant
 *   the seeded `admin` / `employee` / `operator` / `engineer` roles already hold;
 * - the query is tenant- AND organization-scoped regardless of the grant — the
 *   queue feature says which KIND of work you may see, never whose;
 * - eval-replay proposals never reach the queue (allowlist, not denylist);
 * - the row carries `proposalId`, which the existing "Review proposal" row
 *   action reads.
 */

import { describe, test, expect, jest } from '@jest/globals'
import {
  AGENT_DISPOSITION_INBOX_KIND,
  AGENT_DISPOSITION_QUEUE_FEATURE,
  agentDispositionWorkInboxSource,
  buildAgentDispositionWhere,
  toAgentDispositionRow,
} from '../lib/workInbox/agentDispositionSource'
import { isWorkInboxSourceAdmitted } from '@open-mercato/core/modules/workflows/lib/work-inbox/provider'
import type {
  WorkInboxQuery,
  WorkInboxScope,
} from '@open-mercato/core/modules/workflows/lib/work-inbox/provider'
import { AgentProposal } from '../data/entities'

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const OTHER_ORG_ID = '11111111-2222-4333-8444-cccccccccccc'
const NOW = new Date('2026-07-28T12:00:00.000Z')

function makeQuery(overrides: Partial<WorkInboxQuery> = {}): WorkInboxQuery {
  return {
    kinds: null,
    moduleIds: null,
    entityTypes: null,
    roles: null,
    priorities: null,
    statuses: null,
    overdueOnly: false,
    myWork: false,
    assignedTo: null,
    workflowInstanceId: null,
    limit: 50,
    offset: 0,
    now: NOW,
    ...overrides,
  }
}

function makeScope(organizationIds: string[] | null = [ORG_ID]): WorkInboxScope {
  return {
    tenantId: TENANT_ID,
    organizationIds,
    userId: 'user-1',
    roles: [],
    // The source never consults the §6.4 predicate — its rows are proposals, not
    // `UserTask` rows — so a minimal principal is enough here.
    visibility: {
      principal: {
        kind: 'backoffice',
        userId: 'user-1',
        tenantId: TENANT_ID,
        organizationIds,
        roleNames: [],
        grantedFeatures: [AGENT_DISPOSITION_QUEUE_FEATURE],
        isSuperAdmin: false,
      },
      policy: { businessContextEnabled: true },
      entityAccess: new Map(),
      scopedEntityTypes: [],
    },
  }
}

function makeProposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  const proposal = new AgentProposal()
  proposal.id = '11111111-2222-4333-8444-dddddddddddd'
  proposal.tenantId = TENANT_ID
  proposal.organizationId = ORG_ID
  proposal.agentId = 'invoice-triage'
  proposal.runId = '11111111-2222-4333-8444-eeeeeeeeeeee'
  proposal.processId = '11111111-2222-4333-8444-ffffffffffff'
  proposal.stepId = 'review'
  proposal.payload = { total: 10 }
  proposal.source = 'runtime'
  proposal.disposition = 'pending'
  proposal.createdAt = new Date('2026-07-28T09:00:00.000Z')
  proposal.updatedAt = new Date('2026-07-28T09:30:00.000Z')
  Object.assign(proposal, overrides)
  return proposal
}

describe('the declaration', () => {
  test('the source declares the proposals-view queue feature', () => {
    expect(agentDispositionWorkInboxSource.kind).toBe(AGENT_DISPOSITION_INBOX_KIND)
    expect(agentDispositionWorkInboxSource.moduleId).toBe('agent_orchestrator')
    expect(agentDispositionWorkInboxSource.administrativeQueueFeature).toBe(
      'agent_orchestrator.proposals.view',
    )
  })

  test('a holder is admitted and a workflows-only user is not', () => {
    expect(
      isWorkInboxSourceAdmitted(agentDispositionWorkInboxSource, {
        grantedFeatures: [AGENT_DISPOSITION_QUEUE_FEATURE],
        isSuperAdmin: false,
      }),
    ).toBe(true)

    // The intended narrowing: `workflows.tasks.view` used to show these rows to
    // anyone who could open the task list at all.
    expect(
      isWorkInboxSourceAdmitted(agentDispositionWorkInboxSource, {
        grantedFeatures: ['workflows.tasks.view', 'workflows.tasks.view_all'],
        isSuperAdmin: false,
      }),
    ).toBe(false)
  })
})

describe('the query', () => {
  test('scopes to the tenant and the caller organizations, and to pending runtime rows', () => {
    const where = buildAgentDispositionWhere(makeQuery(), makeScope()) as Record<string, unknown>

    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.organizationId).toEqual({ $in: [ORG_ID] })
    expect(where.disposition).toBe('pending')
    // An allowlist, so a future proposal source has to opt in rather than
    // silently appear in somebody's work queue.
    expect(where.source).toBe('runtime')
    expect(where.deletedAt).toBeNull()
  })

  test('an unrestricted operator gets no organization narrowing, but never loses tenant scoping', () => {
    const where = buildAgentDispositionWhere(makeQuery(), makeScope(null)) as Record<string, unknown>

    expect(where.organizationId).toBeUndefined()
    expect(where.tenantId).toBe(TENANT_ID)
  })

  test('narrows to a workflow instance when the inbox asks for one', () => {
    const where = buildAgentDispositionWhere(
      makeQuery({ workflowInstanceId: 'process-1' }),
      makeScope(),
    ) as Record<string, unknown>

    expect(where.processId).toBe('process-1')
  })

  test('the listing pages through the ORM and reports the true total', async () => {
    const findAndCount = jest.fn(async () => [[makeProposal()], 3])
    const rows = await agentDispositionWorkInboxSource.list(makeQuery({ offset: 10, limit: 5 }), {
      scope: makeScope(),
      resolve: <T,>(name: string): T => {
        if (name !== 'em') throw new Error(`[internal] unexpected resolve(${name})`)
        return { findAndCount } as T
      },
    })

    expect(rows.total).toBe(3)
    expect(rows.rows).toHaveLength(1)
    const [, , options] = findAndCount.mock.calls[0] as [unknown, unknown, { limit: number; offset: number }]
    // Merge-then-page: each source is asked for the whole window and the service
    // slices it, so the offset lives in the merge, not in the query.
    expect(options).toMatchObject({ limit: 15, offset: 0 })
  })
})

describe('the row projection', () => {
  test('carries proposalId and claims no owner it does not have', () => {
    const row = toAgentDispositionRow(makeProposal(), NOW)

    expect(row.kind).toBe(AGENT_DISPOSITION_INBOX_KIND)
    expect(row.details.proposalId).toBe('11111111-2222-4333-8444-dddddddddddd')
    // Every one of these is null on purpose: a fabricated assignee is exactly
    // what the administrative-queue class exists to avoid.
    expect(row.assignedTo).toBeNull()
    expect(row.assignedToRoles).toBeNull()
    expect(row.claimedBy).toBeNull()
    expect(row.dueDate).toBeNull()
    expect(row.overdue).toBe(false)
    expect(row.detailHref).toBe('/backend/caseload/11111111-2222-4333-8444-dddddddddddd')
  })
})
