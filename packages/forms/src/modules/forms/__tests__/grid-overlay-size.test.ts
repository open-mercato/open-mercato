import { computeOverlayWidthPx } from '../backend/forms/[id]/studio/canvas/overlay-size'

describe('computeOverlayWidthPx', () => {
  it('columns=1, span=1, gap=md, width=400 returns full width', () => {
    expect(
      computeOverlayWidthPx({ sectionWidthPx: 400, columns: 1, span: 1, gap: 'md' }),
    ).toBe(400)
  })

  it('columns=4, span=1, gap=md returns single column width (88)', () => {
    expect(
      computeOverlayWidthPx({ sectionWidthPx: 400, columns: 4, span: 1, gap: 'md' }),
    ).toBe(88)
  })

  it('columns=4, span=2, gap=md returns two cells + one gap (192)', () => {
    expect(
      computeOverlayWidthPx({ sectionWidthPx: 400, columns: 4, span: 2, gap: 'md' }),
    ).toBe(192)
  })

  it('columns=4, span=4, gap=md returns full section width (400)', () => {
    expect(
      computeOverlayWidthPx({ sectionWidthPx: 400, columns: 4, span: 4, gap: 'md' }),
    ).toBe(400)
  })

  it('columns=2, span=4 (over-span) clamps to columns and returns full section width', () => {
    expect(
      computeOverlayWidthPx({ sectionWidthPx: 400, columns: 2, span: 4, gap: 'md' }),
    ).toBe(400)
  })
})
