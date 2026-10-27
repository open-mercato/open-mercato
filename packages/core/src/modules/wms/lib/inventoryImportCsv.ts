export const INVENTORY_IMPORT_TEMPLATE_HEADERS = [
  'warehouse_code',
  'location_code',
  'sku',
  'quantity',
  'lot_number',
  'serial_number',
] as const

export type InventoryImportTemplateHeader = (typeof INVENTORY_IMPORT_TEMPLATE_HEADERS)[number]

export type InventoryImportRawRow = {
  warehouseCode?: string
  warehouseId?: string
  locationCode?: string
  locationId?: string
  sku?: string
  catalogVariantId?: string
  quantity?: string
  lotNumber?: string
  lotId?: string
  serialNumber?: string
}

const HEADER_ALIASES: Record<string, keyof InventoryImportRawRow> = {
  warehouse_code: 'warehouseCode',
  warehouse: 'warehouseCode',
  warehouse_id: 'warehouseId',
  location_code: 'locationCode',
  location: 'locationCode',
  location_id: 'locationId',
  sku: 'sku',
  variant_sku: 'sku',
  catalog_variant_id: 'catalogVariantId',
  variant_id: 'catalogVariantId',
  quantity: 'quantity',
  qty: 'quantity',
  on_hand: 'quantity',
  quantity_on_hand: 'quantity',
  lot_number: 'lotNumber',
  lot: 'lotNumber',
  lot_id: 'lotId',
  serial_number: 'serialNumber',
  serial: 'serialNumber',
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_')
}

function trimCell(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function parseCsvText(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ''
  let inQuotes = false
  let lineStart = true

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (lineStart && char === '#') {
      while (index < text.length && text[index] !== '\n') {
        index += 1
      }
      lineStart = true
      continue
    }
    lineStart = false

    if (inQuotes) {
      if (char === '"' && next === '"') {
        currentCell += '"'
        index += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        currentCell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }

    if (char === ',') {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if (char === '\n') {
      lineStart = true
      currentRow.push(currentCell)
      currentCell = ''
      if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow)
      }
      currentRow = []
      continue
    }

    if (char === '\r') continue
    currentCell += char
  }

  currentRow.push(currentCell)
  if (currentRow.some((cell) => cell.trim().length > 0)) {
    rows.push(currentRow)
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] }
  }

  const [headerRow, ...dataRows] = rows
  return { headers: headerRow.map((header) => header.trim()), rows: dataRows }
}

export function mapCsvRowsToImportRawRows(
  headers: string[],
  rows: string[][],
): InventoryImportRawRow[] {
  const columnMap = headers.map((header) => HEADER_ALIASES[normalizeHeader(header)] ?? null)
  return rows.map((cells) => {
    const mapped: InventoryImportRawRow = {}
    for (let index = 0; index < columnMap.length; index += 1) {
      const key = columnMap[index]
      if (!key) continue
      const value = trimCell(cells[index])
      if (value !== undefined) mapped[key] = value
    }
    return mapped
  })
}

export function mapCsvRowsWithMappings(
  headers: string[],
  rows: string[][],
  mappings: DetectedColumnMapping[],
): InventoryImportRawRow[] {
  const mappingByHeader = new Map(mappings.map((mapping) => [mapping.csvColumn, mapping.targetField]))
  const columnMap = headers.map((header) => {
    const mappedField = mappingByHeader.get(header)
    if (mappedField === null) return null
    if (mappedField) return mappedField
    return HEADER_ALIASES[normalizeHeader(header)] ?? null
  })
  return rows.map((cells) => {
    const mapped: InventoryImportRawRow = {}
    for (let index = 0; index < columnMap.length; index += 1) {
      const key = columnMap[index]
      if (!key) continue
      const value = trimCell(cells[index])
      if (value !== undefined) mapped[key] = value
    }
    return mapped
  })
}

export function parseInventoryImportCsv(text: string): InventoryImportRawRow[] {
  const parsed = parseCsvText(text)
  if (parsed.headers.length === 0) return []
  return mapCsvRowsToImportRawRows(parsed.headers, parsed.rows)
}

export function buildInventoryImportTemplateCsv(): string {
  const headers = INVENTORY_IMPORT_TEMPLATE_HEADERS.join(',')
  const sampleRow = 'WH-MAIN,BIN-A01,SKU-001,10,,'
  const docRows = [
    '# Column reference:',
    '# warehouse_code   [REQUIRED] Code of the warehouse (e.g. WH-MAIN)',
    '# location_code    [REQUIRED] Storage location code within the warehouse (e.g. BIN-A01)',
    '# sku              [REQUIRED] Product variant SKU',
    '# quantity         [REQUIRED] Quantity to add to existing on-hand stock (positive integer). If "Reconcile to exact balance" is enabled during import, quantity is treated as the absolute target balance instead.',
    '# lot_number       [optional] Lot or batch identifier (leave blank if not tracked)',
    '# serial_number    [optional] Serial number (leave blank for non-serialised items)',
    '# Lines starting with # are comments and are ignored when uploading.',
  ]
  return [headers, sampleRow, ...docRows].join('\n') + '\n'
}

export type ColumnMappingStatus = 'mapped' | 'skipped'

export type DetectedColumnMapping = {
  csvColumn: string
  targetField: keyof InventoryImportRawRow | null
  status: ColumnMappingStatus
}

export function detectColumnMappings(headers: string[]): DetectedColumnMapping[] {
  return headers.map((csvColumn) => {
    const targetField = HEADER_ALIASES[normalizeHeader(csvColumn)] ?? null
    return {
      csvColumn,
      targetField,
      status: targetField ? 'mapped' : 'skipped',
    }
  })
}

export function countMappedColumns(mappings: DetectedColumnMapping[]): number {
  return mappings.filter((mapping) => mapping.status === 'mapped').length
}
