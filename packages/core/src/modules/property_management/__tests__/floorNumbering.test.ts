import {
  addedFloorNumbers,
  countsFromNumbers,
  isContiguousLayout,
  layoutFloors,
  minimumCounts,
  removedFloorNumbers,
} from '../lib/floorNumbering'

describe('layoutFloors', () => {
  it('numbers floors from the below/above-ground counts with ground floor 0', () => {
    expect(layoutFloors(1, 3)).toEqual([-1, 0, 1, 2])
    expect(layoutFloors(0, 1)).toEqual([0])
    expect(layoutFloors(2, 0)).toEqual([-2, -1])
  })

  it('ignores negative and fractional counts', () => {
    expect(layoutFloors(-2, 2.7)).toEqual([0, 1])
  })
})

describe('counts', () => {
  it('derives counts and checks contiguity', () => {
    expect(countsFromNumbers([-1, 0, 1, 2])).toEqual({ below: 1, above: 3 })
    expect(isContiguousLayout([2, 0, -1, 1])).toBe(true)
    expect(isContiguousLayout([0, 2])).toBe(false)
    expect(isContiguousLayout([-2, 0])).toBe(false)
  })

  it('finds the floors added and removed by new counts', () => {
    expect(removedFloorNumbers([-1, 0, 1, 2], 0, 2)).toEqual([-1, 2])
    expect(addedFloorNumbers([0, 1], 1, 3)).toEqual([-1, 2])
  })
})

describe('minimumCounts', () => {
  it('keeps the ground floor and every floor that still holds units', () => {
    expect(minimumCounts([])).toEqual({ minimumBelow: 0, minimumAbove: 1, blockingBelow: null, blockingAbove: null })
    expect(
      minimumCounts([
        { number: -2, unitCount: 3 },
        { number: -1, unitCount: 0 },
        { number: 0, unitCount: 5 },
        { number: 2, unitCount: 9 },
        { number: 3, unitCount: 0 },
      ]),
    ).toEqual({ minimumBelow: 2, minimumAbove: 3, blockingBelow: -2, blockingAbove: 2 })
  })

  it('names the ground floor when it is the only one with units', () => {
    expect(minimumCounts([{ number: 0, unitCount: 1 }, { number: 1, unitCount: 0 }])).toEqual({
      minimumBelow: 0,
      minimumAbove: 1,
      blockingBelow: null,
      blockingAbove: 0,
    })
  })
})
