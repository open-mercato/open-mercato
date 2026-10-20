/**
 * Administrative-queue visibility for unassigned work-inbox sources.
 *
 * §6.4 makes a row visible to whoever it belongs to, and an administrative queue
 * item belongs to nobody: no assignee, no claimant, no role queue, because the
 * module that raised it cannot know a tenant's routing policy or role
 * vocabulary. Without a class of its own such a row would go dark for everyone —
 * which is precisely what happens to agent-disposition work under a naive
 * "assigned OR role" reading.
 *
 * `WorkInboxSourceProvider.administrativeQueueFeature` is that class, and it has
 * two consumers which MUST agree:
 *
 * 1. **Source admission** — a declaring source contributes nothing to a caller
 *    who does not hold the feature, so the kind disappears rather than running a
 *    query whose every row the rule would refuse.
 * 2. **The §6.4 predicate** — handed back to the provider so a source serving
 *    `UserTask` rows uses it as the unassigned-queue arm instead of core's
 *    `workflows.tasks.view_all`.
 *
 * If those two disagreed, a row would be counted in `pagination.total` by one
 * and dropped from the page by the other — the exact "short page, lying total"
 * failure the denormalized entity-type column exists to prevent.
 *
 * The core-alone case is pinned too: with no declaring source registered, every
 * behaviour is byte-for-byte what it was.
 */

import { describe, test, expect, beforeEach } from '@jest/globals'
import {
  clearWorkInboxSources,
  isWorkInboxSourceAdmitted,
  registerWorkInboxSources,
  selectWorkInboxSources,
} from '../work-inbox/provider'
import type {
  WorkInboxQuery,
  WorkInboxRow,
  WorkInboxScope,
  WorkInboxSourceContext,
  WorkInboxSourceProvider,
} from '../work-inbox/provider'
import { listWorkInbox } from '../work-inbox/service'
import {
  buildUserTaskWorkInboxWhere,
  userTaskWorkInboxSource,
} from '../work-inbox/user-task-source'
import { decideTaskVisibility } from '../task-visibility'
import type { TaskFacts } from '../task-visibility'
import { makeTaskVisibilityContext } from './helpers/taskVisibilityContext'

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const USER_ID = '11111111-2222-4333-8444-cccccccccccc'
const NOW = new Date('2026-07-28T12:00:00.000Z')

const QUEUE_FEATURE = 'agent_orchestrator.proposals.view'

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

function makeScope(grantedFeatures: string[], isSuperAdmin = false): WorkInboxScope {
  return {
    tenantId: TENANT_ID,
    organizationIds: [ORG_ID],
    userId: USER_ID,
    roles: [],
    visibility: makeTaskVisibilityContext({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      roleNames: [],
      grantedFeatures,
      isSuperAdmin,
    }),
  }
}

function makeRow(overrides: Partial<WorkInboxRow> = {}): WorkInboxRow {
  return {
    id: 'proposal-1',
    kind: 'agent_disposition',
    moduleId: 'agent_orchestrator',
    title: 'Dispose agent proposal',
    description: null,
    status: 'PENDING',
    priority: null,
    dueDate: null,
    overdue: false,
    createdAt: '2026-07-28T09:00:00.000Z',
    updatedAt: '2026-07-28T09:00:00.000Z',
    assignedTo: null,
    assignedToRoles: null,
    claimedBy: null,
    entityTypes: [],
    entityBindings: [],
    detailHref: null,
    actions: [],
    details: {},
    ...overrides,
  }
}

/** Records the context it was handed, so the threading can be asserted. */
function makeQueueSource(
  administrativeQueueFeature: string | undefined,
  seen: WorkInboxSourceContext[],
): WorkInboxSourceProvider {
  return {
    kind: 'agent_disposition',
    moduleId: 'agent_orchestrator',
    ...(administrativeQueueFeature ? { administrativeQueueFeature } : {}),
    list: async (_query, context) => {
      seen.push(context)
      return { rows: [makeRow()], total: 1 }
    },
  }
}

function makeContext(scope: WorkInboxScope): WorkInboxSourceContext {
  return {
    scope,
    resolve: <T,>(name: string): T => {
      throw new Error(`[internal] unexpected resolve(${name})`)
    },
  }
}

/** A disposition-shaped row: nobody's personal work. */
function makeUnassignedFacts(overrides: Partial<TaskFacts> = {}): TaskFacts {
  return {
    id: 'task-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    status: 'PENDING',
    assignedTo: null,
    assigneeKind: 'user',
    assignedToRoles: null,
    claimedBy: null,
    entityBindings: [],
    ...overrides,
  }
}

