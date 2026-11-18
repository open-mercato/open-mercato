import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CommonArea, Floor, Space, Unit, type Building } from '../data/entities'
import type { FloorLayoutInput } from '../data/validators'
import { floorRect, fitsInside, sameRect, toRect, type Rect } from './geometry'
import { isContiguousLayout, minimumCounts } from './floorNumbering'
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

export type LayoutEntityChanges = {
  floors: { created: Floor[]; updated: Floor[]; removed: Floor[] }
  spaces: { created: Space[]; updated: Space[]; removed: Space[] }
  commonAreas: { created: CommonArea[]; removed: CommonArea[] }
}

export type LayoutChangeResult = {
  snapshot: LayoutChangeSnapshot
  createdFloors: Floor[]
  updatedFloors: Floor[]
  removedFloors: Floor[]
  changes: LayoutEntityChanges
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
  resizedSpaces?: Space[],
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
    resizedSpaces?.push(plan.defaultSpace)
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
  const resizedSpaces: Space[] = []
  const existingByNumber = new Map(existing.map((floor) => [floor.number, floor]))
  for (const entry of layout.floors) {
    const floor = existingByNumber.get(entry.number)
    if (!floor) continue
    const before = snapshotFloor(floor)
    const resized = await resizeFloor(em, scope, floor, entry.sizeX, entry.sizeY, snapshot, resizedSpaces)
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
  const createdSpaces: Space[] = []
  for (const entry of layout.floors) {
    if (existingByNumber.has(entry.number)) continue
    const { floor, space } = createFloorWithDefaultSpace(em, scope, building, entry, defaultSpaceName)
    createdFloors.push(floor)
    createdSpaces.push(space)
    snapshot.createdFloorIds.push(floor.id)
    snapshot.createdSpaceIds.push(space.id)
  }
  await em.flush()
  return {
    snapshot,
    createdFloors,
    updatedFloors,
    removedFloors: removed,
    changes: {
      floors: { created: createdFloors, updated: updatedFloors, removed },
      spaces: { created: createdSpaces, updated: resizedSpaces, removed: removedSpaces },
      commonAreas: { created: [], removed: removedAreas },
    },
  }
}

async function lockLayoutFloors(em: EntityManager, scope: Scope, ids: readonly string[]): Promise<Map<string, Floor>> {
  const unique = Array.from(new Set(ids))
  if (!unique.length) return new Map()
  const floors = await findWithDecryption(
    em,
    Floor,
    { ...scope, id: { $in: unique } },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true, orderBy: { id: 'asc' } },
    scope,
  )
  return new Map(floors.map((floor) => [floor.id, floor]))
}

async function refuseUndo(key: string, fallback: string, extra: Record<string, unknown> = {}): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, { error: translate(key, fallback), ...extra })
}

async function assertCreatedFloorsEmpty(
  em: EntityManager,
  scope: Scope,
  createdFloorIds: readonly string[],
  createdSpaceIds: readonly string[],
): Promise<void> {
  if (!createdFloorIds.length) return
  const onCreatedFloors = { ...scope, floorId: { $in: [...createdFloorIds] }, deletedAt: null }
  const [unitsOnCreated, spacesOnCreated, areasOnCreated] = await Promise.all([
    findWithDecryption(em, Unit, onCreatedFloors, undefined, scope),
    findWithDecryption(em, Space, onCreatedFloors, undefined, scope),
    findWithDecryption(em, CommonArea, onCreatedFloors, undefined, scope),
  ])
  if (unitsOnCreated.length) {
    await refuseUndo('property_management.errors.undoFloorsInUse', 'Cannot undo: units were added to the floors this change created.')
  }
  const addedSpaces = spacesOnCreated.filter((space) => !createdSpaceIds.includes(space.id))
  if (addedSpaces.length || areasOnCreated.length) {
    await refuseUndo(
      'property_management.errors.undoFloorsHaveSpaces',
      'Cannot undo: spaces or common areas were added to the floors this change created. Remove them first.',
      {
        code: 'floor_undo_floors_have_spaces',
        spaces: addedSpaces.map((space) => space.name),
        commonAreas: areasOnCreated.map((area) => area.name),
      },
    )
  }
}

async function assertFloorNumbersFree(
  em: EntityManager,
  scope: Scope,
  buildingId: string,
  restoring: readonly Floor[],
  deleting: readonly string[],
): Promise<void> {
  const reviving = restoring.filter((floor) => floor.deletedAt)
  if (!reviving.length) return
  const live = await findWithDecryption(
    em,
    Floor,
    { ...scope, buildingId, number: { $in: reviving.map((floor) => floor.number) }, deletedAt: null },
    undefined,
    scope,
  )
  const taken = live.filter((floor) => !deleting.includes(floor.id))
  if (taken.length) {
    await refuseUndo(
      'property_management.errors.undoFloorNumberTaken',
      'Cannot undo: a floor with the same number was added since.',
      { code: 'floor_undo_number_taken', floors: taken.map((floor) => floor.number) },
    )
  }
}

