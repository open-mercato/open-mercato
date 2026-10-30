/**
 * Inbox diagnostics: entity-gated rows surfaced to administrators (design §3.6).
 *
 * "A task hidden by the entity gate must never disappear without trace." Before
 * this, the gate removed the row in SQL for everyone, so an administrator saw a
 * page that was short by an unexplained number of rows and could not tell "no
 * such task" from "you cannot see its record" — which is the difference between
 * a support ticket that resolves in a minute and one that never does.
 *
 * The trade is deliberate and narrow:
 *
 * - the gate is lifted from the `WHERE` ONLY for a principal §2.7 already
 *   entitles to a diagnosis (a `workflows.tasks.view_all` holder or a
 *   superadmin);
 * - the predicate still refuses every one of those rows, so none of them reaches
 *   `data`;
 * - what is reported is an id, a reason and the blocking entity type. Nothing
 *   that says what the task is ABOUT exists on the marker at all, so there is no
 *   redaction for a later change to undo.
 *
 * For everybody else the SQL gate is unchanged, `entityHidden` is empty, and its
 * emptiness discloses nothing.
 */

import { describe, test, expect } from '@jest/globals'
import { UserTask } from '../../data/entities'
import {
  buildTaskEntityGateConditions,
  partitionTaskPage,
  type TaskEntityHiddenMarker,
} from '../task-visibility-request'
import { makeTaskVisibilityContext } from './helpers/taskVisibilityContext'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const USER_ID = 'user-1'
const DEAL = 'customers:deal'

function makeTask(overrides: Partial<UserTask> = {}): UserTask {
  const task = new UserTask()
  task.id = 'task-1'
  task.workflowInstanceId = 'instance-1'
  task.stepInstanceId = 'step-1'
  task.taskName = 'Approve the Northwind deal'
  task.description = 'Commercially sensitive'
  task.status = 'PENDING'
  task.assignedTo = USER_ID
  task.assigneeKind = 'user'
  task.assignedToRoles = null
  task.claimedBy = null
  task.entityBindings = [{ entityType: DEAL, entityId: 'deal-1' }]
  task.entityTypes = [DEAL]
  task.tenantId = TENANT_ID
  task.organizationId = ORG_ID
  task.createdAt = new Date('2026-07-28T09:00:00.000Z')
  task.updatedAt = new Date('2026-07-28T09:00:00.000Z')
  Object.assign(task, overrides)
  return task
}

/** Bound to a deal the caller may not view. */
function blockedContext(grantedFeatures: string[], isSuperAdmin = false) {
  return makeTaskVisibilityContext({
    userId: USER_ID,
    tenantId: TENANT_ID,
    organizationIds: [ORG_ID],
    grantedFeatures,
    isSuperAdmin,
    entityAccess: { [DEAL]: { kind: 'requires', features: ['customers.deals.view'] } },
  })
}

describe('the SQL gate', () => {
  test('is lifted for an administrator, so the row arrives and can be explained', () => {
    const context = blockedContext(['workflows.tasks.view', 'workflows.tasks.view_all'])
    expect(buildTaskEntityGateConditions(context)).toEqual([])
  })

  test('and for a superadmin, who never had the gate applied anyway', () => {
    expect(buildTaskEntityGateConditions(blockedContext([], true))).toEqual([])
  })

  test('still removes the rows in SQL for everybody else', () => {
    const context = blockedContext(['workflows.tasks.view'])
    const conditions = buildTaskEntityGateConditions(context)

    expect(conditions).toHaveLength(1)
    // The `entity_types IS NULL` disjunct is load-bearing: without it every row
    // written before the column existed would vanish from its own assignee's
    // inbox.
    const or = (conditions[0] as { $or: Record<string, unknown>[] }).$or
    expect(or[0]).toEqual({ entityTypes: null })
    expect(or[1]).toEqual({ entityTypes: { $contained: [] } })
  })

  test('is still lifted under the tenant opt-out, which skips the entity gate by design', () => {
    const context = makeTaskVisibilityContext({
      grantedFeatures: ['workflows.tasks.view'],
      businessContextEnabled: false,
      entityAccess: { [DEAL]: { kind: 'requires', features: ['customers.deals.view'] } },
    })
    expect(buildTaskEntityGateConditions(context)).toEqual([])
  })
})

