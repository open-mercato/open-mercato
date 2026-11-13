import type { Collision } from '@dnd-kit/core'

const gapHit: Collision = { id: 'section-drop:s1:row:0:gap:1' }
const rowGapHit: Collision = { id: 'section-drop:s1:row-gap:1' }
const cellHit: Collision = { id: 'section-drop:s1:row:0:col:0' }
const fieldHit: Collision = { id: 'field:fk-1' }
const sectionHit: Collision = { id: 'section:s1' }

let pointerWithinReturn: Collision[] = []
let closestCornersReturn: Collision[] = []
let closestCenterReturn: Collision[] = []

jest.mock('@dnd-kit/core', () => ({
  pointerWithin: jest.fn(() => pointerWithinReturn),
  closestCorners: jest.fn(() => closestCornersReturn),
  closestCenter: jest.fn(() => closestCenterReturn),
}))

import { gridAwareCollision } from '../backend/forms/[id]/studio/canvas/grid-collision'

const fakeArgs = {} as Parameters<typeof gridAwareCollision>[0]

describe('gridAwareCollision', () => {
  beforeEach(() => {
    pointerWithinReturn = []
    closestCornersReturn = []
    closestCenterReturn = []
  })

  it('returns the gap collision when pointer is over a col-gap droppable', () => {
    pointerWithinReturn = [cellHit, gapHit, fieldHit]
    const result = gridAwareCollision(fakeArgs)
    expect(result).toEqual([gapHit])
  })

  it('returns the gap collision when pointer is over a row-gap droppable', () => {
    pointerWithinReturn = [cellHit, rowGapHit]
    const result = gridAwareCollision(fakeArgs)
    expect(result).toEqual([rowGapHit])
  })

  it('falls back to closestCorners when pointer is over a field but no gaps', () => {
    pointerWithinReturn = [fieldHit, sectionHit]
    closestCornersReturn = [fieldHit]
    const result = gridAwareCollision(fakeArgs)
    expect(result).toEqual([fieldHit])
  })

  it('falls back to closestCorners when pointerWithin is empty', () => {
    closestCornersReturn = [sectionHit]
    const result = gridAwareCollision(fakeArgs)
    expect(result).toEqual([sectionHit])
  })

  it('falls back to closestCenter when corners returns empty too', () => {
    closestCenterReturn = [fieldHit]
    const result = gridAwareCollision(fakeArgs)
    expect(result).toEqual([fieldHit])
  })

  it('returns only gap collisions when multiple gaps overlap, omitting non-gap hits', () => {
    const secondGap: Collision = { id: 'section-drop:s1:row:0:gap:2' }
    pointerWithinReturn = [gapHit, secondGap, cellHit]
    const result = gridAwareCollision(fakeArgs)
    expect(result).toHaveLength(2)
    expect(result.every((c) => String(c.id).includes(':gap:') || String(c.id).includes('row-gap'))).toBe(true)
  })

  it('returns an empty array when no algorithm produced hits', () => {
    const result = gridAwareCollision(fakeArgs)
    expect(result).toEqual([])
  })
})
