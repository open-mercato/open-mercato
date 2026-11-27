import { parseEntryTab, entryTabSearch, resolveEntryTab, tabsForGroup } from '../entry-tabs'
import {
  FRAME_MAX_HEIGHT,
  FRAME_MIN_HEIGHT,
  buildStateRows,
  clampFrameHeight,
  columnWidths,
  defaultStateWidths,
  frameScale,
  matrixLayout,
  scaledFrameHeight,
  toggleStateWidth,
} from '../states-matrix'

describe('entry tabs', () => {
  it('offers the States tab for blocks and screens, and no API tab for screens', () => {
    expect(tabsForGroup('blocks')).toEqual(['usage', 'api', 'source', 'states'])
    expect(tabsForGroup('screens')).toEqual(['usage', 'source', 'states'])
    expect(parseEntryTab('?tab=api', 'screens')).toBe('usage')
    expect(tabsForGroup('components')).toEqual(['usage', 'api', 'source'])
    expect(tabsForGroup('foundations')).toEqual(['usage', 'api', 'source'])
  })

  it('reads the tab from the query and falls back to Usage', () => {
    expect(parseEntryTab('?tab=states', 'blocks')).toBe('states')
    expect(parseEntryTab('?tab=states', 'components')).toBe('usage')
    expect(parseEntryTab('?tab=api', 'components')).toBe('api')
    expect(parseEntryTab('?tab=unknown', 'blocks')).toBe('usage')
    expect(parseEntryTab('', 'blocks')).toBe('usage')
    expect(resolveEntryTab(null, 'blocks')).toBe('usage')
  })

  it('writes the tab into the query and keeps other parameters', () => {
    expect(entryTabSearch('', 'states')).toBe('?tab=states')
    expect(entryTabSearch('?tab=states', 'usage')).toBe('')
    expect(entryTabSearch('?theme=x&tab=api', 'source')).toBe('?theme=x&tab=source')
    expect(entryTabSearch('?theme=x&tab=api', 'usage')).toBe('?theme=x')
  })
})

describe('state widths', () => {
  it('shows two widths on narrow screens and all four on wide ones', () => {
    expect(defaultStateWidths(false)).toEqual([390, 1440])
    expect(defaultStateWidths(true)).toEqual([390, 768, 1024, 1440])
  })

  it('adds a width in ascending order and removes a selected one', () => {
    expect(toggleStateWidth([390, 1440], 768)).toEqual([390, 768, 1440])
    expect(toggleStateWidth([390, 768, 1440], 390)).toEqual([768, 1440])
  })

  it('keeps the last selected width', () => {
    expect(toggleStateWidth([1024], 1024)).toEqual([1024])
  })
})

describe('buildStateRows', () => {
  it('creates one row per variant and one cell per width with the preview address', () => {
    const rows = buildStateRows('kanban', [{ id: 'default', title: 'Default' }, { id: 'empty', title: 'Empty' }], [390, 1440], 'dark')
    expect(rows).toEqual([
      {
        variantId: 'default',
        title: 'Default',
        cells: [
          { width: 390, href: '/preview/kanban/default/?mode=dark' },
          { width: 1440, href: '/preview/kanban/default/?mode=dark' },
        ],
      },
      {
        variantId: 'empty',
        title: 'Empty',
        cells: [
          { width: 390, href: '/preview/kanban/empty/?mode=dark' },
          { width: 1440, href: '/preview/kanban/empty/?mode=dark' },
        ],
      },
    ])
  })
})

describe('columnWidths', () => {
  it('fills the available space, leaving room for the gaps', () => {
    const columns = columnWidths(1100, [390, 768, 1024, 1440], 16, 120)
    const total = columns.reduce((sum, width) => sum + width, 0)
    expect(total).toBeLessThanOrEqual(1100 - 48)
    expect(total).toBeGreaterThan(1100 - 48 - 4)
    expect([...columns].sort((left, right) => left - right)).toEqual(columns)
  })

  it('never renders a frame larger than its real width', () => {
    expect(columnWidths(3000, [390, 1440], 16, 120)).toEqual([390, 1440])
    expect(columnWidths(1400, [390, 1440], 16, 120)).toEqual([390, 994])
  })

  it('raises narrow columns to the minimum and gives the rest to the others', () => {
    expect(columnWidths(358, [390, 1440], 16, 120)).toEqual([120, 222])
  })

  it('falls back to the minimum everywhere when the space is too small', () => {
    expect(columnWidths(200, [390, 768, 1024, 1440], 16, 120)).toEqual([120, 120, 120, 120])
  })

  it('returns nothing for no widths', () => {
    expect(columnWidths(800, [])).toEqual([])
  })
})

describe('matrixLayout', () => {
  it('stacks the frames at full width when the container is narrow', () => {
    expect(matrixLayout(358, [390, 1440])).toEqual({ stacked: true, columns: [358, 358] })
    expect(matrixLayout(500, [390, 1440])).toEqual({ stacked: true, columns: [390, 500] })
  })

  it('places the frames side by side when there is room', () => {
    const layout = matrixLayout(1104, [390, 768, 1024, 1440])
    expect(layout.stacked).toBe(false)
    expect(layout.columns).toEqual(columnWidths(1104, [390, 768, 1024, 1440]))
  })
})

describe('frame geometry', () => {
  it('scales the viewport to the column inside its border', () => {
    expect(frameScale(362, 1440, 1)).toBeCloseTo(0.25)
    expect(frameScale(2000, 1440, 1)).toBe(1)
    expect(frameScale(100, 0, 1)).toBe(1)
  })

  it('bounds the reported height', () => {
    expect(clampFrameHeight(12)).toBe(FRAME_MIN_HEIGHT)
    expect(clampFrameHeight(340.2)).toBe(341)
    expect(clampFrameHeight(99999)).toBe(FRAME_MAX_HEIGHT)
    expect(clampFrameHeight(Number.NaN)).toBe(FRAME_MIN_HEIGHT)
  })

  it('computes the outer height of a scaled frame', () => {
    expect(scaledFrameHeight(400, 0.25, 1)).toBe(102)
  })
})
