/**
 * EP-49 — the time-tracking AI tool pack.
 *
 * Six tools, three of them writes. The write path is the platform's approval
 * contract, and the shape of that contract is the one thing worth stating
 * plainly here, because the spec described it inside out:
 *
 * A module tool does NOT call `prepareMutation`. `prepareMutation` is framework
 * code — its only call site is `agent-tools.ts` in `@open-mercato/ai-assistant`,
 * which intercepts the model's call, short-circuits the handler, persists an
 * `AiPendingAction` and returns a preview card. A tool opts into that by
 * declaring `isMutation: true` and a `loadBeforeRecord` resolver that renders the
 * diff; the agent opts in with `mutationPolicy: 'confirm-required'`. The handler
 * runs later, once, from the confirm route, with the stored input. Calling
 * `prepareMutation` from here would be calling the interceptor from inside the
 * thing it intercepts.
 *
 * Every tool is API-backed. `createAiApiOperationRunner` resolves the route from
 * the generated manifest and refuses to run a mutation route whose
 * `requiredFeatures` the tool does not itself declare, so the `staff.timesheets.*`
 * gate on each tool below is checked twice: once by the tool registry before the
 * handler, once by the runner against the route. The route then applies the
 * project-access intersection, the mutation guards, the interceptors and the
 * commands — none of which is reimplemented here.
 */

