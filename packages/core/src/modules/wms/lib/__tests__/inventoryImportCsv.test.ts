import {
  buildInventoryImportTemplateCsv,
  countMappedColumns,
  detectColumnMappings,
  mapCsvRowsToImportRawRows,
  mapCsvRowsWithMappings,
  parseCsvText,
  parseInventoryImportCsv,
} from '../inventoryImportCsv'

describe('inventoryImportCsv', () => {
  it('parses quoted CSV cells with commas and escaped quotes', () => {
    const text = 'warehouse_code,location_code,sku,quantity\n"WH-1","A-01","SKU, special","10"'
    const parsed = parseCsvText(text)
    expect(parsed.headers).toEqual(['warehouse_code', 'location_code', 'sku', 'quantity'])
    expect(parsed.rows).toEqual([['WH-1', 'A-01', 'SKU, special', '10']])
  })

  it('maps headers to import row fields with aliases', () => {
    const rows = mapCsvRowsToImportRawRows(
      ['warehouse', 'location', 'variant_sku', 'on_hand', 'lot'],
      [['MAIN', 'BIN-1', 'SKU-001', '25', 'LOT-A']],
    )
    expect(rows).toEqual([
      {
        warehouseCode: 'MAIN',
        locationCode: 'BIN-1',
        sku: 'SKU-001',
        quantity: '25',
        lotNumber: 'LOT-A',
      },
    ])
  })

  it('builds an inventory import template with headers, sample row, and doc comments', () => {
    const csv = buildInventoryImportTemplateCsv()
    expect(csv).toContain('warehouse_code,location_code,sku,quantity,lot_number,serial_number')
    expect(csv).toContain('WH-MAIN,BIN-A01,SKU-001,10,,')
    expect(csv).toContain('# warehouse_code')
    const rows = parseInventoryImportCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ warehouseCode: 'WH-MAIN', locationCode: 'BIN-A01', sku: 'SKU-001', quantity: '10' })
  })

  it('parses end-to-end inventory import CSV with data rows', () => {
    const csv = 'warehouse_code,location_code,sku,quantity\nWH-MAIN,A-01-01,SKU-001,100\n'
    const rows = parseInventoryImportCsv(csv)
    expect(rows).toEqual([
      {
        warehouseCode: 'WH-MAIN',
        locationCode: 'A-01-01',
        sku: 'SKU-001',
        quantity: '100',
      },
    ])
  })

  it('detects mapped and skipped CSV columns', () => {
    const mappings = detectColumnMappings([
      'sku',
      'quantity',
      'location',
      'price',
      'variant_sku',
    ])
    expect(mappings).toEqual([
      { csvColumn: 'sku', targetField: 'sku', status: 'mapped' },
      { csvColumn: 'quantity', targetField: 'quantity', status: 'mapped' },
      { csvColumn: 'location', targetField: 'locationCode', status: 'mapped' },
      { csvColumn: 'price', targetField: null, status: 'skipped' },
      { csvColumn: 'variant_sku', targetField: 'sku', status: 'mapped' },
    ])
    expect(countMappedColumns(mappings)).toBe(4)
  })

  it('applies user column mappings over auto-detected aliases', () => {
    const headers = ['item_code', 'qty', 'bin']
    const rows = [['SKU-001', '12', 'A-01']]
    const mappings = [
      { csvColumn: 'item_code', targetField: 'sku' as const, status: 'mapped' as const },
      { csvColumn: 'qty', targetField: 'quantity' as const, status: 'mapped' as const },
      { csvColumn: 'bin', targetField: 'locationCode' as const, status: 'mapped' as const },
    ]
    expect(mapCsvRowsWithMappings(headers, rows, mappings)).toEqual([
      {
        sku: 'SKU-001',
        quantity: '12',
        locationCode: 'A-01',
      },
    ])
  })
})
