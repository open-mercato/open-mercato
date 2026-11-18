/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Booking, Building, CommonArea, Floor, OpeningHours, ProductUse, Space, Unavailability, Unit } from '../data/entities'
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
jest.mock('../lib/managers', () => ({
  assertManagerUsers: jest.fn(async (_em: unknown, _scope: unknown, ids: string[]) => ids),
  filterOrganizationUsers: jest.fn(async (_em: unknown, _scope: unknown, ids: string[]) => ids),
  loadManagerIds: jest.fn(async () => []),
  replaceManagers: jest.fn(async () => undefined),
}))
jest.mock('../lib/usageGuards', () => {
  const actual = jest.requireActual('../lib/usageGuards')
  const findUnitsEverUsed = jest.fn(async (_em: unknown, _scope: unknown, _unitIds: readonly string[]): Promise<string[]> => [])
  return {
    findActiveLeases: jest.fn(async () => []),
    findUpcomingBookings: jest.fn(async () => []),
    findUpcomingBookingList: jest.fn(async () => ({ blockers: [], total: 0 })),
    findUnitBlockers: jest.fn(async () => []),
    findUnitBlockerList: jest.fn(async () => ({ blockers: [], total: 0 })),
    findUnitsEverUsed,
    findBuildingUnitsEverUsed: jest.fn(async (em: unknown, scope: unknown) => findUnitsEverUsed(em, scope, [])),
    usageBlockerListOf: actual.usageBlockerListOf,
    usageBlockerConflictBody: actual.usageBlockerConflictBody,
    USAGE_BLOCKER_LIST_LIMIT: actual.USAGE_BLOCKER_LIST_LIMIT,
    HOLDING_BOOKING_STATUSES: ['pending', 'confirmed'],
  }
})
jest.mock('../events', () => ({ emitPropertyManagementEvent: jest.fn(async () => undefined) }))

import '../commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { canManageAllBuildings, permittedBuildingIds } from '../lib/buildingAccess'
import { filterOrganizationUsers, replaceManagers } from '../lib/managers'
import { findUnitsEverUsed } from '../lib/usageGuards'
import { emitPropertyManagementEvent } from '../events'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '70000000-0000-4000-8000-000000000001'
const FLOOR = '70000000-0000-4000-8000-000000000002'
const SPACE_A = '70000000-0000-4000-8000-000000000003'
const SPACE_B = '70000000-0000-4000-8000-000000000004'
const UNIT = '70000000-0000-4000-8000-000000000005'
const AREA = '70000000-0000-4000-8000-000000000006'
const OTHER_FLOOR = '70000000-0000-4000-8000-000000000007'
const NEW_FLOOR = '70000000-0000-4000-8000-000000000008'
const NEW_SPACE = '70000000-0000-4000-8000-000000000009'
const CATEGORY = '70000000-0000-4000-8000-000000000010'
const PRODUCT = '70000000-0000-4000-8000-000000000011'

class RecordingEm extends FakeEm {
  log: string[] = []

  async findOne(entity: EntityClass, where: Where, options?: { lockMode?: number }) {
    if (options?.lockMode !== undefined) this.log.push(`lock:${entity.name}`)
    return super.findOne(entity, where, options)
  }
}

function seed(): RecordingEm {
  const em = new RecordingEm()
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', address: 'Quay 1', status: 'active', openingHoursEnabled: false, deletedAt: null } as never)
  em.seed(Floor, { id: FLOOR, ...scope, buildingId: BUILDING, number: 0, name: 'Ground Floor', sizeX: '30.00', sizeY: '10.00', deletedAt: null } as never)
  em.seed(Space, { id: SPACE_A, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Whole floor', x: '0.00', y: '0.00', width: '30.00', depth: '10.00', isDefault: true, deletedAt: null } as never)
  return em
}

function seedUnit(em: FakeEm, values: Record<string, unknown> = {}): Unit {
  return em.seed(Unit, {
    id: UNIT,
    ...scope,
    buildingId: BUILDING,
    floorId: FLOOR,
    spaceId: SPACE_A,
    name: 'Studio 2B',
    catalogCategoryId: CATEGORY,
    catalogProductId: PRODUCT,
    x: '2.00',
    y: '2.00',
    width: '4.00',
    depth: '4.00',
    deletedAt: null,
    ...values,
  } as never) as unknown as Unit
}

function buildCtx(em: FakeEm): CommandRuntimeContext {
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

async function undo(commandId: string, em: FakeEm, payload: Record<string, unknown>): Promise<void> {
  await handler(commandId).undo?.({ logEntry: { payload: { undo: payload } } as never, ctx: buildCtx(em) } as never)
}

async function expectHttpError(promise: Promise<unknown>, status: number, code?: string): Promise<void> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(CrudHttpError)
    expect((err as CrudHttpError).status).toBe(status)
    if (code) expect((err as CrudHttpError).body).toMatchObject({ code })
    return
  }
  throw new Error('[internal] expected the command to fail')
}

function rowOf<T>(em: FakeEm, entity: EntityClass, id: string): T {
  const row = em.rows(entity).find((candidate) => candidate.id === id)
  if (!row) throw new Error(`[internal] missing ${entity.name} ${id}`)
  return row as unknown as T
}

function buildingSnapshot(values: Record<string, unknown> = {}) {
  return {
    id: BUILDING,
    ...scope,
    name: 'Harbor Point',
    address: 'Quay 1',
    status: 'active',
    archivedAt: null,
    openingHoursEnabled: false,
    managerUserIds: ['manager-a'],
    ...values,
  }
}

function sideEffectCalls(mock: jest.Mock): Array<{ action: string; id: string; event: string | null }> {
  return mock.mock.calls.map(([options]) => {
    const typed = options as { action: string; entity: { id: string }; events?: { entity?: string } }
    return { action: typed.action, id: typed.entity.id, event: typed.events?.entity ?? null }
  })
}

function denyAccess(): void {
  jest.mocked(permittedBuildingIds).mockResolvedValue([])
}

function archive(em: FakeEm): void {
  Object.assign(rowOf<Building>(em, Building, BUILDING), { status: 'archived' })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(permittedBuildingIds).mockResolvedValue(null)
  jest.mocked(canManageAllBuildings).mockResolvedValue(true)
  jest.mocked(findUnitsEverUsed).mockResolvedValue([])
})

