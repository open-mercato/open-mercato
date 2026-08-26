/**
 * EP-32…EP-41. The one property this whole group promises: with no contribution
 * registered, every registry serves its built-in and the observable answer is
 * the one the module produced before the registries existed. Each block asserts
 * that first, then that a contribution can actually change the answer, then that
 * disposing it restores the built-in.
 *
 * The behaviour-preservation half is deliberately duplicated from the existing
 * `rounding`, `cost`, `overlap`, `projectCode`, `reportTotals` and `reportExport`
 * suites: those pin the numbers, this pins that the registry indirection did not
 * move them.
 */

import {
  BUILT_IN_TIME_ROUNDING_STRATEGY_ID,
  listTimeRoundingStrategies,
  registerTimeRoundingStrategy,
  resolveTimeRoundingStrategy,
  roundMinutes,
} from '../rounding'
import {
  BUILT_IN_TIME_RATE_RESOLVER_ID,
  applicableRate,
  entryAmount,
  registerTimeRateResolver,
} from '../cost'
import {
  BUILT_IN_BILLABILITY_RESOLVER_ID,
  registerBillabilityResolver,
  resolveBillability,
} from '../billability'
import { DEFAULT_TIME_TRACKING_SETTINGS } from '../settings'
import {
  BUILT_IN_OVERLAP_POLICY_ID,
  evaluateOverlapPolicies,
  findOverlaps,
  registerOverlapPolicy,
  type OverlapPolicyContext,
} from '../overlap'
import {
  BUILT_IN_PROJECT_CODE_GENERATOR_ID,
  deriveProjectCode,
  registerProjectCodeGenerator,
} from '../projectCode'
import {
  BUILT_IN_CAPACITY_PROVIDER_ID,
  registerCapacityProvider,
  resolveTimesheetCapacity,
} from '../capacity'
import {
  BUILT_IN_TIME_ENTRY_SOURCE_IDS,
  getTimeEntrySource,
  normalizeTimeEntrySource,
  registerTimeEntrySource,
  timeEntrySourceIds,
} from '../timeEntrySources'
import {
  BUILT_IN_REPORT_GROUPING_IDS,
  getReportGrouping,
  normalizeReportGrouping,
  registerReportGrouping,
  reportGroupingIds,
  UNASSIGNED_LINE_KEY,
} from '../../timesheets-reports/reportGroupings'
import {
  normalizeReportExportFormat,
  serializeReportExport,
  supportedReportExportFormats,
} from '../../timesheets-reports/reportExport'
import { registerReportExportFormat } from '../../timesheets-reports/reportExportFormats'
import {
  BUILT_IN_REPORT_APPROVAL_POLICY_ID,
  evaluateReportClosePolicies,
  evaluateReportUnlockPolicies,
  notifyReportClosed,
  registerReportApprovalPolicy,
  type ReportApprovalContext,
} from '../../timesheets-reports/reportApprovalPolicies'
import type { ReportExportInput } from '../../timesheets-reports/reportExport'
import { computeReportTotals } from '../../timesheets-reports/reportTotals'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('EP-32 rounding strategy registry', () => {
  it('serves only the built-in with no contribution', () => {
    expect(listTimeRoundingStrategies().map((strategy) => strategy.id)).toEqual([
      BUILT_IN_TIME_ROUNDING_STRATEGY_ID,
    ])
    expect(resolveTimeRoundingStrategy(SCOPE).id).toBe(BUILT_IN_TIME_ROUNDING_STRATEGY_ID)
  })

  it('rounds exactly as the pure function did', () => {
    expect(roundMinutes(62, { unitMinutes: 15, direction: 'up' })).toBe(75)
    expect(roundMinutes(62, { unitMinutes: 15, direction: 'nearest' })).toBe(60)
    expect(roundMinutes(62, { unitMinutes: 0, direction: 'up' })).toBe(62)
  })

  it('lets a scoped contribution take over and restores the built-in on dispose', () => {
    const dispose = registerTimeRoundingStrategy({
      id: 'test.round_down',
      labelKey: 'test.round_down',
      round: (raw, ctx) => Math.floor(raw / ctx.settings.unitMinutes) * ctx.settings.unitMinutes,
    })
    try {
      expect(roundMinutes(62, { unitMinutes: 15, direction: 'up' }, SCOPE)).toBe(60)
      // Unscoped call sites (client previews) fail closed to the built-in.
      expect(roundMinutes(62, { unitMinutes: 15, direction: 'up' })).toBe(75)
      expect(roundMinutes(62, { unitMinutes: 15, direction: 'up' }, { tenantId: 'tenant-1' })).toBe(75)
    } finally {
      dispose()
    }
    expect(roundMinutes(62, { unitMinutes: 15, direction: 'up' }, SCOPE)).toBe(75)
  })
})

