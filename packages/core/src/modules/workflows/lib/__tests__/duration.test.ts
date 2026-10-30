import { calculateDueDate, parseDuration, parseIso8601Duration, toTimeoutMs } from '../duration'

describe('parseDuration', () => {
  describe('ISO 8601 format', () => {
    test('PT5M → 5 minutes', () => {
      expect(parseDuration('PT5M')).toBe(5 * 60 * 1000)
    })

    test('PT1H → 1 hour', () => {
      expect(parseDuration('PT1H')).toBe(60 * 60 * 1000)
    })

    test('PT30S → 30 seconds', () => {
      expect(parseDuration('PT30S')).toBe(30 * 1000)
    })

    test('P1D → 1 day', () => {
      expect(parseDuration('P1D')).toBe(24 * 60 * 60 * 1000)
    })

    test('P3D → 3 days', () => {
      expect(parseDuration('P3D')).toBe(3 * 24 * 60 * 60 * 1000)
    })

    test('PT1H30M → 1 hour 30 minutes', () => {
      expect(parseDuration('PT1H30M')).toBe(90 * 60 * 1000)
    })

    test('P1DT2H3M4S → combined', () => {
      const expected =
        1 * 24 * 60 * 60 * 1000 +
        2 * 60 * 60 * 1000 +
        3 * 60 * 1000 +
        4 * 1000
      expect(parseDuration('P1DT2H3M4S')).toBe(expected)
    })
  })

  describe('simple format', () => {
    test('5m → 5 minutes', () => {
      expect(parseDuration('5m')).toBe(5 * 60 * 1000)
    })

    test('1h → 1 hour', () => {
      expect(parseDuration('1h')).toBe(60 * 60 * 1000)
    })

    test('3d → 3 days', () => {
      expect(parseDuration('3d')).toBe(3 * 24 * 60 * 60 * 1000)
    })

    test('30s → 30 seconds', () => {
      expect(parseDuration('30s')).toBe(30 * 1000)
    })
  })

  describe('error cases', () => {
    test('throws on invalid string', () => {
      expect(() => parseDuration('invalid')).toThrow('Invalid duration format')
    })

    test('throws on unsupported format', () => {
      expect(() => parseDuration('2hours')).toThrow('Invalid duration format')
    })

    test('throws on random text', () => {
      expect(() => parseDuration('abc')).toThrow('Invalid duration format')
    })

    test('throws on years and months, which have no fixed millisecond length', () => {
      expect(() => parseDuration('P1Y')).toThrow('no fixed length in milliseconds')
      expect(() => parseDuration('P2M')).toThrow('no fixed length in milliseconds')
    })
  })

  describe('weeks', () => {
    test('P1W → 1 week', () => {
      expect(parseDuration('P1W')).toBe(7 * 24 * 60 * 60 * 1000)
    })

    test('P2W3D → weeks and days combine', () => {
      expect(parseDuration('P2W3D')).toBe(17 * 24 * 60 * 60 * 1000)
    })
  })
})

describe('parseIso8601Duration', () => {
  test('distinguishes months from minutes by position around T', () => {
    expect(parseIso8601Duration('P1M')?.months).toBe(1)
    expect(parseIso8601Duration('P1M')?.minutes).toBe(0)
    expect(parseIso8601Duration('PT1M')?.minutes).toBe(1)
    expect(parseIso8601Duration('PT1M')?.months).toBe(0)
  })

  test('returns null for designator-only and malformed values', () => {
    expect(parseIso8601Duration('P')).toBeNull()
    expect(parseIso8601Duration('PT')).toBeNull()
    expect(parseIso8601Duration('P1DT')).toBeNull()
    expect(parseIso8601Duration('P1H')).toBeNull()
    expect(parseIso8601Duration('1 day')).toBeNull()
    expect(parseIso8601Duration('')).toBeNull()
  })
})

describe('calculateDueDate', () => {
  const anchor = new Date('2026-06-10T08:00:00.000Z')

  const cases: Array<[string, string]> = [
    ['PT30M', '2026-06-10T08:30:00.000Z'],
    ['PT2H', '2026-06-10T10:00:00.000Z'],
    ['P3D', '2026-06-13T08:00:00.000Z'],
    ['P1W', '2026-06-17T08:00:00.000Z'],
    ['P1DT12H', '2026-06-11T20:00:00.000Z'],
    ['PT45S', '2026-06-10T08:00:45.000Z'],
    ['30m', '2026-06-10T08:30:00.000Z'],
  ]

  test.each(cases)('%s resolves to %s', (duration, expected) => {
    expect(calculateDueDate(duration, anchor).toISOString()).toBe(expected)
  })

  test('PT30M is 30 minutes, not the one-day default the old parser fell back to', () => {
    const oneDayLater = new Date(anchor.getTime() + 24 * 60 * 60 * 1000)
    expect(calculateDueDate('PT30M', anchor).getTime()).not.toBe(oneDayLater.getTime())
    expect(calculateDueDate('PT30M', anchor).getTime() - anchor.getTime()).toBe(30 * 60 * 1000)
  })

  test('applies months as calendar arithmetic', () => {
    expect(calculateDueDate('P1M', new Date('2026-01-31T08:00:00.000Z')).getMonth()).not.toBe(0)
  })

  test('never mutates the anchor date', () => {
    const anchorCopy = new Date(anchor.getTime())
    calculateDueDate('P3D', anchorCopy)
    expect(anchorCopy.toISOString()).toBe(anchor.toISOString())
  })

  test.each(['', 'P', 'PT', 'P1H', 'tomorrow', '{{context.deadline}}'])(
    'throws on malformed duration %p instead of silently defaulting to one day',
    (duration) => {
      expect(() => calculateDueDate(duration, anchor)).toThrow('Invalid duration format')
    }
  )
})

describe('toTimeoutMs', () => {
  describe('millisecond strings', () => {
    test('"30000" → 30000 (the value the activity editor placeholder asks for)', () => {
      expect(toTimeoutMs('30000')).toBe(30000)
    })

    test('surrounding whitespace is tolerated', () => {
      expect(toTimeoutMs('  30000  ')).toBe(30000)
    })

    test('"0" is not a usable timeout', () => {
      expect(toTimeoutMs('0')).toBeUndefined()
    })
  })

  describe('duration strings', () => {
    test('PT30S → 30 seconds', () => {
      expect(toTimeoutMs('PT30S')).toBe(30 * 1000)
    })

    test('5m → 5 minutes', () => {
      expect(toTimeoutMs('5m')).toBe(5 * 60 * 1000)
    })
  })

  describe('numbers', () => {
    test('30000 → 30000', () => {
      expect(toTimeoutMs(30000)).toBe(30000)
    })

    test('zero and negatives are not usable timeouts', () => {
      expect(toTimeoutMs(0)).toBeUndefined()
      expect(toTimeoutMs(-1)).toBeUndefined()
    })

    test('NaN and Infinity are rejected', () => {
      expect(toTimeoutMs(Number.NaN)).toBeUndefined()
      expect(toTimeoutMs(Number.POSITIVE_INFINITY)).toBeUndefined()
    })
  })

  describe('unusable values return undefined instead of throwing', () => {
    test.each([
      ['malformed text', 'not-a-duration'],
      ['empty string', ''],
      ['whitespace only', '   '],
    ])('%s', (_label, value) => {
      expect(toTimeoutMs(value)).toBeUndefined()
    })

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['object', {}],
    ])('%s', (_label, value) => {
      expect(toTimeoutMs(value)).toBeUndefined()
    })
  })
})