describe('building.create undo', () => {
  it('refuses with 409 building_used when a unit of the building was ever used', async () => {
    const em = seed()
    seedUnit(em)
    jest.mocked(findUnitsEverUsed).mockResolvedValue([UNIT])
    await expectHttpError(undo('property_management.building.create', em, { after: buildingSnapshot() }), 409, 'building_used')
    expect(rowOf<Building>(em, Building, BUILDING).deletedAt).toBeNull()
    expect(rowOf<Unit>(em, Unit, UNIT).deletedAt).toBeNull()
  })

  it('takes the building lock before the usage check', async () => {
    const em = seed()
    jest.mocked(findUnitsEverUsed).mockImplementation(async () => {
      em.log.push('usage')
      return []
    })
    await undo('property_management.building.create', em, { after: buildingSnapshot() })
    expect(em.log.indexOf('lock:Building')).toBeGreaterThanOrEqual(0)
    expect(em.log.indexOf('lock:Building')).toBeLessThan(em.log.indexOf('usage'))
  })

  it('soft-deletes a never-used building and emits undo events for its children', async () => {
    const em = seed()
    await undo('property_management.building.create', em, { after: buildingSnapshot() })
    expect(rowOf<Building>(em, Building, BUILDING).deletedAt).toBeInstanceOf(Date)
    expect(rowOf<Floor>(em, Floor, FLOOR).deletedAt).toBeInstanceOf(Date)
    expect(sideEffectCalls(jest.mocked(emitCrudUndoSideEffects))).toEqual(
      expect.arrayContaining([
        { action: 'deleted', id: BUILDING, event: 'building' },
        { action: 'deleted', id: FLOOR, event: 'floor' },
        { action: 'deleted', id: SPACE_A, event: 'space' },
      ]),
    )
  })

  it('returns 404 when the actor no longer has access to the building', async () => {
    const em = seed()
    denyAccess()
    await expectHttpError(undo('property_management.building.create', em, { after: buildingSnapshot() }), 404)
    expect(rowOf<Building>(em, Building, BUILDING).deletedAt).toBeNull()
  })

  it('refuses on an archived building', async () => {
    const em = seed()
    archive(em)
    await expectHttpError(undo('property_management.building.create', em, { after: buildingSnapshot() }), 409)
    expect(rowOf<Building>(em, Building, BUILDING).deletedAt).toBeNull()
    expect(rowOf<Floor>(em, Floor, FLOOR).deletedAt).toBeNull()
  })
})

