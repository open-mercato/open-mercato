import {
  computeReportTotals,
  effectiveMinutes,
  formatReportMinutes,
  isAlreadyReported,
  resolveEntryValues,
  resolveReportCurrency,
  type ReportGroup,
  type ReportInputEntry,
  type ReportInputProject,
  type ReportLine,
} from '../reportTotals'

const labels = {
  unassignedTask: 'No task',
  unassignedPerson: 'Unassigned',
  nonbillableGroup: 'Non-billable time',
}

const projects: ReportInputProject[] = [
  { id: 'p-migration', name: 'Nordvik — B2B migration', hourlyRate: 320, currencyCode: 'PLN' },
  { id: 'p-support', name: 'Nordvik — support', hourlyRate: 320, currencyCode: 'PLN' },
]

const directory = {
  taskLabelById: {
    't-cart': 'B2B cart migration',
    't-cart-child': 'Cart line endpoint',
    't-prices': 'Catalog price mapping',
    't-tax': 'Tax service refactor',
    't-support-june': 'Service tickets — June',
    't-status': 'Weekly status calls',
  },
  personLabelById: {
    'm-anna': 'Anna Nowak',
    'm-paulina': 'Paulina Zych',
    'm-marek': 'Marek Wójcik',
  },
}

function entry(overrides: Partial<ReportInputEntry> & Pick<ReportInputEntry, 'id'>): ReportInputEntry {
  return {
    timeProjectId: 'p-migration',
    taskId: 't-cart',
    rootTaskId: 't-cart',
    staffMemberId: 'm-anna',
    date: '2026-06-01',
    durationMinutes: 60,
    roundedMinutes: 60,
    isBillable: true,
    rateOverrideAmount: null,
    description: null,
    frozen: null,
    ...overrides,
  }
}

/**
 * Deliberately awkward minute counts. `665 / 60 * 320` and friends do not land on
 * whole cents, so an implementation that summed exact values and rounded the
 * total would produce a different grand total from one that rounds per entry —
 * which is exactly what D-7 forbids.
 */
const entries: ReportInputEntry[] = [
  entry({ id: 'e1', taskId: 't-cart', rootTaskId: 't-cart', durationMinutes: 1365, roundedMinutes: 1365 }),
  entry({
    id: 'e2',
    taskId: 't-cart-child',
    rootTaskId: 't-cart',
    staffMemberId: 'm-paulina',
    date: '2026-06-02',
    durationMinutes: 355,
    roundedMinutes: 355,
  }),
  entry({
    id: 'e3',
    taskId: 't-prices',
    rootTaskId: 't-prices',
    staffMemberId: 'm-paulina',
    date: '2026-06-02',
    durationMinutes: 750,
    roundedMinutes: 750,
  }),
  entry({
    id: 'e4',
    taskId: 't-tax',
    rootTaskId: 't-tax',
    staffMemberId: 'm-marek',
    date: '2026-06-03',
    durationMinutes: 665,
    roundedMinutes: 665,
  }),
  entry({
    id: 'e5',
    taskId: 't-tax',
    rootTaskId: 't-tax',
    staffMemberId: 'm-marek',
    date: '2026-06-04',
    durationMinutes: 255,
    roundedMinutes: 255,
    rateOverrideAmount: 260,
  }),
  entry({
    id: 'e6',
    timeProjectId: 'p-support',
    taskId: 't-support-june',
    rootTaskId: 't-support-june',
    staffMemberId: 'm-anna',
    date: '2026-06-10',
    durationMinutes: 345,
    roundedMinutes: 345,
  }),
  entry({
    id: 'e7',
    timeProjectId: 'p-support',
    taskId: 't-status',
    rootTaskId: 't-status',
    staffMemberId: 'm-marek',
    date: '2026-06-11',
    durationMinutes: 135,
    roundedMinutes: 135,
    isBillable: false,
  }),
]

function totalsFor(grouping: 'project_task' | 'project_person' | 'project_day') {
  return computeReportTotals({
    entries,
    projects,
    directory,
    options: { grouping, nonbillableMode: 'separate', includeAlreadyReported: false },
    labels,
  })
}

function flatten(lines: readonly ReportLine[]): ReportLine[] {
  return lines.flatMap((line) => [line, ...flatten(line.children)])
}

function centsOf(value: number): number {
  return Math.round(value * 100)
}

