/**
 * Portal task access — the three properties this surface exists to get right.
 *
 * 1. **An unbound task denies.** The backoffice branch passes an empty binding
 *    set vacuously; the portal branch must not, because the binding to their own
 *    record IS a portal principal's entire authorization.
 * 2. **`isPortalAdmin` buys nothing.** A portal admin's granted features are the
 *    literal `['*']` and `userHasAllFeatures` short-circuits for them, so no
 *    feature may take part in the ownership decision. The principal carries no
 *    feature array at all — this file proves the wildcard cannot be smuggled in
 *    through one.
 * 3. **Cross-principal isolation, both ways.** A portal principal gets nothing
 *    from a backoffice row and a backoffice principal gets nothing from a
 *    customer row, structurally, in SQL and in the predicate.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import {
  buildPortalTaskConditions,
  decidePortalTaskAccess,
  filterVisiblePortalTasks,
  PORTAL_NO_COMPANY_BODY,
  PORTAL_TASKS_COMPLETE_FEATURE,
  PORTAL_TASKS_VIEW_FEATURE,
  resolvePortalTaskPrincipal,
} from '../portal-task-access'
import { buildTaskVisibilityConditions } from '../task-visibility'
import { UserTask } from '../../data/entities'
import type { CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'

const findWithDecryption = jest.fn<(...args: unknown[]) => Promise<unknown[]>>()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const CUSTOMER_ENTITY_ID = 'customer-record-1'
const PERSON_ENTITY_ID = 'person-record-1'
const PORTAL_SUB = 'portal-user-1'

function makeAuth(overrides: Partial<CustomerAuthContext> = {}): CustomerAuthContext {
  return {
    sub: PORTAL_SUB,
    sid: 'session-1',
    type: 'customer',
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    email: 'buyer@example.com',
    displayName: 'Buyer',
    customerEntityId: CUSTOMER_ENTITY_ID,
    personEntityId: PERSON_ENTITY_ID,
    resolvedFeatures: [PORTAL_TASKS_VIEW_FEATURE, PORTAL_TASKS_COMPLETE_FEATURE],
    ...overrides,
  }
}

function makeTask(overrides: Partial<UserTask> = {}): UserTask {
  const task = new UserTask()
  task.id = 'task-1'
  task.workflowInstanceId = 'instance-1'
  task.stepInstanceId = 'step-instance-1'
  task.taskName = 'Confirm delivery address'
  task.status = 'PENDING'
  task.assignedTo = PORTAL_SUB
  task.assigneeKind = 'customer'
  task.assignedToRoles = null
  task.claimedBy = null
  task.entityBindings = [{ entityType: 'customers:person', entityId: PERSON_ENTITY_ID }]
  task.entityTypes = ['customers:person']
  task.tenantId = TENANT_ID
  task.organizationId = ORG_ID
  task.createdAt = new Date('2026-07-28T09:00:00.000Z')
  task.updatedAt = new Date('2026-07-28T09:00:00.000Z')
  Object.assign(task, overrides)
  return task
}

const em = {} as Parameters<typeof resolvePortalTaskPrincipal>[0]['em']

async function principalFor(auth: CustomerAuthContext, isPortalAdmin = false) {
  const resolved = await resolvePortalTaskPrincipal({ auth, em, isPortalAdmin })
  if (!resolved.ok) throw new Error(`[internal] expected a principal, got ${resolved.status}`)
  return resolved
}

beforeEach(() => {
  findWithDecryption.mockReset()
  findWithDecryption.mockResolvedValue([])
})

describe('a portal principal and their own task', () => {
  test('sees it and may complete it', async () => {
    const { principal } = await principalFor(makeAuth())

    expect(decidePortalTaskAccess(principal, makeTask())).toMatchObject({
      visible: true,
      actable: true,
      reason: 'portal-assignee',
    })
  })

  test('a binding on the customer record rather than the person record also owns', async () => {
    const { principal } = await principalFor(makeAuth())
    const task = makeTask({
      entityBindings: [{ entityType: 'customers:customer', entityId: CUSTOMER_ENTITY_ID }],
    })

    expect(decidePortalTaskAccess(principal, task).visible).toBe(true)
  })

  test('a completed task is visible but no longer actable', async () => {
    const { principal } = await principalFor(makeAuth())

    expect(decidePortalTaskAccess(principal, makeTask({ status: 'COMPLETED' }))).toMatchObject({
      visible: true,
      actable: false,
    })
  })
})

describe('an unbound task', () => {
  test('DENIES for the portal principal it is assigned to', async () => {
    const { principal } = await principalFor(makeAuth())
    const task = makeTask({ entityBindings: null, entityTypes: null })

    expect(decidePortalTaskAccess(principal, task)).toMatchObject({
      visible: false,
      actable: false,
      reason: 'denied:portal-unbound',
    })
  })

  test('DENIES for a portal admin too — the wildcard does not reach it', async () => {
    findWithDecryption.mockResolvedValue([
      { id: PORTAL_SUB, personEntityId: PERSON_ENTITY_ID, customerEntityId: CUSTOMER_ENTITY_ID },
    ])
    const { principal } = await principalFor(makeAuth(), true)
    const task = makeTask({ entityBindings: [], entityTypes: null })

    expect(decidePortalTaskAccess(principal, task).visible).toBe(false)
  })

  test('is excluded in SQL as well, so `total` does not count what the predicate drops', async () => {
    const { principal, assigneeIds } = await principalFor(makeAuth())

    expect(buildPortalTaskConditions({ principal, assigneeIds })).toMatchObject({
      entityTypes: { $ne: null },
    })
  })
})

describe('another customer', () => {
  test('a task bound to a record the principal does not own denies', async () => {
    const { principal } = await principalFor(makeAuth())
    const task = makeTask({
      assignedTo: 'portal-user-2',
      entityBindings: [{ entityType: 'customers:person', entityId: 'person-record-999' }],
    })

    expect(decidePortalTaskAccess(principal, task)).toMatchObject({
      visible: false,
      reason: 'denied:portal-not-owner',
    })
  })

  test('every binding must be owned — one foreign binding is enough to refuse', async () => {
    const { principal } = await principalFor(makeAuth())
    const task = makeTask({
      entityBindings: [
        { entityType: 'customers:person', entityId: PERSON_ENTITY_ID },
        { entityType: 'sales:sales_order', entityId: 'order-of-another-company' },
      ],
    })

    expect(decidePortalTaskAccess(principal, task).visible).toBe(false)
  })

  test('a task in another tenant denies before anything else is considered', async () => {
    const { principal } = await principalFor(makeAuth())

    expect(decidePortalTaskAccess(principal, makeTask({ tenantId: 'tenant-2' }))).toMatchObject({
      reason: 'denied:tenant',
    })
  })

  test('a task in another organization denies', async () => {
    const { principal } = await principalFor(makeAuth())

    expect(decidePortalTaskAccess(principal, makeTask({ organizationId: 'org-2' }))).toMatchObject({
      reason: 'denied:organization',
    })
  })
})

describe('a portal admin gains nothing', () => {
  const MEMBER_SUB = 'portal-user-2'
  const MEMBER_PERSON_ID = 'person-record-2'

  function withCompanyMembers() {
    findWithDecryption.mockResolvedValue([
      { id: PORTAL_SUB, personEntityId: PERSON_ENTITY_ID, customerEntityId: CUSTOMER_ENTITY_ID },
      { id: MEMBER_SUB, personEntityId: MEMBER_PERSON_ID, customerEntityId: CUSTOMER_ENTITY_ID },
    ])
  }

  test('a company member\'s task is READABLE but never actable', async () => {
    withCompanyMembers()
    const { principal } = await principalFor(makeAuth(), true)
    const task = makeTask({
      assignedTo: MEMBER_SUB,
      entityBindings: [{ entityType: 'customers:person', entityId: MEMBER_PERSON_ID }],
    })

    expect(decidePortalTaskAccess(principal, task)).toMatchObject({
      visible: true,
      actable: false,
      reason: 'portal-company-admin',
    })
  })

  test('a task outside the company stays invisible however wide the grants are', async () => {
    withCompanyMembers()
    // The literal shape `customerAuth.ts` hands a portal admin. It must not
    // change a single answer below.
    const { principal } = await principalFor(makeAuth({ resolvedFeatures: ['*'] }), true)
    const task = makeTask({
      assignedTo: 'portal-user-from-another-company',
      entityBindings: [{ entityType: 'customers:person', entityId: 'person-record-999' }],
    })

    expect(decidePortalTaskAccess(principal, task).visible).toBe(false)
  })

  test('the principal carries no feature array for a wildcard to live in', async () => {
    withCompanyMembers()
    const { principal } = await principalFor(makeAuth({ resolvedFeatures: ['*'] }), true)

    // Structural, not incidental: if a `grantedFeatures` field ever appears on
    // the portal principal, the `['*']` trap is one `hasFeature` call away.
    expect(principal).not.toHaveProperty('grantedFeatures')
    expect(Object.keys(principal).sort((a, b) => a.localeCompare(b))).toEqual([
      'isPortalAdmin',
      'kind',
      'organizationId',
      'ownedRecordIds',
      'principalId',
      'tenantId',
    ])
  })

  test('with no company association they are refused outright', async () => {
    const resolved = await resolvePortalTaskPrincipal({
      auth: makeAuth({ customerEntityId: null, resolvedFeatures: ['*'] }),
      em,
      isPortalAdmin: true,
    })

    expect(resolved).toEqual({ ok: false, status: 403, body: PORTAL_NO_COMPANY_BODY })
    // No company query even runs — there is no company to scope to.
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  test('the company query uses the same filter `portal/users.ts` uses', async () => {
    withCompanyMembers()
    await principalFor(makeAuth(), true)

    expect(findWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { customerEntityId: CUSTOMER_ENTITY_ID, tenantId: TENANT_ID, deletedAt: null },
      expect.anything(),
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  test('a plain portal user never queries the company at all', async () => {
    await principalFor(makeAuth(), false)

    expect(findWithDecryption).not.toHaveBeenCalled()
  })
})

describe('cross-principal isolation, in both directions', () => {
  test('a portal principal is refused a BACKOFFICE row on structure alone', async () => {
    const { principal } = await principalFor(makeAuth())
    // Same assignee id, same bindings — only the discriminator differs.
    const task = makeTask({ assigneeKind: 'user' })

    expect(decidePortalTaskAccess(principal, task)).toMatchObject({
      visible: false,
      reason: 'denied:portal-wrong-assignee-kind',
    })
  })

  test('the portal SQL pins `assignee_kind` to customer, so backoffice rows never load', async () => {
    const { principal, assigneeIds } = await principalFor(makeAuth())

    expect(buildPortalTaskConditions({ principal, assigneeIds })).toEqual({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      assigneeKind: 'customer',
      assignedTo: { $in: [PORTAL_SUB] },
      entityTypes: { $ne: null },
    })
  })

  test('the backoffice SQL pins its assignee arm to `user`, so customer rows never load', () => {
    const conditions = buildTaskVisibilityConditions(
      {
        kind: 'backoffice',
        userId: PORTAL_SUB,
        tenantId: TENANT_ID,
        organizationIds: [ORG_ID],
        roleNames: [],
        grantedFeatures: ['workflows.tasks.view'],
        isSuperAdmin: false,
      },
      { businessContextEnabled: true },
    )

    // A backoffice user id that happens to equal a portal principal id must not
    // collide: the arm carries the discriminator alongside the id.
    expect(JSON.stringify(conditions)).toContain('"assigneeKind":"user"')
  })

  test('the portal admin arm widens to company members and nobody else', async () => {
    findWithDecryption.mockResolvedValue([
      { id: PORTAL_SUB, personEntityId: PERSON_ENTITY_ID, customerEntityId: CUSTOMER_ENTITY_ID },
      { id: 'portal-user-2', personEntityId: 'person-record-2', customerEntityId: CUSTOMER_ENTITY_ID },
    ])
    const { principal, assigneeIds } = await principalFor(makeAuth(), true)
    const where = buildPortalTaskConditions({ principal, assigneeIds })

    expect(where.assignedTo).toEqual({ $in: [PORTAL_SUB, 'portal-user-2'] })
  })
})

describe('the page filter', () => {
  test('drops a row SQL admitted but ownership refuses', async () => {
    const { principal } = await principalFor(makeAuth())
    const mine = makeTask()
    const foreign = makeTask({
      id: 'task-2',
      entityBindings: [{ entityType: 'customers:person', entityId: 'person-record-999' }],
    })

    expect(filterVisiblePortalTasks(principal, [mine, foreign]).map((task) => task.id)).toEqual([
      'task-1',
    ])
  })
})
