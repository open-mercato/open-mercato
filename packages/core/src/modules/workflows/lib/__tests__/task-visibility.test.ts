/**
 * The §6.4 visibility predicate — the design's full 27-case acceptance matrix
 * (U1–U27), plus the filter builder.
 *
 * Case ids are quoted in the test names on purpose: this file is the acceptance
 * bar the security review ticks against, so a reviewer must be able to find a
 * row of the matrix by searching for its id.
 */

import { describe, test, expect } from '@jest/globals'
import {
  buildTaskVisibilityConditions,
  buildTaskVisibilityFilter,
  decideTaskVisibility,
} from '../task-visibility'
import type {
  BackofficeTaskPrincipal,
  PortalTaskPrincipal,
  TaskEntityAccessMap,
  TaskFacts,
  TaskVisibilityPolicy,
} from '../task-visibility'

const TENANT = '11111111-1111-1111-1111-111111111111'
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222'
const ORG_A = '33333333-3333-3333-3333-333333333333'
const ORG_B = '44444444-4444-4444-4444-444444444444'
const ME = '55555555-5555-5555-5555-555555555555'
const SOMEONE_ELSE = '66666666-6666-6666-6666-666666666666'

const DEAL = 'customers:customer_deal'
const ORDER = 'sales:sales_order'

const ON: TaskVisibilityPolicy = { businessContextEnabled: true }
const OFF: TaskVisibilityPolicy = { businessContextEnabled: false }

const NO_ENTITY_ACCESS: TaskEntityAccessMap = new Map()

function backoffice(overrides: Partial<BackofficeTaskPrincipal> = {}): BackofficeTaskPrincipal {
  return {
    kind: 'backoffice',
    userId: ME,
    tenantId: TENANT,
    organizationIds: null,
    roleNames: [],
    grantedFeatures: [],
    isSuperAdmin: false,
    ...overrides,
  }
}

function portal(overrides: Partial<PortalTaskPrincipal> = {}): PortalTaskPrincipal {
  return {
    kind: 'portal',
    principalId: ME,
    tenantId: TENANT,
    organizationId: ORG_A,
    ownedRecordIds: new Set<string>(['own-record']),
    isPortalAdmin: false,
    ...overrides,
  }
}

function task(overrides: Partial<TaskFacts> = {}): TaskFacts {
  return {
    id: '77777777-7777-7777-7777-777777777777',
    tenantId: TENANT,
    organizationId: ORG_A,
    status: 'PENDING',
    assignedTo: null,
    assigneeKind: 'user',
    assignedToRoles: null,
    claimedBy: null,
    entityBindings: [],
    ...overrides,
  }
}

function accessMap(entries: Record<string, string[]>): TaskEntityAccessMap {
  return new Map(
    Object.entries(entries).map(([entityType, features]) => [
      entityType,
      { kind: 'requires' as const, features },
    ]),
  )
}

