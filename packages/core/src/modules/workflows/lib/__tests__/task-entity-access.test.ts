/**
 * The per-request entity-access resolver: what each bound entity type requires,
 * resolved once for a whole page rather than once per row.
 *
 * The cost assertion is not a micro-optimization — `assertEntityAclForRequest`
 * loads the ACL on every call, so a per-binding resolver would issue ~100 ACL
 * loads for a 50-row inbox page. That is the defect this module exists to
 * prevent, so it is pinned like any other behavior.
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import {
  collectTaskEntityTypes,
  resolveTaskEntityAccess,
} from '../task-entity-access'
import type { TaskEntityAccessAcl } from '../task-entity-access'
import { decideTaskVisibility } from '../task-visibility'
import type { BackofficeTaskPrincipal, TaskFacts } from '../task-visibility'

const REGISTRY = {
  customers: {
    customer_person_profile: 'customers:customer_person_profile',
    customer_deal: 'customers:customer_deal',
  },
  sales: { sales_order: 'sales:sales_order' },
  directory: { tenant: 'directory:tenant' },
}

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const USER = '33333333-3333-3333-3333-333333333333'

const scope = { tenantId: TENANT, organizationId: ORG }

type CustomEntityRow = {
  entityId: string
  tenantId: string | null
  organizationId: string | null
  accessRestricted?: boolean
}

function makeEm(customEntities: CustomEntityRow[] = []) {
  const findOne = jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
    customEntities.find((row) =>
      Object.entries(where).every(
        ([key, value]) => (row as Record<string, unknown>)[key] === value,
      ),
    ) ?? null,
  )
  // `isOrmBackedSystemEntityId` looks a registered table up through the ORM
  // metadata, by PascalCase class-name candidates derived from the entity
  // segment. Everything except the custom-entity fixture has one.
  const getMetadata = () => ({
    find: (candidate: string) =>
      /vendor/i.test(candidate) ? undefined : { tableName: String(candidate) },
    getAll: () => [],
  })
  return { em: { findOne, getMetadata } as unknown as EntityManager, findOne }
}

function makeRbac(acl: TaskEntityAccessAcl | null) {
  const loadAcl = jest.fn(async () => acl)
  return { rbac: { loadAcl } as never, loadAcl }
}

beforeEach(() => registerEntityIds(REGISTRY))
afterEach(() => registerEntityIds(REGISTRY))

describe('collectTaskEntityTypes', () => {
  test('dedupes across a page and keeps the authored spelling verbatim', () => {
    const types = collectTaskEntityTypes([
      { entityBindings: [{ entityType: 'customers:deal' }, { entityType: 'sales:order' }] },
      { entityBindings: [{ entityType: 'customers:deal' }, { entityType: 'Customers.Deal' }] },
      { entityBindings: null },
      {},
    ])

    expect(types.sort()).toEqual(['Customers.Deal', 'customers:deal', 'sales:order'])
  })

  test('skips bindings with no usable entity type', () => {
    expect(
      collectTaskEntityTypes([{ entityBindings: [{ entityType: '' }, { entityType: 42 }, {}] }]),
    ).toEqual([])
  })
})

describe('resolveTaskEntityAccess', () => {
  test('maps a system entity to the view features its ACL requirement declares', async () => {
    const { em } = makeEm()
    const { rbac } = makeRbac({ isSuperAdmin: false, features: ['customers.deals.view'] })

    const { map } = await resolveTaskEntityAccess({
      entityTypes: ['customers:deal', 'sales:order'],
      em,
      rbac,
      userId: USER,
      scope,
    })

    expect(map.get('customers:deal')).toEqual({
      kind: 'requires',
      features: ['customers.deals.view'],
    })
    expect(map.get('sales:order')).toEqual({ kind: 'requires', features: ['sales.orders.view'] })
  })

  test('an authored type that does not resolve is reported as an unknown entity type', async () => {
    const { em } = makeEm()
    const { rbac } = makeRbac({ isSuperAdmin: false, features: [] })

    const { map } = await resolveTaskEntityAccess({
      entityTypes: ['Custmers:Deal'],
      em,
      rbac,
      userId: USER,
      scope,
    })

    expect(map.get('Custmers:Deal')).toEqual({ kind: 'unknown-entity-type' })
  })

  test('a platform-only entity is unavailable rather than merely ungranted', async () => {
    const { em } = makeEm()
    const { rbac } = makeRbac({ isSuperAdmin: false, features: ['*'] })

    const { map } = await resolveTaskEntityAccess({
      entityTypes: ['directory:tenant'],
      em,
      rbac,
      userId: USER,
      scope,
    })

    expect(map.get('directory:tenant')).toEqual({ kind: 'unavailable' })
  })

  test('an unrestricted custom entity needs only the coarse records feature', async () => {
    const { em } = makeEm([{ entityId: 'user:vendors', tenantId: TENANT, organizationId: ORG }])
    const { rbac } = makeRbac({ isSuperAdmin: false, features: ['entities.records.view'] })

    const { map } = await resolveTaskEntityAccess({
      entityTypes: ['user:vendors'],
      em,
      rbac,
      userId: USER,
      scope,
    })

    expect(map.get('user:vendors')).toEqual({
      kind: 'requires',
      features: ['entities.records.view'],
    })
  })

  test('a restricted custom entity also needs its synthesized per-entity grant', async () => {
    const { em } = makeEm([
      { entityId: 'user:vendors', tenantId: TENANT, organizationId: ORG, accessRestricted: true },
    ])
    const { rbac } = makeRbac({ isSuperAdmin: false, features: ['entities.records.view'] })

    const { map } = await resolveTaskEntityAccess({
      entityTypes: ['user:vendors'],
      em,
      rbac,
      userId: USER,
      scope,
    })

    expect(map.get('user:vendors')).toEqual({
      kind: 'requires',
      features: ['entities.records.view', 'entities.records.user:vendors.view'],
    })
  })

  test('a tenant-created custom entity resolves even though the registry has never heard of it', async () => {
    // `custom_entities` rows are runtime data, absent from the generated entity
    // registry, so normalization alone cannot vouch for them. Refusing here
    // would hide every task bound to a tenant's own entity — the classifier's
    // in-scope registration is what separates that from an authored typo.
    const { em } = makeEm([{ entityId: 'user:vendors', tenantId: TENANT, organizationId: null }])
    const { rbac } = makeRbac({ isSuperAdmin: false, features: [] })

    const { map } = await resolveTaskEntityAccess({
      entityTypes: ['User.Vendors', 'user:nothing_registered'],
      em,
      rbac,
      userId: USER,
      scope,
    })

    expect(map.get('User.Vendors')).toEqual({
      kind: 'requires',
      features: ['entities.records.view'],
    })
    expect(map.get('user:nothing_registered')).toEqual({ kind: 'unknown-entity-type' })
  })

  test('a superadmin resolves every type to a satisfied requirement', async () => {
    const { em, findOne } = makeEm()
    const { rbac } = makeRbac({ isSuperAdmin: true, features: ['*'] })

    const { map, isSuperAdmin, grantedFeatures } = await resolveTaskEntityAccess({
      entityTypes: ['directory:tenant', 'Custmers:Deal'],
      em,
      rbac,
      userId: USER,
      scope,
    })

    expect(isSuperAdmin).toBe(true)
    expect(grantedFeatures).toEqual(['*'])
    expect(map.get('directory:tenant')).toEqual({ kind: 'requires', features: [] })
    expect(map.get('Custmers:Deal')).toEqual({ kind: 'requires', features: [] })
    expect(findOne).not.toHaveBeenCalled()
  })

  test('a missing ACL row denies rather than defaulting to open', async () => {
    const { em } = makeEm()
    const { rbac } = makeRbac(null)

    const { map, isSuperAdmin, grantedFeatures } = await resolveTaskEntityAccess({
      entityTypes: ['customers:deal'],
      em,
      rbac,
      userId: USER,
      scope,
    })

    expect(isSuperAdmin).toBe(false)
    expect(grantedFeatures).toEqual([])
    expect(map.get('customers:deal')).toEqual({
      kind: 'requires',
      features: ['customers.deals.view'],
    })
  })

  test('a thrown ACL load propagates — it never degrades to an empty map', async () => {
    const { em } = makeEm()
    const rbac = {
      loadAcl: jest.fn(async () => {
        throw new Error('acl store unavailable')
      }),
    } as never

    await expect(
      resolveTaskEntityAccess({ entityTypes: ['customers:deal'], em, rbac, userId: USER, scope }),
    ).rejects.toThrow('acl store unavailable')
  })

  test('issues ONE ACL load for a whole page, and classifies each type once', async () => {
    const { em, findOne } = makeEm([{ entityId: 'user:vendors', tenantId: TENANT, organizationId: ORG }])
    const { rbac, loadAcl } = makeRbac({ isSuperAdmin: false, features: [] })

    const page = Array.from({ length: 25 }, () => ({
      entityBindings: [{ entityType: 'customers:deal' }, { entityType: 'user:vendors' }],
    }))

    await resolveTaskEntityAccess({
      entityTypes: collectTaskEntityTypes(page),
      em,
      rbac,
      userId: USER,
      scope,
    })

    expect(loadAcl).toHaveBeenCalledTimes(1)
    // Only the custom entity reaches the database at all, and only once — 50
    // bindings, one lookup.
    expect(findOne).toHaveBeenCalledTimes(1)
  })
})

describe('the resolver and the predicate agree', () => {
  const principalFor = (features: string[]): BackofficeTaskPrincipal => ({
    kind: 'backoffice',
    userId: USER,
    tenantId: TENANT,
    organizationIds: null,
    roleNames: [],
    grantedFeatures: features,
    isSuperAdmin: false,
  })

  const taskFor = (entityType: string): TaskFacts => ({
    id: 'task-1',
    tenantId: TENANT,
    organizationId: ORG,
    status: 'PENDING',
    assignedTo: USER,
    assigneeKind: 'user',
    assignedToRoles: null,
    claimedBy: null,
    entityBindings: [{ entityType, entityId: 'record-1' }],
  })

  test('a wildcard grant satisfies the requirement the resolver produced', async () => {
    const { em } = makeEm()
    const { rbac } = makeRbac({ isSuperAdmin: false, features: ['customers.*'] })

    const { map, grantedFeatures } = await resolveTaskEntityAccess({
      entityTypes: ['customers:deal'],
      em,
      rbac,
      userId: USER,
      scope,
    })
    const decision = decideTaskVisibility(
      principalFor(grantedFeatures),
      taskFor('customers:deal'),
      map,
      { businessContextEnabled: true },
    )

    expect(decision).toMatchObject({ visible: true, actable: true, reason: 'assignee' })
  })

  test('the same task is hidden from a principal without the entity grant', async () => {
    const { em } = makeEm()
    const { rbac } = makeRbac({ isSuperAdmin: false, features: ['workflows.tasks.view'] })

    const { map, grantedFeatures } = await resolveTaskEntityAccess({
      entityTypes: ['customers:deal'],
      em,
      rbac,
      userId: USER,
      scope,
    })
    const decision = decideTaskVisibility(
      principalFor(grantedFeatures),
      taskFor('customers:deal'),
      map,
      { businessContextEnabled: true },
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:entity-access')
  })

  test('an authored typo hides the task as an unknown entity type', async () => {
    const { em } = makeEm()
    const { rbac } = makeRbac({ isSuperAdmin: false, features: ['*'] })

    const { map } = await resolveTaskEntityAccess({
      entityTypes: ['Custmers:Deal'],
      em,
      rbac,
      userId: USER,
      scope,
    })
    const decision = decideTaskVisibility(
      principalFor(['*']),
      taskFor('Custmers:Deal'),
      map,
      { businessContextEnabled: true },
    )

    expect(decision.reason).toBe('denied:unknown-entity-type')
  })
})
