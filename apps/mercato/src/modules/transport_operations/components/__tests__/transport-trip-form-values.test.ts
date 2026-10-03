/** @jest-environment node */
/**
 * Pins the trip form's clock handling.
 *
 * A trip is the one transport screen whose value is a moment in time, and the `datetime-local` input
 * speaks wall clock while the column stores UTC. `toISOString().slice(0, 16)` — the obvious shortcut —
 * compiles, looks right in a UTC test runner, and silently shifts every trip by the operator's offset
 * in production. The cases below are built from local date components so they hold in any time zone.
 */
import {
  buildTripFormDefaults,
  fromDateTimeLocal,
  toDateTimeLocal,
  toTripFormValues,
  toTripPayload,
} from '../TransportTripForm'
import type { TripRow } from '../TransportTripsTable'

const LOCAL_START = new Date(2026, 8, 27, 14, 30)
const LOCAL_END = new Date(2026, 8, 27, 16, 0)
const UPDATED_AT = '2026-09-27T06:00:00.000Z'

function trip(overrides: Partial<TripRow> = {}): TripRow {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    route_id: '00000000-0000-4000-8000-000000000010',
    vehicle_id: '00000000-0000-4000-8000-000000000011',
    driver_id: '00000000-0000-4000-8000-000000000012',
    scheduled_start_time: LOCAL_START.toISOString(),
    scheduled_end_time: LOCAL_END.toISOString(),
    status: 'scheduled',
    updated_at: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('datetime-local conversion', () => {
  it('renders an instant as the wall clock the operator scheduled it at', () => {
    expect(toDateTimeLocal(LOCAL_START.toISOString())).toBe('2026-09-27T14:30')
  })

  it('round-trips through the input value without changing the instant', () => {
    const inputValue = toDateTimeLocal(LOCAL_START.toISOString())
    expect(inputValue).not.toBe('')
    expect(new Date(fromDateTimeLocal(inputValue) as string).getTime()).toBe(LOCAL_START.getTime())
  })

  it('returns an empty value for an absent or unparseable instant', () => {
    expect(toDateTimeLocal(null)).toBe('')
    expect(toDateTimeLocal(undefined)).toBe('')
    expect(toDateTimeLocal('not-a-date')).toBe('')
    expect(fromDateTimeLocal('')).toBeNull()
    expect(fromDateTimeLocal('not-a-date')).toBeNull()
  })
})

describe('trip form initial values', () => {
  it('threads the record version into initialValues so CrudForm can derive the lock header', () => {
    expect(toTripFormValues(trip()).updatedAt).toBe(UPDATED_AT)
  })

  it('falls back to the snake_case version the list API actually returns', () => {
    expect(toTripFormValues(trip({ updatedAt: undefined })).updatedAt).toBe(UPDATED_AT)
  })

  it('converts the assigned ids and both instants', () => {
    const values = toTripFormValues(trip())
    expect(values).toMatchObject({
      routeId: '00000000-0000-4000-8000-000000000010',
      vehicleId: '00000000-0000-4000-8000-000000000011',
      driverId: '00000000-0000-4000-8000-000000000012',
      scheduledStartTime: '2026-09-27T14:30',
    })
    expect(values).not.toHaveProperty('scheduled_start_time')
  })
})

describe('trip form payload', () => {
  it('sends the schedule as ISO instants and never sends the status', () => {
    const payload = toTripPayload({
      ...buildTripFormDefaults(),
      routeId: '00000000-0000-4000-8000-000000000010',
      vehicleId: '00000000-0000-4000-8000-000000000011',
      driverId: '00000000-0000-4000-8000-000000000012',
      scheduledStartTime: '2026-09-27T14:30',
      scheduledEndTime: '2026-09-27T16:00',
    })

    expect(payload.routeId).toBe('00000000-0000-4000-8000-000000000010')
    expect(new Date(payload.scheduledStartTime as string).getTime()).toBe(LOCAL_START.getTime())
    expect(new Date(payload.scheduledEndTime as string).getTime()).toBe(LOCAL_END.getTime())
    // Status moves only through the dispatch and complete commands; the schema would strip it anyway.
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('id')
  })

  it('omits a date the input left empty so the schema reports a required field, not a type error', () => {
    const payload = toTripPayload(buildTripFormDefaults())
    expect(payload).not.toHaveProperty('scheduledStartTime')
    expect(payload).not.toHaveProperty('scheduledEndTime')
  })
})
