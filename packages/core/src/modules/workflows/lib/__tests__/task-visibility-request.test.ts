/**
 * Per-request wiring of the §6.4 rule.
 *
 * Two properties carry the whole change and are asserted here directly:
 *
 * 1. **The SQL gate and the predicate agree.** They are two expressions of one
 *    rule, and the single state where they can disagree — a row counted in
 *    `pagination.total` and then dropped from the page — is the failure D-2's
 *    denormalized column exists to prevent.
 * 2. **A task about nothing stays visible to its assignee.** `entity_types IS
 *    NULL` is a disjunct in the SQL and a vacuous `every` in the predicate.
 *    Losing either one takes the entire pre-Phase-4 corpus dark, which is an
 *    outage rather than a narrowing.
 */

import { describe, test, expect, jest } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import { UserTask } from '../../data/entities'
import { decideTaskVisibility } from '../task-visibility'
import {
  buildTaskEntityGateConditions,
  buildTaskVisibilityRequestConditions,
  collectScopedTaskEntityTypes,
  collectTaskEntityTypesFromTasks,
  decideTaskAccess,
  filterVisibleTasks,
  resolveAllowedTaskEntityTypes,
  resolveTaskRefusal,
  toTaskFacts,
} from '../task-visibility-request'
import { makeTaskVisibilityContext } from './helpers/taskVisibilityContext'

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const OTHER_TENANT_ID = '99999999-2222-4333-8444-aaaaaaaaaaaa'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const USER_ID = 'user-1'

function makeTask(overrides: Partial<UserTask> = {}): UserTask {
  const task = new UserTask()
  task.id = '11111111-2222-4333-8444-555555555555'
  task.workflowInstanceId = '11111111-2222-4333-8444-666666666666'
  task.stepInstanceId = '11111111-2222-4333-8444-777777777777'
  task.taskName = 'Approve order'
  task.status = 'PENDING'
  task.assignedTo = USER_ID
  task.assigneeKind = 'user'
  task.assignedToRoles = null
  task.claimedBy = null
  task.entityBindings = null
  task.entityTypes = null
  task.tenantId = TENANT_ID
  task.organizationId = ORG_ID
  task.createdAt = new Date('2026-07-28T09:00:00.000Z')
  task.updatedAt = new Date('2026-07-28T09:00:00.000Z')
  Object.assign(task, overrides)
  return task
}

function assigneeContext(overrides: Parameters<typeof makeTaskVisibilityContext>[0] = {}) {
  return makeTaskVisibilityContext({
    userId: USER_ID,
    tenantId: TENANT_ID,
    organizationIds: [ORG_ID],
    ...overrides,
  })
}

