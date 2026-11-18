import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Building, Unavailability, type UnavailabilitySubjectType } from '../data/entities'
import type { TimeRange } from './bookingSlots'
import { compareWallClock, endOfDay, normalizeWallClock, startOfDay, toStoredWallClock } from './wallClock'
import type { Scope } from './productUse'

export type UnitPlacement = { id: string; buildingId: string; floorId: string; spaceId: string }

export type AvailabilitySource = UnavailabilitySubjectType | 'building_archived'

export type UnavailabilityWindow = {
  id: string | null
  source: AvailabilitySource
  subjectId: string
  reasonEntryId: string | null
  reasonText: string | null
  start: string | null
  end: string | null
}

export type OpenRange = { start: string | null; end: string | null }

export type MergedSpan = { start: string | null; end: string | null }

type UnavailabilityRow = Pick<
  Unavailability,
  'id' | 'subjectType' | 'subjectId' | 'reasonEntryId' | 'reasonText' | 'startsAt' | 'endsAt' | 'endedAt'
>

function compareStart(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0
  if (left === null) return -1
  if (right === null) return 1
  return compareWallClock(left, right)
}

function earlierEnd(left: string | null, right: string | null): string | null {
  if (left === null) return right
  if (right === null) return left
  return compareWallClock(left, right) <= 0 ? left : right
}

function laterEnd(left: string | null, right: string | null): string | null {
  if (left === null || right === null) return null
  return compareWallClock(left, right) >= 0 ? left : right
}

export function effectiveEnd(row: { endsAt?: string | null; endedAt?: string | null }): string | null {
  const planned = row.endsAt ? normalizeWallClock(row.endsAt) : null
  const actual = row.endedAt ? normalizeWallClock(row.endedAt) : null
  return earlierEnd(planned, actual)
}

export function notOverAt(moment: string): Array<Record<string, unknown>> {
  const stored = toStoredWallClock(moment)
  return [
    { $or: [{ endsAt: null }, { endsAt: { $gt: stored } }] },
    { $or: [{ endedAt: null }, { endedAt: { $gt: stored } }] },
  ]
}

export function windowOf(row: UnavailabilityRow): UnavailabilityWindow | null {
  const start = normalizeWallClock(row.startsAt)
  const end = effectiveEnd(row)
  if (end !== null && compareWallClock(end, start) <= 0) return null
  return {
    id: row.id,
    source: row.subjectType,
    subjectId: row.subjectId,
    reasonEntryId: row.reasonEntryId ?? null,
    reasonText: row.reasonText,
    start,
    end,
  }
}

export function archivedWindow(buildingId: string): UnavailabilityWindow {
  return { id: null, source: 'building_archived', subjectId: buildingId, reasonEntryId: null, reasonText: null, start: null, end: null }
}

export function windowIntersects(window: { start: string | null; end: string | null }, range: OpenRange): boolean {
  const startsBeforeRangeEnds = range.end === null || window.start === null || compareWallClock(window.start, range.end) < 0
  const endsAfterRangeStarts = range.start === null || window.end === null || compareWallClock(window.end, range.start) > 0
  return startsBeforeRangeEnds && endsAfterRangeStarts
}

export function subjectsOf(placement: UnitPlacement): Array<{ type: UnavailabilitySubjectType; id: string }> {
  return [
    { type: 'building', id: placement.buildingId },
    { type: 'floor', id: placement.floorId },
    { type: 'space', id: placement.spaceId },
    { type: 'unit', id: placement.id },
  ]
}

export function windowsForUnit(
  placement: UnitPlacement,
  windows: readonly UnavailabilityWindow[],
  archivedBuildingIds: ReadonlySet<string> = new Set(),
): UnavailabilityWindow[] {
  const subjects = subjectsOf(placement)
  const own = windows.filter((window) => subjects.some((subject) => subject.type === window.source && subject.id === window.subjectId))
  return archivedBuildingIds.has(placement.buildingId) ? [archivedWindow(placement.buildingId), ...own] : own
}

export function unavailableDuring(windows: readonly UnavailabilityWindow[], range: OpenRange): UnavailabilityWindow[] {
  return windows.filter((window) => windowIntersects(window, range))
}

