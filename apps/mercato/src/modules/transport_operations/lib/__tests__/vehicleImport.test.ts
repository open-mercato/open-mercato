/** @jest-environment node */
import {
  buildVehicleImportTemplateCsv,
  parseVehicleImportRows,
  VEHICLE_IMPORT_TEMPLATE_HEADERS,
} from '../vehicleImport'

describe('vehicle import parser', () => {
  it('maps operator header spellings and normalizes numbers and statuses', () => {
    const result = parseVehicleImportRows([
      {
        Plate: 'ABC-1234',
        Chassis: 'JTMBFREV00J000000',
        Brand: 'Toyota',
        Model: 'Hiace',
        'Model Year': '2024',
        Seats: '14',
        Odometer: '52,000',
        Status: 'Active',
      },
    ])

    expect(result.missingRequiredHeaders).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].errors).toEqual([])
    expect(result.rows[0].payload).toMatchObject({
      plateNumber: 'ABC-1234',
      vin: 'JTMBFREV00J000000',
      make: 'Toyota',
      model: 'Hiace',
      year: '2024',
      capacity: '14',
      currentOdometer: '52000',
      status: 'active',
    })
  })

  it('reports missing columns and invalid cells without dropping a row', () => {
    const result = parseVehicleImportRows([
      {
        Plate: 'BAD-1',
        'Model Year': 'twenty',
        Seats: 'many',
        Status: 'flying',
      },
    ])

    expect(result.missingRequiredHeaders).toEqual(['make', 'model'])
    expect(result.rows[0].errors).toEqual(expect.arrayContaining([
      'Model Year: not a number',
      'Seats: not a number',
      'Status: expected one of active, maintenance, out_of_service',
    ]))
  })

  it('accepts an optional-only sheet when the required columns are present', () => {
    const result = parseVehicleImportRows([
      {
        plate_number: 'XYZ-9',
        make: 'Ford',
        model: 'Transit',
        year: '2022',
      },
    ])

    expect(result.rows[0].errors).toEqual([])
    expect(result.rows[0].payload).toEqual({
      plateNumber: 'XYZ-9',
      make: 'Ford',
      model: 'Transit',
      year: '2022',
    })
  })

  it('exports a template with the documented headers', () => {
    const csv = buildVehicleImportTemplateCsv()
    expect(csv.split('\n')[0].split(',')).toEqual(VEHICLE_IMPORT_TEMPLATE_HEADERS)
    expect(csv).toContain('ABC-1234')
  })
})