describe('U1–U3: relationship admits and the claim outranks the queue', () => {
  test('U1: the assignee sees and can act on their own binding-free task', () => {
    const decision = decideTaskVisibility(
      backoffice(),
      task({ assignedTo: ME }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision).toEqual({
      visible: true,
      actable: true,
      claimable: false,
      reason: 'assignee',
    })
  })

  test('U2: a role holder can see, act on and CLAIM an unclaimed pending queue item', () => {
    const decision = decideTaskVisibility(
      backoffice({ roleNames: ['approver'] }),
      task({ assignedToRoles: ['approver'] }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision).toEqual({
      visible: true,
      actable: true,
      claimable: true,
      reason: 'role-queue',
    })
  })

  test('U3: a role holder still SEES an item a colleague claimed, but cannot act on it', () => {
    const decision = decideTaskVisibility(
      backoffice({ roleNames: ['approver'] }),
      task({ assignedToRoles: ['approver'], claimedBy: SOMEONE_ELSE, status: 'IN_PROGRESS' }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(true)
    expect(decision.actable).toBe(false)
    expect(decision.claimable).toBe(false)
    expect(decision.reason).toBe('role-queue')
  })
})

describe('U4–U9: administration widens seeing, never acting', () => {
  test('U4: view_all sees somebody else’s task and CANNOT act on it', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['workflows.tasks.view_all'] }),
      task({ assignedTo: SOMEONE_ELSE }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision).toEqual({
      visible: true,
      actable: false,
      claimable: false,
      reason: 'administrative',
    })
  })

  test('U5: workflows.tasks.view alone does not admit an unrelated principal', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['workflows.tasks.view'] }),
      task({ assignedTo: SOMEONE_ELSE }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:no-relationship')
  })

  test('U6: with the tenant opt-out the same principal reads it again, but still cannot act', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['workflows.tasks.view'] }),
      task({ assignedTo: SOMEONE_ELSE }),
      NO_ENTITY_ACCESS,
      OFF,
    )

    expect(decision).toEqual({
      visible: true,
      actable: false,
      claimable: false,
      reason: 'legacy-read-filter',
    })
  })

  test('U7: the opt-out neither widens nor narrows the act path for an assignee', () => {
    const withFlagOn = decideTaskVisibility(
      backoffice({ grantedFeatures: ['workflows.tasks.view'] }),
      task({ assignedTo: ME }),
      NO_ENTITY_ACCESS,
      ON,
    )
    const withFlagOff = decideTaskVisibility(
      backoffice({ grantedFeatures: ['workflows.tasks.view'] }),
      task({ assignedTo: ME }),
      NO_ENTITY_ACCESS,
      OFF,
    )

    expect(withFlagOff.visible).toBe(true)
    expect(withFlagOff.actable).toBe(true)
    expect(withFlagOff.actable).toBe(withFlagOn.actable)
    expect(withFlagOff.claimable).toBe(withFlagOn.claimable)
  })

  test('U8: a bare `*` grant sees everything in tenant and acts on nothing unrelated', () => {
    const unrelated = decideTaskVisibility(
      backoffice({ grantedFeatures: ['*'] }),
      task({ assignedTo: SOMEONE_ELSE }),
      NO_ENTITY_ACCESS,
      ON,
    )
    const own = decideTaskVisibility(
      backoffice({ grantedFeatures: ['*'] }),
      task({ assignedTo: ME }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(unrelated).toMatchObject({ visible: true, actable: false, reason: 'administrative' })
    expect(own).toMatchObject({ visible: true, actable: true, reason: 'assignee' })
  })

  test('U9: `workflows.*` matches view_all, so no seeded admin loses access on upgrade', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['workflows.*'] }),
      task({ assignedTo: SOMEONE_ELSE }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(true)
    expect(decision.reason).toBe('administrative')
  })
})

describe('U10–U13: the entity clause is an AND on both branches', () => {
  test('U10: view_all does not bypass the entity gate', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['workflows.tasks.view_all'] }),
      task({ assignedTo: SOMEONE_ELSE, entityBindings: [{ entityType: DEAL, entityId: 'd1' }] }),
      accessMap({ [DEAL]: ['customers.deals.view'] }),
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:entity-access')
    expect(decision.blockedEntityType).toBe(DEAL)
  })

  test('U11: assignment does not bypass the entity gate either', () => {
    const decision = decideTaskVisibility(
      backoffice(),
      task({ assignedTo: ME, entityBindings: [{ entityType: ORDER, entityId: 'o1' }] }),
      accessMap({ [ORDER]: ['sales.orders.view'] }),
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.actable).toBe(false)
    expect(decision.reason).toBe('denied:entity-access')
  })

  test('U12: an entity type that does not resolve is refused as unknown, not guessed', () => {
    const decision = decideTaskVisibility(
      backoffice(),
      task({ assignedTo: ME, entityBindings: [{ entityType: 'Custmers:Deal', entityId: 'd1' }] }),
      new Map([['Custmers:Deal', { kind: 'unknown-entity-type' as const }]]),
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:unknown-entity-type')
    expect(decision.blockedEntityType).toBe('Custmers:Deal')
  })

  test('U13: `every`, not `some` — holding one of two bound types is not enough', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['customers.deals.view'] }),
      task({
        assignedTo: ME,
        entityBindings: [
          { entityType: DEAL, entityId: 'd1' },
          { entityType: ORDER, entityId: 'o1' },
        ],
      }),
      accessMap({ [DEAL]: ['customers.deals.view'], [ORDER]: ['sales.orders.view'] }),
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:entity-access')
    expect(decision.blockedEntityType).toBe(ORDER)
  })

  test('holding every bound type admits, and a satisfied requirement may be empty', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['customers.*', 'sales.orders.view'] }),
      task({
        assignedTo: ME,
        entityBindings: [
          { entityType: DEAL, entityId: 'd1' },
          { entityType: ORDER, entityId: 'o1' },
        ],
      }),
      accessMap({ [DEAL]: ['customers.deals.view'], [ORDER]: ['sales.orders.view'] }),
      ON,
    )

    expect(decision).toMatchObject({ visible: true, actable: true, reason: 'assignee' })
  })

  test('a superadmin short-circuits the entity clause, matching assertEntityAclForRequest', () => {
    const decision = decideTaskVisibility(
      backoffice({ isSuperAdmin: true }),
      task({ assignedTo: SOMEONE_ELSE, entityBindings: [{ entityType: DEAL, entityId: 'd1' }] }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision).toMatchObject({ visible: true, actable: false, reason: 'administrative' })
  })
})

