/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { applyCustomFieldsNormalization, decorateRecordWithCustomFields } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '#generated/entities.ids.generated'
import { Building, Floor, ProductUse, Space, Unit } from '../data/entities'
import {
  customFieldStore,
  resetCustomFieldStore,
  storedCustomFields,
  textFieldDefinitions,
  TransactionalFakeEm,
} from './support/customFieldStore'

type CapturedRoute = {
  list?: {
    entityId?: string
    transformItem?: (item: Record<string, unknown>) => Record<string, unknown>
    decorateCustomFields?: { entityIds: unknown; stripPrefixedKeys?: boolean }
  }
  actions?: Record<string, { mapInput?: (args: { raw: unknown; ctx: CrudCtx }) => Promise<Record<string, unknown>> }>
}

const capturedRoutes: CapturedRoute[] = []

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((config: CapturedRoute) => {
    capturedRoutes.push(config)
    const handler = jest.fn()
    return { GET: handler, POST: handler, PUT: handler, DELETE: handler }
  }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/shared/lib/data/engine', () => jest.requireActual('./support/customFieldStore').dataEngineMock())
jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => jest.requireActual('./support/customFieldStore').customFieldSnapshotsMock())
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null), canManageAllBuildings: jest.fn(async () => true) }
})
jest.mock('../lib/productUse', () => {
  const actual = jest.requireActual('../lib/productUse')
  return {
    ...actual,
    resolveUnitProduct: jest.fn(async (_em: unknown, _scope: unknown, input: { catalogCategoryId: string; catalogProductId: string }) => ({
      catalogProductId: input.catalogProductId,
      catalogCategoryId: input.catalogCategoryId,
      use: 'leasable',
      billingUnit: 'month',
      productName: 'Private office',
    })),
    resolvePriceSnapshot: jest.fn(async () => ({ priceAmount: null, currencyCode: null, priceKindId: null })),
  }
})
jest.mock('../events', () => ({ emitPropertyManagementEvent: jest.fn(async () => undefined) }))
jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return { ...actual, emitSideEffects: jest.fn(async () => undefined) }
})

import '../commands'
import '../api/units/route'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '81000000-0000-4000-8000-000000000001'
const FLOOR = '81000000-0000-4000-8000-000000000002'
const SPACE = '81000000-0000-4000-8000-000000000003'
const CATEGORY = '81000000-0000-4000-8000-000000000004'
const PRODUCT = '81000000-0000-4000-8000-000000000005'
const ENTITY = E.property_management.unit

function seed(): TransactionalFakeEm {
  const em = new TransactionalFakeEm()
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null } as never)
  em.seed(Floor, { id: FLOOR, ...scope, buildingId: BUILDING, number: 0, name: 'Ground Floor', sizeX: '40.00', sizeY: '20.00', deletedAt: null } as never)
  em.seed(Space, { id: SPACE, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Open plan', x: '0', y: '0', width: '40', depth: '20', isDefault: true, deletedAt: null } as never)
  em.seed(ProductUse, { id: 'use-1', ...scope, catalogProductId: PRODUCT, use: 'leasable', billingUnit: 'month' } as never)
  return em
}

function buildCtx(em: TransactionalFakeEm): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } as never,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function handler(commandId: string) {
  const command = commandRegistry.get(commandId)
  if (!command) throw new Error(`[internal] missing command ${commandId}`)
  return command
}

function unitRoute(): CapturedRoute {
  const route = capturedRoutes.find((config) => config.list?.entityId === ENTITY)
  if (!route) throw new Error('[internal] units route not captured')
  return route
}

beforeEach(() => {
  resetCustomFieldStore()
})

describe('unit custom fields', () => {
  it('maps cf_ keys from the request body into the command input', async () => {
    const mapInput = unitRoute().actions?.update?.mapInput
    const ctx = buildCtx(new TransactionalFakeEm()) as unknown as CrudCtx
    const input = await mapInput?.({ raw: { id: '81000000-0000-4000-8000-000000000009', name: 'Studio', cf_desk_count: 4 }, ctx })
    expect(input).toMatchObject({ ...scope, name: 'Studio', customFields: { desk_count: 4 } })
    expect(input).not.toHaveProperty('cf_desk_count')
  })

  it('keeps custom values on list items and decorates them into customValues', () => {
    const list = unitRoute().list
    expect(list?.decorateCustomFields).toEqual({ entityIds: ENTITY, stripPrefixedKeys: true })
    const item = list?.transformItem?.({ id: 'unit-1', name: 'Studio', organization_id: ORG, tenant_id: TENANT, 'cf:desk_count': '4' }) ?? {}
    const decorated = applyCustomFieldsNormalization(item, decorateRecordWithCustomFields(item, textFieldDefinitions('desk_count', scope), scope), { stripPrefixedKeys: true })
    expect(decorated.customValues).toEqual({ desk_count: '4' })
    expect(decorated).not.toHaveProperty('cf:desk_count')
  })

  it('writes custom values with the unit and restores them on undo of an update', async () => {
    const em = seed()
    const ctx = buildCtx(em)
    const createInput = {
      ...scope,
      floorId: FLOOR,
      spaceId: SPACE,
      name: 'Studio 3C',
      catalogCategoryId: CATEGORY,
      catalogProductId: PRODUCT,
      x: 2,
      y: 2,
      width: 4,
      depth: 4,
      customFields: { desk_count: 4 },
    }
    const created = (await handler('property_management.unit.create').execute(createInput, ctx)) as { unitId: string }
    expect(customFieldStore.writes).toEqual([{ entityId: ENTITY, recordId: created.unitId, values: { desk_count: 4 }, inTransaction: true }])
    expect(em.rows(Unit)).toHaveLength(1)

    const update = handler('property_management.unit.update')
    const updateInput = { ...scope, id: created.unitId, name: 'Studio 3D', customFields: { desk_count: 6 } }
    const prepared = (await update.prepare?.(updateInput, ctx)) as { before?: Record<string, unknown> }
    expect(prepared.before).toMatchObject({ custom: { desk_count: 4 } })
    const result = await update.execute(updateInput, ctx)
    const after = await update.captureAfter?.(updateInput, result, ctx)
    expect(storedCustomFields(ENTITY, created.unitId)).toEqual({ desk_count: 6 })
    expect(customFieldStore.writes.at(-1)?.inTransaction).toBe(true)
    const log = await update.buildLog?.({ input: updateInput, result, ctx, snapshots: { before: prepared.before, after } } as never)

    await update.undo?.({ logEntry: { payload: (log as { payload: unknown }).payload } as never, ctx } as never)
    expect(storedCustomFields(ENTITY, created.unitId)).toEqual({ desk_count: 4 })
    expect(customFieldStore.writes.at(-1)?.inTransaction).toBe(true)
    expect((em.rows(Unit)[0] as unknown as Unit).name).toBe('Studio 3C')
  })
})