import { z } from 'zod'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import type {
  AiApiOperationRequest,
  AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import {
  assertTenantScope,
  enumerateDates,
  isWeekend,
  resolveStaffToolScope,
  toIsoDate,
  toMinutes,
} from './types'

const VIEW_FEATURE = 'staff.timesheets.view'
const MANAGE_OWN_FEATURE = 'staff.timesheets.manage_own'
const REPORTS_VIEW_FEATURE = 'staff.timesheets.reports.view'

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd calendar date.')

type EntryRow = {
  id?: unknown
  date?: unknown
  durationMinutes?: unknown
  duration_minutes?: unknown
  roundedMinutes?: unknown
  timeProjectId?: unknown
  time_project_id?: unknown
  projectName?: unknown
  taskId?: unknown
  notes?: unknown
  isBillable?: unknown
  is_billable?: unknown
}

type EntriesApiResponse = {
  items?: EntryRow[]
  total?: number
}

function readDate(row: EntryRow): string | null {
  return toIsoDate(row.date)
}

function readMinutes(row: EntryRow): number {
  const rounded = toMinutes(row.roundedMinutes)
  if (rounded > 0) return rounded
  return toMinutes(row.durationMinutes ?? row.duration_minutes)
}

function readProjectId(row: EntryRow): string | null {
  const value = row.timeProjectId ?? row.time_project_id
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/* ------------------------------------------------------------------ writes */

const logTimeInput = z.object({
  date: isoDate.describe('The calendar day the work happened, as yyyy-mm-dd.'),
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .describe('How long the work took, in whole minutes (1–1440).'),
  timeProjectId: z.string().uuid().optional().describe('Project the time belongs to. Omit for unassigned time.'),
  taskId: z.string().uuid().optional().describe('Task the time belongs to; the task carries its own project.'),
  notes: z.string().max(2000).optional().describe('What was done. Shown to whoever reviews the timesheet.'),
  isBillable: z.boolean().optional().describe('Override the project default for whether the time is billable.'),
})

type LogTimeInput = z.infer<typeof logTimeInput>

const logTimeTool = defineApiBackedAiTool<LogTimeInput, { id?: string }, { recordId: string | null; commandName: string; before: Record<string, unknown>; after: Record<string, unknown> }>({
  name: 'staff.log_time',
  displayName: 'Log time',
  description:
    'Create a time entry for the signed-in user. Mutation tool — the write is held for approval and shown as a preview card before it runs.',
  inputSchema: logTimeInput,
  requiredFeatures: [MANAGE_OWN_FEATURE],
  isMutation: true,
  loadBeforeRecord: async (input, ctx) => {
    const scope = await resolveStaffToolScope(ctx as unknown as AiToolExecutionContext)
    return {
      recordId: `new:${scope.staffMemberId}:${input.date}`,
      entityType: 'staff.staff_time_entry',
      recordVersion: null,
      before: {},
      after: {
        date: input.date,
        durationMinutes: input.durationMinutes,
        timeProjectId: input.timeProjectId ?? null,
        taskId: input.taskId ?? null,
        notes: input.notes ?? null,
        isBillable: input.isBillable ?? null,
      },
      display: {
        fieldLabels: {
          date: 'Date',
          durationMinutes: 'Minutes',
          timeProjectId: 'Project',
          taskId: 'Task',
          notes: 'Notes',
          isBillable: 'Billable',
        },
      },
    }
  },
  toOperation: async (input, ctx) => {
    const scope = await resolveStaffToolScope(ctx)
    return {
      method: 'POST',
      path: '/staff/timesheets/time-entries',
      body: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        staffMemberId: scope.staffMemberId,
        date: input.date,
        durationMinutes: input.durationMinutes,
        ...(input.timeProjectId ? { timeProjectId: input.timeProjectId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.isBillable === undefined ? {} : { isBillable: input.isBillable }),
      },
    } satisfies AiApiOperationRequest
  },
  mapResponse: (response, input) => ({
    recordId: typeof response.data?.id === 'string' ? response.data.id : null,
    commandName: 'staff.timesheets.time_entries.create',
    before: {},
    after: {
      date: input.date,
      durationMinutes: input.durationMinutes,
      timeProjectId: input.timeProjectId ?? null,
      taskId: input.taskId ?? null,
    },
  }),
}) as unknown as AiToolDefinition

const startTimerInput = z.object({
  date: isoDate.optional().describe('Day to file the running timer under; defaults to today.'),
  timeProjectId: z.string().uuid().optional().describe('Project to start the timer against.'),
  taskId: z.string().uuid().optional().describe('Task to start the timer against; it carries its own project.'),
  notes: z.string().max(2000).optional().describe('What the timer is for.'),
})

type StartTimerInput = z.infer<typeof startTimerInput>

const startTimerTool = defineApiBackedAiTool<StartTimerInput, { id?: string | null }, { recordId: string | null; commandName: string; before: Record<string, unknown>; after: Record<string, unknown> }>({
  name: 'staff.start_timer',
  displayName: 'Start timer',
  description:
    'Start a running timer for the signed-in user. Mutation tool — held for approval before it runs.',
  inputSchema: startTimerInput,
  requiredFeatures: [MANAGE_OWN_FEATURE],
  isMutation: true,
  loadBeforeRecord: async (input, ctx) => {
    const scope = await resolveStaffToolScope(ctx as unknown as AiToolExecutionContext)
    const date = input.date ?? new Date().toISOString().slice(0, 10)
    return {
      recordId: `timer:${scope.staffMemberId}:${date}`,
      entityType: 'staff.staff_time_entry',
      recordVersion: null,
      before: {},
      after: {
        date,
        timeProjectId: input.timeProjectId ?? null,
        taskId: input.taskId ?? null,
        notes: input.notes ?? null,
      },
      display: { fieldLabels: { date: 'Date', timeProjectId: 'Project', taskId: 'Task', notes: 'Notes' } },
    }
  },
  toOperation: async (input, ctx) => {
    const scope = await resolveStaffToolScope(ctx)
    return {
      method: 'POST',
      path: '/staff/timesheets/time-entries/start-timer',
      body: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        staffMemberId: scope.staffMemberId,
        date: input.date ?? new Date().toISOString().slice(0, 10),
        ...(input.timeProjectId ? { timeProjectId: input.timeProjectId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      },
    } satisfies AiApiOperationRequest
  },
  mapResponse: (response, input) => ({
    recordId: typeof response.data?.id === 'string' ? response.data.id : null,
    commandName: 'staff.timesheets.time_entries.start_timer',
    before: {},
    after: { timeProjectId: input.timeProjectId ?? null, taskId: input.taskId ?? null },
  }),
}) as unknown as AiToolDefinition

const stopTimerInput = z.object({
  timeEntryId: z.string().uuid().describe('The time entry whose running timer should be stopped.'),
})

type StopTimerInput = z.infer<typeof stopTimerInput>

const stopTimerTool = defineApiBackedAiTool<StopTimerInput, { durationMinutes?: number }, { recordId: string; commandName: string; before: Record<string, unknown>; after: Record<string, unknown> }>({
  name: 'staff.stop_timer',
  displayName: 'Stop timer',
  description:
    'Stop the running timer on a time entry and freeze its duration. Mutation tool — held for approval before it runs.',
  inputSchema: stopTimerInput,
  requiredFeatures: [MANAGE_OWN_FEATURE],
  isMutation: true,
  loadBeforeRecord: async (input, ctx) => {
    assertTenantScope(ctx as unknown as AiToolExecutionContext)
    return {
      recordId: input.timeEntryId,
      entityType: 'staff.staff_time_entry',
      recordVersion: null,
      before: { timerRunning: true },
      after: { timerRunning: false },
      display: { fieldLabels: { timerRunning: 'Timer running' } },
    }
  },
  toOperation: async (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'POST',
      path: `/staff/timesheets/time-entries/${input.timeEntryId}/timer-stop`,
      body: {},
    } satisfies AiApiOperationRequest
  },
  mapResponse: (response, input) => ({
    recordId: input.timeEntryId,
    commandName: 'staff.timesheets.time_entries.stop_timer',
    before: { timerRunning: true },
    after: { timerRunning: false, durationMinutes: toMinutes(response.data?.durationMinutes) },
  }),
}) as unknown as AiToolDefinition

/* ------------------------------------------------------------------- reads */

const summarizeWeekInput = z.object({
  from: isoDate.describe('First day of the range, yyyy-mm-dd.'),
  to: isoDate.describe('Last day of the range, inclusive, yyyy-mm-dd.'),
})

type SummarizeWeekInput = z.infer<typeof summarizeWeekInput>

const summarizeWeekTool = defineApiBackedAiTool<
  SummarizeWeekInput,
  EntriesApiResponse,
  {
    from: string
    to: string
    totalMinutes: number
    entryCount: number
    byDate: Array<{ date: string; minutes: number }>
    byProject: Array<{ timeProjectId: string | null; minutes: number; entryCount: number }>
  }
>({
  name: 'staff.summarize_week',
  displayName: 'Summarize logged time',
  description:
    'Summarize the signed-in user’s logged time over a date range: totals per day and per project. Read-only. Returns minutes, never money.',
  inputSchema: summarizeWeekInput,
  requiredFeatures: [VIEW_FEATURE],
  toOperation: async (input, ctx) => {
    const scope = await resolveStaffToolScope(ctx)
    return {
      method: 'GET',
      path: '/staff/timesheets/time-entries',
      query: {
        from: input.from,
        to: input.to,
        staffMemberId: scope.staffMemberId,
        page: 1,
        pageSize: 100,
      },
    } satisfies AiApiOperationRequest
  },
  mapResponse: (response, input) => {
    const items = Array.isArray(response.data?.items) ? response.data.items : []
    const byDate = new Map<string, number>()
    const byProject = new Map<string, { minutes: number; entryCount: number }>()
    let totalMinutes = 0
    for (const row of items) {
      const date = readDate(row)
      const minutes = readMinutes(row)
      totalMinutes += minutes
      if (date) byDate.set(date, (byDate.get(date) ?? 0) + minutes)
      const projectKey = readProjectId(row) ?? ''
      const bucket = byProject.get(projectKey) ?? { minutes: 0, entryCount: 0 }
      bucket.minutes += minutes
      bucket.entryCount += 1
      byProject.set(projectKey, bucket)
    }
    return {
      from: input.from,
      to: input.to,
      totalMinutes,
      entryCount: items.length,
      byDate: Array.from(byDate.entries())
        .map(([date, minutes]) => ({ date, minutes }))
        .sort((left, right) => left.date.localeCompare(right.date)),
      byProject: Array.from(byProject.entries()).map(([key, value]) => ({
        timeProjectId: key.length > 0 ? key : null,
        minutes: value.minutes,
        entryCount: value.entryCount,
      })),
    }
  },
}) as unknown as AiToolDefinition

const findMissingDaysInput = z.object({
  from: isoDate.describe('First day of the range, yyyy-mm-dd.'),
  to: isoDate.describe('Last day of the range, inclusive, yyyy-mm-dd.'),
  includeWeekends: z
    .boolean()
    .optional()
    .describe('Count Saturdays and Sundays as days that need time logged. Defaults to false.'),
})

type FindMissingDaysInput = z.infer<typeof findMissingDaysInput>

const findMissingDaysTool = defineApiBackedAiTool<
  FindMissingDaysInput,
  EntriesApiResponse,
  { from: string; to: string; missingDates: string[]; checkedDayCount: number }
>({
  name: 'staff.find_missing_days',
  displayName: 'Find days with no logged time',
  description:
    'List the days in a range on which the signed-in user logged no time. Weekends are excluded unless asked for. Read-only.',
  inputSchema: findMissingDaysInput,
  requiredFeatures: [VIEW_FEATURE],
  toOperation: async (input, ctx) => {
    const scope = await resolveStaffToolScope(ctx)
    return {
      method: 'GET',
      path: '/staff/timesheets/time-entries',
      query: {
        from: input.from,
        to: input.to,
        staffMemberId: scope.staffMemberId,
        page: 1,
        pageSize: 100,
      },
    } satisfies AiApiOperationRequest
  },
  mapResponse: (response, input) => {
    const items = Array.isArray(response.data?.items) ? response.data.items : []
    const logged = new Set<string>()
    for (const row of items) {
      const date = readDate(row)
      if (date && readMinutes(row) > 0) logged.add(date)
    }
    const candidates = enumerateDates(input.from, input.to).filter(
      (date) => (input.includeWeekends ?? false) || !isWeekend(date),
    )
    return {
      from: input.from,
      to: input.to,
      missingDates: candidates.filter((date) => !logged.has(date)),
      checkedDayCount: candidates.length,
    }
  },
}) as unknown as AiToolDefinition

const draftClientReportInput = z.object({
  timeProjectIds: z
    .array(z.string().uuid())
    .min(1)
    .max(100)
    .describe('Projects the report covers. They must all belong to the same customer.'),
  periodFrom: isoDate.describe('First day of the reported period, yyyy-mm-dd.'),
  periodTo: isoDate.describe('Last day of the reported period, inclusive, yyyy-mm-dd.'),
  customerId: z.string().uuid().optional().describe('Customer the report is for.'),
  grouping: z
    .string()
    .optional()
    .describe('Report grouping id, e.g. project_task, project_person or project_day.'),
  includeAlreadyReported: z
    .boolean()
    .optional()
    .describe('Include entries already frozen into an earlier report. Defaults to false.'),
})

type DraftClientReportInput = z.infer<typeof draftClientReportInput>

type PreviewApiResponse = {
  currencyCode?: unknown
  grouping?: unknown
  projects?: Array<{
    id?: unknown
    name?: unknown
    entryCount?: unknown
    billableMinutes?: unknown
    nonbillableMinutes?: unknown
  }>
  totals?: unknown
}

const draftClientReportTool = defineApiBackedAiTool<
  DraftClientReportInput,
  PreviewApiResponse,
  {
    periodFrom: string
    periodTo: string
    grouping: string | null
    projects: Array<{ id: string | null; name: string | null; billableMinutes: number; nonbillableMinutes: number; entryCount: number }>
  }
>({
  name: 'staff.draft_client_report',
  displayName: 'Draft a client report',
  description:
    'Preview what a customer report would contain for a set of projects and a period, without creating one. Read-only — no report is written and nothing is locked. Amounts are omitted; ask the reports screen for money.',
  inputSchema: draftClientReportInput,
  requiredFeatures: [REPORTS_VIEW_FEATURE],
  toOperation: async (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'POST',
      path: '/staff/timesheets/reports/preview',
      body: {
        timeProjectIds: input.timeProjectIds,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        periodKind: 'custom',
        ...(input.customerId ? { customerId: input.customerId } : {}),
        ...(input.grouping ? { grouping: input.grouping } : {}),
        includeAlreadyReported: input.includeAlreadyReported ?? false,
        showRates: false,
      },
    } satisfies AiApiOperationRequest
  },
  /**
   * The preview response carries rates and amounts when the caller holds
   * `staff.timesheets.rates.view`. The tool asks for `showRates: false` and then
   * projects only the minute columns, so an agent transcript never becomes a
   * second, ungated copy of the customer's rate card.
   */
  mapResponse: (response, input) => ({
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    grouping: typeof response.data?.grouping === 'string' ? response.data.grouping : null,
    projects: (response.data?.projects ?? []).map((project) => ({
      id: typeof project.id === 'string' ? project.id : null,
      name: typeof project.name === 'string' ? project.name : null,
      billableMinutes: toMinutes(project.billableMinutes),
      nonbillableMinutes: toMinutes(project.nonbillableMinutes),
      entryCount: toMinutes(project.entryCount),
    })),
  }),
}) as unknown as AiToolDefinition

export const timeTrackingAiTools: AiToolDefinition[] = [
  logTimeTool,
  startTimerTool,
  stopTimerTool,
  summarizeWeekTool,
  findMissingDaysTool,
  draftClientReportTool,
]

export default timeTrackingAiTools
