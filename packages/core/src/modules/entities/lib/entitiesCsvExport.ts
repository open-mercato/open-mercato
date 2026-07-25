import { serializeExport, type CrudExportColumn, type PreparedExport } from '@open-mercato/shared/lib/crud/exporters'

export type EntitiesExportRow = {
  entityId: string
  label: string
  source: 'code' | 'custom'
  count: number
  showInSidebar?: boolean
}

export function buildEntitiesCsv(rows: EntitiesExportRow[], options?: { includeSidebar?: boolean }): string {
  const includeSidebar = options?.includeSidebar ?? false
  const columns: CrudExportColumn[] = [
    { field: 'entityId', header: 'entityId' },
    { field: 'label', header: 'label' },
    { field: 'source', header: 'source' },
    { field: 'count', header: 'count' },
  ]
  if (includeSidebar) columns.push({ field: 'showInSidebar', header: 'showInSidebar' })
  const prepared: PreparedExport = {
    columns,
    rows: rows.map((row) => ({
      entityId: row.entityId,
      label: row.label,
      source: row.source,
      count: row.count,
      ...(includeSidebar ? { showInSidebar: row.showInSidebar || false } : {}),
    })),
  }
  return serializeExport(prepared, 'csv').body
}