describe('EP-33 rate resolver chain', () => {
  it('reproduces the override → project-rate chain with no contribution', () => {
    expect(applicableRate({ rateOverrideAmount: 250 }, { hourlyRate: 100 })).toBe(250)
    expect(applicableRate({ rateOverrideAmount: null }, { hourlyRate: 100 })).toBe(100)
    expect(applicableRate({ rateOverrideAmount: null }, { hourlyRate: null })).toBeNull()
    expect(applicableRate(null, null)).toBeNull()
    expect(entryAmount({ isBillable: true, roundedMinutes: 90 }, { hourlyRate: 100 })).toBe(150)
    expect(entryAmount({ isBillable: false, roundedMinutes: 90 }, { hourlyRate: 100 })).toBeNull()
  })

  it('asks a scoped contribution before the built-in and honours an abstention', () => {
    const dispose = registerTimeRateResolver({
      id: 'test.role_rate',
      resolve: (ctx) => (ctx.role?.name === 'principal' ? 400 : null),
    })
    try {
      expect(applicableRate({ rateOverrideAmount: 250 }, { hourlyRate: 100 }, {
        ...SCOPE,
        role: { name: 'principal' },
      })).toBe(400)
      // Abstained — the built-in chain still decides.
      expect(applicableRate({ rateOverrideAmount: 250 }, { hourlyRate: 100 }, {
        ...SCOPE,
        role: { name: 'associate' },
      })).toBe(250)
      // Unscoped — the contribution is not consulted at all.
      expect(applicableRate({ rateOverrideAmount: null }, { hourlyRate: 100 }, {
        role: { name: 'principal' },
      })).toBe(100)
    } finally {
      dispose()
    }
    expect(BUILT_IN_TIME_RATE_RESOLVER_ID).toBe('staff.time_tracking.rate.entry_override_then_project')
  })
})

describe('EP-34 billability resolver', () => {
  const settings = DEFAULT_TIME_TRACKING_SETTINGS

  it('reproduces the explicit → project → tenant chain with no contribution', () => {
    expect(resolveBillability({ requested: false, project: { billableByDefault: true }, settings })).toBe(false)
    expect(resolveBillability({ project: { billableByDefault: false }, settings })).toBe(false)
    expect(resolveBillability({ project: null, settings })).toBe(settings.defaults.billable)
    expect(BUILT_IN_BILLABILITY_RESOLVER_ID).toBe('staff.time_tracking.billability.project_then_tenant')
  })

  it('lets a scoped contribution decide and treats null as an abstention', () => {
    const dispose = registerBillabilityResolver({
      id: 'test.travel_never_billable',
      resolve: (ctx) => (ctx.task?.id === 'travel' ? false : null),
    })
    try {
      expect(resolveBillability({ ...SCOPE, requested: true, task: { id: 'travel' }, settings })).toBe(false)
      expect(resolveBillability({ ...SCOPE, requested: true, task: { id: 'other' }, settings })).toBe(true)
      expect(resolveBillability({ requested: true, task: { id: 'travel' }, settings })).toBe(true)
    } finally {
      dispose()
    }
  })
})

