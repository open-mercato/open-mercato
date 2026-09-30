import { visitAvailabilityRequestUrl } from '../visitAvailabilityClient'

const values = { date: '2026-09-29', startTime: '09:15', endDate: '2026-09-29', endTime: '12:00', participants: [], resources: [] }

describe('Visit preview interval timezone', () => {
  it('converts a Warsaw visit independently of the browser timezone', () => {
    const url = new URL(visitAvailabilityRequestUrl({ ...values, timezone: 'Europe/Warsaw' })!, 'http://localhost')
    expect(url.searchParams.get('startAt')).toBe('2026-09-29T07:15:00.000Z')
    expect(url.searchParams.get('endAt')).toBe('2026-09-29T10:00:00.000Z')
  })

  it('converts UTC visit inputs as UTC', () => {
    const url = new URL(visitAvailabilityRequestUrl({ ...values, timezone: 'UTC' })!, 'http://localhost')
    expect(url.searchParams.get('startAt')).toBe('2026-09-29T09:15:00.000Z')
    expect(url.searchParams.get('endAt')).toBe('2026-09-29T12:00:00.000Z')
  })

  it('rejects nonexistent local time during the Warsaw daylight-saving gap', () => {
    expect(visitAvailabilityRequestUrl({ ...values, date: '2026-03-29', startTime: '02:30', endDate: '2026-03-29', endTime: '04:00', timezone: 'Europe/Warsaw' })).toBeNull()
  })

  it('keeps legacy browser-local values compatible when timezone is absent', () => {
    const url = new URL(visitAvailabilityRequestUrl(values)!, 'http://localhost')
    expect(url.searchParams.get('startAt')).toBe(new Date('2026-09-29T09:15:00').toISOString())
    expect(url.searchParams.get('endAt')).toBe(new Date('2026-09-29T12:00:00').toISOString())
  })
})
