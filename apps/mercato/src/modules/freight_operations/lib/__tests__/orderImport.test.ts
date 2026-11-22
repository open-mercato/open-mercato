/** @jest-environment node */
import {
  buildOrderImportTemplateCsv,
  ORDER_IMPORT_TEMPLATE_HEADERS,
  parseOrderImportRows,
} from '../orderImport'

describe('order import parser', () => {
  it('maps operator header spellings and normalizes values', () => {
    const result = parseOrderImportRows([
      {
        Cargo: 'Steel coils',
        Pickup: 'Riyadh',
        Destination: 'Dammam',
        'Pickup Date': '01/12/2026',
        'Truck Type': 'Flatbed',
        Quantity: '12',
        Unit: 'ton',
        Weight: '12,000',
        Hazardous: 'no',
        Refrigerated: 'yes',
        Price: '2,500',
        VAT: '15',
        Currency: 'sar',
      },
    ])

    expect(result.missingRequiredHeaders).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].errors).toEqual([])
    expect(result.rows[0].payload).toMatchObject({
      cargoDescription: 'Steel coils',
      pickupLocation: 'Riyadh',
      dropoffLocation: 'Dammam',
      requestedPickupAt: '2026-12-01T12:00:00.000Z',
      truckTypeRequired: 'flatbed',
      cargoQuantity: '12',
      cargoUnit: 'ton',
      cargoWeightKg: '12000',
      cargoHazardous: false,
      cargoRefrigerated: true,
      agreedAmountNet: '2500',
      vatRate: '15',
      currencyCode: 'SAR',
    })
  })

  it('reports missing columns and invalid cells without dropping a row', () => {
    const result = parseOrderImportRows([
      {
        Cargo: 'Cargo',
        Pickup: 'Riyadh',
        Dropoff: 'Dammam',
        Amount: 'not-a-number',
        'Truck Type': 'spaceship',
        'Pickup Date': '32/12/2026',
      },
      { Cargo: '', Pickup: '', Dropoff: '', Amount: '' },
    ])

    expect(result.missingRequiredHeaders).toEqual([])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].errors.join(' ')).toContain('not a number')
    expect(result.rows[0].errors.join(' ')).toContain('expected one of')
    expect(result.rows[0].errors.join(' ')).toContain('not a date')
    expect(result.rows[1].errors).toEqual(
      expect.arrayContaining([
        'cargoDescription: is required',
        'pickupLocation: is required',
        'dropoffLocation: is required',
        'agreedAmountNet: is required',
      ]),
    )
  })

  it('flags missing required headers', () => {
    const result = parseOrderImportRows([{ Cargo: 'Only cargo' }])
    expect(result.missingRequiredHeaders).toEqual(
      expect.arrayContaining(['pickupLocation', 'dropoffLocation', 'agreedAmountNet']),
    )
    expect(result.rows[0].errors).toEqual(
      expect.arrayContaining([
        'pickupLocation: is required',
        'dropoffLocation: is required',
        'agreedAmountNet: is required',
      ]),
    )
  })

  it('exports a template whose headers the parser accepts', () => {
    const csv = buildOrderImportTemplateCsv()
    const [headerLine] = csv.split('\n')
    expect(headerLine).toBe(ORDER_IMPORT_TEMPLATE_HEADERS.join(','))
    expect(ORDER_IMPORT_TEMPLATE_HEADERS).toEqual(
      expect.arrayContaining([
        'cargoDescription',
        'pickupLocation',
        'dropoffLocation',
        'agreedAmountNet',
      ]),
    )
  })
})