describe('computeReportTotals — D-7, the grand total is invariant across groupings', () => {
  const byTask = totalsFor('project_task')
  const byPerson = totalsFor('project_person')
  const byDay = totalsFor('project_day')

  it('produces the same grand total whichever way the report is grouped', () => {
    expect(byPerson.totalAmount).toBe(byTask.totalAmount)
    expect(byDay.totalAmount).toBe(byTask.totalAmount)
  })

  it('produces the same billable and non-billable minutes whichever way it is grouped', () => {
    expect(byPerson.billableMinutes).toBe(byTask.billableMinutes)
    expect(byDay.billableMinutes).toBe(byTask.billableMinutes)
    expect(byPerson.nonbillableMinutes).toBe(byTask.nonbillableMinutes)
    expect(byDay.nonbillableMinutes).toBe(byTask.nonbillableMinutes)
  })

  it('redraws the line boundaries between groupings, so the invariance is not trivial', () => {
    const taskKeys = byTask.groups.flatMap((group) => flatten(group.lines).map((line) => line.key))
    const personKeys = byPerson.groups.flatMap((group) => group.lines.map((line) => line.key))
    const dayKeys = byDay.groups.flatMap((group) => group.lines.map((line) => line.key))
    expect(taskKeys).not.toEqual(personKeys)
    expect(personKeys).not.toEqual(dayKeys)
    expect(dayKeys).toContain('2026-06-03')
  })

  it('lets a client add the printed lines and reach the printed total', () => {
    for (const totals of [byTask, byPerson, byDay]) {
      let cents = 0
      for (const group of totals.groups) {
        // Only the top-level lines are printed; children are the expandable detail
        // already included in their parent (D-2).
        const linesTotal = group.lines.reduce((sum, line) => sum + centsOf(line.amount), 0)
        expect(linesTotal).toBe(centsOf(group.amount))
        cents += centsOf(group.amount)
      }
      expect(cents).toBe(centsOf(totals.totalAmount))
    }
  })

  it('rounds at the entry, so the total differs from a rounded sum of exact values', () => {
    // 665 min at 320/h is 3546.666…, which D-7 bills as 3546.67. Three such
    // entries come to exactly 10 640.00 when the exact values are summed first
    // and rounded once — and to 10 640.01 when each entry is rounded first. The
    // two paths genuinely disagree, and this is the one this module takes.
    const thirds: ReportInputEntry[] = ['f1', 'f2', 'f3'].map((id) =>
      entry({ id, taskId: `t-${id}`, rootTaskId: `t-${id}`, durationMinutes: 665, roundedMinutes: 665 }),
    )
    const totals = computeReportTotals({
      entries: thirds,
      projects,
      directory,
      options: { grouping: 'project_task', nonbillableMode: 'separate', includeAlreadyReported: false },
      labels,
    })
    const exactThenRounded = Math.round(thirds.reduce((sum) => sum + (665 / 60) * 320, 0) * 100) / 100
    expect(exactThenRounded).toBe(10640)
    expect(totals.totalAmount).toBe(10640.01)
    expect(totals.groups[0].lines.every((line) => line.amount === 3546.67)).toBe(true)
  })
})

describe('computeReportTotals — D-2, task lines roll child time into the parent', () => {
  const totals = totalsFor('project_task')
  const migration = totals.groups.find((group) => group.key === 'p-migration') as ReportGroup

  it('folds a child task into its parent line and keeps it expandable underneath', () => {
    const cart = migration.lines.find((line) => line.key === 't-cart') as ReportLine
    expect(cart.minutes).toBe(1365 + 355)
    expect(cart.children.map((child) => child.key)).toEqual(['t-cart-child'])
    expect(cart.children[0].minutes).toBe(355)
  })

  it('never adds the child line to the parent line a second time (risk R10)', () => {
    const cart = migration.lines.find((line) => line.key === 't-cart') as ReportLine
    const childCents = cart.children.reduce((sum, child) => sum + centsOf(child.amount), 0)
    expect(centsOf(cart.amount)).toBeGreaterThan(childCents)
    const groupCents = migration.lines.reduce((sum, line) => sum + centsOf(line.amount), 0)
    expect(groupCents).toBe(centsOf(migration.amount))
  })

  it('marks a line carrying a rate override and shows the rate actually applied (US-F2)', () => {
    const tax = migration.lines.find((line) => line.key === 't-tax') as ReportLine
    expect(tax.hasOverride).toBe(true)
    // Two different rates on one line, so no single rate can honestly be printed.
    expect(tax.rate).toBeNull()

    const overrideOnly = computeReportTotals({
      entries: [entries[4]],
      projects,
      directory,
      options: { grouping: 'project_task', nonbillableMode: 'separate', includeAlreadyReported: false },
      labels,
    })
    const line = overrideOnly.groups[0].lines[0]
    expect(line.rate).toBe(260)
    expect(line.hasOverride).toBe(true)
  })
})

