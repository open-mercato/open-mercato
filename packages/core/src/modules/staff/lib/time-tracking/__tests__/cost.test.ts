import { applicableRate, entryAmount, round2, sumAmounts } from '../cost'
import type { CostEntry, CostProject } from '../cost'

type ReportEntry = CostEntry & {
  taskId: string
  personId: string
  date: string
}

const project: CostProject = { hourlyRate: 180 }

const entries: ReportEntry[] = [
  { taskId: 't1', personId: 'p1', date: '2026-08-10', isBillable: true, roundedMinutes: 75 },
  { taskId: 't1', personId: 'p2', date: '2026-08-10', isBillable: true, roundedMinutes: 20 },
  { taskId: 't2', personId: 'p1', date: '2026-08-11', isBillable: true, roundedMinutes: 55 },
  {
    taskId: 't2',
    personId: 'p2',
    date: '2026-08-11',
    isBillable: true,
    roundedMinutes: 100,
    rateOverrideAmount: 222.22,
  },
  { taskId: 't3', personId: 'p1', date: '2026-08-12', isBillable: false, roundedMinutes: 480 },
  { taskId: 't3', personId: 'p2', date: '2026-08-12', isBillable: true, roundedMinutes: 7 },
]

function groupBy(key: keyof Pick<ReportEntry, 'taskId' | 'personId' | 'date'>): ReportEntry[][] {
  const groups = new Map<string, ReportEntry[]>()
  for (const entry of entries) {
    const bucket = groups.get(entry[key]) ?? []
    bucket.push(entry)
    groups.set(entry[key], bucket)
  }
  return Array.from(groups.values())
}

function grandTotalGroupedBy(key: keyof Pick<ReportEntry, 'taskId' | 'personId' | 'date'>): number {
  const lineTotals = groupBy(key).map((group) => sumAmounts(group.map((entry) => entryAmount(entry, project))))
  return sumAmounts(lineTotals)
}

describe('round2', () => {
  it('rounds decimal halves up instead of inheriting float drift', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(3546.665)).toBe(3546.67)
    expect(round2(2.675)).toBe(2.68)
    expect(round2(1.0049)).toBe(1)
  })

  it('rounds negative halves away from zero', () => {
    expect(round2(-1.005)).toBe(-1.01)
    expect(round2(-2.675)).toBe(-2.68)
  })

  it('leaves already-rounded values untouched', () => {
    expect(round2(125.5)).toBe(125.5)
    expect(round2(0)).toBe(0)
  })

  it('treats non-finite input as zero', () => {
    expect(round2(Number.NaN)).toBe(0)
    expect(round2(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('applicableRate', () => {
  it('falls back to the project rate', () => {
    expect(applicableRate({ rateOverrideAmount: null }, project)).toBe(180)
  })

  it('prefers the entry override over the project rate', () => {
    expect(applicableRate({ rateOverrideAmount: 250 }, project)).toBe(250)
  })

  it('honours a zero override rather than falling through to the project rate', () => {
    expect(applicableRate({ rateOverrideAmount: 0 }, project)).toBe(0)
  })

  it('returns null when neither side carries a rate', () => {
    expect(applicableRate({ rateOverrideAmount: null }, { hourlyRate: null })).toBeNull()
    expect(applicableRate({}, undefined)).toBeNull()
  })
})

describe('entryAmount', () => {
  it('uses the project rate on rounded minutes', () => {
    expect(entryAmount({ isBillable: true, roundedMinutes: 75 }, project)).toBe(225)
  })

  it('uses the entry rate override when present', () => {
    expect(entryAmount({ isBillable: true, roundedMinutes: 30, rateOverrideAmount: 100 }, project)).toBe(50)
  })

  it('returns null for a non-billable entry rather than zero', () => {
    expect(entryAmount({ isBillable: false, roundedMinutes: 480 }, project)).toBeNull()
  })

  it('returns null when no rate can be resolved', () => {
    expect(entryAmount({ isBillable: true, roundedMinutes: 60 }, { hourlyRate: null })).toBeNull()
  })

  it('rounds the amount at the entry', () => {
    expect(entryAmount({ isBillable: true, roundedMinutes: 7, rateOverrideAmount: 180 }, project)).toBe(21)
    expect(entryAmount({ isBillable: true, roundedMinutes: 55 }, project)).toBe(165)
    expect(entryAmount({ isBillable: true, roundedMinutes: 100, rateOverrideAmount: 222.22 }, project)).toBe(
      370.37,
    )
  })
})

describe('sumAmounts', () => {
  it('sums already-rounded values exactly', () => {
    expect(sumAmounts([0.1, 0.2])).toBe(0.3)
    expect(sumAmounts([1.01, 2.02, 3.03])).toBe(6.06)
    expect(sumAmounts([])).toBe(0)
  })

  it('skips null amounts from non-billable entries', () => {
    expect(sumAmounts([10.5, null, 4.5, undefined])).toBe(15)
  })
})

describe('round at the entry, sum upward', () => {
  it('makes printed entry lines add up to the group total', () => {
    const amounts = entries.map((entry) => entryAmount(entry, project))
    const printed = amounts.filter((amount): amount is number => amount !== null)
    expect(printed).toEqual([225, 60, 165, 370.37, 21])
    expect(sumAmounts(amounts)).toBe(841.37)
    expect(sumAmounts(printed)).toBe(841.37)
  })

  it('produces the same grand total for every grouping of the same entries', () => {
    const byTask = grandTotalGroupedBy('taskId')
    const byPerson = grandTotalGroupedBy('personId')
    const byDay = grandTotalGroupedBy('date')

    expect(byTask).toBe(841.37)
    expect(byPerson).toBe(byTask)
    expect(byDay).toBe(byTask)
  })

  it('keeps the grand total equal to the flat sum of entry amounts', () => {
    const flat = sumAmounts(entries.map((entry) => entryAmount(entry, project)))
    expect(grandTotalGroupedBy('taskId')).toBe(flat)
    expect(grandTotalGroupedBy('personId')).toBe(flat)
    expect(grandTotalGroupedBy('date')).toBe(flat)
  })
})
