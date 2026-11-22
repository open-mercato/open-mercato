/** @jest-environment node */
import {
  buildDriverImportTemplateCsv,
  DRIVER_IMPORT_TEMPLATE_HEADERS,
  parseDriverImportRows,
} from '../driverImport'

describe('driver import parser', () => {
  it('maps operator header spellings and normalizes dates and statuses', () => {
    const result = parseDriverImportRows([
      {
        'Full Name': 'Ahmed Al-Harbi',
        'National ID': '1098765432',
        Licence: 'DL-445566',
        'Licence Expiry': '30/06/2027',
        Mobile: '+966500000000',
        Status: 'On Leave',
      },
    ])

    expect(result.missingRequiredHeaders).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].errors).toEqual([])
    expect(result.rows[0].payload).toEqual({
      fullName: 'Ahmed Al-Harbi',
      nationalId: '1098765432',
      licenseNumber: 'DL-445566',
      licenseExpiry: '2027-06-30',
      phone: '+966500000000',
      status: 'on_leave',
    })
  })

  it('reports missing columns and invalid cells without dropping a row', () => {
    const result = parseDriverImportRows([
      {
        'Full Name': 'Broken Row',
        'Licence Expiry': '32/12/2026',
        Status: 'sleeping',
      },
    ])

    expect(result.missingRequiredHeaders).toEqual(['nationalId', 'licenseNumber', 'phone'])
    expect(result.rows[0].errors).toEqual(expect.arrayContaining([
      'Licence Expiry: not a date',
      'Status: expected one of available, on_trip, on_leave, suspended',
    ]))
  })

  it('keeps ISO dates and fills optional columns only when present', () => {
    const result = parseDriverImportRows([
      {
        fullName: 'Sara',
        national_id: '2002',
        license_number: 'LIC-2',
        license_expiry: '2027-01-05',
        phone_number: '+966500000002',
      },
    ])

    expect(result.rows[0].errors).toEqual([])
    expect(result.rows[0].payload.licenseExpiry).toBe('2027-01-05')
    expect(result.rows[0].payload.status).toBeUndefined()
  })

  it('exports a template with the documented headers', () => {
    const csv = buildDriverImportTemplateCsv()
    expect(csv.split('\n')[0].split(',')).toEqual(DRIVER_IMPORT_TEMPLATE_HEADERS)
    expect(csv).toContain('Ahmed Al-Harbi')
  })
})
