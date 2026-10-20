import {
  parseReportPreview,
  readCurrencyConflict,
  readNumber,
  toCandidateProject,
} from '../reportConfigData'
import { parseReportSheet, readCustomerName } from '../reportSheetData'

describe('toCandidateProject', () => {
  it('reads the snake_case list row and the decimal-string rate', () => {
    expect(
      toCandidateProject({ id: 'p1', name: 'Nordvik', hourly_rate: '320.0000', currency_code: 'PLN' }),
    ).toEqual({ id: 'p1', name: 'Nordvik', hourlyRate: 320, currencyCode: 'PLN' })
  })

  it('falls back to the code, then the id, rather than rendering an empty row', () => {
    expect(toCandidateProject({ id: 'p1', code: 'NORD' })?.name).toBe('NORD')
    expect(toCandidateProject({ id: 'p1' })?.name).toBe('p1')
    expect(toCandidateProject({})).toBeNull()
  })
})

describe('readNumber', () => {
  it('accepts both the number and the decimal-string shapes the API can answer', () => {
    expect(readNumber(12.5)).toBe(12.5)
    expect(readNumber('12.50')).toBe(12.5)
    expect(readNumber('')).toBeNull()
    expect(readNumber(null)).toBeNull()
    expect(readNumber('abc')).toBeNull()
    expect(readNumber(Number.NaN)).toBeNull()
  })
})

describe('parseReportPreview', () => {
  const payload = {
    currencyCode: 'PLN',
    grouping: 'project_task',
    nonbillableMode: 'separate',
    includeAlreadyReported: false,
    showRates: true,
    projects: [
      {
        id: 'p1',
        name: 'Nordvik',
        hourlyRate: 320,
        currencyCode: 'PLN',
        entryCount: 62,
        billableMinutes: 3855,
        nonbillableMinutes: 0,
        amount: 20560,
      },
    ],
    groups: [
      {
        key: 'p1',
        kind: 'project',
        label: 'Nordvik',
        rate: 320,
        minutes: 3855,
        amount: 20560,
        entryCount: 62,
        lines: [
          {
            key: 't1',
            label: 'Migracja',
            minutes: 1365,
            rate: 320,
            amount: 7280,
            entryCount: 10,
            hasOverride: false,
            children: [
              { key: 't1a', label: 'Child', minutes: 100, rate: 320, amount: 533.33, entryCount: 1, hasOverride: false, children: [] },
            ],
          },
        ],
      },
    ],
    totals: { entryCount: 62, billableMinutes: 3855, nonbillableMinutes: 0, totalAmount: 20560 },
    alreadyReportedCount: 6,
    alreadyReportedMinutes: 360,
    alreadyReportedIn: [
      { reportId: 'r1', reference: 'RAP-2026-0041', title: 'June', entryCount: 6, minutes: 360 },
    ],
    rounding: { unitMinutes: 15, direction: 'up' },
  }

  it('parses the whole shape, children included', () => {
    const parsed = parseReportPreview(payload)
    expect(parsed?.totals.totalAmount).toBe(20560)
    expect(parsed?.groups[0].lines[0].children[0].amount).toBe(533.33)
    expect(parsed?.alreadyReportedIn[0].reference).toBe('RAP-2026-0041')
    expect(parsed?.rounding).toEqual({ unitMinutes: 15, direction: 'up' })
  })

  it('yields an empty sheet rather than a plausible wrong number on a shape surprise', () => {
    expect(parseReportPreview(null)).toBeNull()
    expect(parseReportPreview('nope')).toBeNull()
    const broken = parseReportPreview({ ...payload, groups: 'not-an-array', totals: null })
    expect(broken?.groups).toEqual([])
    expect(broken?.totals.totalAmount).toBeNull()
  })

  it('defaults an unknown grouping to the documented one rather than throwing', () => {
    expect(parseReportPreview({ ...payload, grouping: 'by_moon_phase' })?.grouping).toBe('project_task')
  })
})

