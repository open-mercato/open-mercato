import { deriveInterval } from '../interval'

describe('deriveInterval', () => {
  it('computes the end from start and duration', () => {
    expect(deriveInterval({ start: '09:00', durationMinutes: 100 })).toEqual({
      start: '09:00',
      end: '10:40',
      durationMinutes: 100,
      computed: 'end',
      crossesMidnight: false,
    })
  })

  it('computes the duration from start and end', () => {
    expect(deriveInterval({ start: '09:00', end: '10:40' })).toEqual({
      start: '09:00',
      end: '10:40',
      durationMinutes: 100,
      computed: 'duration',
      crossesMidnight: false,
    })
  })

  it('computes the start from end and duration', () => {
    expect(deriveInterval({ end: '10:40', durationMinutes: 100 })).toEqual({
      start: '09:00',
      end: '10:40',
      durationMinutes: 100,
      computed: 'start',
      crossesMidnight: false,
    })
  })

  it('reports nothing computed when all three agree', () => {
    expect(deriveInterval({ start: '09:00', end: '10:40', durationMinutes: 100 })).toEqual({
      start: '09:00',
      end: '10:40',
      durationMinutes: 100,
      computed: null,
      crossesMidnight: false,
    })
  })

  it('prefers start and end and recomputes an inconsistent duration', () => {
    expect(deriveInterval({ start: '09:00', end: '10:40', durationMinutes: 240 })).toEqual({
      start: '09:00',
      end: '10:40',
      durationMinutes: 100,
      computed: 'duration',
      crossesMidnight: false,
    })
  })

  it('reads an end earlier than its start as crossing midnight', () => {
    expect(deriveInterval({ start: '23:00', end: '01:00' })).toEqual({
      start: '23:00',
      end: '01:00',
      durationMinutes: 120,
      computed: 'duration',
      crossesMidnight: true,
    })
  })

  it('crosses midnight when start plus duration passes 24:00', () => {
    expect(deriveInterval({ start: '23:00', durationMinutes: 120 })).toEqual({
      start: '23:00',
      end: '01:00',
      durationMinutes: 120,
      computed: 'end',
      crossesMidnight: true,
    })
  })

  it('crosses midnight when the end lands exactly on 00:00', () => {
    const derived = deriveInterval({ start: '23:00', durationMinutes: 60 })
    expect(derived.end).toBe('00:00')
    expect(derived.crossesMidnight).toBe(true)
  })

  it('crosses midnight when the start is derived backwards past 00:00', () => {
    expect(deriveInterval({ end: '01:00', durationMinutes: 120 })).toEqual({
      start: '23:00',
      end: '01:00',
      durationMinutes: 120,
      computed: 'start',
      crossesMidnight: true,
    })
  })

  it('treats an equal start and end as a zero-length interval, not a full day', () => {
    const derived = deriveInterval({ start: '09:00', end: '09:00' })
    expect(derived.durationMinutes).toBe(0)
    expect(derived.crossesMidnight).toBe(false)
  })

  it('returns what it was given when fewer than two fields are usable', () => {
    expect(deriveInterval({ start: '09:00' })).toEqual({
      start: '09:00',
      end: null,
      durationMinutes: null,
      computed: null,
      crossesMidnight: false,
    })
    expect(deriveInterval({ durationMinutes: 60 })).toEqual({
      start: null,
      end: null,
      durationMinutes: 60,
      computed: null,
      crossesMidnight: false,
    })
    expect(deriveInterval({})).toEqual({
      start: null,
      end: null,
      durationMinutes: null,
      computed: null,
      crossesMidnight: false,
    })
  })

  it('normalizes clock strings and ignores unusable ones', () => {
    expect(deriveInterval({ start: '9:05', durationMinutes: 30 }).start).toBe('09:05')
    expect(deriveInterval({ start: 'nonsense', durationMinutes: 30 }).start).toBeNull()
    expect(deriveInterval({ start: '25:00', durationMinutes: 30 }).start).toBeNull()
    expect(deriveInterval({ start: '09:00', durationMinutes: -5 }).durationMinutes).toBeNull()
  })
})
