/**
 * The registration seam for entity types a task may be bound to (#7180).
 *
 * An app-owned ORM entity has no row in the core `ENTITY_ACL_REQUIREMENTS`
 * table, so the §6.4 entity gate resolves it to `unavailable` and a task bound
 * to one is visible to superadmins only. A module registers the `view` features
 * for its own entity; these tests pin that the registration opens the gate to
 * exactly the holders of those features, inside the caller's tenant and
 * organization, and that nothing else moves:
 *
 * - an unregistered entity still resolves to `unavailable` (regression),
 * - a registration can never override a core entry,
 * - a malformed registration is refused rather than degraded.
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { UserTask } from '../../data/entities'
import { resolveTaskEntityAccess } from '../task-entity-access'
import type { TaskEntityAccessAcl } from '../task-entity-access'
import {
  clearTaskEntityRegistrationsForTests,
  registerTaskEntityAclRequirements,
  registerTaskEntityLinkBuilders,
  resolveRegisteredTaskEntityLinkBuilder,
  resolveRegisteredTaskEntityViewFeatures,
} from '../task-entity-registry'
import type { TaskEntityAclRegistration } from '../task-entity-registry'
import {
  buildTaskEntityGateConditions,
  decideTaskAccess,
  resolveAllowedTaskEntityTypes,
  resolveTaskVisibilityRequestContext,
} from '../task-visibility-request'

const REGISTRY = {
  customers: { customer_deal: 'customers:customer_deal' },
  directory: { tenant: 'directory:tenant' },
  notary: {
    notary_case: 'notary:notary_case',
    notary_deed: 'notary:notary_deed',
  },
}

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '99999999-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '88888888-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'

const scope = { tenantId: TENANT, organizationId: ORG }

function makeEm() {
  const findOne = jest.fn(async () => null)
  const getMetadata = () => ({
    find: (candidate: string) => ({ tableName: String(candidate) }),
    getAll: () => [],
  })
  return { findOne, getMetadata } as unknown as EntityManager
}

function makeRbac(acl: TaskEntityAccessAcl | null) {
  return { loadAcl: jest.fn(async () => acl) }
}

function makeTask(overrides: Partial<UserTask> = {}): UserTask {
  const task = new UserTask()
  task.id = '44444444-4444-4444-8444-444444444444'
  task.workflowInstanceId = '55555555-5555-4555-8555-555555555555'
  task.stepInstanceId = '66666666-6666-4666-8666-666666666666'
  task.taskName = 'Review the deed'
  task.status = 'PENDING'
  task.assignedTo = USER
  task.assigneeKind = 'user'
  task.assignedToRoles = null
  task.claimedBy = null
  task.entityBindings = [{ entityType: 'notary:notary_case', entityId: 'case-1' }]
  task.entityTypes = ['notary:notary_case']
  task.tenantId = TENANT
  task.organizationId = ORG
  task.createdAt = new Date('2026-10-11T09:00:00.000Z')
  task.updatedAt = new Date('2026-10-11T09:00:00.000Z')
  Object.assign(task, overrides)
  return task
}

async function contextFor(features: string[], organizationIds: string[] | null = [ORG]) {
  return resolveTaskVisibilityRequestContext({
    em: makeEm(),
    rbac: makeRbac({ isSuperAdmin: false, features }),
    moduleConfigService: null,
    auth: { userId: USER, tenantId: TENANT, roleNames: [] },
    organizationIds,
    aclOrganizationId: ORG,
    entityTypes: ['notary:notary_case'],
  })
}

beforeEach(() => {
  registerEntityIds(REGISTRY)
  clearTaskEntityRegistrationsForTests()
})

afterEach(() => clearTaskEntityRegistrationsForTests())

describe('registerTaskEntityAclRequirements', () => {
  test('stores the view features under the normalized entity id', () => {
    registerTaskEntityAclRequirements([
      { entityId: ' Notary.Notary_Case ', view: ['notary.cases.view', ' notary.cases.view ', 'notary.deeds.view'] },
    ])

    expect(resolveRegisteredTaskEntityViewFeatures('notary:notary_case')).toEqual([
      'notary.cases.view',
      'notary.deeds.view',
    ])
    expect(resolveRegisteredTaskEntityViewFeatures('notary.notary_case')).toEqual([
      'notary.cases.view',
      'notary.deeds.view',
    ])
  })

  test('refuses a registration with no view feature — an empty list would open the type to everyone', () => {
    expect(() =>
      registerTaskEntityAclRequirements([
        { entityId: 'notary:notary_case', view: [] as unknown as TaskEntityAclRegistration['view'] },
      ]),
    ).toThrow('[internal]')
    expect(() =>
      registerTaskEntityAclRequirements([{ entityId: 'notary:notary_case', view: ['  '] }]),
    ).toThrow('[internal]')
    expect(resolveRegisteredTaskEntityViewFeatures('notary:notary_case')).toBeNull()
  })

  test('refuses an entity id that is not a module:entity id', () => {
    for (const entityId of ['', 'notary', 'notary:case:extra', 'notary:*', '*']) {
      expect(() => registerTaskEntityAclRequirements([{ entityId, view: ['notary.cases.view'] }])).toThrow(
        '[internal]',
      )
    }
  })

  test('re-registering replaces the previous entry, so a module re-evaluation is idempotent', () => {
    registerTaskEntityAclRequirements([{ entityId: 'notary:notary_case', view: ['notary.cases.view'] }])
    registerTaskEntityAclRequirements([{ entityId: 'notary:notary_case', view: ['notary.cases.read'] }])

    expect(resolveRegisteredTaskEntityViewFeatures('notary:notary_case')).toEqual(['notary.cases.read'])
  })
})

describe('registerTaskEntityLinkBuilders', () => {
  test('stores a builder under the normalized entity id', () => {
    const buildHref = (recordId: string) => `/backend/notary/cases/${recordId}`
    registerTaskEntityLinkBuilders([{ entityId: 'Notary.Notary_Case', buildHref }])

    expect(resolveRegisteredTaskEntityLinkBuilder('notary:notary_case')).toBe(buildHref)
    expect(resolveRegisteredTaskEntityLinkBuilder('notary:notary_deed')).toBeNull()
  })

  test('refuses a registration without a builder function', () => {
    expect(() =>
      registerTaskEntityLinkBuilders([
        { entityId: 'notary:notary_case', buildHref: '/backend/notary' as unknown as () => string },
      ]),
    ).toThrow('[internal]')
  })
})

describe('the entity gate with registrations', () => {
  test('an unregistered app entity still resolves to unavailable', async () => {
    registerTaskEntityAclRequirements([{ entityId: 'notary:notary_deed', view: ['notary.deeds.view'] }])

    const { map } = await resolveTaskEntityAccess({
      entityTypes: ['notary:notary_case'],
      em: makeEm(),
      rbac: makeRbac({ isSuperAdmin: false, features: ['*'] }) as never,
      userId: USER,
      scope,
    })

    expect(map.get('notary:notary_case')).toEqual({ kind: 'unavailable' })
  })

  test('a registered app entity requires exactly its registered view features', async () => {
    registerTaskEntityAclRequirements([
      { entityId: 'notary:notary_case', view: ['notary.cases.view', 'notary.office.view'] },
    ])

    const { map } = await resolveTaskEntityAccess({
      entityTypes: ['notary:notary_case', 'Notary.Notary_Case'],
      em: makeEm(),
      rbac: makeRbac({ isSuperAdmin: false, features: [] }) as never,
      userId: USER,
      scope,
    })

    const expected = { kind: 'requires', features: ['notary.cases.view', 'notary.office.view'] }
    expect(map.get('notary:notary_case')).toEqual(expected)
    expect(map.get('Notary.Notary_Case')).toEqual(expected)
  })

  test('a registration never overrides a core requirement, platform-only included', async () => {
    registerTaskEntityAclRequirements([
      { entityId: 'customers:customer_deal', view: ['notary.cases.view'] },
      { entityId: 'directory:tenant', view: ['notary.cases.view'] },
    ])

    const { map } = await resolveTaskEntityAccess({
      entityTypes: ['customers:deal', 'directory:tenant'],
      em: makeEm(),
      rbac: makeRbac({ isSuperAdmin: false, features: ['notary.cases.view'] }) as never,
      userId: USER,
      scope,
    })

    expect(map.get('customers:deal')).toEqual({ kind: 'requires', features: ['customers.deals.view'] })
    expect(map.get('directory:tenant')).toEqual({ kind: 'unavailable' })
  })

  test('a registration cannot vouch for a type the entity registry does not know', async () => {
    registerTaskEntityAclRequirements([{ entityId: 'notary:ghost', view: ['notary.cases.view'] }])

    const { map } = await resolveTaskEntityAccess({
      entityTypes: ['notary:ghost'],
      em: makeEm(),
      rbac: makeRbac({ isSuperAdmin: false, features: ['notary.cases.view'] }) as never,
      userId: USER,
      scope,
    })

    expect(map.get('notary:ghost')).toEqual({ kind: 'unknown-entity-type' })
  })
})

describe('task visibility for a registered app entity', () => {
  beforeEach(() => {
    registerTaskEntityAclRequirements([{ entityId: 'notary:notary_case', view: ['notary.cases.view'] }])
  })

  test('is visible to a non-superadmin holding the registered view feature', async () => {
    const context = await contextFor(['workflows.tasks.view', 'notary.cases.view'])

    expect(decideTaskAccess(context, makeTask())).toMatchObject({ visible: true, reason: 'assignee' })
    expect(resolveAllowedTaskEntityTypes(context)).toEqual(['notary:notary_case'])
    expect(buildTaskEntityGateConditions(context)).toEqual([
      { $or: [{ entityTypes: null }, { entityTypes: { $contained: ['notary:notary_case'] } }] },
    ])
  })

  test('honours a wildcard grant over the registered feature', async () => {
    const context = await contextFor(['notary.*'])

    expect(decideTaskAccess(context, makeTask()).visible).toBe(true)
  })

  test('is hidden from a non-superadmin without the registered view feature', async () => {
    const context = await contextFor(['workflows.tasks.view', 'notary.deeds.view'])

    expect(decideTaskAccess(context, makeTask())).toMatchObject({
      visible: false,
      reason: 'denied:entity-access',
    })
    expect(resolveAllowedTaskEntityTypes(context)).toEqual([])
  })

  test('is hidden again once nothing is registered — the gate falls back to unavailable', async () => {
    clearTaskEntityRegistrationsForTests()
    const context = await contextFor(['workflows.tasks.view', 'notary.cases.view'])

    expect(decideTaskAccess(context, makeTask()).visible).toBe(false)
    expect(resolveAllowedTaskEntityTypes(context)).toEqual([])
  })

  test('a task in a foreign tenant stays denied even with the registered feature', async () => {
    const context = await contextFor(['notary.cases.view'])

    expect(decideTaskAccess(context, makeTask({ tenantId: OTHER_TENANT })).reason).toBe('denied:tenant')
  })

  test('a task in an organization outside the caller scope stays denied', async () => {
    const context = await contextFor(['notary.cases.view'])

    expect(decideTaskAccess(context, makeTask({ organizationId: OTHER_ORG })).reason).toBe(
      'denied:organization',
    )
  })
})