describe('the entity gate as SQL', () => {
  test('is a whitelist over the types present in scope, never a denylist', () => {
    const context = assigneeContext({
      grantedFeatures: ['workflows.tasks.view', 'customers.deals.view'],
      entityAccess: {
        'customers:customer_deal': { kind: 'requires', features: ['customers.deals.view'] },
        'sales:sales_order': { kind: 'requires', features: ['sales.orders.view'] },
      },
    })

    expect(resolveAllowedTaskEntityTypes(context)).toEqual(['customers:customer_deal'])
    expect(buildTaskEntityGateConditions(context)).toEqual([
      {
        $or: [
          { entityTypes: null },
          { entityTypes: { $contained: ['customers:customer_deal'] } },
        ],
      },
    ])
  })

  test('always carries the IS NULL disjunct so a task about nothing survives', () => {
    // `NULL <@ ARRAY[…]` is NULL, not true. Without this disjunct every row
    // written before the column existed disappears from its own assignee's
    // inbox — the outage the whole design is built to avoid.
    const conditions = buildTaskEntityGateConditions(assigneeContext())
    const disjuncts = (conditions[0] as { $or: unknown[] }).$or

    expect(disjuncts[0]).toEqual({ entityTypes: null })
  })

  test('treats an unresolvable type and a missing map key alike — neither is allowed', () => {
    const context = assigneeContext({
      grantedFeatures: ['*'],
      entityAccess: {
        'Custmers:Deal': { kind: 'unknown-entity-type' },
        'platform:only': { kind: 'unavailable' },
      },
    })

    // `sales:sales_order` was never enumerated, so it is absent from the map.
    expect(resolveAllowedTaskEntityTypes(context, [
      'Custmers:Deal',
      'platform:only',
      'sales:sales_order',
    ])).toEqual([])
  })

  test('matches required features with the wildcard-aware matcher', () => {
    const context = assigneeContext({
      grantedFeatures: ['customers.*'],
      entityAccess: {
        'customers:customer_deal': { kind: 'requires', features: ['customers.deals.view'] },
      },
    })

    expect(resolveAllowedTaskEntityTypes(context)).toEqual(['customers:customer_deal'])
  })

  test('is skipped for a superadmin, who short-circuits the gate in the predicate too', () => {
    expect(buildTaskEntityGateConditions(assigneeContext({ isSuperAdmin: true }))).toEqual([])
  })

  test('is skipped under the tenant opt-out, which restores the legacy read filter', () => {
    expect(
      buildTaskEntityGateConditions(assigneeContext({ businessContextEnabled: false })),
    ).toEqual([])
  })

  test('is lifted from the SQL for a view_all administrator, who is told about the rows instead', () => {
    // Administration still does not widen the entity gate — the PREDICATE
    // refuses every one of these rows, so none reaches the response. What
    // changes is where the refusal happens: excluding them in SQL left an
    // administrator with a page short by an unexplained number of rows, which is
    // the trace-free disappearance design §3.6 forbids. They arrive, they are
    // refused, and they are reported as markers (`partitionTaskPage`).
    const context = assigneeContext({
      grantedFeatures: ['workflows.tasks.view', 'workflows.tasks.view_all'],
      entityAccess: {
        'sales:sales_order': { kind: 'requires', features: ['sales.orders.view'] },
      },
    })

    expect(buildTaskVisibilityRequestConditions(context)).toEqual([])
  })
})

describe('the relationship clause as SQL', () => {
  test('narrows an ordinary caller to their own work and their queues', () => {
    const conditions = buildTaskVisibilityRequestConditions(
      assigneeContext({ roleNames: ['approver'] }),
    )

    expect(conditions[0]).toEqual({
      $or: [
        { assignedTo: USER_ID, assigneeKind: 'user' },
        { claimedBy: USER_ID },
        { assignedToRoles: { $overlap: ['approver'] } },
      ],
    })
  })

  test('the opt-out drops the relationship clause and the entity clause together', () => {
    expect(
      buildTaskVisibilityRequestConditions(
        assigneeContext({ roleNames: ['approver'], businessContextEnabled: false }),
      ),
    ).toEqual([])
  })
})

describe('SQL gate and predicate agree', () => {
  const context = assigneeContext({
    grantedFeatures: ['workflows.tasks.view', 'customers.deals.view'],
    entityAccess: {
      'customers:customer_deal': { kind: 'requires', features: ['customers.deals.view'] },
      'sales:sales_order': { kind: 'requires', features: ['sales.orders.view'] },
    },
  })

  const allowed = new Set(resolveAllowedTaskEntityTypes(context))

  const rows: Array<[string, UserTask]> = [
    ['no bindings at all (a pre-Phase-4 row)', makeTask()],
    [
      'bound to a type the caller may view',
      makeTask({
        entityBindings: [{ entityType: 'customers:customer_deal', entityId: 'deal-1' }],
        entityTypes: ['customers:customer_deal'],
      }),
    ],
    [
      'bound to a type the caller may not view',
      makeTask({
        entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }],
        entityTypes: ['sales:sales_order'],
      }),
    ],
    [
      'bound to one viewable and one unviewable type',
      makeTask({
        entityBindings: [
          { entityType: 'customers:customer_deal', entityId: 'deal-1' },
          { entityType: 'sales:sales_order', entityId: 'order-1' },
        ],
        entityTypes: ['customers:customer_deal', 'sales:sales_order'],
      }),
    ],
  ]

  test.each(rows)('%s', (_label, task) => {
    // What the SQL `entity_types IS NULL OR entity_types <@ ARRAY[allowed]`
    // clause would answer for this row.
    const sqlAdmits =
      task.entityTypes === null || task.entityTypes.every((type) => allowed.has(type))

    expect(decideTaskAccess(context, task).visible).toBe(sqlAdmits)
  })
})