describe('partitioning a page', () => {
  test('an administrator gets a marker, not the row', () => {
    const context = blockedContext(['workflows.tasks.view', 'workflows.tasks.view_all'])
    const { visible, entityHidden } = partitionTaskPage(context, [makeTask()])

    expect(visible).toEqual([])
    expect(entityHidden).toEqual<TaskEntityHiddenMarker[]>([
      { id: 'task-1', reason: 'denied:entity-access', entityType: DEAL },
    ])
  })

  test('the marker discloses nothing about the task itself', () => {
    const context = blockedContext(['workflows.tasks.view_all'])
    const { entityHidden } = partitionTaskPage(
      context,
      [makeTask({ taskName: 'Approve the Northwind deal', description: 'Commercially sensitive' })],
    )

    // Absence by construction, not by redaction: the marker type has three
    // fields, so there is no field for a later change to un-redact.
    expect(Object.keys(entityHidden[0]).sort()).toEqual(['entityType', 'id', 'reason'])
    expect(JSON.stringify(entityHidden)).not.toContain('Northwind')
    expect(JSON.stringify(entityHidden)).not.toContain('sensitive')
  })

  test('an unresolvable authored type is reported as such, so a typo is diagnosable', () => {
    const context = makeTaskVisibilityContext({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      grantedFeatures: ['workflows.tasks.view_all'],
      entityAccess: { 'custmers:deal': { kind: 'unknown-entity-type' } },
    })
    const task = makeTask({
      entityBindings: [{ entityType: 'custmers:deal', entityId: 'deal-1' }],
      entityTypes: ['custmers:deal'],
    })

    expect(partitionTaskPage(context, [task]).entityHidden).toEqual<TaskEntityHiddenMarker[]>([
      { id: 'task-1', reason: 'denied:unknown-entity-type', entityType: 'custmers:deal' },
    ])
  })

  test('nobody else is told anything', () => {
    // Not an administrator: they have no legitimate knowledge that the row
    // exists, and a marker would be exactly the disclosure the 404 policy
    // exists to prevent.
    const context = blockedContext(['workflows.tasks.view'])
    const { visible, entityHidden } = partitionTaskPage(context, [makeTask()])

    expect(visible).toEqual([])
    expect(entityHidden).toEqual([])
  })

  test('a refusal that is not about entity access is never marked', () => {
    // A row an administrator cannot see for a scope reason must stay
    // indistinguishable from a nonexistent one.
    const context = blockedContext(['workflows.tasks.view_all'])
    const foreign = makeTask({ tenantId: 'other-tenant', entityBindings: [], entityTypes: null })

    expect(partitionTaskPage(context, [foreign]).entityHidden).toEqual([])
  })

  test('readable rows still come back in full, alongside the markers', () => {
    const context = blockedContext(['workflows.tasks.view_all'])
    const readable = makeTask({ id: 'task-2', entityBindings: [], entityTypes: null })

    const { visible, entityHidden } = partitionTaskPage(context, [makeTask(), readable])

    expect(visible.map((task) => task.id)).toEqual(['task-2'])
    expect(entityHidden.map((marker) => marker.id)).toEqual(['task-1'])
  })

  test('a superadmin sees the rows themselves and is told about nothing', () => {
    // The predicate short-circuits the entity clause for a superadmin, matching
    // `assertEntityAclForRequest`, so there is nothing hidden to report.
    const context = blockedContext([], true)
    const { visible, entityHidden } = partitionTaskPage(context, [makeTask()])

    expect(visible.map((task) => task.id)).toEqual(['task-1'])
    expect(entityHidden).toEqual([])
  })
})
