/** @jest-environment node */
/**
 * Pins the vehicle and route form mapping and payloads.
 *
 * The failures this file exists to catch are the quiet ones: dropping `updatedAt` disables optimistic
 * locking for the whole edit surface (the list answers in snake_case, so the camelCase key is not even
 * guaranteed to be present), and a payload that misses a field discards the operator's edit instead of
 * failing. The route mapper is here too because it is the same shape and the same trap.
 */
import { buildVehicleFormDefaults, toVehicleFormValues, toVehiclePayload } from '../TransportVehicleForm'
import { buildRouteFormDefaults, toRouteFormValues, toRoutePayload } from '../TransportRouteForm'
import type { RouteRow } from '../TransportRoutesTable'
import type { VehicleRow } from '../TransportVehiclesTable'

const UPDATED_AT = '2026-09-27T06:00:00.000Z'

function vehicle(overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    plate_number: 'ABC-1234',
    vin: 'JTDBR32E430012345',
    make: 'Toyota',
    model: 'Coaster',
    year: 2024,
    capacity: 23,
    status: 'active',
    telematics_device_id: 'tel-77',
    updated_at: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('vehicle form initial values', () => {
  it('threads the record version into initialValues so CrudForm can derive the lock header', () => {
    expect(toVehicleFormValues(vehicle()).updatedAt).toBe(UPDATED_AT)
  })

  it('falls back to the snake_case version the list API actually returns', () => {
    expect(toVehicleFormValues(vehicle({ updatedAt: undefined })).updatedAt).toBe(UPDATED_AT)
  })

  it('degrades to null rather than undefined when the API omits the version', () => {
    expect(toVehicleFormValues(vehicle({ updatedAt: undefined, updated_at: undefined })).updatedAt).toBeNull()
  })

  it('converts the snake_case row into camelCase form values', () => {
    const values = toVehicleFormValues(vehicle())
    expect(values).toMatchObject({
      plateNumber: 'ABC-1234',
      vin: 'JTDBR32E430012345',
      make: 'Toyota',
      model: 'Coaster',
      year: 2024,
      capacity: 23,
      status: 'active',
      telematicsDeviceId: 'tel-77',
    })
    expect(values).not.toHaveProperty('plate_number')
  })

  it('renders an absent optional device as an empty string', () => {
    expect(toVehicleFormValues(vehicle({ telematics_device_id: null })).telematicsDeviceId).toBe('')
  })

  it('starts a new vehicle on defaults that satisfy the create schema', () => {
    expect(buildVehicleFormDefaults()).toMatchObject({
      plateNumber: '',
      vin: '',
      status: 'active',
      telematicsDeviceId: '',
      updatedAt: null,
    })
  })
})

describe('vehicle form payload', () => {
  it('trims the text fields and keeps the numbers', () => {
    const payload = toVehiclePayload({
      ...buildVehicleFormDefaults(),
      plateNumber: '  ABC-1234 ',
      vin: ' JTDBR32E430012345 ',
      make: ' Toyota ',
      model: ' Coaster ',
      year: 2024,
      capacity: 23,
    })

    expect(payload).toEqual({
      plateNumber: 'ABC-1234',
      vin: 'JTDBR32E430012345',
      sequenceNumber: null,
      make: 'Toyota',
      model: 'Coaster',
      year: 2024,
      capacity: 23,
      color: null,
      vehicleType: null,
      currentOdometer: 0,
      status: 'active',
      telematicsDeviceId: null,
      notes: null,
    })
  })

  it('clears the optional device with null so an update can empty it', () => {
    const payload = toVehiclePayload({ ...buildVehicleFormDefaults(), telematicsDeviceId: '   ' })
    expect(payload.telematicsDeviceId).toBeNull()
  })

  it('never sends the record id, which the update call carries separately', () => {
    expect(toVehiclePayload(buildVehicleFormDefaults('00000000-0000-4000-8000-000000000001')))
      .not.toHaveProperty('id')
  })
})

function route(overrides: Partial<RouteRow> = {}): RouteRow {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    code: 'R-01',
    name: 'East district schools',
    start_location: 'Depot',
    end_location: 'Al Nakheel',
    estimated_duration_minutes: 45,
    updated_at: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('route form mapping', () => {
  it('threads the version and converts the snake_case columns', () => {
    const values = toRouteFormValues(route())
    expect(values).toMatchObject({
      code: 'R-01',
      name: 'East district schools',
      startLocation: 'Depot',
      endLocation: 'Al Nakheel',
      estimatedDurationMinutes: 45,
      updatedAt: UPDATED_AT,
    })
    expect(values).not.toHaveProperty('start_location')
  })

  it('builds a payload the route schema accepts', () => {
    expect(toRoutePayload({
      ...buildRouteFormDefaults(),
      code: ' R-02 ',
      name: ' West ',
      startLocation: ' Depot ',
      endLocation: ' Al Rawdah ',
      estimatedDurationMinutes: 30,
    })).toEqual({
      code: 'R-02',
      name: 'West',
      startLocation: 'Depot',
      endLocation: 'Al Rawdah',
      estimatedDurationMinutes: 30,
    })
  })

  it('never sends the record id', () => {
    expect(toRoutePayload(buildRouteFormDefaults('00000000-0000-4000-8000-000000000002')))
      .not.toHaveProperty('id')
  })
})
