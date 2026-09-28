/** @jest-environment node */
/**
 * Pins the driver form's mapping and payload.
 *
 * The failures this file exists to catch are the quiet ones: dropping `updatedAt` disables optimistic
 * locking for the whole edit surface (the list answers in snake_case, so the camelCase key is not
 * even guaranteed to be present), and mapping the row into the payload wrongly discards field values
 * on save instead of failing. The experience count has its own trap — an empty input must become
 * `null`, not `NaN`, or the schema rejects a save the operator cannot explain.
 */
import { buildDriverFormDefaults, toDriverFormValues, toDriverPayload } from '../DriverForm'
import type { DriverRow } from '../DriversTable'

const UPDATED_AT = '2026-09-27T06:00:00.000Z'
const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

function driver(overrides: Partial<DriverRow> = {}): DriverRow {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    employee_id: EMPLOYEE_ID,
    license_number: 'SA-1234567',
    license_type: 'Heavy',
    license_expiry: '2026-12-31T00:00:00.000Z',
    medical_check_expiry: '2027-03-01T00:00:00.000Z',
    years_of_experience: 8,
    notes: 'Night shifts only',
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
    expect(toDriverFormValues(driver({ updatedAt: undefined, updated_at: UPDATED_AT })).updatedAt).toBe(UPDATED_AT)
  })

  it('degrades to null rather than undefined when the API omits the version', () => {
    expect(toDriverFormValues(driver({ updatedAt: undefined, updated_at: undefined })).updatedAt).toBeNull()
  })

  it('reduces both compliance dates to the date part a date input accepts', () => {
    const values = toDriverFormValues(driver())
    expect(values.licenseExpiry).toBe('2026-12-31')
    expect(values.medicalCheckExpiry).toBe('2027-03-01')
  })

  it('converts the snake_case row into camelCase form values', () => {
    const values = toDriverFormValues(driver())

    expect(values).toMatchObject({
      employeeId: EMPLOYEE_ID,
      licenseNumber: 'SA-1234567',
      licenseType: 'Heavy',
      yearsOfExperience: '8',
      notes: 'Night shifts only',
    })
    expect(values).not.toHaveProperty('license_number')
  })

  it('renders absent optional values as empty strings', () => {
    const values = toDriverFormValues(driver({
      license_type: null,
      medical_check_expiry: null,
      years_of_experience: null,
      notes: null,
    }))

    expect(values.licenseType).toBe('')
    expect(values.medicalCheckExpiry).toBe('')
    expect(values.yearsOfExperience).toBe('')
    expect(values.notes).toBe('')
  })

  it('starts a new profile on defaults that satisfy the create schema', () => {
    expect(buildDriverFormDefaults()).toMatchObject({
      employeeId: '',
      licenseNumber: '',
      licenseExpiry: '',
      medicalCheckExpiry: '',
      yearsOfExperience: '',
      updatedAt: null,
    })
  })
})

describe('driver form payload', () => {
  it('sends the dates and the parsed experience count', () => {
    const payload = toDriverPayload({
      ...buildDriverFormDefaults(EMPLOYEE_ID),
      employeeId: EMPLOYEE_ID,
      licenseNumber: '  SA-1234567  ',
      licenseType: 'Heavy',
      licenseExpiry: '2026-12-31',
      medicalCheckExpiry: '2027-03-01',
      yearsOfExperience: '8',
    })

    expect(payload).toEqual({
      employeeId: EMPLOYEE_ID,
      licenseNumber: 'SA-1234567',
      licenseType: 'Heavy',
      licenseExpiry: '2026-12-31',
      medicalCheckExpiry: '2027-03-01',
      yearsOfExperience: 8,
      notes: null,
    })
  })

  it('turns an empty experience field into null rather than NaN', () => {
    const payload = toDriverPayload({ ...buildDriverFormDefaults(), licenseExpiry: '2026-12-31' })
    expect(payload.yearsOfExperience).toBeNull()
  })

  it('turns an unparseable experience field into null', () => {
    const payload = toDriverPayload({
      ...buildDriverFormDefaults(),
      licenseExpiry: '2026-12-31',
      yearsOfExperience: 'eight',
    })
    expect(payload.yearsOfExperience).toBeNull()
  })

  it('clears an optional field with null so an update can empty it', () => {
    const payload = toDriverPayload({
      ...buildDriverFormDefaults(),
      employeeId: EMPLOYEE_ID,
      licenseNumber: 'SA-1234567',
      licenseExpiry: '2026-12-31',
      medicalCheckExpiry: '',
      notes: '   ',
    })
    expect(payload.medicalCheckExpiry).toBeNull()
    expect(payload.notes).toBeNull()
  })

  it('never sends the record id, which belongs to the URL-bearing update call', () => {
    const payload = toDriverPayload(buildDriverFormDefaults('00000000-0000-4000-8000-000000000002'))
    expect(payload).not.toHaveProperty('id')
  })
})
