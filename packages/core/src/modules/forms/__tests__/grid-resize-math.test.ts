import { computeResizedSpan, GAP_PX } from '../backend/forms/[id]/studio/canvas/resize-math'

describe('computeResizedSpan', () => {
  it('columns=2: dragging past the half-width of the sibling expands span=1 to span=2', () => {
    const sectionLeft = 0
    const sectionWidth = 408
    const colWidth = (sectionWidth - GAP_PX.md) / 2
    const fieldLeft = sectionLeft
    const siblingLeft = fieldLeft + colWidth + GAP_PX.md
    const pointerClientX = siblingLeft + colWidth / 2 + 1
    const result = computeResizedSpan({
      sectionLeft,
      sectionWidth,
      fieldLeft,
      pointerClientX,
      columns: 2,
      startSpan: 1,
      gapPx: GAP_PX.md,
    })
    expect(result).toBe(2)
  })

  it('columns=4: dragging past 1/2/3 column boundaries returns 2/3/4 respectively from start col=0', () => {
    const sectionLeft = 100
    const sectionWidth = 480
    const columns = 4
    const gapPx = GAP_PX.md
    const colWidth = (sectionWidth - (columns - 1) * gapPx) / columns
    const fieldLeft = sectionLeft

    const pointerForTargetSpan = (target: number): number =>
      fieldLeft + (target - 1) * (colWidth + gapPx) + colWidth / 2

    expect(
      computeResizedSpan({
        sectionLeft,
        sectionWidth,
        fieldLeft,
        pointerClientX: pointerForTargetSpan(2),
        columns: 4,
        startSpan: 1,
        gapPx,
      }),
    ).toBe(2)
    expect(
      computeResizedSpan({
        sectionLeft,
        sectionWidth,
        fieldLeft,
        pointerClientX: pointerForTargetSpan(3),
        columns: 4,
        startSpan: 1,
        gapPx,
      }),
    ).toBe(3)
    expect(
      computeResizedSpan({
        sectionLeft,
        sectionWidth,
        fieldLeft,
        pointerClientX: pointerForTargetSpan(4),
        columns: 4,
        startSpan: 1,
        gapPx,
      }),
    ).toBe(4)
  })

  it('columns=4: field at colIndex=2 can only grow to span=2 max', () => {
    const sectionLeft = 0
    const sectionWidth = 480
    const columns = 4
    const gapPx = GAP_PX.md
    const colWidth = (sectionWidth - (columns - 1) * gapPx) / columns
    const fieldLeft = sectionLeft + 2 * (colWidth + gapPx)
    const pointerClientX = sectionLeft + sectionWidth + 200
    const result = computeResizedSpan({
      sectionLeft,
      sectionWidth,
      fieldLeft,
      pointerClientX,
      columns: 4,
      startSpan: 1,
      gapPx,
    })
    expect(result).toBe(2)
  })

  it('pointer to the LEFT of the field returns 1 (minimum)', () => {
    const sectionLeft = 0
    const sectionWidth = 408
    const colWidth = (sectionWidth - GAP_PX.md) / 2
    const fieldLeft = sectionLeft + colWidth + GAP_PX.md
    const pointerClientX = sectionLeft - 50
    const result = computeResizedSpan({
      sectionLeft,
      sectionWidth,
      fieldLeft,
      pointerClientX,
      columns: 2,
      startSpan: 1,
      gapPx: GAP_PX.md,
    })
    expect(result).toBe(1)
  })

  it('pointer way off-screen right clamps to columns - startColIndex', () => {
    const sectionLeft = 0
    const sectionWidth = 480
    const columns = 4
    const gapPx = GAP_PX.md
    const colWidth = (sectionWidth - (columns - 1) * gapPx) / columns
    const fieldLeft = sectionLeft + 1 * (colWidth + gapPx)
    const pointerClientX = sectionLeft + sectionWidth + 5000
    const result = computeResizedSpan({
      sectionLeft,
      sectionWidth,
      fieldLeft,
      pointerClientX,
      columns: 4,
      startSpan: 1,
      gapPx,
    })
    expect(result).toBe(3)
  })

  it('columns=1 returns 1 regardless of pointer', () => {
    const result = computeResizedSpan({
      sectionLeft: 0,
      sectionWidth: 400,
      fieldLeft: 0,
      pointerClientX: 9999,
      columns: 1,
      startSpan: 1,
      gapPx: GAP_PX.md,
    })
    expect(result).toBe(1)
  })

  it('zero / non-finite column width falls back to startSpan', () => {
    const result = computeResizedSpan({
      sectionLeft: 0,
      sectionWidth: 0,
      fieldLeft: 0,
      pointerClientX: 100,
      columns: 4,
      startSpan: 2,
      gapPx: GAP_PX.md,
    })
    expect(result).toBe(2)
  })
})
