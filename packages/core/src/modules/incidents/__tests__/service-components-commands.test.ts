/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { isCrudHttpError, type CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  IncidentServiceComponent,
  IncidentServiceDependency,
} from '../data/entities'

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: jest.fn(async (em: { flush?: () => Promise<void> }, callbacks: Array<() => unknown>) => {
    for (const callback of callbacks) await callback()
    await em.flush?.()
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return { ...actual, emitCrudSideEffects: jest.fn(async () => undefined) }
})

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CHECKOUT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PAYMENTS_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const INVENTORY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const DEP_SRC_TARGET_ID = '11111111-1111-4111-8111-111111111111'
const DEP_TARGET_SRC_ID = '22222222-2222-4222-8222-222222222222'
const MISSING_ID = '99999999-9999-4999-8999-999999999999'

const now = new Date('2026-07-03T08:00:00.000Z')

type EntityClass = typeof IncidentServiceComponent | typeof IncidentServiceDependency

function makeComponent(
  id: string,
  key: string,
  overrides: Partial<IncidentServiceComponent> = {},
): IncidentServiceComponent {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    key,
    name: key,
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

function matches(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([field, expected]) => {
    if (field === '$or') {
      return Array.isArray(expected) && expected.some((clause) => matches(record, clause as Record<string, unknown>))
    }
    return record[field] === expected
  })
}

function buildHarness(seed: {
  components?: IncidentServiceComponent[]
  dependencies?: IncidentServiceDependency[]
} = {}) {
  const store = new Map<EntityClass, Record<string, unknown>[]>()
  store.set(IncidentServiceComponent, [...(seed.components ?? [])] as Record<string, unknown>[])
  store.set(IncidentServiceDependency, [...(seed.dependencies ?? [])] as Record<string, unknown>[])

  let created = 0
  const em = {
    findOne: jest.fn(async (entity: EntityClass, where: Record<string, unknown>) => {
      const rows = store.get(entity) ?? []
      return rows.find((row) => matches(row, where)) ?? null
    }),
    find: jest.fn(async (entity: EntityClass, where: Record<string, unknown>) => {
      const rows = store.get(entity) ?? []
      return rows.filter((row) => matches(row, where))
    }),
    create: jest.fn((_entity: EntityClass, data: Record<string, unknown>) => {
      created += 1
      return { id: `generated-${created}`, ...data }
    }),
    persist: jest.fn((entity: unknown) => entity),
    flush: jest.fn(async () => undefined),
    fork: jest.fn(function fork() {
      return this
    }),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'dataEngine') return {}
      throw new Error(`unexpected resolve(${name})`)
    }),
  }
  const ctx = {
    container,
    auth: { sub: CHECKOUT_ID, userId: CHECKOUT_ID, tenantId: TENANT_ID, orgId: ORG_ID, features: ['incidents.*'] },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    organizationScope: { selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: [ORG_ID], tenantId: TENANT_ID },
  }

  return { em, ctx, store }
}

function handler(id: string) {
  const found = commandRegistry.get(id)
  expect(found).toBeTruthy()
  return found!
}

async function expectHttpError(promise: Promise<unknown>, status: number): Promise<CrudHttpError> {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(isCrudHttpError(caught)).toBe(true)
  expect((caught as CrudHttpError).status).toBe(status)
  return caught as CrudHttpError
}

const baseScope = { organizationId: ORG_ID, tenantId: TENANT_ID }

