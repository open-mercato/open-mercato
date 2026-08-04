/**
 * @jest-environment node
 */
import {
  MAX_DURATION_MINUTES,
  formatMinutesAsDecimal,
  parseDurationInput,
} from '../timesheetsDuration'

function expectMinutes(input: string, minutes: number): void {
  expect(parseDurationInput(input)).toEqual({ ok: true, minutes })
}

function expectRejected(input: string, reason: 'invalid' | 'out_of_range'): void {
  expect(parseDurationInput(input)).toEqual({ ok: false, reason })
}

describe('parseDurationInput', () => {
  describe('h:mm clock notation (issue #4846)', () => {
    it('reads 1:30 as 90 minutes instead of coercing it to a full day', () => {
      expectMinutes('1:30', 90)
    })

    it('reads 0:45 as 45 minutes', () => {
      expectMinutes('0:45', 45)
    })

    it('reads a single-digit minute part', () => {
      expectMinutes('1:5', 65)
    })

    it('reads a two-digit hour part', () => {
      expectMinutes('10:05', 605)
    })

    it('rejects a minute part above 59', () => {
      expectRejected('1:60', 'invalid')
    })
  })

  describe('minute suffixes', () => {
    it('reads 90m as 90 minutes', () => {
      expectMinutes('90m', 90)
    })

    it('reads 90min as 90 minutes', () => {
      expectMinutes('90min', 90)
    })

    it('tolerates whitespace before the suffix', () => {
      expectMinutes('45 m', 45)
    })
  })

  describe('hour suffixes and combinations', () => {
    it('reads 1h as 60 minutes', () => {
      expectMinutes('1h', 60)
    })

    it('reads 1h 30m as 90 minutes', () => {
      expectMinutes('1h 30m', 90)
    })

    it('reads 1h30m without a space', () => {
      expectMinutes('1h30m', 90)
    })

    it('is case insensitive', () => {
      expectMinutes('1H 30M', 90)
    })
  })

  describe('decimal hours', () => {
    it('reads a bare integer as hours', () => {
      expectMinutes('8', 480)
    })

    it('reads a dot decimal as hours', () => {
      expectMinutes('1.5', 90)
    })

    it('reads a comma decimal as hours', () => {
      expectMinutes('1,5', 90)
    })

    it('rounds to the nearest minute', () => {
      expectMinutes('1.008', 60)
    })

    it('trims surrounding whitespace', () => {
      expectMinutes('  2  ', 120)
    })
  })

  describe('empty input', () => {
    it('treats an empty string as zero', () => {
      expectMinutes('', 0)
    })

    it('treats whitespace as zero', () => {
      expectMinutes('   ', 0)
    })

    it('reads an explicit zero', () => {
      expectMinutes('0', 0)
    })
  })

  describe('rejections instead of silent coercion (issue #4846)', () => {
    it('rejects a bare 30 as out of range rather than clamping it to 24h', () => {
      expectRejected('30', 'out_of_range')
    })

    it('rejects a colon-less 130 as out of range rather than clamping it to 24h', () => {
      expectRejected('130', 'out_of_range')
    })

    it('rejects non-numeric text instead of silently reverting to zero', () => {
      expectRejected('abc', 'invalid')
    })

    it('rejects a stray suffix', () => {
      expectRejected('90x', 'invalid')
    })

    it('rejects a negative value', () => {
      expectRejected('-1', 'invalid')
    })

    it('accepts exactly 24 hours', () => {
      expectMinutes('24', MAX_DURATION_MINUTES)
    })

    it('accepts exactly 24:00', () => {
      expectMinutes('24:00', MAX_DURATION_MINUTES)
    })

    it('rejects 25 hours', () => {
      expectRejected('25', 'out_of_range')
    })

    it('rejects 24:01', () => {
      expectRejected('24:01', 'out_of_range')
    })

    it('rejects 1441 minutes', () => {
      expectRejected('1441m', 'out_of_range')
    })
  })
})

describe('formatMinutesAsDecimal', () => {
  it('returns an empty string for zero', () => {
    expect(formatMinutesAsDecimal(0)).toBe('')
  })

  it('formats whole hours without decimals', () => {
    expect(formatMinutesAsDecimal(480)).toBe('8')
  })

  it('formats a half hour', () => {
    expect(formatMinutesAsDecimal(90)).toBe('1.5')
  })

  it('formats a quarter hour', () => {
    expect(formatMinutesAsDecimal(75)).toBe('1.25')
  })

  it('round-trips every value the parser accepts', () => {
    for (const input of ['1:30', '90m', '1,5', '1h 30m', '8', '24']) {
      const parsed = parseDurationInput(input)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      const reparsed = parseDurationInput(formatMinutesAsDecimal(parsed.minutes))
      expect(reparsed).toEqual({ ok: true, minutes: parsed.minutes })
    }
  })
})