describe('EP-35 report export format registry', () => {
  const input: ReportExportInput = {
    reference: 'REP-1',
    title: 'Report',
    customerName: 'Customer',
    periodLabel: '2026-01-01 – 2026-01-31',
    issuedByLabel: null,
    issuedAtLabel: null,
    currencyCode: 'EUR',
    showRates: true,
    groups: [],
    rows: [],
    totals: { billableMinutes: 0, nonbillableMinutes: 0, totalAmount: 0 },
    roundingLabel: 'no rounding',
    labels: {
      documentTitle: 'Statement',
      issuedBy: 'Issued by',
      reference: 'Reference',
      period: 'Period',
      line: 'Line',
      time: 'Time',
      rate: 'Rate',
      amount: 'Amount',
      total: 'Total',
      totalHint: '{billable} · {nonbillable} · {rounding}',
      nonbillable: 'Non-billable',
      overrideBadge: 'agreed rate',
      date: 'Date',
      project: 'Project',
      task: 'Task',
      person: 'Person',
      description: 'Description',
      billable: 'Billable',
      yes: 'Yes',
      no: 'No',
      rawMinutes: 'Raw minutes',
      roundedMinutes: 'Rounded minutes',
    },
  }

  it('ships exactly the three built-in formats', () => {
    expect(supportedReportExportFormats()).toEqual(['pdf', 'csv', 'xlsx'])
    expect(normalizeReportExportFormat('json')).toBeNull()
  })

  it('accepts a contributed format through normalize and serialize', () => {
    const dispose = registerReportExportFormat({
      id: 'json',
      labelKey: 'test.json',
      mimeType: 'application/json',
      extension: 'json',
      serialize: (payload) => ({
        body: Buffer.from(JSON.stringify({ reference: payload.reference }), 'utf8'),
        contentType: 'application/json',
        filename: `${payload.reference}.json`,
      }),
    })
    try {
      expect(supportedReportExportFormats()).toEqual(['pdf', 'csv', 'xlsx', 'json'])
      expect(normalizeReportExportFormat('json')).toBe('json')
      const file = serializeReportExport('json', input)
      expect(file.filename).toBe('REP-1.json')
      expect(JSON.parse(file.body.toString('utf8'))).toEqual({ reference: 'REP-1' })
    } finally {
      dispose()
    }
    expect(normalizeReportExportFormat('json')).toBeNull()
  })
})

describe('EP-36 report grouping registry', () => {
  const directory = { taskLabelById: { 't1': 'Task one' }, personLabelById: { 'p1': 'Person one' } }
  const fallbacks = { unassignedTask: 'No task', unassignedPerson: 'Unassigned', nonbillableGroup: 'Non-billable' }

  it('ships exactly the three built-in groupings', () => {
    expect(reportGroupingIds()).toEqual([...BUILT_IN_REPORT_GROUPING_IDS])
    expect(normalizeReportGrouping('project_person')).toBe('project_person')
    expect(normalizeReportGrouping('project_month')).toBe('project_task')
  })

  it('reproduces the original key and label rules', () => {
    const taskGrouping = getReportGrouping('project_task')
    expect(taskGrouping?.groupOf({ taskId: 'child', rootTaskId: 'root' } as never)).toEqual({
      key: 'child',
      parentKey: 'root',
    })
    expect(taskGrouping?.groupOf({ taskId: null, rootTaskId: null } as never)).toEqual({
      key: UNASSIGNED_LINE_KEY,
      parentKey: null,
    })
    expect(taskGrouping?.labelOf('t1', { directory, fallbacks })).toBe('Task one')
    expect(getReportGrouping('project_person')?.labelOf('p1', { directory, fallbacks })).toBe('Person one')
    expect(getReportGrouping('project_day')?.labelOf('2026-01-02', { directory, fallbacks })).toBe('2026-01-02')
  })

  it('round-trips a contributed grouping through the persisted-value normalizer', () => {
    const dispose = registerReportGrouping({
      id: 'project_month',
      labelKey: 'test.project_month',
      groupOf: (entry) => ({ key: entry.date.slice(0, 7) || UNASSIGNED_LINE_KEY, parentKey: null }),
      labelOf: (key) => key,
      sort: (left, right) => left.label.localeCompare(right.label),
    })
    try {
      expect(reportGroupingIds()).toContain('project_month')
      expect(normalizeReportGrouping('project_month')).toBe('project_month')
    } finally {
      dispose()
    }
    expect(normalizeReportGrouping('project_month')).toBe('project_task')
  })
})

