import {
  addMonths,
  balancedEntry,
  dayBefore,
  invertEntry,
  isDate,
  monthlySchedule,
  numeric,
  serviceSchedule,
} from '../operations-spec'

describe('finance preview accrual schedules', () => {
  it('allocates the rounding remainder to the final month without losing a cent', () => {
    const schedule = monthlySchedule(100, '2026-09-01', 3)

    expect(schedule.map((row) => row.amount)).toEqual([33.33, 33.33, 33.34])
    expect(schedule.reduce((sum, row) => sum + Math.round(row.amount * 100), 0)).toBe(10000)
    expect(schedule.every((row) => !row.accrued && row.journal === null)).toBe(true)
  })

  it('retains month-end anchors across February and a year boundary', () => {
    const schedule = monthlySchedule(1200, '2023-12-31', 4)

    expect(schedule.map((row) => [row.start, row.end])).toEqual([
      ['2023-12-31', '2024-01-30'],
      ['2024-01-31', '2024-02-28'],
      ['2024-02-29', '2024-03-30'],
      ['2024-03-31', '2024-04-29'],
    ])
    expect(schedule.every((row) => row.amount === 300)).toBe(true)
  })

  it('allocates a one-time expense entirely to the first and only interval', () => {
    const schedule = monthlySchedule(1230.49, '2026-09-01', 1)

    expect(schedule).toHaveLength(1)
    expect(schedule[0]).toMatchObject({ start: '2026-09-01', end: '2026-09-30', amount: 1230.49 })
  })

  it('keeps the final service interval within the agreed contract end', () => {
    const schedule = serviceSchedule(1000, '2026-09-15', '2026-11-20')

    expect(schedule.map((row) => [row.start, row.end, row.amount])).toEqual([
      ['2026-09-15', '2026-10-14', 333.33],
      ['2026-10-15', '2026-11-14', 333.33],
      ['2026-11-15', '2026-11-20', 333.34],
    ])
  })

  it('supports a service shorter than one month without extending it', () => {
    expect(serviceSchedule(42.01, '2026-09-25', '2026-09-30')).toEqual([
      { id: '1', start: '2026-09-25', end: '2026-09-30', amount: 42.01, accrued: false, journal: null },
    ])
  })
})

describe('finance preview posting and reversal', () => {
  it('rounds both sides identically and reverses each original account without mutating it', () => {
    const posted = balancedEntry('FX/09', '2026-09-30', 'Valuation', '200', '750', 1.005)
    const snapshot = structuredClone(posted)
    const reversed = invertEntry(posted, 'ST/10', '2026-10-01', 'Reversal')

    expect(posted.map((row) => [row.account, row.debit, row.credit])).toEqual([
      ['200', 1.01, 0], ['750', 0, 1.01],
    ])
    expect(reversed.map((row) => [row.account, row.debit, row.credit])).toEqual([
      ['200', 0, 1.01], ['750', 1.01, 0],
    ])
    expect(reversed.every((row) => row.date === '2026-10-01')).toBe(true)
    expect(new Set([...posted, ...reversed].map((row) => row.id)).size).toBe(4)
    expect(posted).toEqual(snapshot)
    for (const account of ['200', '750']) {
      const balance = [...posted, ...reversed]
        .filter((row) => row.account === account)
        .reduce((sum, row) => sum + row.debit - row.credit, 0)
      expect(balance).toBe(0)
    }
  })

  it('supports reversing a multi-line journal without losing allocations', () => {
    const original = [
      { id: 'cost', date: '2026-09-25', description: 'Purchase', account: '402', debit: 100, credit: 0 },
      { id: 'vat', date: '2026-09-25', description: 'Purchase', account: '223', debit: 23, credit: 0 },
      { id: 'vendor', date: '2026-09-25', description: 'Purchase', account: '202', debit: 0, credit: 123 },
    ]
    const reversed = invertEntry(original, 'reversal', '2026-09-26', 'Correction')

    expect(reversed.map((row) => [row.account, row.debit, row.credit])).toEqual([
      ['402', 0, 100], ['223', 0, 23], ['202', 123, 0],
    ])
    expect(reversed.reduce((sum, row) => sum + row.debit - row.credit, 0)).toBe(0)
  })
})

describe('finance preview date and amount inputs', () => {
  it.each([
    ['1 234,56', 1234.56],
    ['1\u00a0234,56', 1234.56],
    ['1\u202f234,56', 1234.56],
    ['-42,50', -42.5],
    [1234.56, 1234.56],
  ])('reads a localized amount %s', (input, expected) => {
    expect(numeric(input)).toBe(expected)
  })

  it('leaves malformed amounts invalid for form validation', () => {
    expect(Number.isNaN(numeric('12,30 PLN'))).toBe(true)
    expect(Number.isNaN(numeric('1,2,3'))).toBe(true)
  })

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '25.09.2026', '', null, undefined, 20260925])(
    'rejects invalid date input %s',
    (input) => expect(isDate(input)).toBe(false),
  )

  it('uses calendar dates independently of the runtime time zone', () => {
    expect(isDate('2024-02-29')).toBe(true)
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(dayBefore('2026-01-01')).toBe('2025-12-31')
    expect(dayBefore('2024-03-01')).toBe('2024-02-29')
  })
})
