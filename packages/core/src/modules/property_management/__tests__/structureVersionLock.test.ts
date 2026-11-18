/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Building, CommonArea, Floor, Space, Unit } from '../data/entities'
import { FakeEm, type EntityClass, type Where } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null), canManageAllBuildings: jest.fn(async () => true) }
})
jest.mock('../lib/usageGuards', () => {
  const actual = jest.requireActual('../lib/usageGuards')
  return {
    findActiveLeases: jest.fn(async () => []),
    findUpcomingBookings: jest.fn(async () => []),
    findUpcomingBookingList: jest.fn(async () => ({ blockers: [], total: 0 })),
    findUnitBlockers: jest.fn(async () => []),
    findUnitBlockerList: jest.fn(async () => ({ blockers: [], total: 0 })),
    findUnitsEverUsed: jest.fn(async () => []),
    findBuildingUnitsEverUsed: jest.fn(async () => []),
    usageBlockerListOf: actual.usageBlockerListOf,
    usageBlockerConflictBody: actual.usageBlockerConflictBody,
    USAGE_BLOCKER_LIST_LIMIT: actual.USAGE_BLOCKER_LIST_LIMIT,
    HOLDING_BOOKING_STATUSES: ['pending', 'confirmed'],
  }
})
jest.mock('../events', () => ({ emitPropertyManagementEvent: jest.fn(async () => undefined) }))

import '../commands'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '82000000-0000-4000-8000-000000000001'
const FLOOR = '82000000-0000-4000-8000-000000000002'
const SPACE = '82000000-0000-4000-8000-000000000003'
const EMPTY_SPACE = '82000000-0000-4000-8000-000000000004'
const UNIT = '82000000-0000-4000-8000-000000000005'
const AREA = '82000000-0000-4000-8000-000000000006'
const VERSION = new Date('2026-11-10T10:00:00.000Z')
const NEWER = new Date('2026-11-10T10:05:00.000Z')
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

class ConcurrentEditEm extends FakeEm {
  onFloorLock: (() => void) | null = null

  async findOne(entity: EntityClass, where: Where, options?: { lockMode?: number }) {
    if (options?.lockMode !== undefined && entity === Floor && this.onFloorLock) {
      const edit = this.onFloorLock
      this.onFloorLock = null
      edit()
    }
    return super.findOne(entity, where, options)
  }
}