describe('readCurrencyConflict — risk R2 surfaced, not swallowed', () => {
  it('reads the currencies and the offending projects out of the 422 body', () => {
    const conflict = readCurrencyConflict({
      code: 'report_currency_conflict',
      error: 'A report always covers one currency.',
      currencies: ['EUR', 'PLN'],
      offenders: [
        { id: 'p1', name: 'Nordvik — B2B', currencyCode: 'PLN' },
        { id: 'p2', name: 'Nordvik — EU', currencyCode: 'EUR' },
      ],
    })
    expect(conflict?.currencies).toEqual(['EUR', 'PLN'])
    expect(conflict?.offenders.map((project) => project.name)).toEqual(['Nordvik — B2B', 'Nordvik — EU'])
  })

  it('ignores any other error, so an unrelated failure is not mislabelled', () => {
    expect(readCurrencyConflict({ code: 'report_closed', error: 'closed' })).toBeNull()
    expect(readCurrencyConflict(null)).toBeNull()
    expect(readCurrencyConflict({ body: { code: 'report_currency_conflict' } })?.currencies).toEqual([])
  })
})

describe('report sheet parsing', () => {
  it('reads the customer name from the report own snapshot (D-9)', () => {
    expect(readCustomerName({ name: 'Nordvik Retail AB' })).toBe('Nordvik Retail AB')
    expect(readCustomerName({ display_name: 'Fintechly' })).toBe('Fintechly')
    expect(readCustomerName({})).toBeNull()
    expect(readCustomerName(null)).toBeNull()
  })

  it('parses a sheet response into its header, groups, rows and history', () => {
    const parsed = parseReportSheet({
      report: {
        id: 'r1',
        reference: 'RAP-2026-0042',
        title: 'Nordvik · June',
        status: 'closed',
        customerId: 'c1',
        customerSnapshot: { name: 'Nordvik Retail AB' },
        periodFrom: '2026-06-01',
        periodTo: '2026-06-30',
        currencyCode: 'PLN',
        grouping: 'project_person',
        nonbillableMode: 'separate',
        includeAlreadyReported: false,
        showRates: true,
        roundingUnitMinutes: 15,
        roundingDirection: 'up',
        closedAt: '2026-07-20T16:40:00.000Z',
        timeProjectIds: ['p1'],
      },
      groups: [],
      totals: { entryCount: 2, billableMinutes: 600, nonbillableMinutes: 0, totalAmount: 3200 },
      alreadyReportedCount: 0,
      alreadyReportedMinutes: 0,
      alreadyReportedIn: [],
      rows: [
        {
          entryId: 'e1',
          date: '2026-06-10',
          projectName: 'Nordvik',
          taskLabel: 'Refaktor',
          personLabel: 'Marek Wójcik',
          description: 'Notes',
          minutes: 600,
          rawMinutes: 590,
          hours: '10:00',
          isBillable: true,
          rate: 320,
          amount: 3200,
          hasOverride: false,
        },
      ],
      rowCount: 1,
      rowsTruncated: false,
      events: [
        { id: 'ev1', eventType: 'closed', reason: null, actorUserId: 'u1', metadata: {}, createdAt: '2026-07-20T16:40:00.000Z' },
        { id: 'ev2', eventType: 'unlocked', reason: 'Correction', actorUserId: 'u1', metadata: null, createdAt: '2026-07-21T09:00:00.000Z' },
        { id: 'ev3', eventType: 'nonsense', reason: null, actorUserId: null, metadata: null, createdAt: null },
      ],
    })

    expect(parsed?.report.status).toBe('closed')
    expect(parsed?.report.customerName).toBe('Nordvik Retail AB')
    expect(parsed?.report.grouping).toBe('project_person')
    expect(parsed?.rows[0].personLabel).toBe('Marek Wójcik')
    // An unknown event type is dropped rather than rendered as an empty row.
    expect(parsed?.events.map((event) => event.eventType)).toEqual(['closed', 'unlocked'])
    expect(parsed?.events[1].reason).toBe('Correction')
  })

  it('returns null when the payload carries no report', () => {
    expect(parseReportSheet({})).toBeNull()
    expect(parseReportSheet({ report: { reference: 'x' } })).toBeNull()
  })
})
