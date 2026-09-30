import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { getEnabledModuleIds, hasEnabledModulesRegistry } from '@open-mercato/shared/security/enabledModulesRegistry'

const uuid = z.string().uuid()
const ids = z.array(uuid).max(20).refine((value) => new Set(value).size === value.length)
export const visitAvailabilityInputSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  staffUserIds: ids.default([]),
  resourceIds: ids.default([]),
}).refine((value) => new Date(value.endAt).getTime() > new Date(value.startAt).getTime(), {
  path: ['endAt'],
  message: 'example.calendar.visitAvailability.invalidInterval',
})

export type VisitAvailabilityInput = z.infer<typeof visitAvailabilityInputSchema>
export type VisitAvailabilitySubject = {
  type: 'staff' | 'resource'
  id: string
  status: 'available' | 'unavailable' | 'unknown'
  reasonKey: string | null
}

export function visitAvailabilityWarnings(): string[] {
  if (!hasEnabledModulesRegistry()) return []
  const enabledModules = new Set(getEnabledModuleIds())
  return ['staff', 'resources', 'planner'].flatMap((moduleId) => enabledModules.has(moduleId)
    ? []
    : [`example.calendar.visitAvailability.${moduleId}Disabled`])
}

type Row = Record<string, unknown>
type Window = { start: Date; end: Date }
type PlannerService = { getMergedAvailabilityWindows: (input: { respectTimezone?: boolean; weeklyScheduleTemplate?: boolean; rules: Array<{ id?: string; rrule: string; timezone?: string; exdates?: string[]; kind?: 'availability' | 'unavailability' }>; range: Window }) => Window[] }
type Rbac = { userHasAllFeatures: (userId: string, features: string[], scope: { tenantId: string; organizationId: string }) => Promise<boolean> }

export function resolveVisitService<T>(container: Pick<AwilixContainer, 'resolve'>, name: string): T | null {
  try {
    return container.resolve<T>(name) ?? null
  } catch {
    return null
  }
}

function value(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

function covers(windows: Window[], start: Date, end: Date): boolean {
  let cursor = start.getTime()
  for (const window of [...windows].sort((left, right) => left.start.getTime() - right.start.getTime())) {
    if (window.start.getTime() > cursor) return false
    if (window.end.getTime() > cursor) cursor = window.end.getTime()
    if (cursor >= end.getTime()) return true
  }
  return false
}

function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

async function list(queryEngine: QueryEngine, entity: `${string}:${string}`, scope: { tenantId: string; organizationId: string }, filters: Record<string, unknown>, fields: string[]): Promise<Row[]> {
  const result = await queryEngine.query<Row>(entity, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    filters,
    fields,
    page: { page: 1, pageSize: 100 },
  })
  if (result.total > 100) throw new Error('visit_availability_result_limit')
  return result.items
}

