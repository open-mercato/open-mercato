/** @jest-environment node */
import { openingHoursPayload, openingRowsOf } from '../components/buildings/openingHoursRows'
import { blockedOnlyBy, placeInsideSpace } from '../components/placement/placementModel'
import { reasonOf } from '../components/availability/availabilityModel'
import { bookingStatusBadge, formatWallClockTime } from '../components/bookings/bookingModel'
import { isCalendarDate, readingOrder, sameTileRow, tileRows, verticalNeighbour } from '../components/floorPlan/floorPlanModel'
import { hatchedSubjects, type FloorLayoutData } from '../components/floor/types'
import { pluralCategory, translatePlural } from '../components/plural'
import { withMondayWeekStart } from '../components/useMondayDateLocale'
import { enUS } from 'date-fns/locale/en-US'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

describe('openingRowsOf', () => {
  it('opens Monday to Friday by default for a building without opening hours', () => {
    expect(openingRowsOf([]).map((row) => row.open)).toEqual([true, true, true, true, true, false, false])
  })

  it('keeps every day closed when opening hours are enabled with no open day', () => {
    const rows = openingRowsOf([], true)
    expect(rows.every((row) => !row.open)).toBe(true)
    expect(openingHoursPayload(rows).entries).toEqual([])
  })

  it('opens only the saved days', () => {
    const rows = openingRowsOf([{ weekday: 2, opensAt: '08:00', closesAt: '12:00' }], true)
    expect(rows.filter((row) => row.open)).toEqual([{ weekday: 2, open: true, opensAt: '08:00', closesAt: '12:00' }])
  })
})

describe('placeInsideSpace', () => {
  const space = { x: 10, y: 0, width: 10, depth: 6 }

  it('uses the top-left corner of the space when it is free', () => {
    expect(placeInsideSpace({ x: 0, y: 0, width: 4, depth: 3 }, space, [])).toMatchObject({ x: 10, y: 0, width: 4, depth: 3 })
  })

  it('takes the first free position on the 0.5 m grid', () => {
    const placed = placeInsideSpace({ x: 0, y: 0, width: 4, depth: 3 }, space, [{ x: 10, y: 0, width: 5, depth: 3 }])
    expect(placed).toMatchObject({ x: 15, y: 0 })
  })

  it('falls back to the top-left corner when nothing is free', () => {
    const placed = placeInsideSpace({ x: 0, y: 0, width: 4, depth: 3 }, space, [{ ...space }])
    expect(placed).toMatchObject({ x: 10, y: 0 })
  })
})

describe('blockedOnlyBy', () => {
  it('is true when the only space overlap is the named space', () => {
    expect(blockedOnlyBy([{ code: 'overlaps', kind: 'space', names: ['Whole floor'] }], 'space', 'Whole floor')).toBe(true)
  })

  it('is false when another space overlaps too or nothing overlaps', () => {
    expect(blockedOnlyBy([{ code: 'overlaps', kind: 'space', names: ['Whole floor', 'Studio'] }], 'space', 'Whole floor')).toBe(false)
    expect(blockedOnlyBy([{ code: 'outside_floor' }], 'space', 'Whole floor')).toBe(false)
  })
})

describe('reasonOf', () => {
  it('does not repeat the reason label', () => {
    expect(reasonOf({ reasonLabel: 'Maintenance', reasonText: 'Maintenance' })).toBe('Maintenance')
    expect(reasonOf({ reasonLabel: 'Maintenance', reasonText: 'MaintenanceChrome UI check' })).toBe('Maintenance — Chrome UI check')
    expect(reasonOf({ reasonLabel: 'Maintenance', reasonText: 'Projector' })).toBe('Maintenance — Projector')
    expect(reasonOf({ reasonLabel: null, reasonText: 'Projector' })).toBe('Projector')
  })
})

describe('bookingStatusBadge', () => {
  it('gives every status its own badge', () => {
    const badges = (['pending', 'confirmed', 'completed', 'cancelled'] as const).map((status) => JSON.stringify(bookingStatusBadge(status)))
    expect(new Set(badges).size).toBe(4)
    expect(bookingStatusBadge('pending').variant).toBe('info')
    expect(bookingStatusBadge('confirmed').variant).toBe('success')
  })
})

