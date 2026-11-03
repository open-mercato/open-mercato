import {
  MIN_SCHEDULE_INTERVAL_MS,
  isValidScheduleInterval,
  parseScheduleInterval,
} from '../interval'

describe('parseScheduleInterval', () => {
  it('converts each documented unit to milliseconds', () => {
    expect(parseScheduleInterval('90s')).toBe(90 * 1000)
    expect(parseScheduleInterval('15m')).toBe(15 * 60 * 1000)
    expect(parseScheduleInterval('6h')).toBe(6 * 60 * 60 * 1000)
    expect(parseScheduleInterval('1d')).toBe(24 * 60 * 60 * 1000)
  })

  it('rejects a value that carries no unit', () => {
    expect(() => parseScheduleInterval('3600')).toThrow('Invalid interval format: 3600')
  })
})

describe('isValidScheduleInterval', () => {
  it.each(['1h', '6h', '24h', '15m', '60s', '1d'])('accepts the documented format %s', (interval) => {
    expect(isValidScheduleInterval(interval)).toBe(true)
  })

  it.each(['3600', '', ' 1h', '1h ', '1.5h', '-1h', 'hourly', '1w', '1H'])(
    'rejects %p, which the scheduler could never run',
    (interval) => {
      expect(isValidScheduleInterval(interval)).toBe(false)
    },
  )

  it('rejects an interval shorter than the enforced minimum', () => {
    expect(MIN_SCHEDULE_INTERVAL_MS).toBe(60 * 1000)
    expect(isValidScheduleInterval('30s')).toBe(false)
    expect(isValidScheduleInterval('0m')).toBe(false)
  })
})
