/** @jest-environment node */
import { Building, Unavailability } from '../data/entities'
import {
  blockedRangesForDay,
  effectiveEnd,
  mergeWindows,
  resolveUnitsAvailability,
  unavailabilityInTerm,
  unavailableDuring,
  windowOf,
  windowsForUnit,
  type UnavailabilityWindow,
  type UnitPlacement,
} from '../lib/availabilityResolver'
import { leaseUnavailability } from '../lib/leaseAvailability'
import { closureDates, countClosureLeases, previewTokenOf, unitFilterOf } from '../lib/unavailabilityImpact'
import { RESERVING_LEASE_STATUSES } from '../lib/leaseOccupancy'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }

const unit: UnitPlacement = { id: 'unit-1', buildingId: 'building-1', floorId: 'floor-1', spaceId: 'space-1' }
const neighbour: UnitPlacement = { id: 'unit-2', buildingId: 'building-1', floorId: 'floor-2', spaceId: 'space-2' }

function closure(
  source: UnavailabilityWindow['source'],
  subjectId: string,
  start: string | null,
  end: string | null,
  id: string = `${source}-${subjectId}`,
): UnavailabilityWindow {
  return { id, source, subjectId, reasonEntryId: null, reasonText: 'Renovation', start, end }
}

describe('windowOf', () => {
  it('uses the earlier of the planned end and the actual end', () => {
    expect(effectiveEnd({ endsAt: '2026-12-01 00:00:00', endedAt: '2026-11-20 10:15:00' })).toBe('2026-11-20T10:15')
    expect(effectiveEnd({ endsAt: null, endedAt: null })).toBeNull()
    expect(effectiveEnd({ endsAt: null, endedAt: '2026-11-20T10:15:00' })).toBe('2026-11-20T10:15')
  })

  it('drops a period ended before it started', () => {
    const row = {
      id: 'u1',
      subjectType: 'floor' as const,
      subjectId: 'floor-1',
      reasonEntryId: null,
      reasonText: 'Cancelled plan',
      startsAt: '2026-12-01T00:00:00',
      endsAt: null,
      endedAt: '2026-11-11T09:00:00',
    }
    expect(windowOf(row)).toBeNull()
    expect(windowOf({ ...row, endedAt: null })).toMatchObject({ source: 'floor', start: '2026-12-01T00:00', end: null })
  })
})

describe('windowsForUnit', () => {
  const windows = [
    closure('building', 'building-1', '2026-11-20T00:00', '2026-11-21T00:00'),
    closure('floor', 'floor-1', '2026-11-12T00:00', null),
    closure('space', 'space-1', '2026-11-13T08:00', '2026-11-13T12:00'),
    closure('unit', 'unit-1', '2026-11-14T00:00', '2026-11-15T00:00'),
    closure('floor', 'floor-2', '2026-11-12T00:00', null),
    closure('unit', 'unit-2', '2026-11-12T00:00', null),
  ]

  it('inherits the building, floor and space and keeps its own', () => {
    expect(windowsForUnit(unit, windows).map((window) => window.id)).toEqual([
      'building-building-1',
      'floor-floor-1',
      'space-space-1',
      'unit-unit-1',
    ])
    expect(windowsForUnit(neighbour, windows).map((window) => window.id)).toEqual(['building-building-1', 'floor-floor-2', 'unit-unit-2'])
  })

  it('treats an archived building as unavailable for good', () => {
    const result = windowsForUnit(unit, [], new Set(['building-1']))
    expect(result).toEqual([expect.objectContaining({ source: 'building_archived', start: null, end: null })])
    expect(unavailableDuring(result, { start: '2030-01-01T10:00', end: '2030-01-01T11:00' })).toHaveLength(1)
  })
})

describe('mergeWindows', () => {
  it('takes the union of overlapping and touching closures and keeps gaps', () => {
    const spans = mergeWindows([
      closure('space', 's', '2026-11-12T10:00', '2026-11-12T14:00'),
      closure('floor', 'f', '2026-11-12T08:00', '2026-11-12T11:00'),
      closure('unit', 'u', '2026-11-12T14:00', '2026-11-12T15:00'),
      closure('building', 'b', '2026-11-12T18:00', '2026-11-12T19:00'),
    ])
    expect(spans).toEqual([
      { start: '2026-11-12T08:00', end: '2026-11-12T15:00' },
      { start: '2026-11-12T18:00', end: '2026-11-12T19:00' },
    ])
  })

  it('keeps an open-ended closure open after a union', () => {
    expect(mergeWindows([closure('space', 's', '2026-11-12T10:00', null), closure('floor', 'f', '2026-11-12T12:00', '2026-11-13T00:00')])).toEqual([
      { start: '2026-11-12T10:00', end: null },
    ])
  })

  it('ending one of two overlapping closures leaves the other in force', () => {
    const floor = closure('floor', 'floor-1', '2026-11-12T00:00', '2026-11-20T00:00')
    const space = closure('space', 'space-1', '2026-11-10T00:00', '2026-11-12T12:00')
    const windows = windowsForUnit(unit, [floor, space])
    const day = { start: '2026-11-15T09:00', end: '2026-11-15T10:00' }
    expect(unavailableDuring(windows, day)).toEqual([floor])
  })
})