async function assertRevertContiguous(
  em: EntityManager,
  scope: Scope,
  buildingId: string,
  restoring: readonly Floor[],
  deleting: readonly string[],
): Promise<void> {
  const reviving = restoring.filter((floor) => floor.deletedAt)
  if (!reviving.length && !deleting.length) return
  const live = await findWithDecryption(em, Floor, { ...scope, buildingId, deletedAt: null }, undefined, scope)
  const numbers = [
    ...live.filter((floor) => !deleting.includes(floor.id)).map((floor) => floor.number),
    ...reviving.map((floor) => floor.number),
  ]
  if (isContiguousLayout(numbers)) return
  await refuseUndo(
    'property_management.errors.undoFloorsNotContiguous',
    'Cannot undo: later floor changes would leave a gap in the floor numbers. Undo those changes first.',
    { code: 'floor_undo_not_contiguous' },
  )
}

type PlannedResize = { floor: Floor; before: FloorSnapshot; space: Space | null }

async function planRevertResizes(
  em: EntityManager,
  scope: Scope,
  snapshot: LayoutChangeSnapshot,
  floorsById: Map<string, Floor>,
): Promise<PlannedResize[]> {
  const planned: PlannedResize[] = []
  for (const before of snapshot.updatedFloors) {
    const floor = floorsById.get(before.id)
    if (!floor || floor.deletedAt) continue
    const current = floorRect(floor.sizeX, floor.sizeY)
    const next = floorRect(before.sizeX, before.sizeY)
    if (sameRect(current, next)) {
      planned.push({ floor, before, space: null })
      continue
    }
    const [spaces, units, commonAreas] = await Promise.all([
      findWithDecryption(em, Space, { ...scope, floorId: floor.id, deletedAt: null }, undefined, scope),
      findWithDecryption(em, Unit, { ...scope, floorId: floor.id, deletedAt: null }, undefined, scope),
      findWithDecryption(em, CommonArea, { ...scope, floorId: floor.id, deletedAt: null }, undefined, scope),
    ])
    const plan = planFloorResize(current, next, spaces, units, commonAreas)
    if (plan.outside.length) return refuseResize(floor.name, plan.outside)
    planned.push({ floor, before, space: plan.defaultSpace })
  }
  return planned
}

export async function revertFloorLayout(em: EntityManager, scope: Scope, snapshot: LayoutChangeSnapshot): Promise<LayoutEntityChanges> {
  const createdFloorIds = snapshot.createdFloorIds
  const floorsById = await lockLayoutFloors(em, scope, [
    ...createdFloorIds,
    ...snapshot.removedFloorIds,
    ...snapshot.updatedFloors.map((floor) => floor.id),
  ])
  await assertCreatedFloorsEmpty(em, scope, createdFloorIds, snapshot.createdSpaceIds)
  const removedFloors = snapshot.removedFloorIds.map((id) => floorsById.get(id)).filter((floor): floor is Floor => Boolean(floor))
  await assertFloorNumbersFree(em, scope, snapshot.buildingId, removedFloors, createdFloorIds)
  await assertRevertContiguous(em, scope, snapshot.buildingId, removedFloors, createdFloorIds)
  const resizes = await planRevertResizes(em, scope, snapshot, floorsById)
  const now = new Date()
  const createdFloors = createdFloorIds.map((id) => floorsById.get(id)).filter((floor): floor is Floor => Boolean(floor && !floor.deletedAt))
  const [createdSpaces, createdAreas, removedSpaces, removedAreas] = await Promise.all([
    createdFloorIds.length ? findWithDecryption(em, Space, { ...scope, floorId: { $in: createdFloorIds }, deletedAt: null }, undefined, scope) : Promise.resolve([]),
    createdFloorIds.length ? findWithDecryption(em, CommonArea, { ...scope, floorId: { $in: createdFloorIds }, deletedAt: null }, undefined, scope) : Promise.resolve([]),
    snapshot.removedSpaceIds.length ? findWithDecryption(em, Space, { ...scope, id: { $in: snapshot.removedSpaceIds } }, undefined, scope) : Promise.resolve([]),
    snapshot.removedCommonAreaIds.length ? findWithDecryption(em, CommonArea, { ...scope, id: { $in: snapshot.removedCommonAreaIds } }, undefined, scope) : Promise.resolve([]),
  ])
  for (const record of [...createdFloors, ...createdSpaces, ...createdAreas]) record.deletedAt = now
  await em.flush()
  const restoredFloors = removedFloors.filter((floor) => floor.deletedAt)
  const restoredSpaces = removedSpaces.filter((space) => space.deletedAt)
  const restoredAreas = removedAreas.filter((area) => area.deletedAt)
  for (const record of [...restoredFloors, ...restoredSpaces, ...restoredAreas]) record.deletedAt = null
  const updatedFloors: Floor[] = []
  const updatedSpaces: Space[] = []
  for (const { floor, before, space } of resizes) {
    floor.name = before.name
    floor.sizeX = before.sizeX
    floor.sizeY = before.sizeY
    updatedFloors.push(floor)
    if (space) {
      space.width = before.sizeX
      space.depth = before.sizeY
      updatedSpaces.push(space)
    }
  }
  await em.flush()
  return {
    floors: { created: restoredFloors, updated: updatedFloors, removed: createdFloors },
    spaces: { created: restoredSpaces, updated: updatedSpaces, removed: createdSpaces },
    commonAreas: { created: restoredAreas, removed: createdAreas },
  }
}
