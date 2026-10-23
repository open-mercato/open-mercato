import {
  generatePeriods,
  initialLedgerState,
  isDate,
  journalEntries,
  reconcile,
  starterChart,
  trialBalance,
  validBank,
  validNip,
  type LedgerState,
} from '../ledger-spec'

function configuredLedger(): LedgerState {
  return {
    ...initialLedgerState,
    accounts: starterChart.accounts,
    types: starterChart.types,
    periods: generatePeriods('2026-01-01', []),
    clearing: '490-1',
    unallocatedAccount: '552-1',
    rules: [{ source: '402-1', target: '550-1', center: 'IT' }],
  }
}

describe('finance preview accounting periods', () => {
  it('generates a fiscal year across a calendar boundary including leap February', () => {
    const periods = generatePeriods('2023-10-01', [])

    expect(periods).toHaveLength(12)
    expect(periods[0]).toEqual({ start: '2023-10-01', end: '2023-10-31', locked: false })
    expect(periods[4]).toEqual({ start: '2024-02-01', end: '2024-02-29', locked: false })
    expect(periods[11]).toEqual({ start: '2024-09-01', end: '2024-09-30', locked: false })
  })

  it('preserves existing locks while adding an adjacent year in chronological order', () => {
    const existing = [{ start: '2027-01-01', end: '2027-01-31', locked: true }]
    const periods = generatePeriods('2026-01-01', existing)

    expect(periods).toHaveLength(13)
    expect(periods[12]).toEqual(existing[0])
    expect(existing).toEqual([{ start: '2027-01-01', end: '2027-01-31', locked: true }])
  })

  it.each([
    { start: '2026-09-01', end: '2026-09-30', locked: false },
    { start: '2025-12-31', end: '2026-01-01', locked: true },
    { start: '2026-12-31', end: '2027-01-31', locked: false },
  ])('rejects overlapping periods without modifying existing data: %j', (existingPeriod) => {
    const existing = [existingPeriod]
    const snapshot = structuredClone(existing)

    expect(() => generatePeriods('2026-01-01', existing)).toThrow()
    expect(existing).toEqual(snapshot)
  })

  it.each(['2026-02-30', '2026-09-25', '2026-13-01', '01.09.2026', ''])(
    'rejects an invalid fiscal-year start: %s',
    (start) => expect(() => generatePeriods(start, [])).toThrow(),
  )
})

describe('finance preview reclassification', () => {
  it('posts the source cost once and preserves its source reference', () => {
    const before = configuredLedger()
    const posted = reconcile(before)
    const repeated = reconcile(posted)
    const added = journalEntries(repeated).filter((entry) => entry.id === 'PK/2026/4-5')

    expect(before.reclassification).toBeNull()
    expect(repeated).toBe(posted)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      reference: 'FZ/2026/091',
      date: '2026-09-25',
      lines: [
        { account: '550-1', debit: 123000, credit: 0 },
        { account: '490-1', debit: 0, credit: 123000 },
      ],
    })
    expect(journalEntries(repeated)).toHaveLength(journalEntries(before).length + 1)
  })

  it('keeps the posted allocation when the rule and period are subsequently changed', () => {
    const posted = reconcile(configuredLedger())
    const changed: LedgerState = {
      ...posted,
      periods: posted.periods.map((period) => ({ ...period, locked: true })),
      rules: [{ source: '402-1', target: '552-1', center: 'SALES' }],
    }

    expect(reconcile(changed).reclassification).toEqual({
      target: '550-1', clearing: '490-1', center: 'IT',
    })
    expect(journalEntries(changed)).toEqual(journalEntries(posted))
  })

  it('routes unmatched costs to the configured unallocated account', () => {
    expect(reconcile({ ...configuredLedger(), rules: [] }).reclassification).toEqual({
      target: '552-1', clearing: '490-1', center: 'UNALLOCATED',
    })
  })

  it('does not allocate a new posting to an inactive cost center', () => {
    const state = configuredLedger()
    state.centers = state.centers.map((center) => ({ ...center, active: false }))

    expect(reconcile(state).reclassification).toEqual({
      target: '550-1', clearing: '490-1', center: 'UNALLOCATED',
    })
  })

  it.each(['clearing', 'unallocatedAccount'] as const)(
    'requires the %s setting before posting',
    (setting) => {
      const state = { ...configuredLedger(), [setting]: '' }
      expect(() => reconcile(state)).toThrow()
      expect(state.reclassification).toBeNull()
    },
  )

  it.each(['missing', 'locked'])('blocks posting when the source period is %s', (condition) => {
    const state = configuredLedger()
    state.periods = condition === 'missing'
      ? []
      : state.periods.map((period) => ({ ...period, locked: true }))

    expect(() => reconcile(state)).toThrow()
    expect(state.reclassification).toBeNull()
  })
})

