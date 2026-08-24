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