export function mergeWindows(windows: ReadonlyArray<{ start: string | null; end: string | null }>): MergedSpan[] {
  const sorted = windows.slice().sort((left, right) => compareStart(left.start, right.start))
  const merged: MergedSpan[] = []
  for (const window of sorted) {
    const last = merged[merged.length - 1]
    if (last && (last.end === null || window.start === null || compareWallClock(window.start, last.end) <= 0)) {
      last.end = laterEnd(last.end, window.end)
      continue
    }
    merged.push({ start: window.start, end: window.end })
  }
  return merged
}

export function firstSpanFrom(windows: readonly UnavailabilityWindow[], from: string): MergedSpan | null {
  return mergeWindows(windows).find((span) => span.end === null || compareWallClock(span.end, from) > 0) ?? null
}

export function blockedRangesForDay(windows: readonly UnavailabilityWindow[], date: string): TimeRange[] {
  const day = { start: startOfDay(date), end: endOfDay(date) }
  return mergeWindows(unavailableDuring(windows, day)).map((span) => ({
    start: span.start === null || compareWallClock(span.start, day.start) < 0 ? day.start : span.start,
    end: span.end === null || compareWallClock(span.end, day.end) > 0 ? day.end : span.end,
  }))
}

export async function loadUnavailabilities(
  em: EntityManager,
  scope: Scope,
  subjectIds: readonly string[],
  range: OpenRange,
  options: { buildingIds?: readonly string[] } = {},
): Promise<UnavailabilityWindow[]> {
  const ids = Array.from(new Set(subjectIds))
  if (!ids.length) return []
  const where: Record<string, unknown> = { ...scope, subjectId: { $in: ids }, deletedAt: null }
  if (options.buildingIds) where.buildingId = { $in: Array.from(new Set(options.buildingIds)) }
  if (range.end !== null) where.startsAt = { $lt: toStoredWallClock(range.end) }
  if (range.start !== null) where.$and = notOverAt(range.start)
  const rows = await findWithDecryption(em, Unavailability, where, { orderBy: { startsAt: 'asc' } }, scope)
  return rows
    .map(windowOf)
    .filter((window): window is UnavailabilityWindow => window !== null && windowIntersects(window, range))
}

export async function loadArchivedBuildingIds(em: EntityManager, scope: Scope, buildingIds: readonly string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(buildingIds))
  if (!ids.length) return new Set()
  const buildings = await findWithDecryption(em, Building, { ...scope, id: { $in: ids } }, { fields: ['id', 'status', 'deletedAt'] }, scope)
  const found = new Set(buildings.map((building) => building.id))
  return new Set([
    ...buildings.filter((building) => building.status === 'archived' || building.deletedAt).map((building) => building.id),
    ...ids.filter((id) => !found.has(id)),
  ])
}

export async function resolveUnitsAvailability(
  em: EntityManager,
  scope: Scope,
  units: readonly UnitPlacement[],
  range: OpenRange,
): Promise<Map<string, UnavailabilityWindow[]>> {
  const result = new Map<string, UnavailabilityWindow[]>()
  if (!units.length) return result
  const subjectIds = units.flatMap((unit) => subjectsOf(unit).map((subject) => subject.id))
  const buildingIds = units.map((unit) => unit.buildingId)
  const [windows, archived] = await Promise.all([
    loadUnavailabilities(em, scope, subjectIds, range, { buildingIds }),
    loadArchivedBuildingIds(em, scope, buildingIds),
  ])
  for (const unit of units) result.set(unit.id, windowsForUnit(unit, windows, archived))
  return result
}

export async function resolveUnitAvailability(
  em: EntityManager,
  scope: Scope,
  unit: UnitPlacement,
  range: OpenRange,
): Promise<UnavailabilityWindow[]> {
  return (await resolveUnitsAvailability(em, scope, [unit], range)).get(unit.id) ?? []
}

export function unavailabilityInTerm(
  windows: readonly UnavailabilityWindow[],
  term: { startsOn: string; endsOn: string },
  today: string,
): MergedSpan | null {
  const from = term.startsOn > today ? term.startsOn : today
  if (term.endsOn < from) return null
  const range = { start: `${from}T00:00`, end: endOfDay(term.endsOn) }
  const spans = mergeWindows(unavailableDuring(windows, range))
  return spans[0] ?? null
}
