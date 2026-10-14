import {
  resolveProjectAmountDecimalPlaces,
  summarizeProjectEntryGroups,
  type ProjectEntryGroup,
} from '../computeProjectFinancials'

function group(overrides: Partial<ProjectEntryGroup> = {}): ProjectEntryGroup {
  return {
    projectId: 'p1',
    isBillable: true,
    rateOverrideAmount: null,
    billingMinutes: 60,
    rawMinutes: 60,
    entryCount: 1,
    ...overrides,
  }
}

describe('summarizeProjectEntryGroups', () => {
  it('returns zeroed rows for projects without entries', () => {
    const result = summarizeProjectEntryGroups([], new Map([['p1', 320]]), ['p1'])
    expect(result.get('p1')).toEqual({ totalMinutes: 0, billableMinutes: 0, cost: null, costExact: null })
  })

  it('sums raw minutes for hours and rounded minutes for cost', () => {
    const groups = [group({ billingMinutes: 60, rawMinutes: 52, entryCount: 1 })]
    const result = summarizeProjectEntryGroups(groups, new Map([['p1', 320]]), ['p1'])
    expect(result.get('p1')).toEqual({ totalMinutes: 52, billableMinutes: 52, cost: 320, costExact: '320' })
  })

  it('multiplies a grouped bucket by its entry count', () => {
    const groups = [group({ billingMinutes: 30, rawMinutes: 90, entryCount: 3 })]
    const result = summarizeProjectEntryGroups(groups, new Map([['p1', 100]]), ['p1'])
    expect(result.get('p1')?.cost).toBe(150)
  })

  it('prefers the entry rate override over the project rate', () => {
    const groups = [group({ rateOverrideAmount: 500 })]
    const result = summarizeProjectEntryGroups(groups, new Map([['p1', 320]]), ['p1'])
    expect(result.get('p1')?.cost).toBe(500)
  })

  it('excludes non-billable minutes from cost but keeps them in total hours', () => {
    const groups = [
      group({ isBillable: false, billingMinutes: 120, rawMinutes: 120 }),
      group({ billingMinutes: 60, rawMinutes: 60 }),
    ]
    const result = summarizeProjectEntryGroups(groups, new Map([['p1', 200]]), ['p1'])
    expect(result.get('p1')).toEqual({ totalMinutes: 180, billableMinutes: 60, cost: 200, costExact: '200' })
  })

  it('leaves cost null when no rate is available anywhere', () => {
    const groups = [group()]
    const result = summarizeProjectEntryGroups(groups, new Map([['p1', null]]), ['p1'])
    expect(result.get('p1')).toEqual({ totalMinutes: 60, billableMinutes: 60, cost: null, costExact: null })
  })

  it('keeps each project separate and never merges currencies', () => {
    const groups = [
      group({ projectId: 'p1', billingMinutes: 60, rawMinutes: 60 }),
      group({ projectId: 'p2', billingMinutes: 120, rawMinutes: 120 }),
    ]
    const result = summarizeProjectEntryGroups(
      groups,
      new Map([
        ['p1', 320],
        ['p2', 95],
      ]),
      ['p1', 'p2'],
    )
    expect(result.get('p1')?.cost).toBe(320)
    expect(result.get('p2')?.cost).toBe(190)
  })

  it('rounds at the entry, so the project total is a sum of rounded amounts', () => {
    const groups = [
      group({ billingMinutes: 10, rawMinutes: 10 }),
      group({ billingMinutes: 10, rawMinutes: 10 }),
      group({ billingMinutes: 10, rawMinutes: 10 }),
    ]
    const result = summarizeProjectEntryGroups(groups, new Map([['p1', 100.03]]), ['p1'])
    expect(result.get('p1')?.cost).toBe(50.01)
  })

  it('ignores groups for projects outside the requested page', () => {
    const groups = [group({ projectId: 'other' })]
    const result = summarizeProjectEntryGroups(groups, new Map([['p1', 320]]), ['p1'])
    expect(result.get('p1')).toEqual({ totalMinutes: 0, billableMinutes: 0, cost: null, costExact: null })
    expect(result.has('other')).toBe(false)
  })
})

describe('summarizeProjectEntryGroups - currency decimals (D10)', () => {
  const groups = [
    group({ projectId: 'p-jpy', billingMinutes: 7, rawMinutes: 7 }),
    group({ projectId: 'p-kwd', billingMinutes: 7, rawMinutes: 7 }),
    group({ projectId: 'p-unknown', billingMinutes: 7, rawMinutes: 7 }),
  ]
  const rates = new Map<string, string | null>([
    ['p-jpy', '123.4567'],
    ['p-kwd', '123.4567'],
    ['p-unknown', '123.4567'],
  ])

  it('rounds each project cost to its own currency decimals, 2 when unknown', () => {
    const result = summarizeProjectEntryGroups(groups, rates, ['p-jpy', 'p-kwd', 'p-unknown'], {
      'p-jpy': 0,
      'p-kwd': 3,
    })
    expect(result.get('p-jpy')?.costExact).toBe('14')
    expect(result.get('p-kwd')?.costExact).toBe('14.403')
    expect(result.get('p-unknown')?.costExact).toBe('14.4')
  })

  it('keeps an hourly rate beyond float precision exact', () => {
    const result = summarizeProjectEntryGroups(
      [group({ billingMinutes: 60, rawMinutes: 60 })],
      new Map([['p1', '12345678901234567.89']]),
      ['p1'],
    )
    expect(result.get('p1')?.costExact).toBe('12345678901234567.89')
  })
})

describe('resolveProjectAmountDecimalPlaces', () => {
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

  it('resolves each distinct currency once and falls back to 2 without a currency', async () => {
    const getDecimalPlaces = jest.fn(async ({ code }: { code: string }) => (code === 'KWD' ? 3 : null))
    const container = {
      resolve: <T,>(name: string): T => {
        if (name !== 'currencyPrecisionService') throw new Error('[internal] not registered')
        return { getDecimalPlaces } as unknown as T
      },
    }
    const result = await resolveProjectAmountDecimalPlaces(
      container,
      [
        { id: 'p-jpy', currencyCode: 'JPY' },
        { id: 'p-usd', currencyCode: 'usd' },
        { id: 'p-kwd', currencyCode: 'KWD' },
        { id: 'p-kwd-2', currencyCode: 'KWD' },
        { id: 'p-none', currencyCode: null },
      ],
      scope,
    )
    expect(result).toEqual({ 'p-jpy': 0, 'p-usd': 2, 'p-kwd': 3, 'p-kwd-2': 3, 'p-none': 2 })
    expect(getDecimalPlaces).toHaveBeenCalledTimes(3)
  })
})
