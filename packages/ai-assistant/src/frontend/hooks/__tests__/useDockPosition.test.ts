import {
  MIN_DOCKED_CONTENT_WIDTH,
  resolveViewportSafeDockPosition,
} from '../useDockPosition'

describe('resolveViewportSafeDockPosition', () => {
  const PANEL_WIDTH = 550

  it('keeps floating regardless of viewport width', () => {
    expect(resolveViewportSafeDockPosition('floating', PANEL_WIDTH, 320)).toBe('floating')
    expect(resolveViewportSafeDockPosition('floating', PANEL_WIDTH, 1920)).toBe('floating')
  })

  it('keeps bottom dock even on a narrow viewport (it does not reduce content width)', () => {
    expect(resolveViewportSafeDockPosition('bottom', PANEL_WIDTH, 600)).toBe('bottom')
  })

  it('keeps a side dock when enough content width remains', () => {
    // 1440 - 550 = 890 >= 640
    expect(resolveViewportSafeDockPosition('right', PANEL_WIDTH, 1440)).toBe('right')
    expect(resolveViewportSafeDockPosition('left', PANEL_WIDTH, 1440)).toBe('left')
  })

  it('falls back to floating when a side dock would squeeze content below the threshold', () => {
    // 1024 - 550 = 474 < 640
    expect(resolveViewportSafeDockPosition('right', PANEL_WIDTH, 1024)).toBe('floating')
    expect(resolveViewportSafeDockPosition('left', PANEL_WIDTH, 1024)).toBe('floating')
  })

  it('falls back to floating when a wide side panel leaves too little room on a common laptop width', () => {
    // 1280 - 900 (max panel) = 380 < 640
    expect(resolveViewportSafeDockPosition('right', 900, 1280)).toBe('floating')
  })

  it('treats the threshold as inclusive (exactly MIN_DOCKED_CONTENT_WIDTH of content is allowed)', () => {
    const viewportWidth = PANEL_WIDTH + MIN_DOCKED_CONTENT_WIDTH
    expect(resolveViewportSafeDockPosition('right', PANEL_WIDTH, viewportWidth)).toBe('right')
    expect(resolveViewportSafeDockPosition('right', PANEL_WIDTH, viewportWidth - 1)).toBe('floating')
  })

  it('allows a side dock when viewport width is unknown (SSR / non-browser)', () => {
    expect(resolveViewportSafeDockPosition('right', PANEL_WIDTH, Number.POSITIVE_INFINITY)).toBe('right')
  })
})