describe('building.delete', () => {
  it('runs the usage check inside the transaction after locking the building', async () => {
    const em = seed()
    jest.mocked(findUnitsEverUsed).mockImplementation(async () => {
      em.log.push('usage')
      return [UNIT]
    })
    await expectHttpError(handler('property_management.building.delete').execute({ ...scope, id: BUILDING }, buildCtx(em)), 409, 'building_used')
    expect(em.log.indexOf('lock:Building')).toBeGreaterThanOrEqual(0)
    expect(em.log.indexOf('lock:Building')).toBeLessThan(em.log.indexOf('usage'))
    expect(rowOf<Building>(em, Building, BUILDING).deletedAt).toBeNull()
  })

  it('emits deleted events for the children it removes', async () => {
    const em = seed()
    seedUnit(em)
    await handler('property_management.building.delete').execute({ ...scope, id: BUILDING }, buildCtx(em))
    expect(sideEffectCalls(jest.mocked(emitCrudSideEffects))).toEqual(
      expect.arrayContaining([
        { action: 'deleted', id: FLOOR, event: 'floor' },
        { action: 'deleted', id: SPACE_A, event: 'space' },
        { action: 'deleted', id: UNIT, event: 'unit' },
      ]),
    )
  })

  it('undo restores the tree and re-indexes the restored children', async () => {
    const em = seed()
    seedUnit(em)
    em.seed(ProductUse, { id: 'use-1', ...scope, catalogProductId: PRODUCT, use: 'leasable', billingUnit: 'month' } as never)
    em.seed(CommonArea, { id: AREA, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Lobby', kind: 'lobby', x: '20.00', y: '0.00', width: '4.00', depth: '4.00', deletedAt: null } as never)
    const result = await handler('property_management.building.delete').execute({ ...scope, id: BUILDING }, buildCtx(em)) as { deleted: unknown }
    jest.clearAllMocks()
    jest.mocked(permittedBuildingIds).mockResolvedValue(null)
    await undo('property_management.building.delete', em, { before: buildingSnapshot(), deleted: result.deleted })
    expect(rowOf<Building>(em, Building, BUILDING).deletedAt).toBeNull()
    expect(rowOf<Unit>(em, Unit, UNIT).deletedAt).toBeNull()
    expect(sideEffectCalls(jest.mocked(emitCrudUndoSideEffects))).toEqual(
      expect.arrayContaining([
        { action: 'created', id: BUILDING, event: 'building' },
        { action: 'created', id: FLOOR, event: 'floor' },
        { action: 'created', id: SPACE_A, event: 'space' },
        { action: 'created', id: UNIT, event: 'unit' },
        { action: 'created', id: AREA, event: 'common_area' },
      ]),
    )
  })

  it('undo refuses with 409 unit_undo_product_unavailable when a revived unit\'s product lost its use, after locking the building', async () => {
    const em = seed()
    seedUnit(em)
    const result = await handler('property_management.building.delete').execute({ ...scope, id: BUILDING }, buildCtx(em)) as { deleted: unknown }
    em.log = []
    await expectHttpError(
      undo('property_management.building.delete', em, { before: buildingSnapshot(), deleted: result.deleted }),
      409,
      'unit_undo_product_unavailable',
    )
    expect(em.log.indexOf('lock:Building')).toBeLessThan(em.log.indexOf('lock:ProductUse'))
    expect(rowOf<Building>(em, Building, BUILDING).deletedAt).toBeInstanceOf(Date)
    expect(rowOf<Unit>(em, Unit, UNIT).deletedAt).toBeInstanceOf(Date)
  })

  it('undo returns 404 when the actor no longer has access', async () => {
    const em = seed()
    Object.assign(rowOf<Building>(em, Building, BUILDING), { deletedAt: new Date() })
    denyAccess()
    await expectHttpError(undo('property_management.building.delete', em, { before: buildingSnapshot(), deleted: null }), 404)
    expect(rowOf<Building>(em, Building, BUILDING).deletedAt).toBeInstanceOf(Date)
  })
})

describe('building snapshots', () => {
  it('reads the snapshot only inside the command scope', async () => {
    const em = seed()
    const prepare = handler('property_management.building.update').prepare
    const foreign = await prepare?.({ id: BUILDING, tenantId: TENANT, organizationId: '33333333-3333-4333-8333-333333333333' } as never, buildCtx(em))
    expect(foreign).toEqual({})
    const own = await prepare?.({ id: BUILDING, ...scope } as never, buildCtx(em))
    expect(own).toMatchObject({ before: { id: BUILDING, organizationId: ORG } })
  })
})

const ANNEX_LAYOUT = { below: 0, above: 1, floors: [{ number: 0, name: 'Ground Floor', sizeX: 20, sizeY: 10 }] }

describe('building.create manager self-assignment', () => {
  it('refuses with 403 when a manager without manage_all creates a building outside their own organization', async () => {
    const em = seed()
    jest.mocked(canManageAllBuildings).mockResolvedValue(false)
    jest.mocked(filterOrganizationUsers).mockResolvedValueOnce([])
    await expectHttpError(
      handler('property_management.building.create').execute({ ...scope, name: 'Annex', address: 'Quay 2', layout: ANNEX_LAYOUT }, buildCtx(em)),
      403,
    )
    expect(em.rows(Building)).toHaveLength(1)
    expect(replaceManagers).not.toHaveBeenCalled()
  })

  it('assigns the creating manager when they belong to the organization', async () => {
    const em = seed()
    jest.mocked(canManageAllBuildings).mockResolvedValue(false)
    await handler('property_management.building.create').execute({ ...scope, name: 'Annex', address: 'Quay 2', layout: ANNEX_LAYOUT }, buildCtx(em))
    expect(filterOrganizationUsers).toHaveBeenCalledWith(em, scope, ['user-1'])
    expect(replaceManagers).toHaveBeenCalledWith(em, scope, expect.any(String), ['user-1'])
  })
})

describe('building.archive', () => {
  it('archives the building and emits building.archived with trusted scope as a persistent event', async () => {
    const em = seed()
    await handler('property_management.building.archive').execute({ ...scope, id: BUILDING }, buildCtx(em))
    expect(rowOf<Building>(em, Building, BUILDING).status).toBe('archived')
    expect(emitPropertyManagementEvent).toHaveBeenCalledWith(
      'property_management.building.archived',
      { id: BUILDING, ...scope },
      { persistent: true, ...scope },
    )
  })
})

describe('building.update undo', () => {
  const renamed = () => Object.assign(rowOf<Building>(seedEm, Building, BUILDING), { name: 'Renamed' })
  let seedEm: RecordingEm

  beforeEach(() => {
    seedEm = seed()
    renamed()
  })

  it('restores the managers when the update changed them and the actor manages all buildings', async () => {
    await undo('property_management.building.update', seedEm, {
      before: buildingSnapshot(),
      after: buildingSnapshot({ name: 'Renamed', managerUserIds: ['manager-b'] }),
    })
    expect(replaceManagers).toHaveBeenCalledWith(expect.anything(), scope, BUILDING, ['manager-a'])
    expect(rowOf<Building>(seedEm, Building, BUILDING).name).toBe('Harbor Point')
  })

  it('leaves the managers alone when the update did not change them', async () => {
    await undo('property_management.building.update', seedEm, {
      before: buildingSnapshot(),
      after: buildingSnapshot({ name: 'Renamed' }),
    })
    expect(replaceManagers).not.toHaveBeenCalled()
    expect(rowOf<Building>(seedEm, Building, BUILDING).name).toBe('Harbor Point')
  })

  it('leaves the managers alone when the actor cannot manage all buildings', async () => {
    jest.mocked(canManageAllBuildings).mockResolvedValue(false)
    jest.mocked(permittedBuildingIds).mockResolvedValue([BUILDING])
    await undo('property_management.building.update', seedEm, {
      before: buildingSnapshot(),
      after: buildingSnapshot({ name: 'Renamed', managerUserIds: ['manager-b'] }),
    })
    expect(replaceManagers).not.toHaveBeenCalled()
    expect(rowOf<Building>(seedEm, Building, BUILDING).name).toBe('Harbor Point')
  })

  it('returns 404 for a manager who lost access to the building', async () => {
    jest.mocked(canManageAllBuildings).mockResolvedValue(false)
    denyAccess()
    await expectHttpError(
      undo('property_management.building.update', seedEm, {
        before: buildingSnapshot({ managerUserIds: ['user-1'] }),
        after: buildingSnapshot({ name: 'Renamed', managerUserIds: [] }),
      }),
      404,
    )
    expect(replaceManagers).not.toHaveBeenCalled()
    expect(rowOf<Building>(seedEm, Building, BUILDING).name).toBe('Renamed')
  })

  it('refuses on an archived building', async () => {
    archive(seedEm)
    await expectHttpError(undo('property_management.building.update', seedEm, { before: buildingSnapshot(), after: buildingSnapshot({ name: 'Renamed' }) }), 409)
    expect(rowOf<Building>(seedEm, Building, BUILDING).name).toBe('Renamed')
  })

  it('restores only the managers that are still users of the organization', async () => {
    jest.mocked(filterOrganizationUsers).mockResolvedValueOnce(['manager-a'])
    await undo('property_management.building.update', seedEm, {
      before: buildingSnapshot({ managerUserIds: ['manager-a', 'manager-gone'] }),
      after: buildingSnapshot({ name: 'Renamed', managerUserIds: ['manager-b'] }),
    })
    expect(filterOrganizationUsers).toHaveBeenCalledWith(expect.anything(), scope, ['manager-a', 'manager-gone'])
    expect(replaceManagers).toHaveBeenCalledWith(expect.anything(), scope, BUILDING, ['manager-a'])
  })

  describe('opening hours and fields the update did not change', () => {
    const morning = [{ weekday: 0, opensAt: '08:00', closesAt: '16:00' }]
    const evening = [{ weekday: 0, opensAt: '12:00', closesAt: '20:00' }]
    const newer = { weekday: 0, opensAt: '10:00:00', closesAt: '18:00:00' }

    beforeEach(() => {
      Object.assign(rowOf<Building>(seedEm, Building, BUILDING), { openingHoursEnabled: true, address: 'Quay 9' })
      seedEm.seed(OpeningHours, { id: 'hours-newer', ...scope, buildingId: BUILDING, ...newer } as never)
    })

    it('leaves newer hours, the switch and the address alone when undoing a rename', async () => {
      await undo('property_management.building.update', seedEm, {
        before: buildingSnapshot({ openingHoursEnabled: false, openingHours: morning }),
        after: buildingSnapshot({ name: 'Renamed', openingHoursEnabled: false, openingHours: morning }),
      })
      const building = rowOf<Building>(seedEm, Building, BUILDING)
      expect(building).toMatchObject({ name: 'Harbor Point', address: 'Quay 9', openingHoursEnabled: true })
      expect(seedEm.rows(OpeningHours)).toEqual([expect.objectContaining({ id: 'hours-newer', ...newer })])
    })

    it('restores the hours and the switch when the update changed them', async () => {
      await undo('property_management.building.update', seedEm, {
        before: buildingSnapshot({ name: 'Renamed', openingHoursEnabled: false, openingHours: morning }),
        after: buildingSnapshot({ name: 'Renamed', openingHoursEnabled: true, openingHours: evening }),
      })
      expect(rowOf<Building>(seedEm, Building, BUILDING).openingHoursEnabled).toBe(false)
      expect(seedEm.rows(OpeningHours)).toEqual([expect.objectContaining({ weekday: 0, opensAt: '08:00:00', closesAt: '16:00:00' })])
    })
  })
})

function floorResizeLayout() {
  return {
    buildingId: BUILDING,
    updatedFloors: [{ id: FLOOR, number: 0, name: 'Ground Floor', sizeX: '20.00', sizeY: '10.00' }],
    resizedSpaces: [{ id: SPACE_A, before: { x: '0.00', y: '0.00', width: '20.00', depth: '10.00' } }],
    createdFloorIds: [],
    createdSpaceIds: [],
    removedFloorIds: [],
    removedSpaceIds: [],
    removedCommonAreaIds: [],
  }
}

describe('floor.update undo', () => {
  const payload = () => ({ before: floorResizeLayout().updatedFloors[0], layout: floorResizeLayout(), scope })

  it('refuses when shrinking back would leave a unit added since outside the floor', async () => {
    const em = seed()
    seedUnit(em, { x: '24.00' })
    await expectHttpError(undo('property_management.floor.update', em, payload()), 422, 'floor_resize_strands')
    expect(rowOf<Floor>(em, Floor, FLOOR).sizeX).toBe('30.00')
    expect(rowOf<Space>(em, Space, SPACE_A).width).toBe('30.00')
  })

  it('refuses when shrinking back would leave a common area added since outside the floor', async () => {
    const em = seed()
    em.seed(CommonArea, { id: AREA, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Lobby', kind: 'lobby', x: '22.00', y: '0.00', width: '4.00', depth: '4.00', deletedAt: null } as never)
    await expectHttpError(undo('property_management.floor.update', em, payload()), 422, 'floor_resize_strands')
  })

  it('restores the size of the floor and its whole-floor space when everything fits', async () => {
    const em = seed()
    seedUnit(em)
    await undo('property_management.floor.update', em, payload())
    expect(rowOf<Floor>(em, Floor, FLOOR).sizeX).toBe('20.00')
    expect(rowOf<Space>(em, Space, SPACE_A).width).toBe('20.00')
    expect(sideEffectCalls(jest.mocked(emitCrudUndoSideEffects))).toEqual(
      expect.arrayContaining([
        { action: 'updated', id: FLOOR, event: 'floor' },
        { action: 'updated', id: SPACE_A, event: 'space' },
      ]),
    )
  })

  it('takes the floor lock under the building lock', async () => {
    const em = seed()
    await undo('property_management.floor.update', em, payload())
    expect(em.log[0]).toBe('lock:Building')
  })

  it('refuses on an archived building', async () => {
    const em = seed()
    archive(em)
    await expectHttpError(undo('property_management.floor.update', em, payload()), 409)
    expect(rowOf<Floor>(em, Floor, FLOOR).sizeX).toBe('30.00')
  })

  it('returns 404 when the actor no longer has access', async () => {
    const em = seed()
    denyAccess()
    await expectHttpError(undo('property_management.floor.update', em, payload()), 404)
    expect(rowOf<Floor>(em, Floor, FLOOR).sizeX).toBe('30.00')
  })
})

describe('floor.layout_replace', () => {
  it('indexes the spaces and common areas it creates, resizes and removes', async () => {
    const em = seed()
    em.seed(Floor, { id: OTHER_FLOOR, ...scope, buildingId: BUILDING, number: 1, name: 'First Floor', sizeX: '30.00', sizeY: '10.00', deletedAt: null } as never)
    em.seed(Space, { id: SPACE_B, ...scope, buildingId: BUILDING, floorId: OTHER_FLOOR, name: 'Upstairs', x: '0.00', y: '0.00', width: '30.00', depth: '10.00', isDefault: true, deletedAt: null } as never)
    em.seed(CommonArea, { id: AREA, ...scope, buildingId: BUILDING, floorId: OTHER_FLOOR, name: 'Stairs', kind: 'stairs', x: '0.00', y: '0.00', width: '2.00', depth: '2.00', deletedAt: null } as never)
    await handler('property_management.floor.layout_replace').execute({
      ...scope,
      buildingId: BUILDING,
      layout: {
        below: 1,
        above: 1,
        floors: [
          { number: -1, name: 'Basement', sizeX: 30, sizeY: 10 },
          { number: 0, name: 'Ground Floor', sizeX: 20, sizeY: 10 },
        ],
      },
    }, buildCtx(em))
    const created = (em.rows(Floor) as unknown as Floor[]).find((floor) => floor.number === -1) as Floor
    const createdSpace = (em.rows(Space) as unknown as Space[]).find((space) => space.floorId === created.id) as Space
    expect(sideEffectCalls(jest.mocked(emitCrudSideEffects))).toEqual(
      expect.arrayContaining([
        { action: 'created', id: created.id, event: 'floor' },
        { action: 'created', id: createdSpace.id, event: 'space' },
        { action: 'updated', id: FLOOR, event: 'floor' },
        { action: 'updated', id: SPACE_A, event: 'space' },
        { action: 'deleted', id: OTHER_FLOOR, event: 'floor' },
        { action: 'deleted', id: SPACE_B, event: 'space' },
        { action: 'deleted', id: AREA, event: 'common_area' },
      ]),
    )
  })
})

describe('floor.layout_replace undo', () => {
  function layoutChange() {
    return {
      buildingId: BUILDING,
      updatedFloors: [],
      resizedSpaces: [],
      createdFloorIds: [NEW_FLOOR],
      createdSpaceIds: [NEW_SPACE],
      removedFloorIds: [OTHER_FLOOR],
      removedSpaceIds: [],
      removedCommonAreaIds: [],
    }
  }

  function seedLayout(em: FakeEm): void {
    em.seed(Floor, { id: OTHER_FLOOR, ...scope, buildingId: BUILDING, number: 1, name: 'First Floor', sizeX: '30.00', sizeY: '10.00', deletedAt: new Date('2026-11-01T00:00:00Z') } as never)
    em.seed(Floor, { id: NEW_FLOOR, ...scope, buildingId: BUILDING, number: -1, name: 'Basement', sizeX: '30.00', sizeY: '10.00', deletedAt: null } as never)
    em.seed(Space, { id: NEW_SPACE, ...scope, buildingId: BUILDING, floorId: NEW_FLOOR, name: 'Whole floor', x: '0.00', y: '0.00', width: '30.00', depth: '10.00', isDefault: true, deletedAt: null } as never)
  }

  it('removes the created floor, restores the removed one and re-indexes both', async () => {
    const em = seed()
    seedLayout(em)
    await undo('property_management.floor.layout_replace', em, { layout: layoutChange(), scope })
    expect(rowOf<Floor>(em, Floor, NEW_FLOOR).deletedAt).toBeInstanceOf(Date)
    expect(rowOf<Space>(em, Space, NEW_SPACE).deletedAt).toBeInstanceOf(Date)
    expect(rowOf<Floor>(em, Floor, OTHER_FLOOR).deletedAt).toBeNull()
    expect(sideEffectCalls(jest.mocked(emitCrudUndoSideEffects))).toEqual(
      expect.arrayContaining([
        { action: 'deleted', id: NEW_FLOOR, event: 'floor' },
        { action: 'deleted', id: NEW_SPACE, event: 'space' },
        { action: 'created', id: OTHER_FLOOR, event: 'floor' },
      ]),
    )
  })

  it('refuses when a floor with the number of a removed floor was added since', async () => {
    const em = seed()
    seedLayout(em)
    em.seed(Floor, { id: '70000000-0000-4000-8000-000000000099', ...scope, buildingId: BUILDING, number: 1, name: 'New first', sizeX: '30.00', sizeY: '10.00', deletedAt: null } as never)
    await expectHttpError(undo('property_management.floor.layout_replace', em, { layout: layoutChange(), scope }), 409, 'floor_undo_number_taken')
    expect(rowOf<Floor>(em, Floor, NEW_FLOOR).deletedAt).toBeNull()
  })

  it('refuses with 409 floor_undo_not_contiguous when an older change would leave a gap in the floor numbers', async () => {
    const em = seed()
    em.seed(Floor, { id: OTHER_FLOOR, ...scope, buildingId: BUILDING, number: 1, name: 'First Floor', sizeX: '30.00', sizeY: '10.00', deletedAt: new Date('2026-11-02T00:00:00Z') } as never)
    em.seed(Floor, { id: NEW_FLOOR, ...scope, buildingId: BUILDING, number: 2, name: 'Second Floor', sizeX: '30.00', sizeY: '10.00', deletedAt: new Date('2026-11-01T00:00:00Z') } as never)
    const olderChange = { ...layoutChange(), createdFloorIds: [], createdSpaceIds: [], removedFloorIds: [NEW_FLOOR] }
    await expectHttpError(undo('property_management.floor.layout_replace', em, { layout: olderChange, scope }), 409, 'floor_undo_not_contiguous')
    expect(rowOf<Floor>(em, Floor, NEW_FLOOR).deletedAt).toBeInstanceOf(Date)
  })

  it('undoes an older change once the floor numbers stay contiguous', async () => {
    const em = seed()
    em.seed(Floor, { id: OTHER_FLOOR, ...scope, buildingId: BUILDING, number: 1, name: 'First Floor', sizeX: '30.00', sizeY: '10.00', deletedAt: null } as never)
    em.seed(Floor, { id: NEW_FLOOR, ...scope, buildingId: BUILDING, number: 2, name: 'Second Floor', sizeX: '30.00', sizeY: '10.00', deletedAt: new Date('2026-11-01T00:00:00Z') } as never)
    const olderChange = { ...layoutChange(), createdFloorIds: [], createdSpaceIds: [], removedFloorIds: [NEW_FLOOR] }
    await undo('property_management.floor.layout_replace', em, { layout: olderChange, scope })
    expect(rowOf<Floor>(em, Floor, NEW_FLOOR).deletedAt).toBeNull()
  })

  it('refuses when units were added to a created floor', async () => {
    const em = seed()
    seedLayout(em)
    seedUnit(em, { floorId: NEW_FLOOR, spaceId: NEW_SPACE })
    await expectHttpError(undo('property_management.floor.layout_replace', em, { layout: layoutChange(), scope }), 409)
    expect(rowOf<Floor>(em, Floor, NEW_FLOOR).deletedAt).toBeNull()
  })

  it('refuses with 409 floor_undo_floors_have_spaces when a space was added to a created floor since', async () => {
    const em = seed()
    seedLayout(em)
    const added = '70000000-0000-4000-8000-000000000098'
    em.seed(Space, { id: added, ...scope, buildingId: BUILDING, floorId: NEW_FLOOR, name: 'Meeting room', x: '0.00', y: '0.00', width: '5.00', depth: '5.00', isDefault: false, deletedAt: null } as never)
    await expectHttpError(undo('property_management.floor.layout_replace', em, { layout: layoutChange(), scope }), 409, 'floor_undo_floors_have_spaces')
    expect(rowOf<Floor>(em, Floor, NEW_FLOOR).deletedAt).toBeNull()
    expect(rowOf<Space>(em, Space, added).deletedAt).toBeNull()
  })

  it('refuses with 409 floor_undo_floors_have_spaces when a common area was added to a created floor since', async () => {
    const em = seed()
    seedLayout(em)
    em.seed(CommonArea, { id: AREA, ...scope, buildingId: BUILDING, floorId: NEW_FLOOR, name: 'Stairs', kind: 'stairs', x: '0.00', y: '0.00', width: '2.00', depth: '2.00', deletedAt: null } as never)
    await expectHttpError(undo('property_management.floor.layout_replace', em, { layout: layoutChange(), scope }), 409, 'floor_undo_floors_have_spaces')
    expect(rowOf<CommonArea>(em, CommonArea, AREA).deletedAt).toBeNull()
  })

  it('refuses on an archived building', async () => {
    const em = seed()
    seedLayout(em)
    archive(em)
    await expectHttpError(undo('property_management.floor.layout_replace', em, { layout: layoutChange(), scope }), 409)
  })
})

function spaceSnapshot(values: Record<string, unknown> = {}) {
  return {
    id: SPACE_B,
    ...scope,
    buildingId: BUILDING,
    floorId: FLOOR,
    name: 'Meeting zone',
    purpose: null,
    x: '0.00',
    y: '0.00',
    width: '5.00',
    depth: '5.00',
    isDefault: false,
    ...values,
  }
}

describe('space undo', () => {
  function seedSpaces(): RecordingEm {
    const em = seed()
    Object.assign(rowOf<Space>(em, Space, SPACE_A), { isDefault: false, x: '10.00', width: '20.00' })
    em.seed(Space, { ...spaceSnapshot({ width: '8.00' }), deletedAt: null } as never)
    return em
  }

  it('locks the building before the floor', async () => {
    const em = seedSpaces()
    await undo('property_management.space.update', em, { before: spaceSnapshot(), after: spaceSnapshot({ width: '8.00' }) })
    expect(em.log.slice(0, 2)).toEqual(['lock:Building', 'lock:Floor'])
    expect(rowOf<Space>(em, Space, SPACE_B).width).toBe('5.00')
  })

  it('refuses on an archived building', async () => {
    const em = seedSpaces()
    archive(em)
    await expectHttpError(undo('property_management.space.update', em, { before: spaceSnapshot(), after: spaceSnapshot({ width: '8.00' }) }), 409)
    expect(rowOf<Space>(em, Space, SPACE_B).width).toBe('8.00')
  })

  it('returns 404 when the actor no longer has access', async () => {
    const em = seedSpaces()
    denyAccess()
    await expectHttpError(undo('property_management.space.create', em, { after: spaceSnapshot() }), 404)
    expect(rowOf<Space>(em, Space, SPACE_B).deletedAt).toBeNull()
  })

  it('create undo locks the building before the floor', async () => {
    const em = seedSpaces()
    await undo('property_management.space.create', em, { after: spaceSnapshot() })
    expect(em.log.slice(0, 2)).toEqual(['lock:Building', 'lock:Floor'])
    expect(rowOf<Space>(em, Space, SPACE_B).deletedAt).toBeInstanceOf(Date)
  })
})

function areaSnapshot() {
  return { id: AREA, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Lobby', kind: 'lobby', x: '20.00', y: '0.00', width: '4.00', depth: '4.00' }
}

describe('common_area undo', () => {
  function seedArea(): RecordingEm {
    const em = seed()
    em.seed(CommonArea, { ...areaSnapshot(), deletedAt: null } as never)
    return em
  }

  it('create undo locks building then floor before removing the area', async () => {
    const em = seedArea()
    await undo('property_management.common_area.create', em, { after: areaSnapshot() })
    expect(em.log.slice(0, 2)).toEqual(['lock:Building', 'lock:Floor'])
    expect(rowOf<CommonArea>(em, CommonArea, AREA).deletedAt).toBeInstanceOf(Date)
  })

  it('create undo refuses on an archived building', async () => {
    const em = seedArea()
    archive(em)
    await expectHttpError(undo('property_management.common_area.create', em, { after: areaSnapshot() }), 409)
    expect(rowOf<CommonArea>(em, CommonArea, AREA).deletedAt).toBeNull()
  })

  it('delete undo returns 404 when the actor no longer has access', async () => {
    const em = seedArea()
    Object.assign(rowOf<CommonArea>(em, CommonArea, AREA), { deletedAt: new Date() })
    denyAccess()
    await expectHttpError(undo('property_management.common_area.delete', em, { before: areaSnapshot() }), 404)
    expect(rowOf<CommonArea>(em, CommonArea, AREA).deletedAt).toBeInstanceOf(Date)
  })

  it('update undo locks the building before the floor', async () => {
    const em = seedArea()
    Object.assign(rowOf<CommonArea>(em, CommonArea, AREA), { name: 'Hall' })
    await undo('property_management.common_area.update', em, { before: areaSnapshot() })
    expect(em.log.slice(0, 2)).toEqual(['lock:Building', 'lock:Floor'])
    expect(rowOf<CommonArea>(em, CommonArea, AREA).name).toBe('Lobby')
  })
})

function unitSnapshot(values: Record<string, unknown> = {}) {
  return {
    id: UNIT,
    ...scope,
    buildingId: BUILDING,
    floorId: FLOOR,
    spaceId: SPACE_B,
    name: 'Studio 2B',
    catalogCategoryId: CATEGORY,
    catalogProductId: PRODUCT,
    x: '1.00',
    y: '1.00',
    width: '2.00',
    depth: '2.00',
    ...values,
  }
}

describe('unit undo', () => {
  function seedMovedUnit(): RecordingEm {
    const em = seed()
    Object.assign(rowOf<Space>(em, Space, SPACE_A), { isDefault: false, x: '10.00', width: '20.00' })
    em.seed(Space, { ...spaceSnapshot(), deletedAt: null } as never)
    seedUnit(em, { spaceId: SPACE_A, x: '12.00', y: '1.00', width: '2.00', depth: '2.00' })
    em.seed(Booking, {
      id: 'booking-1',
      ...scope,
      unitId: UNIT,
      productName: 'Meeting room',
      status: 'confirmed',
      startsAt: '2099-01-05T10:00:00',
      endsAt: '2099-01-05T11:00:00',
      deletedAt: null,
    } as never)
    return em
  }

  it('update undo refuses to move the unit back into a closed space while its bookings fall in the closure', async () => {
    const em = seedMovedUnit()
    em.seed(Unavailability, {
      id: 'closure-1',
      ...scope,
      buildingId: BUILDING,
      subjectType: 'space',
      subjectId: SPACE_B,
      reasonEntryId: null,
      reasonText: 'Renovation',
      startsAt: '2099-01-01T00:00:00',
      endsAt: null,
      endedAt: null,
      deletedAt: null,
    } as never)
    await expectHttpError(
      undo('property_management.unit.update', em, { before: unitSnapshot(), after: unitSnapshot({ spaceId: SPACE_A, x: '12.00' }) }),
      409,
      'unit_move_destination_unavailable',
    )
    expect(rowOf<Unit>(em, Unit, UNIT).spaceId).toBe(SPACE_A)
  })

  it('update undo moves the unit back when the original space is open', async () => {
    const em = seedMovedUnit()
    await undo('property_management.unit.update', em, { before: unitSnapshot(), after: unitSnapshot({ spaceId: SPACE_A, x: '12.00' }) })
    expect(rowOf<Unit>(em, Unit, UNIT).spaceId).toBe(SPACE_B)
  })

  it('delete undo returns 404 when the actor no longer has access', async () => {
    const em = seed()
    seedUnit(em, { deletedAt: new Date() })
    denyAccess()
    await expectHttpError(undo('property_management.unit.delete', em, { before: unitSnapshot({ spaceId: SPACE_A }) }), 404)
    expect(rowOf<Unit>(em, Unit, UNIT).deletedAt).toBeInstanceOf(Date)
  })

  it('create undo returns 404 when the actor no longer has access', async () => {
    const em = seed()
    seedUnit(em)
    denyAccess()
    await expectHttpError(undo('property_management.unit.create', em, { after: unitSnapshot({ spaceId: SPACE_A }) }), 404)
    expect(rowOf<Unit>(em, Unit, UNIT).deletedAt).toBeNull()
  })
})
