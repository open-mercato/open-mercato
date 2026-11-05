import { computeMenuViewportShiftX } from '../viewport'

describe('computeMenuViewportShiftX', () => {
  const viewport = 390

  it('returns 0 when the overlay already fits within the viewport', () => {
    expect(computeMenuViewportShiftX({ left: 100, right: 340 }, viewport)).toBe(0)
  })

  it('shifts right when the overlay bleeds off the left edge', () => {
    // Export dropdown reproduction: left:-38 on a narrow phone.
    expect(computeMenuViewportShiftX({ left: -38, right: 202 }, viewport)).toBe(46)
  })

  it('shifts left (negative) when the overlay bleeds off the right edge', () => {
    expect(computeMenuViewportShiftX({ left: 200, right: 440 }, viewport)).toBe(-58)
  })

  it('respects a custom margin', () => {
    expect(computeMenuViewportShiftX({ left: 2, right: 200 }, viewport, 16)).toBe(14)
  })

  it('leaves overlays flush to the margin untouched', () => {
    expect(computeMenuViewportShiftX({ left: 8, right: 382 }, viewport)).toBe(0)
  })
})
