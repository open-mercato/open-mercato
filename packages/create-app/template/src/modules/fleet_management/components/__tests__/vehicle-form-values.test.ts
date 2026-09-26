/** @jest-environment node */
/**
 * Pins the optimistic-lock wiring and the payload shape of the fleet vehicle form.
 *
 * Two failures are invisible without this file:
 *
 * 1. `CrudForm` auto-derives the expected-version header from
 *    `initialValues.updatedAt`, and that header covers update AND delete, so
 *    dropping `updatedAt` from this mapping silently turns optimistic locking off
 *    for the whole edit surface. The vehicle list answers in snake_case
 *    (`updated_at`) because the query engine projects columns as stored, so the
 *    camelCase key is not even guaranteed to be present — the fallback is the
 *    load-bearing part, not a convenience.
 * 2. The same mapper converts the snake_case row into the camelCase payload the
 *    create/update zod schemas accept (`plateNumber`, `currentOdometer`). Getting
 *    that wrong silently discards field values on save instead of failing.
 */
import { buildVehicleFormDefaults, toVehicleFormValues, type VehicleRow } from '../VehicleForm'

const UPDATED_AT = '2026-09-26T06:00:00.000Z'

function vehicle(overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    plate_number: 'ABC-1234',
    sequence_number: '7',
    make: 'Toyota',
    model: 'Hilux',
    year: 2024,
    color: 'White',
    vehicle_type: 'pickup',
    status: 'active',
    current_odometer: 15234,
    assigned_employee_id: null,
    notes: 'Pool vehicle',
    updated_at: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('fleet vehicle form initial values', () => {
  it('threads the record version into initialValues so CrudForm can derive the lock header', () => {
    expect(toVehicleFormValues(vehicle()).updatedAt).toBe(UPDATED_AT)
  })

  it('falls back to the snake_case version the list API actually returns', () => {
    expect(toVehicleFormValues(vehicle({ updatedAt: undefined, updated_at: UPDATED_AT })).updatedAt).toBe(UPDATED_AT)
  })

  it('keeps a version that CrudForm would actually accept', () => {
    // CrudForm only derives a header from a NON-EMPTY string; null/'' disable the lock.
    const derived = toVehicleFormValues(vehicle()).updatedAt
    expect(typeof derived).toBe('string')
    expect((derived ?? '').length).toBeGreaterThan(0)
  })

  it('degrades to null rather than undefined when the API omits the version', () => {
    expect(toVehicleFormValues(vehicle({ updatedAt: undefined, updated_at: undefined })).updatedAt).toBeNull()
  })

  it('converts the snake_case row into the camelCase payload the schemas accept', () => {
    const values = toVehicleFormValues(vehicle())

    expect(values).toMatchObject({
      plateNumber: 'ABC-1234',
      sequenceNumber: '7',
      vehicleType: 'pickup',
      currentOdometer: 15234,
      year: 2024,
      status: 'active',
    })
    expect(values).not.toHaveProperty('plate_number')
    expect(values).not.toHaveProperty('current_odometer')
  })

  it('renders absent optional text as empty strings instead of null', () => {
    const values = toVehicleFormValues(vehicle({ color: null, notes: null, sequence_number: null }))

    expect(values.color).toBe('')
    expect(values.notes).toBe('')
    expect(values.sequenceNumber).toBe('')
  })

  it('starts a new vehicle on defaults that satisfy the create schema', () => {
    expect(buildVehicleFormDefaults()).toMatchObject({
      status: 'active',
      currentOdometer: 0,
      plateNumber: '',
      updatedAt: null,
    })
  })
})
