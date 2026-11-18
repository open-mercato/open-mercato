/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Floor } from '../data/entities'
import { TransactionalFakeEm } from './support/customFieldStore'

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
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const LAYOUT = {
  below: 0,
  above: 2,
  floors: [
    { number: 0, name: 'Ground Floor', sizeX: 20, sizeY: 10 },
    { number: 1, name: 'First Floor', sizeX: 20, sizeY: 10 },
  ],
}

type EmitOptions = {
  action: string
  entity: { id: string }
  identifiers: { id: string; organizationId: string; tenantId: string }
  events?: { entity: string; buildPayload?: (ctx: unknown) => unknown }
}

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

function updatedPayloads(entity: 'building' | 'floor'): Array<Record<string, unknown>> {
  return jest
    .mocked(emitCrudSideEffects)
    .mock.calls.map(([options]) => options as unknown as EmitOptions)
    .filter((options) => options.action === 'updated' && options.events?.entity === entity)
    .map((options) => options.events?.buildPayload?.({ identifiers: options.identifiers }) as Record<string, unknown>)
}

async function createBuilding(em: TransactionalFakeEm): Promise<{ buildingId: string; floors: Map<number, Floor> }> {
  const ctx = buildCtx(em)
  const created = (await handler('property_management.building.create').execute({ ...scope, name: 'Annex', address: 'Quay 2', layout: LAYOUT }, ctx)) as {
    buildingId: string
  }
  const floors = new Map((em.rows(Floor) as unknown as Floor[]).map((floor) => [floor.number, floor]))
  jest.mocked(emitCrudSideEffects).mockClear()
  return { buildingId: created.buildingId, floors }
}

function layoutWith(overrides: Record<number, Partial<{ name: string; sizeX: number }>>) {
  return { ...LAYOUT, floors: LAYOUT.floors.map((floor) => ({ ...floor, ...(overrides[floor.number] ?? {}) })) }
}

beforeEach(() => jest.mocked(emitCrudSideEffects).mockClear())

describe('building.updated nameChanged', () => {
  it('is false when only the address changes', async () => {
    const em = new TransactionalFakeEm()
    const { buildingId } = await createBuilding(em)
    await handler('property_management.building.update').execute({ ...scope, id: buildingId, name: 'Annex', address: 'Quay 3' }, buildCtx(em))
    expect(updatedPayloads('building')).toEqual([expect.objectContaining({ id: buildingId, nameChanged: false })])
  })

  it('is true on a rename, and the renamed floors of the same save do not ask for a second unit reindex', async () => {
    const em = new TransactionalFakeEm()
    const { buildingId, floors } = await createBuilding(em)
    await handler('property_management.building.update').execute(
      { ...scope, id: buildingId, name: 'Annex West', layout: layoutWith({ 1: { name: 'Mezzanine' } }) },
      buildCtx(em),
    )
    expect(updatedPayloads('building')).toEqual([expect.objectContaining({ nameChanged: true })])
    expect(updatedPayloads('floor')).toEqual([expect.objectContaining({ id: floors.get(1)?.id, nameChanged: false })])
  })

  it('marks only the floors renamed by a layout save of an unchanged building name', async () => {
    const em = new TransactionalFakeEm()
    const { buildingId, floors } = await createBuilding(em)
    await handler('property_management.building.update').execute(
      { ...scope, id: buildingId, name: 'Annex', layout: layoutWith({ 0: { sizeX: 25 }, 1: { name: 'Mezzanine' } }) },
      buildCtx(em),
    )
    expect(updatedPayloads('building')).toEqual([expect.objectContaining({ nameChanged: false })])
    const byId = new Map(updatedPayloads('floor').map((payload) => [payload.id, payload.nameChanged]))
    expect(byId.get(floors.get(0)?.id)).toBe(false)
    expect(byId.get(floors.get(1)?.id)).toBe(true)
  })
})

describe('floor.updated nameChanged', () => {
  it('reports the renamed floors of a layout replace', async () => {
    const em = new TransactionalFakeEm()
    const { buildingId, floors } = await createBuilding(em)
    await handler('property_management.floor.layout_replace').execute(
      { ...scope, buildingId, layout: layoutWith({ 0: { name: 'Lobby' }, 1: { sizeX: 25 } }) },
      buildCtx(em),
    )
    expect(updatedPayloads('building')).toEqual([])
    const byId = new Map(updatedPayloads('floor').map((payload) => [payload.id, payload.nameChanged]))
    expect(byId.get(floors.get(0)?.id)).toBe(true)
    expect(byId.get(floors.get(1)?.id)).toBe(false)
  })

  it('is true when floor.update renames the floor and false when it only resizes it', async () => {
    const em = new TransactionalFakeEm()
    const { floors } = await createBuilding(em)
    const floorId = floors.get(1)?.id as string
    await handler('property_management.floor.update').execute({ ...scope, id: floorId, name: 'Mezzanine' }, buildCtx(em))
    expect(updatedPayloads('floor')).toEqual([expect.objectContaining({ id: floorId, nameChanged: true })])
    jest.mocked(emitCrudSideEffects).mockClear()
    await handler('property_management.floor.update').execute({ ...scope, id: floorId, sizeX: 25, sizeY: 10 }, buildCtx(em))
    expect(updatedPayloads('floor')).toEqual([expect.objectContaining({ id: floorId, nameChanged: false })])
  })
})