describe('incidents service-component / service-dependency commands', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../commands/serviceComponents')
  })

  describe('incidents.service_components.create', () => {
    it('persists a new component and enforces the unique key check', async () => {
      const { em, ctx } = buildHarness()

      const result = await handler('incidents.service_components.create').execute(
        { ...baseScope, key: 'checkout', name: 'Checkout' },
        ctx as never,
      )

      expect(result).toMatchObject({ organizationId: ORG_ID, tenantId: TENANT_ID })
      expect(typeof (result as { id: string }).id).toBe('string')
      expect(em.findOne).toHaveBeenCalledWith(
        IncidentServiceComponent,
        expect.objectContaining({ key: 'checkout', deletedAt: null, organizationId: ORG_ID, tenantId: TENANT_ID }),
      )
      expect(em.create).toHaveBeenCalledWith(
        IncidentServiceComponent,
        expect.objectContaining({ key: 'checkout', componentType: 'service', criticality: 'medium', isActive: true }),
      )
      expect(em.persist).toHaveBeenCalled()
    })

    it('rejects a duplicate key in the same scope with 409', async () => {
      const { ctx } = buildHarness({ components: [makeComponent(CHECKOUT_ID, 'checkout')] })

      await expectHttpError(
        handler('incidents.service_components.create').execute(
          { ...baseScope, key: 'checkout', name: 'Checkout again' },
          ctx as never,
        ),
        409,
      )
    })
  })

  describe('incidents.service_components.delete', () => {
    it('cascade soft-deletes dependency edges on both sides of the component', async () => {
      const outgoing = makeDependency(DEP_SRC_TARGET_ID, CHECKOUT_ID, PAYMENTS_ID)
      const incoming = makeDependency(DEP_TARGET_SRC_ID, INVENTORY_ID, CHECKOUT_ID)
      const component = makeComponent(CHECKOUT_ID, 'checkout')
      const { ctx } = buildHarness({ components: [component], dependencies: [outgoing, incoming] })

      await handler('incidents.service_components.delete').execute(
        { ...baseScope, id: CHECKOUT_ID },
        ctx as never,
      )

      expect(component.deletedAt).toBeInstanceOf(Date)
      expect(component.isActive).toBe(false)
      expect(outgoing.deletedAt).toBeInstanceOf(Date)
      expect(outgoing.isActive).toBe(false)
      expect(incoming.deletedAt).toBeInstanceOf(Date)
      expect(incoming.isActive).toBe(false)
    })

    it('returns 404 for a component id that belongs to another tenant', async () => {
      const { ctx } = buildHarness({
        components: [makeComponent(CHECKOUT_ID, 'checkout', { tenantId: OTHER_TENANT_ID })],
      })

      await expectHttpError(
        handler('incidents.service_components.delete').execute(
          { ...baseScope, id: CHECKOUT_ID },
          ctx as never,
        ),
        404,
      )
    })
  })

  describe('incidents.service_dependencies.create', () => {
    it('persists a dependency with the default kind once both endpoints resolve in scope', async () => {
      const { em, ctx } = buildHarness({
        components: [makeComponent(CHECKOUT_ID, 'checkout'), makeComponent(PAYMENTS_ID, 'payments')],
      })

      const result = await handler('incidents.service_dependencies.create').execute(
        { ...baseScope, sourceComponentId: CHECKOUT_ID, targetComponentId: PAYMENTS_ID },
        ctx as never,
      )

      expect(result).toMatchObject({ organizationId: ORG_ID, tenantId: TENANT_ID })
      expect(em.create).toHaveBeenCalledWith(
        IncidentServiceDependency,
        expect.objectContaining({ sourceComponentId: CHECKOUT_ID, targetComponentId: PAYMENTS_ID, dependencyKind: 'depends_on' }),
      )
    })

    it('rejects a duplicate (source,target,kind) edge with 409', async () => {
      const { ctx } = buildHarness({
        components: [makeComponent(CHECKOUT_ID, 'checkout'), makeComponent(PAYMENTS_ID, 'payments')],
        dependencies: [makeDependency(DEP_SRC_TARGET_ID, CHECKOUT_ID, PAYMENTS_ID)],
      })

      await expectHttpError(
        handler('incidents.service_dependencies.create').execute(
          { ...baseScope, sourceComponentId: CHECKOUT_ID, targetComponentId: PAYMENTS_ID },
          ctx as never,
        ),
        409,
      )
    })

    it('returns 404 when an endpoint component is missing from the scope', async () => {
      const { ctx } = buildHarness({ components: [makeComponent(CHECKOUT_ID, 'checkout')] })

      await expectHttpError(
        handler('incidents.service_dependencies.create').execute(
          { ...baseScope, sourceComponentId: CHECKOUT_ID, targetComponentId: MISSING_ID },
          ctx as never,
        ),
        404,
      )
    })
  })

  describe('incidents.service_dependencies.update', () => {
    it('rejects a self-referential edge with 400 when an endpoint is repointed onto the other', async () => {
      const dependency = makeDependency(DEP_SRC_TARGET_ID, CHECKOUT_ID, PAYMENTS_ID)
      const { ctx } = buildHarness({
        components: [makeComponent(CHECKOUT_ID, 'checkout'), makeComponent(PAYMENTS_ID, 'payments')],
        dependencies: [dependency],
      })

      const error = await expectHttpError(
        handler('incidents.service_dependencies.update').execute(
          { ...baseScope, id: DEP_SRC_TARGET_ID, sourceComponentId: PAYMENTS_ID },
          ctx as never,
        ),
        400,
      )
      expect(error.body).toMatchObject({ error: expect.stringContaining('itself') })
    })
  })
})