describe('EP-37 time-entry source registry', () => {
  it('ships exactly the four built-in sources', () => {
    expect(timeEntrySourceIds()).toEqual([...BUILT_IN_TIME_ENTRY_SOURCE_IDS])
    expect(getTimeEntrySource('manual')?.editable).toBe(true)
    expect(getTimeEntrySource('kiosk')?.editable).toBe(false)
    expect(normalizeTimeEntrySource('jira')).toBe('manual')
    expect(normalizeTimeEntrySource(undefined)).toBe('manual')
  })

  it('accepts a contributed source', () => {
    const dispose = registerTimeEntrySource({
      id: 'jira',
      labelKey: 'test.jira',
      icon: 'Link',
      editable: false,
    })
    try {
      expect(normalizeTimeEntrySource('jira')).toBe('jira')
      expect(timeEntrySourceIds()).toEqual([...BUILT_IN_TIME_ENTRY_SOURCE_IDS, 'jira'])
    } finally {
      dispose()
    }
    expect(normalizeTimeEntrySource('jira')).toBe('manual')
  })
})

describe('EP-38 overlap policy provider', () => {
  const candidate = { date: '2026-01-02', start: '09:00', durationMinutes: 60 }
  const existing = [{ id: 'e1', date: '2026-01-02', start: '09:30', durationMinutes: 60 }]
  const overlaps = findOverlaps(candidate, existing)

  const ctx = (over: Partial<OverlapPolicyContext> = {}): OverlapPolicyContext => ({
    ...SCOPE,
    candidate,
    warningsEnabled: true,
    ...over,
  })

  it('warns only when the tenant setting is on and something intersects', () => {
    expect(overlaps).toHaveLength(1)
    expect(evaluateOverlapPolicies(overlaps, ctx())).toBe('warn')
    expect(evaluateOverlapPolicies(overlaps, ctx({ warningsEnabled: false }))).toBe('allow')
    expect(evaluateOverlapPolicies([], ctx())).toBe('allow')
    expect(BUILT_IN_OVERLAP_POLICY_ID).toBe('staff.time_tracking.overlap.warn_when_enabled')
  })

  it('lets a contribution escalate but never suppress', () => {
    const blocker = registerOverlapPolicy({ id: 'test.block', evaluate: () => 'block' })
    try {
      expect(evaluateOverlapPolicies(overlaps, ctx())).toBe('block')
      expect(evaluateOverlapPolicies(overlaps, { ...ctx(), tenantId: undefined })).toBe('warn')
    } finally {
      blocker()
    }
    const suppressor = registerOverlapPolicy({ id: 'test.allow', evaluate: () => 'allow' })
    try {
      expect(evaluateOverlapPolicies(overlaps, ctx())).toBe('warn')
    } finally {
      suppressor()
    }
  })
})

describe('EP-39 project code generator provider', () => {
  it('derives exactly what the pure function did', () => {
    expect(deriveProjectCode('Apollo', new Set())).toBe('APO')
    expect(deriveProjectCode('Ergo Hestia Korpo', new Set())).toBe('EHK')
    expect(deriveProjectCode('Apollo', new Set(['APO']))).toBe('APO2')
    expect(BUILT_IN_PROJECT_CODE_GENERATOR_ID).toBe('staff.time_tracking.project_code.initials')
  })

  it('lets a scoped contribution take over', () => {
    const dispose = registerProjectCodeGenerator({
      id: 'test.sequence',
      generate: (_name, taken) => `P${taken.size + 1}`,
    })
    try {
      expect(deriveProjectCode('Apollo', new Set(), SCOPE)).toBe('P1')
      expect(deriveProjectCode('Apollo', new Set())).toBe('APO')
    } finally {
      dispose()
    }
    expect(deriveProjectCode('Apollo', new Set(), SCOPE)).toBe('APO')
  })
})