describe('the no-bindings vacuous pass, end to end', () => {
  test('a legacy row with NULL entity_types stays visible to its assignee', () => {
    const context = assigneeContext({ grantedFeatures: ['workflows.tasks.view'] })
    const legacy = makeTask({ entityBindings: null, entityTypes: null })

    const decision = decideTaskAccess(context, legacy)

    expect(decision.visible).toBe(true)
    expect(decision.actable).toBe(true)
    expect(decision.reason).toBe('assignee')
    // And the SQL half admits it through the IS NULL disjunct.
    expect(buildTaskEntityGateConditions(context)[0]).toMatchObject({
      $or: expect.arrayContaining([{ entityTypes: null }]),
    })
  })

  test('the same row is invisible to an unrelated colleague', () => {
    const colleague = makeTaskVisibilityContext({
      userId: 'user-2',
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      grantedFeatures: ['workflows.tasks.view'],
    })

    const decision = decideTaskAccess(colleague, makeTask())

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:no-relationship')
  })

  test('the opt-out gives that colleague the legacy read back, and nothing else', () => {
    const colleague = makeTaskVisibilityContext({
      userId: 'user-2',
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      grantedFeatures: ['workflows.tasks.view'],
      businessContextEnabled: false,
    })

    const decision = decideTaskAccess(colleague, makeTask())

    expect(decision.visible).toBe(true)
    expect(decision.reason).toBe('legacy-read-filter')
    expect(decision.actable).toBe(false)
    expect(decision.claimable).toBe(false)
  })
})

describe('cross-tenant and cross-organization rows', () => {
  test('a foreign tenant is denied whether the opt-out is on or off', () => {
    const foreign = makeTask({ tenantId: OTHER_TENANT_ID })

    for (const businessContextEnabled of [true, false]) {
      const context = assigneeContext({
        grantedFeatures: ['*'],
        isSuperAdmin: true,
        businessContextEnabled,
      })

      expect(decideTaskAccess(context, foreign).reason).toBe('denied:tenant')
    }
  })

  test('an organization outside the caller scope is denied', () => {
    const context = assigneeContext({ organizationIds: ['other-org'] })

    expect(decideTaskAccess(context, makeTask()).reason).toBe('denied:organization')
  })
})

describe('the 404-vs-403 disclosure policy', () => {
  const entityDenied = makeTask({
    entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }],
    entityTypes: ['sales:sales_order'],
  })

  const entityAccess = {
    'sales:sales_order': { kind: 'requires' as const, features: ['sales.orders.view'] },
  }

  test('an ordinary caller cannot tell an entity refusal from a missing task', () => {
    const context = assigneeContext({ grantedFeatures: ['workflows.tasks.view'], entityAccess })
    const decision = decideTaskAccess(context, entityDenied)

    const refusal = resolveTaskRefusal(context, decision)

    expect(decision.reason).toBe('denied:entity-access')
    expect(refusal).toEqual({ status: 404, body: { error: 'Task not found' } })
  })

  test('a no-relationship refusal is the same 404 as a foreign tenant', () => {
    const context = makeTaskVisibilityContext({
      userId: 'user-2',
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      grantedFeatures: ['workflows.tasks.view'],
    })

    const unrelated = resolveTaskRefusal(context, decideTaskAccess(context, makeTask()))
    const foreign = resolveTaskRefusal(
      context,
      decideTaskAccess(context, makeTask({ tenantId: OTHER_TENANT_ID })),
    )

    expect(unrelated).toEqual(foreign)
  })

  test('a view_all holder gets the diagnosis, because they already see the row', () => {
    const context = assigneeContext({
      userId: 'user-2',
      grantedFeatures: ['workflows.tasks.view', 'workflows.tasks.view_all'],
      entityAccess,
    })

    const refusal = resolveTaskRefusal(context, decideTaskAccess(context, entityDenied))

    expect(refusal.status).toBe(403)
    expect(refusal.body).toEqual({
      error: 'Forbidden',
      reason: 'denied:entity-access',
      entityType: 'sales:sales_order',
    })
  })

  test('a view_all holder still gets a bare 404 for a task outside their tenant', () => {
    const context = assigneeContext({
      grantedFeatures: ['workflows.tasks.view', 'workflows.tasks.view_all'],
    })

    const refusal = resolveTaskRefusal(
      context,
      decideTaskAccess(context, makeTask({ tenantId: OTHER_TENANT_ID })),
    )

    expect(refusal).toEqual({ status: 404, body: { error: 'Task not found' } })
  })
})

