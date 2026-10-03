/** @jest-environment node */
/**
 * Pins the driver form's mapping and payload.
 *
 * The licence date is the trap: the list answers with a full ISO instant and the form field is a date
 * input, so a value that is not reduced to `YYYY-MM-DD` renders empty and saves back as `''`. The
 * employee link is deliberately absent from both directions — the transport module does not import
 * HR's option lookup, and an update leaves the stored link untouched because the schema is partial.
 */
import { buildDriverFormDefaults, toDriverFormValues, toDriverPayload } from '../TransportDriverForm'
import type { DriverRow } from '../TransportDriversTable'

const UPDATED_AT = '2026-09-27T06:00:00.000Z'

function driver(overrides: Partial<DriverRow> = {}): DriverRow {
  return {
    id: '00000000-0000-4000-8000-000000000004',
    employee_id: '00000000-0000-4000-8000-000000000005',
    full_name: 'Salem Al Harbi',
    national_id: '1098765432',
    license_number: 'SA-7654321',
    license_expiry: '2026-12-31T00:00:00.000Z',
    phone: '+966500000000',
    status: 'available',
    updated_at: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('driver form initial values', () => {
  it('threads the record version into initialValues so CrudForm can derive the lock header', () => {
    expect(toDriverFormValues(driver()).updatedAt).toBe(UPDATED_AT)
  })

  it('falls back to the snake_case version the list API actually returns', () => {
    expect(toDriverFormValues(driver({ updatedAt: undefined })).updatedAt).toBe(UPDATED_AT)
  })

  it('degrades to null rather than undefined when the API omits the version', () => {
    expect(toDriverFormValues(driver({ updatedAt: undefined, updated_at: undefined })).updatedAt).toBeNull()
  })

  it('reduces the licence date to the date part a date input accepts', () => {
    expect(toDriverFormValues(driver()).licenseExpiry).toBe('2026-12-31')
  })

  it('converts the snake_case row into camelCase form values', () => {
    const values = toDriverFormValues(driver())
    expect(values).toMatchObject({
      fullName: 'Salem Al Harbi',
      nationalId: '1098765432',
      licenseNumber: 'SA-7654321',
      phone: '+966500000000',
      status: 'available',
    })
    expect(values).not.toHaveProperty('full_name')
    expect(values).not.toHaveProperty('employeeId')
  })

  it('starts a new driver on defaults that satisfy the create schema', () => {
    expect(buildDriverFormDefaults()).toMatchObject({
      fullName: '',
      nationalId: '',
      licenseNumber: '',
      licenseExpiry: '',
      phone: '',
      status: 'available',
      updatedAt: null,
    })
  })
})

describe('driver form payload', () => {
  it('trims the text fields and keeps the licence date verbatim', () => {
    expect(toDriverPayload({
      ...buildDriverFormDefaults(),
      fullName: '  Salem Al Harbi ',
      nationalId: ' 1098765432 ',
      licenseNumber: ' SA-7654321 ',
      licenseExpiry: '2026-12-31',
      phone: ' +966500000000 ',
    })).toEqual({
      fullName: 'Salem Al Harbi',
      nationalId: '1098765432',
      licenseNumber: 'SA-7654321',
      licenseExpiry: '2026-12-31',
      phone: '+966500000000',
      status: 'available',
    })
  })

  it('never sends the record id or the employee link, which the form does not own', () => {
    const payload = toDriverPayload(buildDriverFormDefaults('00000000-0000-4000-8000-000000000004'))
    expect(payload).not.toHaveProperty('id')
    expect(payload).not.toHaveProperty('employeeId')
  })
})