describe('EP-40 capacity provider', () => {
  const range = { from: '2026-01-01', to: '2026-01-02', workingDays: ['2026-01-01', '2026-01-02'] }

  it('returns the flat daily number exactly as the setting says', () => {
    expect(resolveTimesheetCapacity('member-1', range, { ...SCOPE, dailyHours: 8 })).toEqual({
      targetMinutesByDate: { '2026-01-01': 480, '2026-01-02': 480 },
      totalTargetMinutes: 960,
    })
    expect(resolveTimesheetCapacity('member-1', range, { ...SCOPE, dailyHours: null })).toEqual({
      targetMinutesByDate: {},
      totalTargetMinutes: null,
    })
    expect(BUILT_IN_CAPACITY_PROVIDER_ID).toBe('staff.time_tracking.capacity.flat_daily_hours')
  })

  it('lets a scoped contribution answer per day', () => {
    const dispose = registerCapacityProvider({
      id: 'test.part_time',
      resolve: () => ({ targetMinutesByDate: { '2026-01-01': 240 }, totalTargetMinutes: 240 }),
    })
    try {
      expect(resolveTimesheetCapacity('member-1', range, { ...SCOPE, dailyHours: 8 }).totalTargetMinutes).toBe(240)
      expect(resolveTimesheetCapacity('member-1', range, { dailyHours: 8 }).totalTargetMinutes).toBe(960)
    } finally {
      dispose()
    }
  })
})

describe('EP-41 report approval policy provider', () => {
  const ctx: ReportApprovalContext = {
    ...SCOPE,
    reportId: 'report-1',
    actorUserId: 'user-1',
    actorFeatures: ['staff.timesheets.lock'],
    status: 'draft',
  }

  it('refuses nothing with no contribution', () => {
    expect(evaluateReportClosePolicies(ctx)).toBeNull()
    expect(evaluateReportUnlockPolicies(ctx)).toBeNull()
    expect(BUILT_IN_REPORT_APPROVAL_POLICY_ID).toBe('staff.time_tracking.report_approval.acl_only')
  })

  it('lets a contribution refuse but gives it no way to grant', () => {
    const dispose = registerReportApprovalPolicy({
      id: 'test.four_eyes',
      canClose: () => ({ code: 'four_eyes_required', messageKey: 'test.four_eyes' }),
      canUnlock: () => null,
    })
    try {
      expect(evaluateReportClosePolicies(ctx)).toEqual({
        code: 'four_eyes_required',
        messageKey: 'test.four_eyes',
      })
      expect(evaluateReportUnlockPolicies(ctx)).toBeNull()
      expect(evaluateReportClosePolicies({ ...ctx, tenantId: undefined })).toBeNull()
    } finally {
      dispose()
    }
    expect(evaluateReportClosePolicies(ctx)).toBeNull()
  })

  it('collects an onClosed failure instead of unwinding a committed freeze', async () => {
    const dispose = registerReportApprovalPolicy({
      id: 'test.notifier',
      onClosed: () => {
        throw new Error('[internal] downstream unavailable')
      },
    })
    try {
      const failures = await notifyReportClosed({ ...ctx, status: 'closed' })
      expect(failures.map((failure) => failure.policyId)).toEqual(['test.notifier'])
    } finally {
      dispose()
    }
    expect(await notifyReportClosed({ ...ctx, status: 'closed' })).toEqual([])
  })
})

/**
 * M-3 — a contribution cannot impersonate a built-in, and cannot delete one.
 *
 * All eleven built-in ids are published in `staff/AGENTS.md`, and `register()` used
 * to be `slots.set(id, slot)`: last writer wins. A module registering
 * `{ id: 'staff.time_tracking.rounding.unit', … }` therefore BECAME the built-in —
 * it ran on the unscoped path the fail-closed gate exists to keep byte-identical,
 * and its disposer then removed the real built-in permanently, after which
 * `resolveGroupingStrategy` throws on every report list, sheet and export.
 */
