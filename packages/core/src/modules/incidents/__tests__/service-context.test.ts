/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  IncidentImpact,
  IncidentServiceComponent,
  IncidentServiceDependency,
} from '../data/entities'
import { resolveIncidentServiceContext } from '../lib/serviceContext'

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const INCIDENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CHECKOUT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PAYMENTS_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const INVENTORY_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const DEP_1_ID = '11111111-1111-4111-8111-111111111111'
const DEP_2_ID = '22222222-2222-4222-8222-222222222222'

const scope = { organizationId: ORG_ID, tenantId: TENANT_ID }
const now = new Date('2026-07-03T08:00:00.000Z')

type Store = {
  impacts: IncidentImpact[]
  components: IncidentServiceComponent[]
  dependencies: IncidentServiceDependency[]
}

function makeImpact(overrides: Partial<IncidentImpact>): IncidentImpact {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    incidentId: INCIDENT_ID,
    targetType: 'service_component',
    targetId: CHECKOUT_ID,
    componentLabel: null,
    impactStatus: 'degraded',
    snapshot: null,
    revenueAmountMinor: null,
    revenueCurrency: null,
    revenueRefreshedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as IncidentImpact
}

function makeComponent(id: string, key: string, name: string, overrides: Partial<IncidentServiceComponent> = {}): IncidentServiceComponent {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    key,
    name,
    description: null,
    componentType: 'service',
    ownerTeamId: null,
    ownerUserId: null,
    criticality: 'medium',
    tier: null,
    sloTargetBasisPoints: null,
    sourceType: null,
    sourceId: null,
    snapshot: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as IncidentServiceComponent
}

function makeDependency(
  id: string,
  sourceComponentId: string,
  targetComponentId: string,
  overrides: Partial<IncidentServiceDependency> = {},
): IncidentServiceDependency {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    sourceComponentId,
    targetComponentId,
    dependencyKind: 'depends_on',
    snapshot: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as IncidentServiceDependency
}

function idInWhere(where: Record<string, unknown>, id: string): boolean {
  const filter = where.id
  if (!filter || typeof filter !== 'object') return true
  const values = (filter as { $in?: unknown }).$in
  return Array.isArray(values) ? values.includes(id) : true
}

function dependencyMatchesOr(where: Record<string, unknown>, dependency: IncidentServiceDependency): boolean {
  const ors = where.$or
  if (!Array.isArray(ors)) return true
  return ors.some((entry) => {
    const sourceValues = (entry as { sourceComponentId?: { $in?: string[] } }).sourceComponentId?.$in
    const targetValues = (entry as { targetComponentId?: { $in?: string[] } }).targetComponentId?.$in
    return Boolean(
      sourceValues?.includes(dependency.sourceComponentId) ||
      targetValues?.includes(dependency.targetComponentId),
    )
  })
}

function makeEntityManager(store: Store): EntityManager {
  return {
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === IncidentImpact) {
        return store.impacts.filter((impact) =>
          impact.organizationId === where.organizationId &&
          impact.tenantId === where.tenantId &&
          impact.incidentId === where.incidentId &&
          impact.deletedAt === where.deletedAt)
      }
      if (entity === IncidentServiceDependency) {
        return store.dependencies.filter((dependency) =>
          dependency.organizationId === where.organizationId &&
          dependency.tenantId === where.tenantId &&
          dependency.isActive === where.isActive &&
          dependency.deletedAt === where.deletedAt &&
          dependencyMatchesOr(where, dependency))
      }
      if (entity === IncidentServiceComponent) {
        return store.components.filter((component) =>
          component.organizationId === where.organizationId &&
          component.tenantId === where.tenantId &&
          component.isActive === where.isActive &&
          component.deletedAt === where.deletedAt &&
          idInWhere(where, component.id))
      }
      return []
    }),
  } as unknown as EntityManager
}

describe('incident service context', () => {
  test('returns impacted service components with first-hop dependencies', async () => {
    const em = makeEntityManager({
      impacts: [makeImpact({})],
      components: [
        makeComponent(CHECKOUT_ID, 'checkout', 'Checkout'),
        makeComponent(PAYMENTS_ID, 'payments', 'Payments'),
        makeComponent(INVENTORY_ID, 'inventory', 'Inventory'),
      ],
      dependencies: [
        makeDependency(DEP_1_ID, CHECKOUT_ID, PAYMENTS_ID),
        makeDependency(DEP_2_ID, INVENTORY_ID, CHECKOUT_ID),
      ],
    })

    const context = await resolveIncidentServiceContext(em, scope, INCIDENT_ID)

    expect(context.impactedComponentIds).toEqual([CHECKOUT_ID])
    expect(context.components.map((component) => component.id).sort()).toEqual([
      CHECKOUT_ID,
      INVENTORY_ID,
      PAYMENTS_ID,
    ].sort())
    expect(context.components.find((component) => component.id === CHECKOUT_ID)).toMatchObject({
      name: 'Checkout',
      impacted: true,
    })
    expect(context.dependencies.map((dependency) => dependency.id).sort()).toEqual([DEP_1_ID, DEP_2_ID].sort())
  })

  test('preserves freeform component labels without requiring catalog records', async () => {
    const em = makeEntityManager({
      impacts: [
        makeImpact({
          targetType: 'component',
          targetId: null,
          componentLabel: 'Legacy ERP',
        }),
      ],
      components: [],
      dependencies: [],
    })

    const context = await resolveIncidentServiceContext(em, scope, INCIDENT_ID)

    expect(context.freeformComponentLabels).toEqual(['Legacy ERP'])
    expect(context.impactedComponentIds).toEqual([])
    expect(context.components).toEqual([])
    expect(context.dependencies).toEqual([])
    expect((em.find as jest.Mock).mock.calls).toHaveLength(1)
  })

  test('does not include service components from another tenant', async () => {
    const em = makeEntityManager({
      impacts: [makeImpact({})],
      components: [
        makeComponent(CHECKOUT_ID, 'checkout', 'Checkout', { tenantId: OTHER_TENANT_ID }),
        makeComponent(PAYMENTS_ID, 'payments', 'Payments'),
      ],
      dependencies: [
        makeDependency(DEP_1_ID, CHECKOUT_ID, PAYMENTS_ID),
      ],
    })

    const context = await resolveIncidentServiceContext(em, scope, INCIDENT_ID)

    expect(context.impactedComponentIds).toEqual([])
    expect(context.components).toEqual([])
    expect(context.dependencies).toEqual([])
  })
})