beforeEach(() => clearWorkInboxSources())

describe('source admission', () => {
  test('a declaring source is admitted to a holder of its queue feature', () => {
    const source = makeQueueSource(QUEUE_FEATURE, [])
    expect(isWorkInboxSourceAdmitted(source, {
      grantedFeatures: [QUEUE_FEATURE],
      isSuperAdmin: false,
    })).toBe(true)
  })

  test('and refused to somebody who does not hold it', () => {
    const source = makeQueueSource(QUEUE_FEATURE, [])
    expect(isWorkInboxSourceAdmitted(source, {
      grantedFeatures: ['workflows.tasks.view', 'workflows.tasks.view_all'],
      isSuperAdmin: false,
    })).toBe(false)
  })

  test('a wildcard grant satisfies it', () => {
    // A tenant `admin` holds `agent_orchestrator.*`, never the concrete id. An
    // array membership test would lock every real administrator out of the queue
    // the grant exists for.
    const source = makeQueueSource(QUEUE_FEATURE, [])
    for (const wildcard of ['agent_orchestrator.*', '*']) {
      expect(isWorkInboxSourceAdmitted(source, {
        grantedFeatures: [wildcard],
        isSuperAdmin: false,
      })).toBe(true)
    }
  })

  test('a superadmin is admitted without the grant', () => {
    const source = makeQueueSource(QUEUE_FEATURE, [])
    expect(isWorkInboxSourceAdmitted(source, { grantedFeatures: [], isSuperAdmin: true })).toBe(true)
  })

  test('a source declaring nothing is admitted to everyone', () => {
    expect(isWorkInboxSourceAdmitted(userTaskWorkInboxSource, {
      grantedFeatures: [],
      isSuperAdmin: false,
    })).toBe(true)
  })

  test('selectWorkInboxSources drops the source before it is asked for rows', () => {
    registerWorkInboxSources([
      { moduleId: 'workflows', sources: [userTaskWorkInboxSource] },
      { moduleId: 'agent_orchestrator', sources: [makeQueueSource(QUEUE_FEATURE, [])] },
    ])

    const held = selectWorkInboxSources(makeQuery(), {
      grantedFeatures: [QUEUE_FEATURE],
      isSuperAdmin: false,
    })
    const withheld = selectWorkInboxSources(makeQuery(), {
      grantedFeatures: ['workflows.tasks.view'],
      isSuperAdmin: false,
    })

    expect(held.map((entry) => entry.provider.kind).sort()).toEqual([
      'agent_disposition',
      'user_task',
    ])
    expect(withheld.map((entry) => entry.provider.kind)).toEqual(['user_task'])
  })

  test('omitting the admission argument keeps every existing caller unchanged', () => {
    registerWorkInboxSources([
      { moduleId: 'agent_orchestrator', sources: [makeQueueSource(QUEUE_FEATURE, [])] },
    ])

    expect(selectWorkInboxSources(makeQuery())).toHaveLength(1)
  })
})

describe('the merged inbox', () => {
  test('a disposition-shaped row reaches a holder of the declared feature', async () => {
    const seen: WorkInboxSourceContext[] = []
    registerWorkInboxSources([
      { moduleId: 'agent_orchestrator', sources: [makeQueueSource(QUEUE_FEATURE, seen)] },
    ])

    const scope = makeScope([QUEUE_FEATURE])
    const result = await listWorkInbox(makeQuery(), makeContext(scope))

    expect(result.rows.map((row) => row.id)).toEqual(['proposal-1'])
    expect(result.total).toBe(1)
    expect(result.kinds).toEqual(['agent_disposition'])
  })

  test('and is invisible — and uncounted — without it', async () => {
    const seen: WorkInboxSourceContext[] = []
    registerWorkInboxSources([
      { moduleId: 'agent_orchestrator', sources: [makeQueueSource(QUEUE_FEATURE, seen)] },
    ])

    const scope = makeScope(['workflows.tasks.view', 'workflows.tasks.view_all'])
    const result = await listWorkInbox(makeQuery(), makeContext(scope))

    expect(result.rows).toEqual([])
    // `total` must not count what the caller cannot see, and the source must not
    // have been queried at all.
    expect(result.total).toBe(0)
    expect(result.kinds).toEqual([])
    expect(seen).toHaveLength(0)
  })

  test('each source is handed its OWN declaration', async () => {
    const declaring: WorkInboxSourceContext[] = []
    const plain: WorkInboxSourceContext[] = []
    registerWorkInboxSources([
      { moduleId: 'agent_orchestrator', sources: [makeQueueSource(QUEUE_FEATURE, declaring)] },
      {
        moduleId: 'other',
        sources: [{ ...makeQueueSource(undefined, plain), kind: 'other_kind', moduleId: 'other' }],
      },
    ])

    await listWorkInbox(makeQuery(), makeContext(makeScope([QUEUE_FEATURE])))

    expect(declaring[0]?.administrativeQueueFeature).toBe(QUEUE_FEATURE)
    // Not the neighbour's — a leaked declaration would widen an unrelated kind.
    expect(plain[0]?.administrativeQueueFeature).toBeNull()
  })
})