describe('blockedRangesForDay', () => {
  it('clips closures to the day', () => {
    const windows = [closure('floor', 'f', '2026-11-10T00:00', '2026-11-12T10:00'), closure('unit', 'u', '2026-11-12T16:00', null)]
    expect(blockedRangesForDay(windows, '2026-11-12')).toEqual([
      { start: '2026-11-12T00:00', end: '2026-11-12T10:00' },
      { start: '2026-11-12T16:00', end: '2026-11-13T00:00' },
    ])
    expect(blockedRangesForDay(windows, '2026-11-09')).toEqual([])
  })
})

describe('lease flag', () => {
  const lease = { status: 'active' as const, startsOn: '2026-01-01', endsOn: '2026-12-31', pendingChange: null }

  it('flags an active lease while a closure falls in the rest of its term, and says until when', () => {
    const windows = [closure('floor', 'f', '2026-11-12T00:00', '2026-12-01T00:00')]
    expect(leaseUnavailability(lease, windows, '2026-11-15')).toEqual({ from: '2026-11-12T00:00', until: '2026-12-01T00:00' })
    expect(leaseUnavailability(lease, windows, '2026-12-02')).toBeNull()
    expect(leaseUnavailability({ ...lease, status: 'ended' }, windows, '2026-11-15')).toBeNull()
  })

  it('reports the first span of overlapping closures in the term', () => {
    const windows = [
      closure('space', 's', '2026-11-12T00:00', '2026-11-20T00:00'),
      closure('unit', 'u', '2026-11-18T00:00', '2026-11-25T00:00'),
    ]
    expect(unavailabilityInTerm(windows, { startsOn: '2026-01-01', endsOn: '2026-12-31' }, '2026-11-13')).toEqual({
      start: '2026-11-12T00:00',
      end: '2026-11-25T00:00',
    })
  })

  it('counts a closure as overlapping a lease only when it reaches a not-yet-ended reserved term', async () => {
    const executed: Array<{ sql: string; params: unknown[] }> = []
    const em = {
      getConnection: () => ({
        execute: async (sql: string, params: unknown[]) => {
          executed.push({ sql, params })
          return [{ total: 2 }]
        },
      }),
      getTransactionContext: () => undefined,
    } as unknown as EntityManager
    const range = { start: '2026-11-12T00:00', end: '2026-11-13T00:00' }
    expect(closureDates(range)).toEqual({ startsOn: '2026-11-12', endsOn: '2026-11-12' })
    expect(await countClosureLeases(em, scope, ['unit-1', 'unit-2'], range, '2026-11-11')).toBe(2)
    expect(await countClosureLeases(em, scope, ['unit-1'], { start: '2026-11-12T00:00', end: null }, '2026-11-11')).toBe(2)
    expect(await countClosureLeases(em, scope, [], range, '2026-11-11')).toBe(0)
    expect(executed).toHaveLength(2)
    const [bounded, openEnded] = executed
    for (const query of executed) {
      expect(query.sql.match(/\?/g)?.length).toBe(query.params.length)
      expect(query.sql).toContain('lease.deleted_at is null')
    }
    expect(bounded.params).toEqual([ORG, TENANT, 'unit-1', 'unit-2', ...RESERVING_LEASE_STATUSES, '2026-11-11', '2026-11-12', '2026-11-12'])
    expect(bounded.sql).toMatch(/ends_on end\) >= \?::date\s+and \(case .*ends_on end\) >= \?::date\s+and \(case .*starts_on end\) <= \?::date/s)
    expect(openEnded.params).toEqual([ORG, TENANT, 'unit-1', ...RESERVING_LEASE_STATUSES, '2026-11-11', '2026-11-12'])
    expect(openEnded.sql).not.toMatch(/starts_on end\) <= \?::date/)
  })
})

