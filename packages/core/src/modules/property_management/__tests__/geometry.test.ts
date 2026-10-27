import {
  checkPlacement,
  clampInto,
  containingRect,
  firstConflicts,
  fitsInside,
  isValidRect,
  outsideOf,
  overlaps,
  rectArea,
  snapTo,
  toRect,
  type PlacementContext,
} from '../lib/geometry'

const floor = { x: 0, y: 0, width: 42, depth: 18 }

function context(): PlacementContext {
  return {
    floor,
    spaces: [
      { id: 'reception', name: 'Reception', x: 0, y: 0, width: 8, depth: 12 },
      { id: 'coworking', name: 'Coworking', x: 8, y: 0, width: 20, depth: 18 },
      { id: 'parking', name: 'Parking', x: 28, y: 0, width: 14, depth: 18 },
    ],
    units: [
      { id: 'hall', name: 'Coworking hall', spaceId: 'coworking', x: 8, y: 0, width: 20, depth: 12 },
      { id: 'desks', name: 'Dedicated desks', spaceId: 'coworking', x: 12, y: 12, width: 8, depth: 6 },
    ],
    commonAreas: [
      { id: 'kitchen', name: 'Kitchen', x: 24, y: 12, width: 4, depth: 6 },
      { id: 'toilets', name: 'Toilets', x: 4, y: 8, width: 4, depth: 4 },
    ],
  }
}

describe('geometry primitives', () => {
  it('converts numeric strings into rectangles', () => {
    expect(toRect({ x: '1.50', y: '2', width: '3.25', depth: 4 })).toEqual({ x: 1.5, y: 2, width: 3.25, depth: 4 })
  })

  it('treats touching edges as fitting and not overlapping', () => {
    const left = { x: 0, y: 0, width: 5, depth: 5 }
    const right = { x: 5, y: 0, width: 5, depth: 5 }
    expect(overlaps(left, right)).toBe(false)
    expect(fitsInside(left, floor)).toBe(true)
  })

  it('applies the 0.01 m tolerance', () => {
    expect(fitsInside({ x: 0, y: 0, width: 42.005, depth: 18 }, floor)).toBe(true)
    expect(fitsInside({ x: 0, y: 0, width: 42.02, depth: 18 }, floor)).toBe(false)
    expect(overlaps({ x: 0, y: 0, width: 5.005, depth: 5 }, { x: 5, y: 0, width: 5, depth: 5 })).toBe(false)
    expect(overlaps({ x: 0, y: 0, width: 5.5, depth: 5 }, { x: 5, y: 0, width: 5, depth: 5 })).toBe(true)
  })

  it('lists conflicts, stranded items and the containing rectangle', () => {
    const ctx = context()
    expect(firstConflicts({ x: 22, y: 14, width: 4, depth: 2 }, ctx.commonAreas).map((item) => item.name)).toEqual(['Kitchen'])
    expect(outsideOf({ x: 8, y: 0, width: 20, depth: 12 }, ctx.units).map((item) => item.name)).toEqual(['Dedicated desks'])
    expect(containingRect({ x: 30, y: 2, width: 2.5, depth: 5 }, ctx.spaces)?.name).toBe('Parking')
    expect(containingRect({ x: 26, y: 2, width: 4, depth: 5 }, ctx.spaces)).toBeNull()
  })

  it('snaps, clamps, rounds areas and rejects empty sizes', () => {
    expect(snapTo(3.26)).toBe(3.5)
    expect(snapTo(3.24)).toBe(3)
    expect(clampInto({ x: 40, y: -3, width: 5, depth: 5 }, floor)).toEqual({ x: 37, y: 0, width: 5, depth: 5 })
    expect(rectArea({ x: 0, y: 0, width: 2.5, depth: 5 })).toBe(12.5)
    expect(isValidRect({ x: 0, y: 0, width: 0, depth: 5 })).toBe(false)
  })
})

describe('checkPlacement', () => {
  it('accepts a unit in a free gap of its space', () => {
    expect(checkPlacement({ kind: 'unit', rect: { x: 20, y: 12, width: 4, depth: 6 }, spaceId: 'coworking' }, context())).toEqual([])
  })

  it('names the unit and common area a unit overlaps', () => {
    const issues = checkPlacement({ kind: 'unit', rect: { x: 18, y: 12, width: 8, depth: 6 }, spaceId: 'coworking' }, context())
    expect(issues).toEqual([
      { code: 'overlaps', kind: 'unit', names: ['Dedicated desks'] },
      { code: 'overlaps', kind: 'common_area', names: ['Kitchen'] },
    ])
  })

  it('names the space a unit does not fit inside', () => {
    const issues = checkPlacement({ kind: 'unit', rect: { x: 6, y: 13, width: 1, depth: 1 }, spaceId: 'reception' }, context())
    expect(issues).toEqual([{ code: 'outside_space', spaceName: 'Reception' }])
  })

  it('ignores the unit itself when editing', () => {
    expect(checkPlacement({ kind: 'unit', rect: { x: 12, y: 12, width: 8, depth: 6 }, selfId: 'desks', spaceId: 'coworking' }, context())).toEqual([])
  })

  it('refuses a space that overlaps another space or leaves the floor', () => {
    expect(checkPlacement({ kind: 'space', rect: { x: 0, y: 10, width: 9, depth: 6 } }, context())).toEqual([
      { code: 'overlaps', kind: 'space', names: ['Reception', 'Coworking'] },
    ])
    expect(checkPlacement({ kind: 'space', rect: { x: 0, y: 14, width: 8, depth: 6 } }, context())).toEqual([{ code: 'outside_floor' }])
  })

  it('names the units a shrunk space would strand', () => {
    const issues = checkPlacement({ kind: 'space', rect: { x: 8, y: 0, width: 20, depth: 12 }, selfId: 'coworking' }, context())
    expect(issues).toEqual([{ code: 'strands_units', names: ['Dedicated desks'] }])
  })

  it('lets a common area sit inside a space but not over a unit', () => {
    expect(checkPlacement({ kind: 'common_area', rect: { x: 0, y: 9, width: 3, depth: 3 } }, context())).toEqual([])
    expect(checkPlacement({ kind: 'common_area', rect: { x: 4, y: 8, width: 4, depth: 4 }, selfId: 'toilets' }, context())).toEqual([])
    expect(checkPlacement({ kind: 'common_area', rect: { x: 10, y: 2, width: 2, depth: 2 } }, context())).toEqual([
      { code: 'overlaps', kind: 'unit', names: ['Coworking hall'] },
    ])
  })

  it('reports an invalid size before anything else', () => {
    expect(checkPlacement({ kind: 'unit', rect: { x: 0, y: 0, width: 0, depth: 2 }, spaceId: 'reception' }, context())).toEqual([{ code: 'invalid_size' }])
  })
})
