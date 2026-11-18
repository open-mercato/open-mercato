/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { applyCustomFieldsNormalization, decorateRecordWithCustomFields } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '#generated/entities.ids.generated'
import { Building } from '../data/entities'
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
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined) }))
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null), canManageAllBuildings: jest.fn(async () => true) }
})
jest.mock('../lib/managers', () => ({
  assertManagerUsers: jest.fn(async (_em: unknown, _scope: unknown, ids: string[]) => ids),
  filterOrganizationUsers: jest.fn(async (_em: unknown, _scope: unknown, ids: string[]) => ids),
  loadManagerIds: jest.fn(async () => []),
  replaceManagers: jest.fn(async () => undefined),
  listBuildingManagers: jest.fn(async () => new Map()),
}))
jest.mock('../events', () => ({ emitPropertyManagementEvent: jest.fn(async () => undefined) }))

import '../commands'
import '../api/buildings/route'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '80000000-0000-4000-8000-000000000001'
const ENTITY = E.property_management.building
const LAYOUT = { below: 0, above: 1, floors: [{ number: 0, name: 'Ground Floor', sizeX: 20, sizeY: 10 }] }

function buildCtx(em: TransactionalFakeEm): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
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

function buildingRoute(): CapturedRoute {
  const route = capturedRoutes.find((config) => config.list?.entityId === ENTITY)
  if (!route) throw new Error('[internal] buildings route not captured')
  return route
}

function buildingRow(em: TransactionalFakeEm, id: string): Building {
  return em.rows(Building).find((row) => row.id === id) as unknown as Building
}

beforeEach(() => {
  resetCustomFieldStore()
})

describe('building custom fields', () => {
  it('maps cf_ keys from the request body into the command input', async () => {
    const mapInput = buildingRoute().actions?.create?.mapInput
    const ctx = { ...buildCtx(new TransactionalFakeEm()), auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } } as unknown as CrudCtx
    const input = await mapInput?.({ raw: { name: 'Annex', address: 'Quay 2', layout: LAYOUT, cf_floor_code: 'A1' }, ctx })
    expect(input).toMatchObject({ ...scope, name: 'Annex', customFields: { floor_code: 'A1' } })
    expect(input).not.toHaveProperty('cf_floor_code')
  })

  it('keeps custom values on list items and decorates them into customValues', () => {
    const list = buildingRoute().list
    expect(list?.decorateCustomFields).toEqual({ entityIds: ENTITY, stripPrefixedKeys: true })
    const item = list?.transformItem?.({ id: BUILDING, name: 'Annex', address: 'Quay 2', organization_id: ORG, tenant_id: TENANT, 'cf:floor_code': 'A1' }) ?? {}
    expect(item.cf_floor_code).toBe('A1')
    const decorated = applyCustomFieldsNormalization(item, decorateRecordWithCustomFields(item, textFieldDefinitions('floor_code', scope), scope), { stripPrefixedKeys: true })
    expect(decorated.customValues).toEqual({ floor_code: 'A1' })
    expect(decorated).not.toHaveProperty('cf_floor_code')
  })

  it('writes custom values with the building and restores them on undo of an update', async () => {
    const em = new TransactionalFakeEm()
    const ctx = buildCtx(em)
    const createInput = { ...scope, name: 'Annex', address: 'Quay 2', layout: LAYOUT, customFields: { floor_code: 'A1' } }
    const created = (await handler('property_management.building.create').execute(createInput, ctx)) as { buildingId: string }
    expect(customFieldStore.writes).toEqual([{ entityId: ENTITY, recordId: created.buildingId, values: { floor_code: 'A1' }, inTransaction: true }])
    const afterCreate = await handler('property_management.building.create').captureAfter?.(createInput, created, ctx)
    expect(afterCreate).toMatchObject({ custom: { floor_code: 'A1' } })

    const update = handler('property_management.building.update')
    const updateInput = { ...scope, id: created.buildingId, customFields: { floor_code: 'B2', wing: 'North' } }
    const prepared = (await update.prepare?.(updateInput, ctx)) as { before?: Record<string, unknown> }
    const result = await update.execute(updateInput, ctx)
    const after = await update.captureAfter?.(updateInput, result, ctx)
    expect(storedCustomFields(ENTITY, created.buildingId)).toEqual({ floor_code: 'B2', wing: 'North' })
    expect(customFieldStore.writes.at(-1)?.inTransaction).toBe(true)
    const log = await update.buildLog?.({ input: updateInput, result, ctx, snapshots: { before: prepared.before, after } } as never)

    await update.undo?.({ logEntry: { payload: (log as { payload: unknown }).payload } as never, ctx } as never)
    expect(storedCustomFields(ENTITY, created.buildingId)).toEqual({ floor_code: 'A1' })
    expect(customFieldStore.writes.at(-1)).toMatchObject({ values: { floor_code: 'A1', wing: null }, inTransaction: true })
  })

  it('does not touch custom values when undoing an update logged before they were captured', async () => {
    const em = new TransactionalFakeEm()
    em.seed(Building, { id: BUILDING, ...scope, name: 'Renamed', address: 'Quay 1', status: 'active', openingHoursEnabled: false, deletedAt: null } as never)
    const snapshot = { id: BUILDING, ...scope, name: 'Harbor Point', address: 'Quay 1', status: 'active', archivedAt: null, openingHoursEnabled: false, managerUserIds: [] }
    await handler('property_management.building.update').undo?.({
      logEntry: { payload: { undo: { before: snapshot, after: { ...snapshot, name: 'Renamed' } } } } as never,
      ctx: buildCtx(em),
    } as never)
    expect(buildingRow(em, BUILDING).name).toBe('Harbor Point')
    expect(customFieldStore.writes).toEqual([])
  })
})

describe('building update undo version', () => {
  it('bumps updated_at even when the undone update changed only managers', async () => {
    const em = new TransactionalFakeEm()
    const stale = new Date('2026-01-01T00:00:00Z')
    em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', address: 'Quay 1', status: 'active', openingHoursEnabled: false, deletedAt: null, updatedAt: stale } as never)
    const snapshot = { id: BUILDING, ...scope, name: 'Harbor Point', address: 'Quay 1', status: 'active', archivedAt: null, openingHoursEnabled: false }
    await handler('property_management.building.update').undo?.({
      logEntry: { payload: { undo: { before: { ...snapshot, managerUserIds: ['manager-a'] }, after: { ...snapshot, managerUserIds: ['manager-b'] } } } } as never,
      ctx: buildCtx(em),
    } as never)
    expect(buildingRow(em, BUILDING).updatedAt.getTime()).toBeGreaterThan(stale.getTime())
  })
})