describe('translatePlural', () => {
  const dict: Record<string, string> = {
    'x.units.one': '{count} lokal',
    'x.units.few': '{count} lokale',
    'x.units.many': '{count} lokali',
    'x.units.other': '{count} lokali',
  }
  const t = ((key: string, fallbackOrParams?: string | Record<string, string | number>, params?: Record<string, string | number>) => {
    const values = typeof fallbackOrParams === 'object' ? fallbackOrParams : params
    const template = dict[key] ?? (typeof fallbackOrParams === 'string' ? fallbackOrParams : key)
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values?.[name] ?? ''))
  }) as TranslateFn

  it('picks the CLDR category of the locale', () => {
    expect(pluralCategory('pl', 1)).toBe('one')
    expect(pluralCategory('pl', 3)).toBe('few')
    expect(pluralCategory('pl', 5)).toBe('many')
    expect(translatePlural(t, 'pl', 'x.units', '{count} units', 1)).toBe('1 lokal')
    expect(translatePlural(t, 'pl', 'x.units', '{count} units', 3)).toBe('3 lokale')
    expect(translatePlural(t, 'pl', 'x.units', '{count} units', 12)).toBe('12 lokali')
  })

  it('falls back to the given text when the key is missing', () => {
    expect(translatePlural(t, 'en', 'missing', '{count} units', 2)).toBe('2 units')
  })
})

describe('withMondayWeekStart', () => {
  it('starts the week on Monday without changing the base locale', () => {
    expect(withMondayWeekStart(enUS).options?.weekStartsOn).toBe(1)
    expect(enUS.options?.weekStartsOn).toBe(0)
  })
})

describe('formatWallClockTime', () => {
  it('formats the wall-clock time in the reader locale', () => {
    expect(formatWallClockTime('2026-11-12T09:00', 'en-US').replace(/\s/g, ' ')).toBe('9:00 AM')
    expect(formatWallClockTime('2026-11-12T17:30', 'pl')).toBe('17:30')
  })
})

describe('isCalendarDate', () => {
  it('accepts real days only', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-2-3')).toBe(false)
  })
})

describe('verticalNeighbour', () => {
  const tile = (id: string, x: number, y: number) => ({ id, x, y, width: 4, depth: 4 })
  const left = tile('left', 0, 0)
  const right = tile('right', 5, 0.3)
  const below = tile('below', 0.5, 6)
  const units = [left, right, below]

  it('treats tiles whose vertical centres are close as one row', () => {
    expect(sameTileRow(left, right)).toBe(true)
    expect(sameTileRow(left, below)).toBe(false)
  })

  it('skips a slightly offset tile in the same row', () => {
    expect(verticalNeighbour(units, left, 1)?.id).toBe('below')
    expect(verticalNeighbour(units, right, 1)?.id).toBe('below')
    expect(verticalNeighbour(units, right, -1)).toBeNull()
  })

  it('moves up to the nearest tile in the row above', () => {
    expect(verticalNeighbour(units, below, -1)?.id).toBe('left')
  })

  it('moves down past a deeper top-aligned tile to the tile below', () => {
    const small = { id: 'S', x: 0, y: 0, width: 3, depth: 2 }
    const deep = { id: 'T', x: 3, y: 0, width: 3, depth: 4 }
    const under = { id: 'U', x: 0, y: 5, width: 3, depth: 2 }
    expect(verticalNeighbour([small, deep, under], small, 1)?.id).toBe('U')
    expect(verticalNeighbour([small, deep, under], under, -1)?.id).toBe('S')
  })

  it('moves through the rows of stacked small tiles beside a tall tile', () => {
    const tall = { id: 'tall', x: 0, y: 0, width: 3, depth: 10 }
    const first = { id: 's1', x: 3, y: 0, width: 3, depth: 2 }
    const second = { id: 's2', x: 3, y: 4, width: 3, depth: 2 }
    const third = { id: 's3', x: 3, y: 8, width: 3, depth: 2 }
    const stack = [tall, first, second, third]
    expect(verticalNeighbour(stack, tall, -1)).toBeNull()
    expect(verticalNeighbour(stack, tall, 1)?.id).toBe('s2')
    expect(verticalNeighbour(stack, second, -1)?.id).toBe('s1')
    expect(verticalNeighbour(stack, second, 1)?.id).toBe('s3')
  })

  it('moves into the next row even when its tiles overlap the current one', () => {
    const first = { id: 'A', x: 0, y: 0, width: 4, depth: 4 }
    const second = { id: 'B', x: 5, y: 3, width: 4, depth: 4 }
    const strip = { id: 'C', x: 10, y: 3.5, width: 4, depth: 1 }
    const units = [first, second, strip]
    expect(verticalNeighbour(units, first, 1)?.id).toBe('B')
    expect(verticalNeighbour(units, second, -1)?.id).toBe('A')
    expect(verticalNeighbour(units, strip, -1)?.id).toBe('A')
    expect(verticalNeighbour(units, first, -1)).toBeNull()
    expect(verticalNeighbour(units, second, 1)).toBeNull()
  })

  it('returns no neighbour when nothing is above or below', () => {
    const lone = tile('lone', 0, 0)
    const beside = tile('beside', 5, 0)
    expect(verticalNeighbour([lone, beside], lone, 1)).toBeNull()
    expect(verticalNeighbour([lone, beside], lone, -1)).toBeNull()
  })
})