describe('computeReportTotals — non-billable time', () => {
  it('shows non-billable time in its own group at zero rather than omitting it', () => {
    const totals = totalsFor('project_task')
    const group = totals.groups.find((entryGroup) => entryGroup.kind === 'nonbillable') as ReportGroup
    expect(group).toBeDefined()
    expect(group.minutes).toBe(135)
    expect(group.amount).toBe(0)
    expect(totals.nonbillableMinutes).toBe(135)
  })

  it('drops it entirely when the mode says exclude, without touching the billable total', () => {
    const separate = totalsFor('project_task')
    const excluded = computeReportTotals({
      entries,
      projects,
      directory,
      options: { grouping: 'project_task', nonbillableMode: 'exclude', includeAlreadyReported: false },
      labels,
    })
    expect(excluded.groups.some((group) => group.kind === 'nonbillable')).toBe(false)
    expect(excluded.nonbillableMinutes).toBe(0)
    expect(excluded.totalAmount).toBe(separate.totalAmount)
  })
})

describe('computeReportTotals — D-5, an hour frozen elsewhere never reaches a second invoice silently', () => {
  const frozenEntries: ReportInputEntry[] = [
    entries[0],
    {
      ...entries[3],
      frozen: {
        reportId: 'r-june',
        reference: 'RAP-2026-0041',
        title: 'Nordvik · June',
        rawMinutes: 665,
        roundedMinutes: 660,
        rateAmount: 300,
        currencyCode: 'PLN',
        amount: 3300,
        isBillable: true,
      },
    },
  ]

  const base = {
    entries: frozenEntries,
    projects,
    directory,
    labels,
  }

  it('excludes it by default and reports what was skipped, with the source report named', () => {
    const totals = computeReportTotals({
      ...base,
      options: { grouping: 'project_task', nonbillableMode: 'separate', includeAlreadyReported: false },
    })
    expect(totals.entryCount).toBe(1)
    expect(totals.alreadyReportedCount).toBe(1)
    expect(totals.alreadyReportedMinutes).toBe(660)
    expect(totals.alreadyReportedIn).toEqual([
      {
        reportId: 'r-june',
        reference: 'RAP-2026-0041',
        title: 'Nordvik · June',
        entryCount: 1,
        minutes: 660,
      },
    ])
    expect(totals.groups.flatMap((group) => group.lines).some((line) => line.key === 't-tax')).toBe(false)
  })

  it('includes it at its FROZEN values once the opt-in is ticked, not at today rates', () => {
    const totals = computeReportTotals({
      ...base,
      options: { grouping: 'project_task', nonbillableMode: 'separate', includeAlreadyReported: true },
    })
    expect(totals.alreadyReportedCount).toBe(0)
    const line = totals.groups[0].lines.find((row) => row.key === 't-tax') as ReportLine
    // Frozen at 660 min × 300, not recomputed as 665 min × 320.
    expect(line.minutes).toBe(660)
    expect(line.rate).toBe(300)
    expect(line.amount).toBe(3300)
  })

  it('does not treat this report own freeze records as already reported', () => {
    const totals = computeReportTotals({
      ...base,
      options: { grouping: 'project_task', nonbillableMode: 'separate', includeAlreadyReported: false },
      currentReportId: 'r-june',
    })
    expect(totals.alreadyReportedCount).toBe(0)
    expect(totals.entryCount).toBe(2)
  })

  it('sums minutes and counts per source report when several froze the period', () => {
    const totals = computeReportTotals({
      ...base,
      entries: [
        frozenEntries[1],
        {
          ...entries[2],
          frozen: {
            reportId: 'r-june',
            reference: 'RAP-2026-0041',
            title: 'Nordvik · June',
            rawMinutes: 750,
            roundedMinutes: 750,
            rateAmount: 320,
            currencyCode: 'PLN',
            amount: 4000,
            isBillable: true,
          },
        },
        {
          ...entries[5],
          frozen: {
            reportId: 'r-may',
            reference: 'RAP-2026-0031',
            title: 'Nordvik · May',
            rawMinutes: 345,
            roundedMinutes: 345,
            rateAmount: 320,
            currencyCode: 'PLN',
            amount: 1840,
            isBillable: true,
          },
        },
      ],
      options: { grouping: 'project_task', nonbillableMode: 'separate', includeAlreadyReported: false },
    })
    expect(totals.alreadyReportedCount).toBe(3)
    expect(totals.alreadyReportedMinutes).toBe(660 + 750 + 345)
    expect(totals.alreadyReportedIn.map((source) => source.reportId).sort()).toEqual(['r-june', 'r-may'])
    expect(totals.alreadyReportedIn.find((source) => source.reportId === 'r-june')?.entryCount).toBe(2)
  })
})