describe('the predicate arm the declaration drives', () => {
  const policy = { businessContextEnabled: true }

  test('the declared feature admits an unassigned row', () => {
    const principal = makeTaskVisibilityContext({
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      grantedFeatures: [QUEUE_FEATURE],
    }).principal

    const decision = decideTaskVisibility(
      principal,
      makeUnassignedFacts({ administrativeQueueFeature: QUEUE_FEATURE }),
      new Map(),
      policy,
    )

    expect(decision.visible).toBe(true)
    expect(decision.reason).toBe('administrative-queue')
    // Seeing a queue is never permission to finish somebody's work.
    expect(decision.actable).toBe(false)
  })

  test('without the declaration the same row needs workflows.tasks.view_all', () => {
    const queueHolder = makeTaskVisibilityContext({
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      grantedFeatures: [QUEUE_FEATURE],
    }).principal

    expect(
      decideTaskVisibility(queueHolder, makeUnassignedFacts(), new Map(), policy).visible,
    ).toBe(false)

    const administrator = makeTaskVisibilityContext({
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      grantedFeatures: ['workflows.tasks.view_all'],
    }).principal

    expect(
      decideTaskVisibility(administrator, makeUnassignedFacts(), new Map(), policy).visible,
    ).toBe(true)
  })

  test('an ASSIGNED row is never admitted by the queue feature', () => {
    // The arm is for work nobody owns. A colleague's task must not become
    // visible because the caller holds the queue grant.
    const principal = makeTaskVisibilityContext({
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      grantedFeatures: [QUEUE_FEATURE],
    }).principal

    const decision = decideTaskVisibility(
      principal,
      makeUnassignedFacts({
        assignedTo: 'somebody-else',
        administrativeQueueFeature: QUEUE_FEATURE,
      }),
      new Map(),
      policy,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:no-relationship')
  })
})

describe('the SQL filter follows the same declaration', () => {
  function armsOf(where: Record<string, unknown>): Record<string, unknown>[] {
    const and = (where.$and ?? []) as Record<string, unknown>[]
    const group = and.find((condition) => Array.isArray(condition.$or))
    return (group?.$or ?? []) as Record<string, unknown>[]
  }

  test('the unassigned-queue arm appears for a holder of the declared feature', () => {
    const where = buildUserTaskWorkInboxWhere(makeQuery(), makeScope([QUEUE_FEATURE]), {
      administrativeQueueFeature: QUEUE_FEATURE,
    }) as Record<string, unknown>

    const queueArm = armsOf(where).find((arm) => arm.assignedTo === null)
    expect(queueArm).toBeDefined()
    expect(queueArm?.claimedBy).toBeNull()
  })

  test('and not for somebody who lacks it', () => {
    const where = buildUserTaskWorkInboxWhere(
      makeQuery(),
      makeScope(['workflows.tasks.view']),
      { administrativeQueueFeature: QUEUE_FEATURE },
    ) as Record<string, unknown>

    expect(armsOf(where).some((arm) => arm.assignedTo === null)).toBe(false)
  })

  test('core alone, with no declaration, builds exactly the filter it always did', () => {
    const scope = makeScope(['workflows.tasks.view'])
    const withoutOptions = buildUserTaskWorkInboxWhere(makeQuery(), scope)
    const withEmptyOptions = buildUserTaskWorkInboxWhere(makeQuery(), scope, {})

    expect(withEmptyOptions).toEqual(withoutOptions)
    expect(armsOf(withoutOptions as Record<string, unknown>).some((arm) => arm.assignedTo === null)).toBe(
      false,
    )
  })
})
