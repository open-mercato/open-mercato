import {
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
    expect(result.get('p1')).toEqual({ totalMinutes: 0, billableMinutes: 0, cost: null })
  })

  it('sums raw minutes for hours and rounded minutes for cost', () => {
    const groups = [group({ billingMinutes: 60, rawMinutes: 52, entryCount: 1 })]
    const result = summarizeProjectEntryGroups(groups, new Map([['p1', 320]]), ['p1'])
    expect(result.get('p1')).toEqual({ totalMinutes: 52, billableMinutes: 52, cost: 320 })
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
    expect(result.get('p1')).toEqual({ totalMinutes: 180, billableMinutes: 60, cost: 200 })
  })

  it('leaves cost null when no rate is available anywhere', () => {
    const groups = [group()]
    const result = summarizeProjectEntryGroups(groups, new Map([['p1', null]]), ['p1'])
    expect(result.get('p1')).toEqual({ totalMinutes: 60, billableMinutes: 60, cost: null })
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
    expect(result.get('p1')).toEqual({ totalMinutes: 0, billableMinutes: 0, cost: null })
    expect(result.has('other')).toBe(false)
  })
})