describe('isAlreadyReported', () => {
  it('is false without a freeze record and true with one from another report', () => {
    expect(isAlreadyReported(entry({ id: 'a' }), null)).toBe(false)
    const frozen = entry({
      id: 'b',
      frozen: {
        reportId: 'r1',
        reference: null,
        title: null,
        rawMinutes: 10,
        roundedMinutes: 15,
        rateAmount: null,
        currencyCode: 'PLN',
        amount: null,
        isBillable: true,
      },
    })
    expect(isAlreadyReported(frozen, null)).toBe(true)
    expect(isAlreadyReported(frozen, 'r1')).toBe(false)
    expect(isAlreadyReported(frozen, 'r2')).toBe(true)
  })
})

describe('effectiveMinutes', () => {
  it('bills the rounded minutes when present', () => {
    expect(effectiveMinutes({ durationMinutes: 47, roundedMinutes: 60 })).toBe(60)
  })

  it('falls back to the raw duration rather than to zero for a pre-rounding entry', () => {
    expect(effectiveMinutes({ durationMinutes: 47, roundedMinutes: null })).toBe(47)
    expect(effectiveMinutes({ durationMinutes: 0, roundedMinutes: null })).toBe(0)
  })
})

describe('resolveEntryValues', () => {
  it('gives a non-billable entry no amount and no rate, never a zero rate', () => {
    const values = resolveEntryValues(entry({ id: 'x', isBillable: false }), projects[0])
    expect(values.amount).toBeNull()
    expect(values.rate).toBeNull()
  })

  it('prefers the entry override over the project rate', () => {
    const values = resolveEntryValues(entry({ id: 'x', rateOverrideAmount: 111 }), projects[0])
    expect(values.rate).toBe(111)
    expect(values.hasOverride).toBe(true)
    expect(values.amount).toBe(111)
  })

  it('yields no amount when nothing carries a rate', () => {
    const values = resolveEntryValues(entry({ id: 'x' }), { ...projects[0], hourlyRate: null })
    expect(values.amount).toBeNull()
  })
})

describe('resolveReportCurrency — risk R2', () => {
  it('accepts a single currency and normalizes case', () => {
    const resolution = resolveReportCurrency([
      { id: 'a', name: 'A', currencyCode: 'PLN' },
      { id: 'b', name: 'B', currencyCode: 'pln' },
    ])
    expect(resolution).toEqual({ ok: true, currencyCode: 'PLN' })
  })

  it('blocks a mixed selection and names both the currencies and the projects', () => {
    const resolution = resolveReportCurrency([
      { id: 'a', name: 'Nordvik — B2B', currencyCode: 'PLN' },
      { id: 'b', name: 'Nordvik — EU', currencyCode: 'EUR' },
    ])
    expect(resolution.ok).toBe(false)
    if (resolution.ok) throw new Error('[internal] expected a currency conflict')
    expect(resolution.currencies).toEqual(['EUR', 'PLN'])
    expect(resolution.offenders.map((project) => project.name)).toEqual(
      expect.arrayContaining(['Nordvik — B2B', 'Nordvik — EU']),
    )
  })

  it('treats a project with no currency as no opinion rather than as a second currency', () => {
    const resolution = resolveReportCurrency([
      { id: 'a', name: 'A', currencyCode: 'PLN' },
      { id: 'b', name: 'B', currencyCode: null },
    ])
    expect(resolution).toEqual({ ok: true, currencyCode: 'PLN' })
  })
})

describe('formatReportMinutes', () => {
  it('prints the sheet clock format', () => {
    expect(formatReportMinutes(3855)).toBe('64:15')
    expect(formatReportMinutes(0)).toBe('0:00')
    expect(formatReportMinutes(60)).toBe('1:00')
    expect(formatReportMinutes(5)).toBe('0:05')
  })
})
