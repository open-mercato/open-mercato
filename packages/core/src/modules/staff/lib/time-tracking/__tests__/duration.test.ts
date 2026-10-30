import { MAX_DURATION_MINUTES, formatDuration, parseDuration } from '../duration'

describe('parseDuration', () => {
  it.each([
    ['1h 40m', 100],
    ['1h40m', 100],
    ['1 h 40 m', 100],
    ['1H40M', 100],
    ['1.5h', 90],
    ['1,5h', 90],
    ['90m', 90],
    ['90min', 90],
    ['1:40', 100],
    ['0:45', 45],
    ['2h', 120],
    ['45m', 45],
  ])('parses %s as %i minutes', (input, expected) => {
    expect(parseDuration(input)).toEqual({ ok: true, minutes: expected })
  })

  it('treats a bare number as hours', () => {
    expect(parseDuration('1.5')).toEqual({ ok: true, minutes: 90 })
    expect(parseDuration('2')).toEqual({ ok: true, minutes: 120 })
  })

  it('accepts a comma decimal separator on a bare number', () => {
    expect(parseDuration('1,5')).toEqual({ ok: true, minutes: 90 })
  })

  it('reports empty input separately from garbage', () => {
    expect(parseDuration('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseDuration('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it.each(['1godz i troche', 'abc', '1h 40', 'h', ':30', '1:75', '1h m'])(
    'rejects %s as unparseable',
    (input) => {
      expect(parseDuration(input)).toEqual({ ok: false, reason: 'unparseable' })
    },
  )

  it('never throws on hostile input', () => {
    expect(() => parseDuration(undefined as unknown as string)).not.toThrow()
    expect(parseDuration(undefined as unknown as string)).toEqual({ ok: false, reason: 'unparseable' })
  })

  it('rejects negative input rather than coercing it', () => {
    expect(parseDuration('-1')).toEqual({ ok: false, reason: 'unparseable' })
    expect(parseDuration('-2h')).toEqual({ ok: false, reason: 'unparseable' })
    expect(parseDuration('-0:30')).toEqual({ ok: false, reason: 'unparseable' })
  })

  it('clamps anything above 24 hours', () => {
    expect(parseDuration('30h')).toEqual({ ok: true, minutes: MAX_DURATION_MINUTES })
    expect(parseDuration('2000m')).toEqual({ ok: true, minutes: MAX_DURATION_MINUTES })
    expect(parseDuration('25:30')).toEqual({ ok: true, minutes: MAX_DURATION_MINUTES })
    expect(parseDuration('48')).toEqual({ ok: true, minutes: MAX_DURATION_MINUTES })
  })

  it('accepts exactly 24 hours', () => {
    expect(parseDuration('24h')).toEqual({ ok: true, minutes: 1440 })
  })

  it('rounds fractional minutes to whole minutes', () => {
    expect(parseDuration('1.33h')).toEqual({ ok: true, minutes: 80 })
  })
})

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(100, 'hm')).toBe('1h 40m')
    expect(formatDuration(120, 'hm')).toBe('2h')
    expect(formatDuration(45, 'hm')).toBe('45m')
    expect(formatDuration(0, 'hm')).toBe('0m')
  })

  it('formats clock style', () => {
    expect(formatDuration(100, 'clock')).toBe('1:40')
    expect(formatDuration(45, 'clock')).toBe('0:45')
    expect(formatDuration(1440, 'clock')).toBe('24:00')
  })

  it('formats decimal style', () => {
    expect(formatDuration(100, 'decimal')).toBe('1.67')
    expect(formatDuration(90, 'decimal')).toBe('1.50')
    expect(formatDuration(0, 'decimal')).toBe('0.00')
  })

  it('treats negative and non-finite minutes as zero', () => {
    expect(formatDuration(-30, 'hm')).toBe('0m')
    expect(formatDuration(Number.NaN, 'clock')).toBe('0:00')
  })

  it('round-trips every parseable format through parseDuration', () => {
    const minutes = 100
    expect(parseDuration(formatDuration(minutes, 'hm'))).toEqual({ ok: true, minutes })
    expect(parseDuration(formatDuration(minutes, 'clock'))).toEqual({ ok: true, minutes })
  })
})