describe('finance preview trial balance', () => {
  it('separates opening balances, period turnovers and debit/credit normal balances', () => {
    const rows = trialBalance(configuredLedger(), '2026-09-01', '2026-09-30')

    expect(rows.find((row) => row.number === '130-1')).toMatchObject({
      opening: 1000000, periodDebit: 200000, periodCredit: 0,
      ytdDebit: 1200000, ytdCredit: 0, closing: 1200000,
    })
    expect(rows.find((row) => row.number === '210-1')).toMatchObject({
      periodDebit: 0, periodCredit: 123000, closing: 123000,
    })
    expect(rows.find((row) => row.number === '800-1')).toMatchObject({
      opening: 1000000, periodDebit: 0, periodCredit: 0, closing: 1000000,
    })
  })

  it('excludes future receipts from the as-of date', () => {
    const rows = trialBalance(configuredLedger(), '2026-09-01', '2026-09-25')

    expect(rows.find((row) => row.number === '130-1')?.closing).toBe(1000000)
    expect(rows.find((row) => row.number === '700-1')?.closing).toBeCloseTo(0, 2)
    expect(rows.find((row) => row.number === '210-1')?.closing).toBe(123000)
  })

  it('carries September balances into October and applies the linked reversal', () => {
    const rows = trialBalance(configuredLedger(), '2026-10-01', '2026-10-31')

    expect(rows.find((row) => row.number === '130-1')).toMatchObject({
      opening: 1200000, periodDebit: 0, periodCredit: 200000, closing: 1000000,
    })
    const revenue = rows.find((row) => row.number === '700-1')
    expect(revenue).toMatchObject({
      opening: 200000, periodDebit: 200000, periodCredit: 0,
    })
    expect(revenue?.closing).toBeCloseTo(0, 2)
  })

  it('keeps the entire ledger balanced after reclassification and reversal', () => {
    const rows = trialBalance(reconcile(configuredLedger()), '2026-01-01', '2026-10-31')
    const debit = rows.reduce((sum, row) => sum + row.periodDebit, 0)
    const credit = rows.reduce((sum, row) => sum + row.periodCredit, 0)
    const signedClosing = rows.reduce(
      (sum, row) => sum + row.closing * (row.normal === 'DEBIT' ? 1 : -1), 0,
    )

    expect(debit).toBe(1646000)
    expect(credit).toBe(debit)
    expect(signedClosing).toBe(0)
  })

  it('resets year-to-date turnovers without discarding carried balances', () => {
    const bank = trialBalance(configuredLedger(), '2027-01-01', '2027-01-31')
      .find((row) => row.number === '130-1')

    expect(bank).toMatchObject({ opening: 1000000, ytdDebit: 0, ytdCredit: 0, closing: 1000000 })
  })
})

describe('finance preview registry validation', () => {
  it('accepts a valid NIP and rejects altered checksums and malformed identifiers', () => {
    expect(validNip('5260250995')).toBe(true)
    for (const invalid of ['5260250994', '526025099', '52602509955', '526-025-09-95', '526025099X']) {
      expect(validNip(invalid)).toBe(false)
    }
  })

  it('validates Polish IBAN length, country and checksum', () => {
    expect(validBank('PL61109010140000071219812874')).toBe(true)
    for (const invalid of ['PL62109010140000071219812874', 'DE61109010140000071219812874', '61109010140000071219812874', 'PL6110901014000007121981287']) {
      expect(validBank(invalid)).toBe(false)
    }
  })

  it('rejects normalized invalid calendar dates', () => {
    expect(isDate('2024-02-29')).toBe(true)
    expect(isDate('2026-02-29')).toBe(false)
    expect(isDate('2026-04-31')).toBe(false)
    expect(isDate('2026-09-25T00:00:00Z')).toBe(false)
  })
})

describe('finance preview zero balance display', () => {
  it('does not show a minus sign for unused credit-normal accounts', () => {
    const state = configuredLedger()
    state.accounts = [{
      number: '209',
      name: 'Unused liability',
      type: '20',
      normal: 'CREDIT',
      used: false,
    }]
    const balances = trialBalance(state, '2026-09-01', '2026-09-30')
    expect(balances).toHaveLength(1)
    expect(Object.is(balances[0].opening, -0)).toBe(false)
    expect(Object.is(balances[0].closing, -0)).toBe(false)
  })
})
