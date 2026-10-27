export type FloorCounts = { below: number; above: number }

export type FloorOccupancy = { number: number; unitCount: number }

export type MinimumCounts = {
  minimumBelow: number
  minimumAbove: number
  blockingBelow: number | null
  blockingAbove: number | null
}

export function layoutFloors(below: number, above: number): number[] {
  const safeBelow = Math.max(0, Math.floor(below))
  const safeAbove = Math.max(0, Math.floor(above))
  const numbers: number[] = []
  for (let index = safeBelow; index >= 1; index -= 1) numbers.push(-index)
  for (let index = 0; index < safeAbove; index += 1) numbers.push(index)
  return numbers
}

export function countsFromNumbers(numbers: readonly number[]): FloorCounts {
  let below = 0
  let above = 0
  for (const value of numbers) {
    if (value < 0) below += 1
    else above += 1
  }
  return { below, above }
}

export function isContiguousLayout(numbers: readonly number[]): boolean {
  const { below, above } = countsFromNumbers(numbers)
  const expected = layoutFloors(below, above)
  if (expected.length !== numbers.length) return false
  const sorted = [...numbers].sort((left, right) => left - right)
  return expected.every((value, index) => value === sorted[index])
}

export function minimumCounts(floors: readonly FloorOccupancy[]): MinimumCounts {
  let minimumBelow = 0
  let minimumAbove = 1
  let blockingBelow: number | null = null
  let blockingAbove: number | null = null
  for (const floor of floors) {
    if (floor.unitCount <= 0) continue
    if (floor.number < 0) {
      const required = -floor.number
      if (required > minimumBelow) {
        minimumBelow = required
        blockingBelow = floor.number
      }
    } else {
      const required = floor.number + 1
      if (required > minimumAbove || (required === minimumAbove && blockingAbove === null)) {
        minimumAbove = required
        blockingAbove = floor.number
      }
    }
  }
  return { minimumBelow, minimumAbove, blockingBelow, blockingAbove }
}

export function removedFloorNumbers(current: readonly number[], below: number, above: number): number[] {
  const next = new Set(layoutFloors(below, above))
  return current.filter((value) => !next.has(value))
}

export function addedFloorNumbers(current: readonly number[], below: number, above: number): number[] {
  const existing = new Set(current)
  return layoutFloors(below, above).filter((value) => !existing.has(value))
}