describe('built-in strategies are not replaceable', () => {
  it('refuses a contribution registered under a built-in id', () => {
    expect(() =>
      registerTimeRoundingStrategy({
        id: BUILT_IN_TIME_ROUNDING_STRATEGY_ID,
        labelKey: 'test.impostor',
        round: () => 1,
      }),
    ).toThrow(/built-in/)

    expect(() =>
      registerReportGrouping({
        id: 'project_task',
        labelKey: 'test.impostor',
        groupOf: () => ({ key: 'x', parentKey: null }),
        labelOf: () => 'x',
        sort: () => 0,
      }),
    ).toThrow(/built-in/)

    expect(() =>
      registerCapacityProvider({
        id: BUILT_IN_CAPACITY_PROVIDER_ID,
        resolve: () => ({ targetMinutesByDate: {}, totalTargetMinutes: 0 }),
      }),
    ).toThrow(/built-in/)

    // Nothing was displaced by the attempts.
    expect(resolveTimeRoundingStrategy(SCOPE).id).toBe(BUILT_IN_TIME_ROUNDING_STRATEGY_ID)
    expect(getReportGrouping('project_task')).not.toBeNull()
    expect(roundMinutes(62, { unitMinutes: 15, direction: 'up' }, SCOPE)).toBe(75)
  })

  it('cannot be removed by a contributed strategy disposer', () => {
    const dispose = registerReportGrouping({
      id: 'test.by_tag',
      labelKey: 'test.by_tag',
      groupOf: (entry) => ({ key: entry.date || UNASSIGNED_LINE_KEY, parentKey: null }),
      labelOf: (key) => key,
      sort: () => 0,
    })
    dispose()
    // Disposing twice, the shape a buggy contribution takes, must not reach further.
    dispose()

    expect(getReportGrouping('test.by_tag')).toBeNull()
    for (const id of BUILT_IN_REPORT_GROUPING_IDS) {
      expect(getReportGrouping(id)).not.toBeNull()
    }
    expect(reportGroupingIds()).toEqual(expect.arrayContaining([...BUILT_IN_REPORT_GROUPING_IDS]))
    expect(normalizeReportGrouping('project_task')).toBe('project_task')
  })
})

/**
 * M-4 — a contributed strategy's return value is not trusted, and neither is its
 * ability to return at all.
 *
 * `roundMinutes` feeds `staff_time_entries.rounded_minutes`, an `integer` column and
 * the sole input to cost. The obvious contributed strategy —
 * `Math.floor(raw / ctx.settings.unitMinutes) * ctx.settings.unitMinutes`, the shape
 * this suite's own fixture uses — is `NaN` under the SHIPPED default of
 * `unitMinutes: 0`: the write either fails or stores garbage, and on read
 * `entryAmount` substitutes `0`, so the entry bills 0.00 in silence.
 */
