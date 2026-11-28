import { formatCsvCell } from '@open-mercato/shared/lib/crud/exporters'

export type InventoryCsvCell = string | number

export function buildInventoryCsv(rows: InventoryCsvCell[][]): string {
  return rows.map((row) => row.map((cell) => formatCsvCell(cell)).join(',')).join('\n')
}

export function downloadInventoryCsv(filename: string, rows: InventoryCsvCell[][]): void {
  const csv = buildInventoryCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