describe('readingOrder', () => {
  it('reads slightly offset tiles as one row from left to right', () => {
    const units = [
      { id: 'A', x: 0, y: 0.3, width: 4, depth: 4 },
      { id: 'B', x: 5, y: 0, width: 4, depth: 4 },
      { id: 'C', x: 10, y: 0.2, width: 4, depth: 4 },
      { id: 'D', x: 0, y: 6, width: 4, depth: 4 },
    ]
    expect(readingOrder(units).map((unit) => unit.id)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('keeps a deeper top-aligned tile in the first row', () => {
    const units = [
      { id: 'U', x: 0, y: 5, width: 3, depth: 2 },
      { id: 'T', x: 3, y: 0, width: 3, depth: 4 },
      { id: 'S', x: 0, y: 0, width: 3, depth: 2 },
    ]
    expect(readingOrder(units).map((unit) => unit.id)).toEqual(['S', 'T', 'U'])
  })
})

describe('tileRows', () => {
  const square = (id: string, x: number, y: number) => ({ id, x, y, width: 5, depth: 5 })
  const idsOf = (rows: { id: string }[][]) => rows.map((row) => row.map((unit) => unit.id))

  it('splits a grid beside a tall tile on the left into its own rows', () => {
    const units = [
      { id: 'tall', x: 0, y: 0, width: 5, depth: 10 },
      square('a', 5, 0),
      square('b', 10, 0),
      square('c', 5, 5),
      square('d', 10, 5),
    ]
    expect(idsOf(tileRows(units))).toEqual([['tall', 'a', 'b'], ['c', 'd']])
  })

  it('splits a grid beside a tall tile on the right into its own rows', () => {
    const units = [
      square('a', 0, 0),
      square('b', 5, 0),
      { id: 'tall', x: 10, y: 0, width: 5, depth: 10 },
      square('c', 0, 5),
      square('d', 5, 5),
    ]
    expect(idsOf(tileRows(units))).toEqual([['a', 'b', 'tall'], ['c', 'd']])
  })

  it('keeps a deep tile out of a row it shares with only one member', () => {
    const units = [
      { id: 'first', x: 0, y: 0, width: 5, depth: 10 },
      { id: 'shallow', x: 5, y: 0, width: 5, depth: 4 },
      { id: 'deep', x: 10, y: 4, width: 5, depth: 10 },
    ]
    expect(idsOf(tileRows(units))).toEqual([['first', 'shallow'], ['deep']])
  })

  it('puts a tile in the row it overlaps most, not the first row it touches', () => {
    const units = [
      { id: 'A', x: 0, y: 0, width: 4, depth: 4 },
      { id: 'B', x: 5, y: 3, width: 4, depth: 4 },
      { id: 'C', x: 10, y: 3.5, width: 4, depth: 1 },
    ]
    expect(idsOf(tileRows(units))).toEqual([['A'], ['B', 'C']])
  })
})

describe('hatchedSubjects', () => {
  const rect = { x: 0, y: 0, width: 4, depth: 4 }
  const layout = {
    building: { id: 'building', name: 'B', address: '', status: 'active', updatedAt: '' },
    floor: { id: 'floor', number: 0, name: 'Ground', sizeX: 20, sizeY: 10, updatedAt: '' },
    floors: [],
    spaces: [
      { ...rect, id: 'east', name: 'East', purpose: null, isDefault: false, unitCount: 1, updatedAt: '' },
      { ...rect, id: 'west', name: 'West', purpose: null, isDefault: false, unitCount: 1, updatedAt: '' },
    ],
    units: [
      { ...rect, id: 'east-unit', name: 'E1', spaceId: 'east', catalogCategoryId: 'c', catalogProductId: 'p', categoryName: null, productName: null, use: 'leasable', hasBlockers: false, updatedAt: '' },
      { ...rect, id: 'west-unit', name: 'W1', spaceId: 'west', catalogCategoryId: 'c', catalogProductId: 'p', categoryName: null, productName: null, use: 'bookable', hasBlockers: false, updatedAt: '' },
    ],
    commonAreas: [],
  } satisfies FloorLayoutData

  it('hatches the units of a closed space', () => {
    const hatched = hatchedSubjects(layout, new Set(['east']))
    expect(hatched.floor).toBe(false)
    expect([...hatched.unitIds]).toEqual(['east-unit'])
  })

  it('hatches every space and unit of a closed floor, building or archived building', () => {
    for (const hatched of [
      hatchedSubjects(layout, new Set(['floor'])),
      hatchedSubjects(layout, new Set(['building'])),
      hatchedSubjects({ ...layout, building: { ...layout.building, status: 'archived' } }, new Set()),
    ]) {
      expect(hatched.floor).toBe(true)
      expect([...hatched.spaceIds]).toEqual(['east', 'west'])
      expect([...hatched.unitIds]).toEqual(['east-unit', 'west-unit'])
    }
  })

  it('hatches a unit closed on its own', () => {
    expect([...hatchedSubjects(layout, new Set(['west-unit'])).unitIds]).toEqual(['west-unit'])
  })
})
