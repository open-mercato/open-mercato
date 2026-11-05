// Decision 6b — column hint maps to nearest linear index; layout is pure.

export type RowLayoutSpan = 1 | 2 | 3 | 4

export type RowLayoutCell =
  | { kind: 'field'; fieldKey: string; span: RowLayoutSpan; linearIndex: number }
  | { kind: 'empty'; span: 1 }

export type RowLayoutRow = { cells: RowLayoutCell[] }

export type RowLayout = {
  rows: RowLayoutRow[]
  columns: 1 | 2 | 3 | 4
  totalFields: number
}

export function readSpan(value: unknown): RowLayoutSpan | undefined {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value
  return undefined
}

function clampSpan(raw: number | undefined, columns: 1 | 2 | 3 | 4): RowLayoutSpan {
  if (raw === undefined) return 1
  const normalized = raw === 1 || raw === 2 || raw === 3 || raw === 4 ? raw : 1
  const limit = Math.min(normalized, columns)
  return (limit < 1 ? 1 : limit) as RowLayoutSpan
}

export function computeRowLayout(input: {
  fieldKeys: string[]
  spans: Record<string, number | undefined>
  columns: 1 | 2 | 3 | 4
}): RowLayout {
  const { fieldKeys, spans, columns } = input
  const rows: RowLayoutRow[] = []
  let currentCells: RowLayoutCell[] = []
  let currentUsed = 0

  for (let i = 0; i < fieldKeys.length; i += 1) {
    const key = fieldKeys[i]
    const span = clampSpan(spans[key], columns)
    if (currentUsed + span > columns) {
      while (currentCells.length > 0 && currentUsed < columns) {
        currentCells.push({ kind: 'empty', span: 1 })
        currentUsed += 1
      }
      if (currentCells.length > 0) {
        rows.push({ cells: currentCells })
      }
      currentCells = []
      currentUsed = 0
    }
    currentCells.push({ kind: 'field', fieldKey: key, span, linearIndex: i })
    currentUsed += span
    if (currentUsed >= columns) {
      rows.push({ cells: currentCells })
      currentCells = []
      currentUsed = 0
    }
  }

  if (currentCells.length > 0) {
    while (currentUsed < columns) {
      currentCells.push({ kind: 'empty', span: 1 })
      currentUsed += 1
    }
    rows.push({ cells: currentCells })
  }

  return { rows, columns, totalFields: fieldKeys.length }
}

type RowLayoutFieldCell = Extract<RowLayoutCell, { kind: 'field' }>

function fieldsInRow(row: RowLayoutRow): RowLayoutFieldCell[] {
  return row.cells.filter((cell): cell is RowLayoutFieldCell => cell.kind === 'field')
}

export function dropHintToLinearIndex(input: {
  layout: RowLayout
  rowIndex: number
  columnIndex: number
}): number {
  const { layout, rowIndex, columnIndex } = input
  if (layout.rows.length === 0) return 0
  if (rowIndex >= layout.rows.length) return layout.totalFields

  const safeRowIndex = rowIndex < 0 ? 0 : rowIndex
  const row = layout.rows[safeRowIndex]
  const fields = fieldsInRow(row)

  if (fields.length === 0) {
    let prior = 0
    for (let r = 0; r < safeRowIndex; r += 1) {
      prior += fieldsInRow(layout.rows[r]).length
    }
    return prior
  }

  let consumed = 0
  for (let i = 0; i < row.cells.length; i += 1) {
    const cell = row.cells[i]
    if (consumed >= columnIndex) {
      if (cell.kind === 'field') return cell.linearIndex
      return fields[fields.length - 1].linearIndex + 1
    }
    consumed += cell.span
  }
  return fields[fields.length - 1].linearIndex + 1
}