describe('a contributed strategy cannot corrupt the value it returns', () => {
  const suppressed: jest.SpyInstance[] = []

  beforeEach(() => {
    suppressed.push(jest.spyOn(console, 'error').mockImplementation(() => {}))
  })

  afterEach(() => {
    for (const spy of suppressed.splice(0)) spy.mockRestore()
  })

  it('falls back to the built-in rounding when a strategy answers NaN', () => {
    const dispose = registerTimeRoundingStrategy({
      id: 'test.divide_by_unit',
      labelKey: 'test.divide_by_unit',
      round: (raw, ctx) => Math.floor(raw / ctx.settings.unitMinutes) * ctx.settings.unitMinutes,
    })
    try {
      // The shipped default. Before the clamp this stored NaN and billed 0.00.
      expect(roundMinutes(62, { unitMinutes: 0, direction: 'up' }, SCOPE)).toBe(62)
    } finally {
      dispose()
    }
  })

  it('clamps a fractional or negative answer to something the column can hold', () => {
    const dispose = registerTimeRoundingStrategy({
      id: 'test.fractional',
      labelKey: 'test.fractional',
      round: (raw) => -raw / 3,
    })
    try {
      expect(roundMinutes(62, { unitMinutes: 15, direction: 'up' }, SCOPE)).toBe(0)
    } finally {
      dispose()
    }
  })

  it('falls back to the built-in rounding when a strategy throws', () => {
    const dispose = registerTimeRoundingStrategy({
      id: 'test.thrower',
      labelKey: 'test.thrower',
      round: () => {
        throw new Error('[internal] contributed rounding blew up')
      },
    })
    try {
      expect(roundMinutes(62, { unitMinutes: 15, direction: 'up' }, SCOPE)).toBe(75)
    } finally {
      dispose()
    }
  })

  it('falls back to the flat daily target when a capacity provider throws or answers nonsense', () => {
    const range = { from: '2026-01-01', to: '2026-01-02', workingDays: ['2026-01-01', '2026-01-02'] }
    const disposeThrower = registerCapacityProvider({
      id: 'test.capacity_thrower',
      priority: 10,
      resolve: () => {
        throw new Error('[internal] contributed capacity blew up')
      },
    })
    try {
      expect(resolveTimesheetCapacity('member-1', range, { ...SCOPE, dailyHours: 8 })).toEqual({
        targetMinutesByDate: { '2026-01-01': 480, '2026-01-02': 480 },
        totalTargetMinutes: 960,
      })
    } finally {
      disposeThrower()
    }

    const disposeNonsense = registerCapacityProvider({
      id: 'test.capacity_nonsense',
      priority: 10,
      resolve: () =>
        ({ targetMinutesByDate: { '2026-01-01': Number.NaN }, totalTargetMinutes: Number.NaN }) as never,
    })
    try {
      expect(
        resolveTimesheetCapacity('member-1', range, { ...SCOPE, dailyHours: 8 }).totalTargetMinutes,
      ).toBe(960)
    } finally {
      disposeNonsense()
    }
  })

  it('falls back to the initials rule when a project code generator throws or answers unusably', () => {
    const disposeThrower = registerProjectCodeGenerator({
      id: 'test.code_thrower',
      generate: () => {
        throw new Error('[internal] contributed generator blew up')
      },
    })
    try {
      expect(deriveProjectCode('Ergo Hestia Korpo', new Set(), SCOPE)).toBe('EHK')
    } finally {
      disposeThrower()
    }

    const disposeBlank = registerProjectCodeGenerator({
      id: 'test.code_blank',
      generate: () => '   ',
    })
    try {
      expect(deriveProjectCode('Ergo Hestia Korpo', new Set(), SCOPE)).toBe('EHK')
    } finally {
      disposeBlank()
    }
  })

  it('keeps a report renderable when a contributed grouping sort throws', () => {
    const dispose = registerReportGrouping({
      id: 'test.sort_thrower',
      labelKey: 'test.sort_thrower',
      groupOf: (entry) => ({ key: entry.staffMemberId ?? UNASSIGNED_LINE_KEY, parentKey: null }),
      labelOf: (key) => key,
      sort: () => {
        throw new Error('[internal] contributed sort blew up')
      },
    })
    try {
      const totals = computeReportTotals({
        entries: [
          {
            id: 'e1',
            date: '2026-01-01',
            staffMemberId: 'member-1',
            timeProjectId: 'project-1',
            taskId: null,
            rootTaskId: null,
            isBillable: true,
            roundedMinutes: 60,
            durationMinutes: 60,
            rateOverrideAmount: null,
            lockedReportId: null,
          },
        ],
        projects: [{ id: 'project-1', name: 'Apollo', hourlyRate: 100, currencyCode: 'PLN' }],
        directory: { taskLabelById: {}, personLabelById: { 'member-1': 'Ada' } },
        options: { grouping: 'test.sort_thrower', nonBillableMode: 'separate', includeAlreadyReported: false },
        labels: { unassignedTask: '—', unassignedPerson: '—', nonbillableGroup: 'Non-billable' },
      })
      expect(totals.groups[0].lines).toHaveLength(1)
    } finally {
      dispose()
    }
  })

  it('re-raises a failing export serializer as a diagnosable internal error', () => {
    const dispose = registerReportExportFormat({
      id: 'test.broken_format',
      labelKey: 'test.broken_format',
      mimeType: 'application/x-broken',
      extension: 'brk',
      serialize: () => {
        throw new Error('boom')
      },
    })
    try {
      expect(() => serializeReportExport('test.broken_format', {} as ReportExportInput)).toThrow(
        /\[internal\] report export format test\.broken_format failed to serialize/,
      )
    } finally {
      dispose()
    }
  })

  it('refuses a close when an approval policy throws, rather than treating it as consent', () => {
    const dispose = registerReportApprovalPolicy({
      id: 'test.policy_thrower',
      canClose: () => {
        throw new Error('[internal] contributed policy blew up')
      },
    })
    try {
      const refusal = evaluateReportClosePolicies({
        ...SCOPE,
        reportId: 'report-1',
        actorUserId: 'user-1',
        actorFeatures: ['staff.timesheets.lock'],
        status: 'draft',
      })
      expect(refusal).toMatchObject({ code: 'approval_policy_unavailable' })
    } finally {
      dispose()
    }
  })
})
