import * as React from 'react'

export type DataTableColumn<T> = {
  key: string
  header: string
  cell?: (row: T) => React.ReactNode
}

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[]
  data: T[]
  isLoading?: boolean
  emptyState?: React.ReactNode
  onRowClick?: (row: T) => void
  toolbar?: React.ReactNode
}

export function DataTable<T extends Record<string, any>>({ columns, data, isLoading, emptyState, onRowClick, toolbar }: DataTableProps<T>) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="text-sm font-medium">Products</div>
        <div className="flex items-center gap-2">{toolbar}</div>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              {columns.map((c) => (
                <th key={c.key} className="text-left font-medium px-4 py-2 whitespace-nowrap">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-6" colSpan={columns.length}>
                  <div className="h-4 w-48 bg-muted animate-pulse rounded" />
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-muted-foreground" colSpan={columns.length}>
                  {emptyState || 'No data'}
                </td>
              </tr>
            ) : (
              data.map((row, i) => (
                <tr
                  key={i}
                  className={`border-b last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-accent/50' : ''}`}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-2">
                      {c.cell ? c.cell(row) : String(row[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