describe('U14–U15: the unassigned administrative queue', () => {
  const disposition = task({
    assignedTo: null,
    assignedToRoles: null,
    claimedBy: null,
    administrativeQueueFeature: 'agent_orchestrator.proposals.view',
  })

  test('U14: the queue feature admits a principal to unassigned rows, and grants no act', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['agent_orchestrator.proposals.view'] }),
      disposition,
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision).toEqual({
      visible: true,
      actable: false,
      claimable: false,
      reason: 'administrative-queue',
    })
  })

  test('U15: a workflows-only principal no longer sees them — the intended narrowing', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['workflows.tasks.view'] }),
      disposition,
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:no-relationship')
  })

  test('a source that declares no queue feature falls back to workflows.tasks.view_all', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['workflows.tasks.view_all'] }),
      task({ assignedTo: null, assignedToRoles: [], claimedBy: null }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(true)
  })

  test('the queue arm never applies to a row somebody owns', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['agent_orchestrator.proposals.view'] }),
      task({
        assignedTo: SOMEONE_ELSE,
        administrativeQueueFeature: 'agent_orchestrator.proposals.view',
      }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:no-relationship')
  })
})

describe('U16–U18: scope is never overridable', () => {
  test('U16: a foreign tenant is refused with the flag on AND off', () => {
    const foreign = task({ tenantId: OTHER_TENANT, assignedTo: ME })
    const principal = backoffice({ grantedFeatures: ['*'], isSuperAdmin: true })

    for (const policy of [ON, OFF]) {
      const decision = decideTaskVisibility(principal, foreign, NO_ENTITY_ACCESS, policy)
      expect(decision.visible).toBe(false)
      expect(decision.actable).toBe(false)
      expect(decision.reason).toBe('denied:tenant')
    }
  })

  test('U17: an organization outside the caller’s scope is refused', () => {
    const decision = decideTaskVisibility(
      backoffice({ organizationIds: [ORG_A], grantedFeatures: ['*'] }),
      task({ organizationId: ORG_B, assignedTo: ME }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:organization')
  })

  test('U18: `organizationIds: null` is an unrestricted operator and passes scope', () => {
    const decision = decideTaskVisibility(
      backoffice({ organizationIds: null }),
      task({ organizationId: ORG_B, assignedTo: ME }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(true)
  })
})

describe('U19–U26: portal principals', () => {
  const portalTask = (overrides: Partial<TaskFacts> = {}) =>
    task({
      assigneeKind: 'customer',
      assignedTo: ME,
      entityBindings: [{ entityType: 'customers:person', entityId: 'own-record' }],
      ...overrides,
    })

  test('U19: a portal assignee sees and completes work bound to their own record', () => {
    const decision = decideTaskVisibility(portal(), portalTask(), NO_ENTITY_ACCESS, ON)

    expect(decision).toEqual({
      visible: true,
      actable: true,
      claimable: false,
      reason: 'portal-assignee',
    })
  })

  test('U20: an UNBOUND portal task is visible to nobody', () => {
    const decision = decideTaskVisibility(
      portal(),
      portalTask({ entityBindings: [] }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:portal-unbound')
  })

  test('U21: a binding on another customer’s record is refused', () => {
    const decision = decideTaskVisibility(
      portal(),
      portalTask({ entityBindings: [{ entityType: 'customers:person', entityId: 'their-record' }] }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:portal-not-owner')
  })

  test('U22: a backoffice task is structurally not portal work', () => {
    const decision = decideTaskVisibility(
      portal(),
      portalTask({ assigneeKind: 'user' }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:portal-wrong-assignee-kind')
  })

  test('U23: a portal admin whose features resolve to `[*]` buys nothing with the wildcard', () => {
    // `customerAuth.ts` REPLACES a portal admin's grants with ['*'] and
    // `customerRbacService` short-circuits every feature check for them. The
    // portal branch therefore carries no feature array at all — this principal
    // type has nowhere to put one.
    const decision = decideTaskVisibility(
      portal({ isPortalAdmin: true, ownedRecordIds: new Set<string>() }),
      task({ assigneeKind: 'user', assignedTo: SOMEONE_ELSE, entityBindings: [] }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.actable).toBe(false)
  })

  test('U24: a portal admin READS a company member’s task and cannot complete it', () => {
    const decision = decideTaskVisibility(
      portal({ isPortalAdmin: true, ownedRecordIds: new Set(['member-record']) }),
      portalTask({
        assignedTo: SOMEONE_ELSE,
        entityBindings: [{ entityType: 'customers:person', entityId: 'member-record' }],
      }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision).toEqual({
      visible: true,
      actable: false,
      claimable: false,
      reason: 'portal-company-admin',
    })
  })

  test('U25: a portal admin with no company association owns nothing and sees nothing', () => {
    const decision = decideTaskVisibility(
      portal({ isPortalAdmin: true, ownedRecordIds: new Set<string>() }),
      portalTask(),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:portal-not-owner')
  })

  test('U26: a portal principal is refused a task from another tenant', () => {
    const decision = decideTaskVisibility(
      portal(),
      portalTask({ tenantId: OTHER_TENANT }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.reason).toBe('denied:tenant')
  })

  test('a portal principal is refused a task from another organization', () => {
    const decision = decideTaskVisibility(
      portal(),
      portalTask({ organizationId: ORG_B }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.reason).toBe('denied:organization')
  })

  test('the tenant opt-out is ignored on the portal branch', () => {
    const withFlagOff = decideTaskVisibility(
      portal(),
      portalTask({ entityBindings: [] }),
      NO_ENTITY_ACCESS,
      OFF,
    )

    expect(withFlagOff.visible).toBe(false)
    expect(withFlagOff.reason).toBe('denied:portal-unbound')
  })

  test('a completed portal task is visible but no longer actable', () => {
    const decision = decideTaskVisibility(
      portal(),
      portalTask({ status: 'COMPLETED' }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(true)
    expect(decision.actable).toBe(false)
  })
})

describe('U27 and the rest of fail-closed', () => {
  test('U27: a map key the resolver never produced denies — a missing key is not a pass', () => {
    const decision = decideTaskVisibility(
      backoffice({ grantedFeatures: ['*'] }),
      task({ assignedTo: ME, entityBindings: [{ entityType: DEAL, entityId: 'd1' }] }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:entity-access')
    expect(decision.blockedEntityType).toBe(DEAL)
  })

  test('an entity the platform has no rule for denies', () => {
    const decision = decideTaskVisibility(
      backoffice(),
      task({ assignedTo: ME, entityBindings: [{ entityType: 'directory:tenant', entityId: 't1' }] }),
      new Map([['directory:tenant', { kind: 'unavailable' as const }]]),
      ON,
    )

    expect(decision.reason).toBe('denied:entity-access')
  })

  test('the opt-out does not rescue a task blocked only by the entity gate for a non-view holder', () => {
    const decision = decideTaskVisibility(
      backoffice(),
      task({ assignedTo: ME, entityBindings: [{ entityType: DEAL, entityId: 'd1' }] }),
      accessMap({ [DEAL]: ['customers.deals.view'] }),
      OFF,
    )

    expect(decision.visible).toBe(false)
    expect(decision.reason).toBe('denied:entity-access')
  })

  test('an unrecognized assigneeKind is neither user nor customer, so nothing admits', () => {
    const decision = decideTaskVisibility(
      backoffice(),
      task({ assignedTo: ME, assigneeKind: 'service' as unknown as 'user' }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(decision.visible).toBe(false)
    expect(decision.actable).toBe(false)
    expect(decision.reason).toBe('denied:no-relationship')
  })

  test('a terminal task is visible to its assignee but never actable', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'ESCALATED']) {
      const decision = decideTaskVisibility(
        backoffice(),
        task({ assignedTo: ME, status }),
        NO_ENTITY_ACCESS,
        ON,
      )
      expect(decision.visible).toBe(true)
      expect(decision.actable).toBe(false)
    }
  })

  test('claimable is strictly narrower than actable', () => {
    const alreadyAssigned = decideTaskVisibility(
      backoffice({ roleNames: ['approver'] }),
      task({ assignedTo: ME, assignedToRoles: ['approver'] }),
      NO_ENTITY_ACCESS,
      ON,
    )
    const alreadyClaimed = decideTaskVisibility(
      backoffice({ roleNames: ['approver'] }),
      task({ assignedToRoles: ['approver'], claimedBy: ME, status: 'IN_PROGRESS' }),
      NO_ENTITY_ACCESS,
      ON,
    )

    expect(alreadyAssigned.actable).toBe(true)
    expect(alreadyAssigned.claimable).toBe(false)
    expect(alreadyClaimed.actable).toBe(true)
    expect(alreadyClaimed.claimable).toBe(false)
  })
})

describe('buildTaskVisibilityFilter', () => {
  test('emits tenant, organization and the relationship $or for an ordinary principal', () => {
    const where = buildTaskVisibilityFilter(
      backoffice({ organizationIds: [ORG_A], roleNames: ['approver'] }),
      ON,
    )

    expect(where).toEqual({
      tenantId: TENANT,
      organizationId: { $in: [ORG_A] },
      $and: [
        {
          $or: [
            { assignedTo: ME, assigneeKind: 'user' },
            { claimedBy: ME },
            { assignedToRoles: { $overlap: ['approver'] } },
          ],
        },
      ],
    })
  })

  test('omits the organization predicate for an unrestricted operator', () => {
    const where = buildTaskVisibilityFilter(backoffice({ organizationIds: null }), ON)

    expect(where.organizationId).toBeUndefined()
    expect(where.tenantId).toBe(TENANT)
  })

  test('an administrative caller gets no relationship clause', () => {
    for (const principal of [
      backoffice({ isSuperAdmin: true }),
      backoffice({ grantedFeatures: ['workflows.tasks.view_all'] }),
      backoffice({ grantedFeatures: ['workflows.*'] }),
      backoffice({ grantedFeatures: ['*'] }),
    ]) {
      expect(buildTaskVisibilityConditions(principal, ON)).toEqual([])
    }
  })

  test('the opt-out drops the relationship clause for a workflows.tasks.view holder', () => {
    expect(buildTaskVisibilityConditions(backoffice({ grantedFeatures: ['workflows.tasks.view'] }), OFF)).toEqual([])
    expect(
      buildTaskVisibilityConditions(backoffice({ grantedFeatures: ['workflows.tasks.view'] }), ON),
    ).not.toEqual([])
  })

  test('the opt-out does not open the query to a principal without workflows.tasks.view', () => {
    expect(buildTaskVisibilityConditions(backoffice(), OFF)).not.toEqual([])
  })

  test('a principal with no roles gets no $overlap arm', () => {
    const [clause] = buildTaskVisibilityConditions(backoffice(), ON)
    expect(clause).toEqual({
      $or: [{ assignedTo: ME, assigneeKind: 'user' }, { claimedBy: ME }],
    })
  })

  test('the unassigned-queue arm appears only when the caller holds the declared queue feature', () => {
    const withGrant = buildTaskVisibilityConditions(
      backoffice({ grantedFeatures: ['agent_orchestrator.proposals.view'] }),
      ON,
      { administrativeQueueFeature: 'agent_orchestrator.proposals.view' },
    )
    const withoutGrant = buildTaskVisibilityConditions(backoffice(), ON, {
      administrativeQueueFeature: 'agent_orchestrator.proposals.view',
    })

    expect(JSON.stringify(withGrant)).toContain('assignedToRoles')
    expect((withGrant[0] as { $or: unknown[] }).$or).toHaveLength(3)
    expect((withoutGrant[0] as { $or: unknown[] }).$or).toHaveLength(2)
  })
})
