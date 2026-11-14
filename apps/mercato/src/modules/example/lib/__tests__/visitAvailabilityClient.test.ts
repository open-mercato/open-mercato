import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import dictionary from '../../i18n/en.json'
import { visitAvailabilityRequestUrl, visitAvailabilitySubjectMessage } from '../visitAvailabilityClient'

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
  it('excludes the edited interaction and its recurring occurrence from booking checks', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    for (const value of [id, `${id}:3`]) {
      const url = new URL(visitAvailabilityRequestUrl({ ...values, id: value })!, 'http://localhost')
      expect(url.searchParams.get('excludeInteractionId')).toBe(id)
    }
    for (const id of ['', 'new', undefined]) {
      const url = new URL(visitAvailabilityRequestUrl({ ...values, id })!, 'http://localhost')
      expect(url.searchParams.has('excludeInteractionId')).toBe(false)
    }
  })

  it('sends the parent person or company so a new Visit resolves subjects in its organization', () => {
    const entityId = '22222222-2222-4222-8222-222222222222'
    const fromRelatedTo = new URL(visitAvailabilityRequestUrl({ ...values, relatedTo: { id: entityId, kind: 'person', label: 'Ada' } })!, 'http://localhost')
    expect(fromRelatedTo.searchParams.get('entityId')).toBe(entityId)
    const fromEntityId = new URL(visitAvailabilityRequestUrl({ ...values, entityId })!, 'http://localhost')
    expect(fromEntityId.searchParams.get('entityId')).toBe(entityId)
    for (const relatedTo of [null, undefined, { id: 'not-a-uuid' }, {}]) {
      const url = new URL(visitAvailabilityRequestUrl({ ...values, relatedTo })!, 'http://localhost')
      expect(url.searchParams.has('entityId')).toBe(false)
    }
  })

  it('uses a localized unnamed label rather than a UUID or exposing the selection id', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const message = visitAvailabilitySubjectMessage({ type: 'staff', id, displayName: id, status: 'unknown', reasonKey: null },
      { participants: [{ userId: id, name: id }] }, createTranslator(dictionary))
    expect(message).toBe('Selected staff member: Availability could not be confirmed.')
    expect(message).not.toContain(id)
  })

})
