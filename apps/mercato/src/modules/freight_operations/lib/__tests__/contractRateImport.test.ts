/** @jest-environment node */
import { buildRateImportTemplateCsv, parseRateImportRows } from '../contractRateImport'

describe('rate import row mapping', () => {
  it('accepts the spellings a transport office writes', () => {
    const parsed = parseRateImportRows([
      { From: 'Riyadh', To: 'Dammam', Rate: '450', Basis: 'per_trip', Equipment: 'Flatbed', Active: 'yes', 'VAT': '15' },
    ])
    expect(parsed.missingRequiredHeaders).toEqual([])
    expect(parsed.unknownHeaders).toEqual([])
    expect(parsed.rows[0].errors).toEqual([])
    expect(parsed.rows[0].payload).toMatchObject({
      origin: 'Riyadh',
      destination: 'Dammam',
      rateAmount: '450',
      rateBasis: 'per_trip',
      equipmentType: 'Flatbed',
      isActive: true,
      vatRateOverride: '15',
    })
  })

  it('reports missing required columns before any row is examined', () => {
    const parsed = parseRateImportRows([{ origin: 'Riyadh', destination: 'Dammam' }])
    expect(parsed.missingRequiredHeaders).toEqual(['rateAmount'])
  })

  it('flags a bad number, a bad boolean and an unknown enum value per cell', () => {
    const parsed = parseRateImportRows([
      { origin: 'Riyadh', destination: 'Dammam', rateAmount: 'four fifty', includesTolls: 'maybe', rateBasis: 'per_moon' },
    ])
    const errors = parsed.rows[0].errors.join(' | ')
    expect(errors).toContain('rateAmount: not a number')
    expect(errors).toContain('includesTolls: not a yes/no value')
    expect(errors).toContain('rateBasis: expected one of')
  })

  // A sheet exported from an accounting system carries thousands separators and
  // a currency suffix; the cell is still a number and must not be rejected.
  it('cleans formatted amounts and infers the row numbers the operator sees', () => {
    const parsed = parseRateImportRows([
      { origin: 'Riyadh', destination: 'Dammam', rateAmount: '1,250.50 SAR' },
      { origin: 'Riyadh', destination: 'Jeddah', rateAmount: '  900  ' },
    ])
    expect(parsed.rows[0].payload.rateAmount).toBe('1250.50')
    expect(parsed.rows[1].payload.rateAmount).toBe('900')
    expect(parsed.rows.map((row) => row.rowNumber)).toEqual([2, 3])
  })

  it('reports a column it does not know instead of dropping it silently', () => {
    const parsed = parseRateImportRows([{ origin: 'R', destination: 'D', rateAmount: '1', mystery: 'x' }])
    expect(parsed.unknownHeaders).toEqual(['mystery'])
  })

  it('ships a template that parses back cleanly', () => {
    const csv = buildRateImportTemplateCsv().trim().split('\n')
    const headers = csv[0].split(',')
    const values = csv[1].split(',')
    const row: Record<string, string> = {}
    headers.forEach((header, index) => { row[header] = values[index] })
    const parsed = parseRateImportRows([row])
    expect(parsed.rows[0].errors).toEqual([])
    expect(parsed.missingRequiredHeaders).toEqual([])
  })
})
