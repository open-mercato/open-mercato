import {
  computeRowLayout,
  dropHintToLinearIndex,
} from '../backend/forms/[id]/studio/canvas/row-layout'

describe('computeRowLayout', () => {
  it('columns=1: every field is its own row, empty layout has zero rows', () => {
    const empty = computeRowLayout({ fieldKeys: [], spans: {}, columns: 1 })
    expect(empty.rows).toHaveLength(0)
    expect(empty.totalFields).toBe(0)

    const result = computeRowLayout({
      fieldKeys: ['a', 'b', 'c'],
      spans: { a: 1, b: undefined, c: 4 },
      columns: 1,
    })
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0].cells).toEqual([
      { kind: 'field', fieldKey: 'a', span: 1, linearIndex: 0 },
    ])
    expect(result.rows[1].cells).toEqual([
      { kind: 'field', fieldKey: 'b', span: 1, linearIndex: 1 },
    ])
    // span=4 clamps to columns=1
    expect(result.rows[2].cells).toEqual([
      { kind: 'field', fieldKey: 'c', span: 1, linearIndex: 2 },
    ])
  })

  it('columns=2: two span-1 fields share a row; span-2 fills its own row; clamps oversize spans', () => {
    const result = computeRowLayout({
      fieldKeys: ['a', 'b', 'c', 'd'],
      spans: { a: 1, b: 1, c: 2, d: 3 },
      columns: 2,
    })
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0].cells).toEqual([
      { kind: 'field', fieldKey: 'a', span: 1, linearIndex: 0 },
      { kind: 'field', fieldKey: 'b', span: 1, linearIndex: 1 },
    ])
    expect(result.rows[1].cells).toEqual([
      { kind: 'field', fieldKey: 'c', span: 2, linearIndex: 2 },
    ])
    // span=3 clamps to columns=2
    expect(result.rows[2].cells).toEqual([
      { kind: 'field', fieldKey: 'd', span: 2, linearIndex: 3 },
    ])
  })

  it('columns=3: span-2 + span-1 share a row; span-2 + span-2 wraps', () => {
    const result = computeRowLayout({
      fieldKeys: ['a', 'b', 'c', 'd'],
      spans: { a: 2, b: 1, c: 2, d: 2 },
      columns: 3,
    })
    expect(result.rows).toHaveLength(3)
    // Row 0 fills exactly (2+1=3): no padding.
    expect(result.rows[0].cells).toEqual([
      { kind: 'field', fieldKey: 'a', span: 2, linearIndex: 0 },
      { kind: 'field', fieldKey: 'b', span: 1, linearIndex: 1 },
    ])
    // span-2 'c' fills 2 of 3 cols, then 'd' wraps because 2+2 > 3.
    expect(result.rows[1].cells).toEqual([
      { kind: 'field', fieldKey: 'c', span: 2, linearIndex: 2 },
      { kind: 'empty', span: 1 },
    ])
    expect(result.rows[2].cells).toEqual([
      { kind: 'field', fieldKey: 'd', span: 2, linearIndex: 3 },
      { kind: 'empty', span: 1 },
    ])
  })

  it('columns=4: four span-1s share a row; span-3 + span-1 share a row; span-4 fills row; padding tail', () => {
    const result = computeRowLayout({
      fieldKeys: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      spans: {
        a: 1, b: 1, c: 1, d: 1,
        e: 3, f: 1,
        g: 4,
        h: 1, i: 1,
      },
      columns: 4,
    })
    expect(result.rows).toHaveLength(4)
    expect(result.rows[0].cells).toHaveLength(4)
    expect(result.rows[0].cells.map((cell) => cell.kind)).toEqual(['field', 'field', 'field', 'field'])
    expect(result.rows[1].cells).toEqual([
      { kind: 'field', fieldKey: 'e', span: 3, linearIndex: 4 },
      { kind: 'field', fieldKey: 'f', span: 1, linearIndex: 5 },
    ])
    expect(result.rows[2].cells).toEqual([
      { kind: 'field', fieldKey: 'g', span: 4, linearIndex: 6 },
    ])
    // 'h' + 'i' take 2 of 4 cols — pad with 2 empty cells
    expect(result.rows[3].cells).toEqual([
      { kind: 'field', fieldKey: 'h', span: 1, linearIndex: 7 },
      { kind: 'field', fieldKey: 'i', span: 1, linearIndex: 8 },
      { kind: 'empty', span: 1 },
      { kind: 'empty', span: 1 },
    ])
  })
})

describe('dropHintToLinearIndex', () => {
  it('returns 0 for row=0 col=0 in an empty section', () => {
    const layout = computeRowLayout({ fieldKeys: [], spans: {}, columns: 3 })
    expect(dropHintToLinearIndex({ layout, rowIndex: 0, columnIndex: 0 })).toBe(0)
  })

  it('returns fieldKeys.length when dropping into a row past the layout', () => {
    const layout = computeRowLayout({
      fieldKeys: ['a', 'b', 'c'],
      spans: { a: 1, b: 1, c: 1 },
      columns: 2,
    })
    expect(dropHintToLinearIndex({ layout, rowIndex: 5, columnIndex: 0 })).toBe(3)
  })

  it('returns the field linearIndex when dropping on a field cell', () => {
    const layout = computeRowLayout({
      fieldKeys: ['a', 'b', 'c', 'd'],
      spans: { a: 1, b: 1, c: 1, d: 1 },
      columns: 2,
    })
    // row 1 = [c, d]; col 0 → c (index 2)
    expect(dropHintToLinearIndex({ layout, rowIndex: 1, columnIndex: 0 })).toBe(2)
    // row 1 col 1 → d (index 3)
    expect(dropHintToLinearIndex({ layout, rowIndex: 1, columnIndex: 1 })).toBe(3)
  })

  it('returns "after last field of row" when dropping at the tail empty cell', () => {
    const layout = computeRowLayout({
      fieldKeys: ['a', 'b'],
      spans: { a: 1, b: 1 },
      columns: 4,
    })
    // row 0 = [a, b, empty, empty]; col 2/3 → past last field → 2
    expect(dropHintToLinearIndex({ layout, rowIndex: 0, columnIndex: 2 })).toBe(2)
    expect(dropHintToLinearIndex({ layout, rowIndex: 0, columnIndex: 3 })).toBe(2)
  })

  it('returns "next valid linear index" when dropping at a column past the last field of a row', () => {
    const layout = computeRowLayout({
      fieldKeys: ['a', 'b', 'c'],
      spans: { a: 2, b: 1, c: 1 },
      columns: 3,
    })
    // row 0 = [a(span=2), b(span=1)]; col 2 hits b cell → linearIndex 1
    expect(dropHintToLinearIndex({ layout, rowIndex: 0, columnIndex: 2 })).toBe(1)
    // row 1 = [c, empty, empty]; col 1 → past last field of row → linearIndex 3
    expect(dropHintToLinearIndex({ layout, rowIndex: 1, columnIndex: 1 })).toBe(3)
  })
})