describe('task facts', () => {
  test('defaults a projection that predates the assignee-kind column', () => {
    const legacy = makeTask()
    delete (legacy as Partial<UserTask>).assigneeKind

    expect(toTaskFacts(legacy).assigneeKind).toBe('user')
  })

  test('drops malformed bindings rather than passing them to the predicate', () => {
    const task = makeTask({
      entityBindings: [
        { entityType: 'sales:sales_order', entityId: 'order-1' },
        { entityType: 'sales:sales_order' },
        'nonsense',
        null,
      ],
    })

    expect(toTaskFacts(task).entityBindings).toEqual([
      { entityType: 'sales:sales_order', entityId: 'order-1' },
    ])
  })

  test('carries the source-declared administrative queue feature through', () => {
    expect(
      toTaskFacts(makeTask(), { administrativeQueueFeature: 'agent_orchestrator.proposals.view' })
        .administrativeQueueFeature,
    ).toBe('agent_orchestrator.proposals.view')
  })

  test('the facts a task exposes are exactly what the predicate is given', () => {
    const context = assigneeContext()
    const task = makeTask()

    expect(decideTaskAccess(context, task)).toEqual(
      decideTaskVisibility(context.principal, toTaskFacts(task), context.entityAccess, context.policy),
    )
  })
})

describe('collecting the entity types a page references', () => {
  test('dedupes across tasks and ignores malformed bindings', () => {
    expect(
      collectTaskEntityTypesFromTasks([
        makeTask({ entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }] }),
        makeTask({
          entityBindings: [
            { entityType: 'sales:sales_order', entityId: 'order-2' },
            { entityType: 'customers:customer_deal', entityId: 'deal-1' },
            { entityId: 'missing-type' },
          ],
        }),
        makeTask(),
      ]),
    ).toEqual(['sales:sales_order', 'customers:customer_deal'])
  })
})

describe('enumerating the types present in scope', () => {
  function emWith(rows: Array<{ entity_type: string | null }>) {
    const execute = jest.fn(async () => rows)
    return { em: { getConnection: () => ({ execute }) } as unknown as EntityManager, execute }
  }

  test('scopes the enumeration to the tenant and the visible organizations', async () => {
    const { em, execute } = emWith([{ entity_type: 'sales:sales_order' }])

    const types = await collectScopedTaskEntityTypes(em, {
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID, 'org-2'],
    })

    expect(types).toEqual(['sales:sales_order'])
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('tenant_id = ?')
    expect(sql).toContain('organization_id IN (?, ?)')
    expect(params).toEqual([TENANT_ID, ORG_ID, 'org-2'])
  })

  test('omits the organization predicate only for the wildcard scope', async () => {
    const { em, execute } = emWith([])

    await collectScopedTaskEntityTypes(em, { tenantId: TENANT_ID, organizationIds: null })

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('organization_id')
    expect(params).toEqual([TENANT_ID])
  })

  test('an empty organization scope asks the database nothing at all', async () => {
    const { em, execute } = emWith([])

    expect(
      await collectScopedTaskEntityTypes(em, { tenantId: TENANT_ID, organizationIds: [] }),
    ).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })

  test('dedupes and drops null rows, which is what unnest of a NULL array yields', async () => {
    const { em } = emWith([
      { entity_type: 'sales:sales_order' },
      { entity_type: 'sales:sales_order' },
      { entity_type: null },
      { entity_type: '' },
    ])

    expect(
      await collectScopedTaskEntityTypes(em, { tenantId: TENANT_ID, organizationIds: [ORG_ID] }),
    ).toEqual(['sales:sales_order'])
  })
})

describe('filtering an already-queried page', () => {
  test('keeps exactly the rows the predicate admits', () => {
    const context = assigneeContext({
      grantedFeatures: ['workflows.tasks.view'],
      entityAccess: {
        'sales:sales_order': { kind: 'requires', features: ['sales.orders.view'] },
      },
    })

    const mine = makeTask({ id: 'mine' })
    const blocked = makeTask({
      id: 'blocked',
      entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }],
      entityTypes: ['sales:sales_order'],
    })
    const foreign = makeTask({ id: 'foreign', assignedTo: 'user-2' })

    expect(filterVisibleTasks(context, [mine, blocked, foreign]).map((task) => task.id)).toEqual([
      'mine',
    ])
  })
})