export async function evaluateVisitAvailability(args: {
  container: AwilixContainer
  actorUserId: string
  scope: { tenantId: string; organizationId: string }
  input: VisitAvailabilityInput
}): Promise<VisitAvailabilitySubject[]> {
  const { container, actorUserId, scope, input } = args
  const enabledModules = hasEnabledModulesRegistry() ? new Set(getEnabledModuleIds()) : null
  const canCheck = (moduleId: string) => !enabledModules || (enabledModules.has(moduleId) && enabledModules.has('planner'))
  const subjects: VisitAvailabilitySubject[] = [
    ...(canCheck('staff') ? input.staffUserIds : []).map((id): VisitAvailabilitySubject => ({ type: 'staff', id, status: 'unknown', reasonKey: 'example.calendar.visitAvailability.unknown' })),
    ...(canCheck('resources') ? input.resourceIds : []).map((id): VisitAvailabilitySubject => ({ type: 'resource', id, status: 'unknown', reasonKey: 'example.calendar.visitAvailability.unknown' })),
  ]
  if (!subjects.length) return subjects
  const queryEngine = resolveVisitService<QueryEngine>(container, 'queryEngine')
  const planner = resolveVisitService<PlannerService>(container, 'plannerAvailabilityService')
  const rbac = resolveVisitService<Rbac>(container, 'rbacService')
  if (!queryEngine || !planner || !rbac) return subjects

  const start = new Date(input.startAt)
  const end = new Date(input.endAt)
  for (const type of ['staff', 'resource'] as const) {
    const selected = subjects.filter((subject) => subject.type === type)
    if (!selected.length) continue
    const features = type === 'staff' ? ['staff.view', 'planner.view'] : ['resources.view', 'planner.view']
    if (!await rbac.userHasAllFeatures(actorUserId, features, scope)) {
      selected.forEach((subject) => { subject.reasonKey = 'example.calendar.visitAvailability.missingScope' })
      continue
    }
    try {
      const records = await list(queryEngine,
        type === 'staff' ? 'staff:staff_team_member' : 'resources:resources_resource',
        scope,
        type === 'staff' ? { user_id: { $in: selected.map((subject) => subject.id) }, is_active: true } : { id: { $in: selected.map((subject) => subject.id) }, is_active: true },
        type === 'staff' ? ['id', 'user_id', 'is_active', 'availability_rule_set_id'] : ['id', 'is_active', 'availability_rule_set_id'],
      )
      for (const subject of selected) {
        const record = records.find((row) => value(row, type === 'staff' ? 'userId' : 'id', type === 'staff' ? 'user_id' : 'id') === subject.id)
        if (!record) {
          subject.status = 'unavailable'
          subject.reasonKey = 'example.calendar.visitAvailability.inactiveSubject'
          continue
        }
        const memberId = value(record, 'id', 'id')
        const ruleSetId = value(record, 'availabilityRuleSetId', 'availability_rule_set_id')
        if (typeof memberId !== 'string') continue
        const activeRuleSet = typeof ruleSetId === 'string'
          ? (await list(queryEngine, 'planner:planner_availability_rule_set', scope, { id: ruleSetId }, ['id'])).some((row) => row.id === ruleSetId)
          : false
        const ruleFilters = { $or: [
          { subject_type: type === 'staff' ? 'member' : 'resource', subject_id: memberId },
          ...(activeRuleSet ? [{ subject_type: 'ruleset', subject_id: ruleSetId }] : []),
        ] }
        const rules = await list(queryEngine, 'planner:planner_availability_rule', scope, ruleFilters, ['id', 'rrule', 'exdates', 'kind', 'timezone'])
        if (rules.some((row) => !isValidTimezone(value(row, 'timezone', 'timezone')))) {
          subject.reasonKey = 'example.calendar.visitAvailability.retry'
          continue
        }
        const normalizedRules = rules.flatMap((row) => {
          const rrule = value(row, 'rrule', 'rrule')
          if (typeof rrule !== 'string') return []
          const kind = value(row, 'kind', 'kind')
          const exdates = value(row, 'exdates', 'exdates')
          const timezone = value(row, 'timezone', 'timezone')
          return [{ id: typeof row.id === 'string' ? row.id : undefined, rrule, timezone: timezone as string, kind: kind === 'unavailability' ? 'unavailability' as const : 'availability' as const, exdates: Array.isArray(exdates) ? exdates.filter((item): item is string => typeof item === 'string') : [] }]
        })
        if (!normalizedRules.length) {
          subject.status = 'unavailable'
          subject.reasonKey = 'example.calendar.visitAvailability.noSchedule'
          continue
        }
        const windows = planner.getMergedAvailabilityWindows({ rules: normalizedRules, range: { start, end }, respectTimezone: true, weeklyScheduleTemplate: true })
        subject.status = covers(windows, start, end) ? 'available' : 'unavailable'
        subject.reasonKey = subject.status === 'available' ? null : 'example.calendar.visitAvailability.unavailable'
      }
    } catch {
      selected.filter((subject) => subject.status === 'unknown').forEach((subject) => {
        subject.reasonKey = 'example.calendar.visitAvailability.retry'
      })
    }
  }
  return subjects
}
