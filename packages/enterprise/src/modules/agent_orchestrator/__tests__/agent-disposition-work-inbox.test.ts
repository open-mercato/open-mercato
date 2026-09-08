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
 *   action reads;
 * - a narrowing the constant projection cannot satisfy drops the source
 *   entirely, rows AND total — the inbox's Status filter used to return this
 *   whole queue under `status=COMPLETED` and under every other status, because
 *   the source read none of the query's row-level filters.
 */

import { describe, test, expect, jest } from '@jest/globals'
import {
  AGENT_DISPOSITION_INBOX_KIND,
  AGENT_DISPOSITION_QUEUE_FEATURE,
  AGENT_DISPOSITION_ROW_STATUS,
  AGENT_DISPOSITION_TITLE_KEY,
  agentDispositionSourceMatchesQuery,
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

/**
 * A translator that echoes the key it was asked for, so a projection that goes
 * back to hard-coded English fails loudly here instead of reading fine in
 * English and wrong in every other locale.
 */
const PRESENTATION = {
  translate: (key: string, _fallback: string, params?: Record<string, string | number>) =>
    `${key}:${params?.agent ?? ''}`,
  agentLabels: new Map([['invoice-triage', 'Invoice triage']]),
}

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
  proposal.workflowInstanceId = '11111111-2222-4333-8444-ffffffffffff'
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

    expect(where.workflowInstanceId).toBe('process-1')
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

/**
 * The source cannot express any of these as a column predicate on
 * `agent_proposals` — its rows are pending, unprioritized, undated and
 * ownerless by construction — so it has to answer them against that constant.
 * Ignoring them is what made the Work Inbox's Status filter useless: every
 * status other than the one these rows carry still returned the whole queue.
 */
describe('narrowings the constant projection cannot satisfy', () => {
  function listWith(overrides: Partial<WorkInboxQuery>) {
    const findAndCount = jest.fn(async () => [[makeProposal()], 3])
    const result = agentDispositionWorkInboxSource.list(makeQuery(overrides), {
      scope: makeScope(),
      resolve: <T,>(name: string): T => {
        if (name !== 'em') throw new Error(`[internal] unexpected resolve(${name})`)
        return { findAndCount } as T
      },
    })
    return { result, findAndCount }
  }

  test('every row this source projects is PENDING', () => {
    expect(toAgentDispositionRow(makeProposal(), NOW, PRESENTATION).status).toBe(
      AGENT_DISPOSITION_ROW_STATUS,
    )
  })

  test('a status filter that excludes PENDING contributes no rows and no total', async () => {
    const { result, findAndCount } = listWith({ statuses: ['COMPLETED'] })

    expect(await result).toEqual({ rows: [], total: 0 })
    // Counted-but-absent is the failure mode: a row in `pagination.total` that
    // never reaches the page is exactly what the inbox guards against.
    expect(findAndCount).not.toHaveBeenCalled()
  })

  test.each([['IN_PROGRESS'], ['CANCELLED'], ['ESCALATED']])(
    'status=%s drops the source instead of falling through to the pending queue',
    (status) => {
      expect(agentDispositionSourceMatchesQuery(makeQuery({ statuses: [status] }))).toBe(false)
    },
  )

  test('a status filter that includes PENDING still lists the queue', async () => {
    const { result, findAndCount } = listWith({ statuses: ['PENDING'] })

    expect((await result).rows).toHaveLength(1)
    expect(findAndCount).toHaveBeenCalled()
  })

  test('a multi-value status filter matches on any member', () => {
    expect(
      agentDispositionSourceMatchesQuery(makeQuery({ statuses: ['IN_PROGRESS', 'PENDING'] })),
    ).toBe(true)
  })

  test.each([
    ['priority', { priorities: ['high'] as WorkInboxQuery['priorities'] }],
    ['role', { roles: ['reviewer'] }],
    ['entity type', { entityTypes: ['sales:order'] }],
    ['assignee', { assignedTo: 'user-2' }],
    ['overdue-only', { overdueOnly: true }],
  ])('a %s narrowing drops the source too — its rows carry none', (_label, overrides) => {
    expect(agentDispositionSourceMatchesQuery(makeQuery(overrides))).toBe(false)
  })

  test('an unnarrowed query still contributes, and myWork never narrows this queue', () => {
    // The inbox opens with `myWork` on. Answering it here would hide the very
    // queue the source exists to raise — admission is the queue feature's job.
    expect(agentDispositionSourceMatchesQuery(makeQuery())).toBe(true)
    expect(agentDispositionSourceMatchesQuery(makeQuery({ myWork: true }))).toBe(true)
  })
})

describe('the row projection', () => {
  test('carries proposalId and claims no owner it does not have', () => {
    const row = toAgentDispositionRow(makeProposal(), NOW, PRESENTATION)

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

  test('titles the row through the locale key, naming the agent rather than its id', () => {
    const row = toAgentDispositionRow(makeProposal(), NOW, PRESENTATION)

    expect(row.title).toBe(`${AGENT_DISPOSITION_TITLE_KEY}:Invoice triage`)
  })

  test('falls back to the agent id only when the registry has no label for it', () => {
    const row = toAgentDispositionRow(makeProposal(), NOW, {
      translate: PRESENTATION.translate,
      agentLabels: new Map(),
    })

    expect(row.title).toBe(`${AGENT_DISPOSITION_TITLE_KEY}:invoice-triage`)
  })
})