describe('preview token and subject filters', () => {
  it('hashes the affected booking ids independently of their order', () => {
    const binding = { subjectType: 'floor' as const, subjectId: 'floor-1', start: '2026-11-17T00:00', end: null }
    expect(previewTokenOf(binding, ['b', 'a'])).toBe(previewTokenOf(binding, ['a', 'b']))
    expect(previewTokenOf(binding, ['a'])).not.toBe(previewTokenOf(binding, ['a', 'b']))
    expect(previewTokenOf(binding, [])).toHaveLength(64)
  })

  it('binds the token to the subject and the range, so an empty preview confirms only its own closure', () => {
    const binding = { subjectType: 'floor' as const, subjectId: 'floor-1', start: '2026-11-17T00:00', end: null }
    const empty = previewTokenOf(binding, [])
    expect(previewTokenOf({ ...binding, subjectId: 'floor-2' }, [])).not.toBe(empty)
    expect(previewTokenOf({ ...binding, subjectType: 'unit' }, [])).not.toBe(empty)
    expect(previewTokenOf({ ...binding, start: '2026-11-18T00:00' }, [])).not.toBe(empty)
    expect(previewTokenOf({ ...binding, end: '2026-11-20T00:00' }, [])).not.toBe(empty)
  })

  it('maps each subject to the units it covers', () => {
    expect(unitFilterOf({ type: 'building', id: 'x' })).toEqual({ buildingId: 'x' })
    expect(unitFilterOf({ type: 'floor', id: 'x' })).toEqual({ floorId: 'x' })
    expect(unitFilterOf({ type: 'space', id: 'x' })).toEqual({ spaceId: 'x' })
    expect(unitFilterOf({ type: 'unit', id: 'x' })).toEqual({ id: 'x' })
  })
})

describe('resolveUnitsAvailability', () => {
  it('resolves many units in two queries', async () => {
    const em = new FakeEm()
    em.seed(Building, { id: 'building-1', ...scope, status: 'active', deletedAt: null } as never)
    em.seed(Unavailability, { id: 'u-floor', ...scope, buildingId: 'building-1', subjectType: 'floor', subjectId: 'floor-1', reasonText: 'Works', startsAt: '2026-11-12T00:00:00', endsAt: null, endedAt: null, deletedAt: null } as never)
    em.seed(Unavailability, { id: 'u-old', ...scope, buildingId: 'building-1', subjectType: 'unit', subjectId: 'unit-2', reasonText: 'Old', startsAt: '2026-10-01T00:00:00', endsAt: '2026-10-02T00:00:00', endedAt: null, deletedAt: null } as never)
    em.seed(Unavailability, { id: 'u-deleted', ...scope, buildingId: 'building-1', subjectType: 'unit', subjectId: 'unit-2', reasonText: 'Undone', startsAt: '2026-11-12T00:00:00', endsAt: null, endedAt: null, deletedAt: new Date() } as never)
    const find = jest.spyOn(em, 'find')
    const units = [unit, neighbour, ...Array.from({ length: 20 }, (_, index) => ({ ...neighbour, id: `unit-x${index}` }))]
    const result = await resolveUnitsAvailability(em as never, scope, units, { start: '2026-11-12T09:00', end: '2026-11-12T10:00' })
    expect(find).toHaveBeenCalledTimes(2)
    expect(result.get('unit-1')?.map((window) => window.id)).toEqual(['u-floor'])
    expect(result.get('unit-2')).toEqual([])
  })

  it('narrows the closure query to the buildings of the units so it can use the building index', async () => {
    const em = new FakeEm()
    em.seed(Building, { id: 'building-1', ...scope, status: 'active', deletedAt: null } as never)
    em.seed(Unavailability, { id: 'u-floor', ...scope, buildingId: 'building-1', subjectType: 'floor', subjectId: 'floor-1', reasonText: 'Works', startsAt: '2026-11-12T00:00:00', endsAt: null, endedAt: null, deletedAt: null } as never)
    const find = jest.spyOn(em, 'find')
    const result = await resolveUnitsAvailability(em as never, scope, [unit, neighbour], { start: '2026-11-12T09:00', end: '2026-11-12T10:00' })
    const closureQuery = find.mock.calls.find(([entity]) => entity === Unavailability)
    expect(closureQuery?.[1]).toMatchObject({ buildingId: { $in: ['building-1'] } })
    expect(result.get('unit-1')?.map((window) => window.id)).toEqual(['u-floor'])
  })
})
