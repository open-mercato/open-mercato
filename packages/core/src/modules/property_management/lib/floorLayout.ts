import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CommonArea, Floor, Space, Unit, type Building } from '../data/entities'
import type { FloorLayoutInput } from '../data/validators'
import { floorRect, fitsInside, sameRect, toRect, type Rect } from './geometry'
import { minimumCounts } from './floorNumbering'
import type { Scope } from './productUse'

export type RectSnapshot = { x: string; y: string; width: string; depth: string }

export type FloorSnapshot = { id: string; number: number; name: string; sizeX: string; sizeY: string }

export type LayoutChangeSnapshot = {
  buildingId: string
  updatedFloors: FloorSnapshot[]
  resizedSpaces: Array<{ id: string; before: RectSnapshot }>
  createdFloorIds: string[]
  createdSpaceIds: string[]
  removedFloorIds: string[]
  removedSpaceIds: string[]
  removedCommonAreaIds: string[]
}

export type LayoutChangeResult = {
  snapshot: LayoutChangeSnapshot
  createdFloors: Floor[]
  updatedFloors: Floor[]
  removedFloors: Floor[]
}

function metres(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

export function snapshotFloor(floor: Floor): FloorSnapshot {
  return { id: floor.id, number: floor.number, name: floor.name, sizeX: floor.sizeX, sizeY: floor.sizeY }
}

export function emptyLayoutSnapshot(buildingId: string): LayoutChangeSnapshot {
  return {
    buildingId,
    updatedFloors: [],
    resizedSpaces: [],
    createdFloorIds: [],
    createdSpaceIds: [],
    removedFloorIds: [],
    removedSpaceIds: [],
    removedCommonAreaIds: [],
  }
}

export type FloorResizePlan = {
  outside: string[]
  defaultSpace: Space | null
}

export function planFloorResize(
  current: Rect,
  next: Rect,
  spaces: readonly Space[],
  units: readonly Unit[],
  commonAreas: readonly CommonArea[],
): FloorResizePlan {
  const coveringDefault = spaces.find((space) => space.isDefault && sameRect(toRect(space), current)) ?? null
  const spaceRects = new Map<string, Rect>()
  for (const space of spaces) {
    spaceRects.set(space.id, coveringDefault && space.id === coveringDefault.id ? next : toRect(space))
  }
  const outside: string[] = []
  for (const space of spaces) {
    const rect = spaceRects.get(space.id)
    if (rect && !fitsInside(rect, next)) outside.push(space.name)
  }
  for (const area of commonAreas) {
    if (!fitsInside(toRect(area), next)) outside.push(area.name)
  }
  for (const unit of units) {
    const container = spaceRects.get(unit.spaceId)
    const rect = toRect(unit)
    if (!fitsInside(rect, next) || (container && !fitsInside(rect, container))) outside.push(unit.name)
  }
  return { outside, defaultSpace: coveringDefault }
}

async function refuseResize(floorName: string, names: string[]): Promise<never> {
  const { translate } = await resolveTranslations()
  const message = translate(
    'property_management.errors.floorResizeStrands',
    'Resizing {floor} would leave {names} outside it.',
    { floor: floorName, names: names.join(', ') },
  )
  throw new CrudHttpError(422, { error: message, code: 'floor_resize_strands', names, fieldErrors: { sizeX: message } })
}

export async function resizeFloor(
  em: EntityManager,
  scope: Scope,
  floor: Floor,
  sizeX: number,
  sizeY: number,
  snapshot: LayoutChangeSnapshot,
): Promise<boolean> {
  const current = floorRect(floor.sizeX, floor.sizeY)
  const next = floorRect(sizeX, sizeY)
  if (sameRect(current, next)) return false
  const [spaces, units, commonAreas] = await Promise.all([
    findWithDecryption(em, Space, { ...scope, floorId: floor.id, deletedAt: null }, undefined, scope),
    findWithDecryption(em, Unit, { ...scope, floorId: floor.id, deletedAt: null }, undefined, scope),
    findWithDecryption(em, CommonArea, { ...scope, floorId: floor.id, deletedAt: null }, undefined, scope),
  ])
  const plan = planFloorResize(current, next, spaces, units, commonAreas)
  if (plan.outside.length) return refuseResize(floor.name, plan.outside)
  if (plan.defaultSpace) {
    snapshot.resizedSpaces.push({
      id: plan.defaultSpace.id,
      before: { x: plan.defaultSpace.x, y: plan.defaultSpace.y, width: plan.defaultSpace.width, depth: plan.defaultSpace.depth },
    })
    plan.defaultSpace.width = metres(sizeX)
    plan.defaultSpace.depth = metres(sizeY)
  }
  floor.sizeX = metres(sizeX)
  floor.sizeY = metres(sizeY)
  return true
}

export function createFloorWithDefaultSpace(
  em: EntityManager,
  scope: Scope,
  building: Building,
  entry: { number: number; name: string; sizeX: number; sizeY: number },
  defaultSpaceName: string,
): { floor: Floor; space: Space } {
  const floor = em.create(Floor, {
    id: randomUUID(),
    ...scope,
    buildingId: building.id,
    number: entry.number,
    name: entry.name,
    sizeX: metres(entry.sizeX),
    sizeY: metres(entry.sizeY),
  })
  em.persist(floor)
  const space = em.create(Space, {
    id: randomUUID(),
    ...scope,
    buildingId: building.id,
    floorId: floor.id,
    name: defaultSpaceName,
    purpose: null,
    x: metres(0),
    y: metres(0),
    width: metres(entry.sizeX),
    depth: metres(entry.sizeY),
    isDefault: true,
  })
  em.persist(space)
  return { floor, space }
}

async function refuseRemoval(floors: Floor[], unitCounts: Map<string, number>, blockingFloor: Floor): Promise<never> {
  const { translate } = await resolveTranslations()
  const counts = minimumCounts(floors.map((floor) => ({ number: floor.number, unitCount: unitCounts.get(floor.id) ?? 0 })))
  const message = translate(
    'property_management.errors.floorHasUnits',
    'Floor {number} ({name}) still has units on it, so the floor counts cannot go below {below} below ground and {above} above ground.',
    { number: blockingFloor.number, name: blockingFloor.name, below: counts.minimumBelow, above: counts.minimumAbove },
  )
  throw new CrudHttpError(422, {
    error: message,
    code: 'floor_has_units',
    minimumAbove: counts.minimumAbove,
    minimumBelow: counts.minimumBelow,
    blockingFloor: { id: blockingFloor.id, number: blockingFloor.number, name: blockingFloor.name },
    fieldErrors: { [blockingFloor.number < 0 ? 'below' : 'above']: message },
  })
}

export async function applyFloorLayout(
  em: EntityManager,
  scope: Scope,
  building: Building,
  layout: FloorLayoutInput,
  defaultSpaceName: string,
): Promise<LayoutChangeResult> {
  const snapshot = emptyLayoutSnapshot(building.id)
  const existing = await findWithDecryption(
    em,
    Floor,
    { ...scope, buildingId: building.id, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true, orderBy: { id: 'asc' } },
    scope,
  )
  const entriesByNumber = new Map(layout.floors.map((entry) => [entry.number, entry]))
  const removed = existing.filter((floor) => !entriesByNumber.has(floor.number))
  const existingIds = existing.map((floor) => floor.id)
  const unitRows = existingIds.length
    ? await findWithDecryption(em, Unit, { ...scope, floorId: { $in: existingIds }, deletedAt: null }, undefined, scope)
    : []
  const unitCounts = new Map<string, number>()
  for (const unit of unitRows) unitCounts.set(unit.floorId, (unitCounts.get(unit.floorId) ?? 0) + 1)
  const blocking = removed
    .filter((floor) => (unitCounts.get(floor.id) ?? 0) > 0)
    .sort((left, right) => Math.abs(right.number) - Math.abs(left.number))[0]
  if (blocking) return refuseRemoval(existing, unitCounts, blocking)

  const updatedFloors: Floor[] = []
  const existingByNumber = new Map(existing.map((floor) => [floor.number, floor]))
  for (const entry of layout.floors) {
    const floor = existingByNumber.get(entry.number)
    if (!floor) continue
    const before = snapshotFloor(floor)
    const resized = await resizeFloor(em, scope, floor, entry.sizeX, entry.sizeY, snapshot)
    const renamed = floor.name !== entry.name
    if (renamed) floor.name = entry.name
    if (resized || renamed) {
      snapshot.updatedFloors.push(before)
      updatedFloors.push(floor)
      await em.flush()
    }
  }

  const removedIds = removed.map((floor) => floor.id)
  const [removedSpaces, removedAreas] = removedIds.length
    ? await Promise.all([
        findWithDecryption(em, Space, { ...scope, floorId: { $in: removedIds }, deletedAt: null }, undefined, scope),
        findWithDecryption(em, CommonArea, { ...scope, floorId: { $in: removedIds }, deletedAt: null }, undefined, scope),
      ])
    : [[], []]

  const now = new Date()
  for (const floor of removed) {
    floor.deletedAt = now
    snapshot.removedFloorIds.push(floor.id)
  }
  for (const space of removedSpaces) {
    space.deletedAt = now
    snapshot.removedSpaceIds.push(space.id)
  }
  for (const area of removedAreas) {
    area.deletedAt = now
    snapshot.removedCommonAreaIds.push(area.id)
  }
  await em.flush()

  const createdFloors: Floor[] = []
  for (const entry of layout.floors) {
    if (existingByNumber.has(entry.number)) continue
    const { floor, space } = createFloorWithDefaultSpace(em, scope, building, entry, defaultSpaceName)
    createdFloors.push(floor)
    snapshot.createdFloorIds.push(floor.id)
    snapshot.createdSpaceIds.push(space.id)
  }
  await em.flush()
  return { snapshot, createdFloors, updatedFloors, removedFloors: removed }
}

export async function revertFloorLayout(em: EntityManager, scope: Scope, snapshot: LayoutChangeSnapshot): Promise<void> {
  const createdFloorIds = snapshot.createdFloorIds
  if (createdFloorIds.length) {
    const unitsOnCreated = await findWithDecryption(
      em,
      Unit,
      { ...scope, floorId: { $in: createdFloorIds }, deletedAt: null },
      undefined,
      scope,
    )
    if (unitsOnCreated.length) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(409, {
        error: translate('property_management.errors.undoFloorsInUse', 'Cannot undo: units were added to the floors this change created.'),
      })
    }
  }
  const now = new Date()
  const [createdFloors, createdSpaces, createdAreas, removedFloors, removedSpaces, removedAreas, updatedFloors, resizedSpaces] = await Promise.all([
    createdFloorIds.length ? findWithDecryption(em, Floor, { ...scope, id: { $in: createdFloorIds } }, undefined, scope) : Promise.resolve([]),
    createdFloorIds.length ? findWithDecryption(em, Space, { ...scope, floorId: { $in: createdFloorIds }, deletedAt: null }, undefined, scope) : Promise.resolve([]),
    createdFloorIds.length ? findWithDecryption(em, CommonArea, { ...scope, floorId: { $in: createdFloorIds }, deletedAt: null }, undefined, scope) : Promise.resolve([]),
    snapshot.removedFloorIds.length ? findWithDecryption(em, Floor, { ...scope, id: { $in: snapshot.removedFloorIds } }, undefined, scope) : Promise.resolve([]),
    snapshot.removedSpaceIds.length ? findWithDecryption(em, Space, { ...scope, id: { $in: snapshot.removedSpaceIds } }, undefined, scope) : Promise.resolve([]),
    snapshot.removedCommonAreaIds.length ? findWithDecryption(em, CommonArea, { ...scope, id: { $in: snapshot.removedCommonAreaIds } }, undefined, scope) : Promise.resolve([]),
    snapshot.updatedFloors.length ? findWithDecryption(em, Floor, { ...scope, id: { $in: snapshot.updatedFloors.map((floor) => floor.id) } }, undefined, scope) : Promise.resolve([]),
    snapshot.resizedSpaces.length ? findWithDecryption(em, Space, { ...scope, id: { $in: snapshot.resizedSpaces.map((space) => space.id) } }, undefined, scope) : Promise.resolve([]),
  ])
  for (const record of [...createdFloors, ...createdSpaces, ...createdAreas]) record.deletedAt = now
  await em.flush()
  for (const record of [...removedFloors, ...removedSpaces, ...removedAreas]) record.deletedAt = null
  const updatedById = new Map(snapshot.updatedFloors.map((floor) => [floor.id, floor]))
  for (const floor of updatedFloors) {
    const before = updatedById.get(floor.id)
    if (!before) continue
    floor.name = before.name
    floor.sizeX = before.sizeX
    floor.sizeY = before.sizeY
  }
  const resizedById = new Map(snapshot.resizedSpaces.map((space) => [space.id, space.before]))
  for (const space of resizedSpaces) {
    const before = resizedById.get(space.id)
    if (!before) continue
    space.x = before.x
    space.y = before.y
    space.width = before.width
    space.depth = before.depth
  }
  await em.flush()
}