function seed(): ConcurrentEditEm {
  const em = new ConcurrentEditEm()
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null, updatedAt: VERSION } as never)
  em.seed(Floor, { id: FLOOR, ...scope, buildingId: BUILDING, number: 0, name: 'Ground Floor', sizeX: '40.00', sizeY: '20.00', deletedAt: null, updatedAt: VERSION } as never)
  em.seed(Space, { id: SPACE, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Open plan', x: '0', y: '0', width: '20', depth: '20', isDefault: true, deletedAt: null, updatedAt: VERSION } as never)
  em.seed(Space, { id: EMPTY_SPACE, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Annex', x: '20', y: '0', width: '10', depth: '10', isDefault: false, deletedAt: null, updatedAt: VERSION } as never)
  em.seed(Unit, {
    id: UNIT,
    ...scope,
    buildingId: BUILDING,
    floorId: FLOOR,
    spaceId: SPACE,
    name: 'Room 1',
    catalogCategoryId: '82000000-0000-4000-8000-000000000010',
    catalogProductId: '82000000-0000-4000-8000-000000000011',
    x: '2',
    y: '2',
    width: '4',
    depth: '4',
    deletedAt: null,
    updatedAt: VERSION,
  } as never)
  em.seed(CommonArea, { id: AREA, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Lobby', kind: 'lobby', x: '30', y: '10', width: '5', depth: '5', deletedAt: null, updatedAt: VERSION } as never)
  return em
}

function buildCtx(em: FakeEm, expected: string): CommandRuntimeContext {
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
    request: new Request('http://localhost/api', { headers: { [LOCK_HEADER]: expected } }),
  }
}

function handler(commandId: string) {
  const command = commandRegistry.get(commandId)
  if (!command) throw new Error(`[internal] missing command ${commandId}`)
  return command
}

function rowOf(em: FakeEm, entity: EntityClass, id: string): Record<string, unknown> {
  const row = em.rows(entity).find((candidate) => candidate.id === id)
  if (!row) throw new Error(`[internal] missing ${entity.name} ${id}`)
  return row as Record<string, unknown>
}

type VersionCase = {
  name: string
  commandId: string
  entity: EntityClass
  id: string
  input: Record<string, unknown>
  unchanged: (row: Record<string, unknown>) => void
  applied: (row: Record<string, unknown>) => void
}

const cases: VersionCase[] = [
  {
    name: 'unit.update',
    commandId: 'property_management.unit.update',
    entity: Unit,
    id: UNIT,
    input: { ...scope, id: UNIT, name: 'Room 2' },
    unchanged: (row) => expect(row.name).toBe('Room 1'),
    applied: (row) => expect(row.name).toBe('Room 2'),
  },
  {
    name: 'unit.delete',
    commandId: 'property_management.unit.delete',
    entity: Unit,
    id: UNIT,
    input: { ...scope, id: UNIT },
    unchanged: (row) => expect(row.deletedAt).toBeNull(),
    applied: (row) => expect(row.deletedAt).toBeInstanceOf(Date),
  },
  {
    name: 'space.update',
    commandId: 'property_management.space.update',
    entity: Space,
    id: SPACE,
    input: { ...scope, id: SPACE, name: 'Hot desks' },
    unchanged: (row) => expect(row.name).toBe('Open plan'),
    applied: (row) => expect(row.name).toBe('Hot desks'),
  },
  {
    name: 'space.delete',
    commandId: 'property_management.space.delete',
    entity: Space,
    id: EMPTY_SPACE,
    input: { ...scope, id: EMPTY_SPACE },
    unchanged: (row) => expect(row.deletedAt).toBeNull(),
    applied: (row) => expect(row.deletedAt).toBeInstanceOf(Date),
  },
  {
    name: 'common_area.update',
    commandId: 'property_management.common_area.update',
    entity: CommonArea,
    id: AREA,
    input: { ...scope, id: AREA, name: 'Reception' },
    unchanged: (row) => expect(row.name).toBe('Lobby'),
    applied: (row) => expect(row.name).toBe('Reception'),
  },
  {
    name: 'common_area.delete',
    commandId: 'property_management.common_area.delete',
    entity: CommonArea,
    id: AREA,
    input: { ...scope, id: AREA },
    unchanged: (row) => expect(row.deletedAt).toBeNull(),
    applied: (row) => expect(row.deletedAt).toBeInstanceOf(Date),
  },
  {
    name: 'floor.update',
    commandId: 'property_management.floor.update',
    entity: Floor,
    id: FLOOR,
    input: { ...scope, id: FLOOR, name: 'Lobby level' },
    unchanged: (row) => expect(row.name).toBe('Ground Floor'),
    applied: (row) => expect(row.name).toBe('Lobby level'),
  },
]

describe.each(cases)('$name version check under the floor lock', ({ commandId, entity, id, input, unchanged, applied }) => {
  it('refuses with 409 when the record changed between the route guard and the lock', async () => {
    const em = seed()
    em.onFloorLock = () => {
      Object.assign(rowOf(em, entity, id), { updatedAt: NEWER })
    }
    let caught: unknown = null
    try {
      await handler(commandId).execute(input, buildCtx(em, VERSION.toISOString()))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CrudHttpError)
    expect((caught as CrudHttpError).status).toBe(409)
    expect((caught as CrudHttpError).body).toMatchObject({ code: 'optimistic_lock_conflict', currentUpdatedAt: NEWER.toISOString() })
    unchanged(rowOf(em, entity, id))
  })

  it('applies the change when the version still matches under the lock', async () => {
    const em = seed()
    await handler(commandId).execute(input, buildCtx(em, VERSION.toISOString()))
    applied(rowOf(em, entity, id))
  })
})
