import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import widget from '../injection/visit-availability/widget'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const values = {
  category: 'visit', date: '2026-10-01', startTime: '10:00', endDate: '2026-10-01', endTime: '11:00',
  participants: [{ userId: '2c3884dc-f677-449a-a804-e45b8a3c10b3', name: 'Alex', isCustomer: false }],
  resources: [{ id: '52ffdb7a-5e40-46df-a387-b4093fd77c19', label: 'Room' }],
}

describe('selected Visit availability widget', () => {
  beforeEach(() => {
    jest.mocked(apiCall).mockReset()
    jest.mocked(apiCall).mockResolvedValueOnce({ ok: true, status: 200,
      result: { items: [{ key: 'visit', behavior: { fields: { people: 'recipients', resources: true } } }] },
      response: {} as Response, cacheStatus: null })
  })

  it('declares its selected type and blocks unavailable subjects', async () => {
    expect(widget.metadata).not.toHaveProperty('calendarEventTypeKeys')
    jest.mocked(apiCall).mockResolvedValue({ ok: true, status: 200, result: { subjects: [
      { type: 'staff', id: values.participants[0].userId, status: 'unavailable', reasonKey: null },
    ] }, response: {} as Response, cacheStatus: null })
    const result = await widget.eventHandlers?.onBeforeSave?.(values, {})
    expect(result).toEqual({ ok: false, fieldErrors: { participants: 'example.calendar.visitAvailability.unavailable' } })
    expect(jest.mocked(apiCall).mock.calls[1]?.[0]).toContain('/api/example/visit-availability?')
  })

  it('fails closed when the interval or lookup is unavailable', async () => {
    expect(await widget.eventHandlers?.onBeforeSave?.({ ...values, endTime: '09:00' }, {}))
      .toEqual({ ok: false, fieldErrors: { ends: 'example.calendar.visitAvailability.invalidInterval' } })
    jest.mocked(apiCall).mockResolvedValueOnce({ ok: true, status: 200, result: { items: [{ key: 'visit', behavior: { fields: {} } }] }, response: {} as Response, cacheStatus: null })
    jest.mocked(apiCall).mockResolvedValue({ ok: false, status: 503, result: null,
      response: {} as Response, cacheStatus: null })
    expect(await widget.eventHandlers?.onBeforeSave?.(values, {}))
      .toEqual({ ok: false, fieldErrors: { ends: 'example.calendar.visitAvailability.retry' } })
  })

  it('does not check hidden same-type assignments', async () => {
    jest.mocked(apiCall).mockReset()
    jest.mocked(apiCall).mockResolvedValueOnce({ ok: true, status: 200, result: { items: [{ key: 'visit', behavior: { fields: { people: 'none', resources: false } } }] }, response: {} as Response, cacheStatus: null })
    jest.mocked(apiCall).mockResolvedValue({ ok: true, status: 200, result: { subjects: [] },
      response: {} as Response, cacheStatus: null })
    expect(await widget.eventHandlers?.onBeforeSave?.(values, {})).toEqual({ ok: true })
    const url = new URL(String(jest.mocked(apiCall).mock.calls[1]?.[0]), 'http://localhost')
    expect(url.searchParams.has('staffUserIds')).toBe(false)
    expect(url.searchParams.has('resourceIds')).toBe(false)
  })
  it('skips other event types without any catalog or availability request', async () => {
    expect(await widget.eventHandlers?.onBeforeSave?.({ ...values, category: 'meeting' }, {})).toEqual({ ok: true })
    expect(apiCall).not.toHaveBeenCalled()
  })

  it('blocks when the selected type catalog cannot be read', async () => {
    jest.mocked(apiCall).mockReset().mockResolvedValue({ ok: false, status: 503, result: null, response: {} as Response, cacheStatus: null })
    expect(await widget.eventHandlers?.onBeforeSave?.(values, {})).toEqual({ ok: false, fieldErrors: { ends: 'example.calendar.visitAvailability.retry' } })
  })

})
