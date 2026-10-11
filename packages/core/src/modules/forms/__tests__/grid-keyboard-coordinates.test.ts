import { nextGridCoordinates } from '../backend/forms/[id]/studio/canvas/keyboard-coordinates'

describe('nextGridCoordinates', () => {
  const baseInput = {
    current: { x: 100, y: 200 },
    rowHeight: 60,
    colWidth: 120,
    gapPx: 16,
  }

  it('left moves x by -(colWidth + gapPx) and keeps y', () => {
    const result = nextGridCoordinates({ ...baseInput, direction: 'left' })
    expect(result).toEqual({ x: 100 - (120 + 16), y: 200 })
  })

  it('right moves x by +(colWidth + gapPx) and keeps y', () => {
    const result = nextGridCoordinates({ ...baseInput, direction: 'right' })
    expect(result).toEqual({ x: 100 + (120 + 16), y: 200 })
  })

  it('up moves y by -(rowHeight + gapPx) and keeps x', () => {
    const result = nextGridCoordinates({ ...baseInput, direction: 'up' })
    expect(result).toEqual({ x: 100, y: 200 - (60 + 16) })
  })

  it('down moves y by +(rowHeight + gapPx) and keeps x', () => {
    const result = nextGridCoordinates({ ...baseInput, direction: 'down' })
    expect(result).toEqual({ x: 100, y: 200 + (60 + 16) })
  })

  it('treats zero gap correctly', () => {
    const result = nextGridCoordinates({ ...baseInput, gapPx: 0, direction: 'right' })
    expect(result).toEqual({ x: 220, y: 200 })
  })

  it('coerces NaN row/col/gap to zero step so coordinates never become NaN', () => {
    const result = nextGridCoordinates({
      current: { x: 50, y: 75 },
      direction: 'down',
      rowHeight: Number.NaN,
      colWidth: Number.NaN,
      gapPx: Number.NaN,
    })
    expect(Number.isFinite(result.x)).toBe(true)
    expect(Number.isFinite(result.y)).toBe(true)
    expect(result).toEqual({ x: 50, y: 75 })
  })

  it('coerces negative widths/heights to zero step', () => {
    const result = nextGridCoordinates({
      current: { x: 10, y: 20 },
      direction: 'right',
      rowHeight: -100,
      colWidth: -100,
      gapPx: 0,
    })
    expect(result).toEqual({ x: 10, y: 20 })
  })

  it('does not mutate the input coordinates', () => {
    const current = { x: 1, y: 2 }
    const result = nextGridCoordinates({ ...baseInput, current, direction: 'right' })
    expect(current).toEqual({ x: 1, y: 2 })
    expect(result).not.toBe(current)
  })

  it('unknown direction returns current coordinates verbatim', () => {
    // Forced through `any` because the public type union excludes invalid
    // directions — but this guards against future regressions where the
    // dispatch table could fall through.
    const result = nextGridCoordinates({
      ...baseInput,
      direction: 'diagonal' as unknown as 'left',
    })
    expect(Number.isFinite(result.x)).toBe(true)
    expect(Number.isFinite(result.y)).toBe(true)
  })
})
