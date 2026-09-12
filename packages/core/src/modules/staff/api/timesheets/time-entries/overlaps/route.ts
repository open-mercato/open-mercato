import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { StaffTimeEntry, StaffTimeProject, StaffTimeTask } from '../../../../data/entities'
import { deriveInterval, formatClock, parseClock } from '../../../../lib/time-tracking/interval'
import {
  evaluateOverlapPolicies,
  findOverlaps,
  type OverlapSpan,
} from '../../../../lib/time-tracking/overlap'
import { resolveFeatureAccess } from '../../../../lib/time-tracking/featureAccess'
import {
  MANAGE_PROJECTS_FEATURE,
  assertProjectAccess,
  resolveProjectAccess,
} from '../../../../lib/time-tracking/access'
import { readTimeTrackingSettings } from '../../../../lib/time-tracking/settings'
import {
  readSearchParamsRecord,
  runTimesheetInterceptors,
} from '../../_shared/withTimesheetInterceptors'

const logger = createLogger('staff').child({ component: 'api/timesheets/time-entries/overlaps' })

const VIEW_FEATURE = 'staff.timesheets.view'
const MANAGE_ALL_FEATURE = 'staff.timesheets.manage_all'

/**
 * Upper bound for the day-window scan. One staff member can only hold a handful
 * of entries across three days, so this is a guard against pathological data
 * rather than a paging contract.
 */
const MAX_WINDOW_ROWS = 500

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})/

const querySchema = z.object({
  date: z.string().regex(DATE_PATTERN),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  durationMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  excludeId: z.string().uuid().optional(),
  staffMemberId: z.string().uuid().optional(),
})

const overlapItemSchema = z.object({
  id: z.string().uuid(),
  staff_member_id: z.string().uuid(),
  date: z.string(),
  started_at: z.string(),
  ended_at: z.string(),
  duration_minutes: z.number(),
  overlap_minutes: z.number(),
  crosses_midnight: z.boolean(),
  task_id: z.string().uuid().nullable(),
  task_title: z.string().nullable(),
  time_project_id: z.string().uuid().nullable(),
  project_name: z.string().nullable(),
  notes: z.string().nullable(),
})

const overlapsResponseSchema = z.object({
  items: z.array(overlapItemSchema),
  total: z.number(),
  /**
   * EP-38. `warn` is what this route has always meant; the field exists so a
   * contributed policy that escalates to `block` reaches the form, and so a
   * caller can tell "the tenant turned the warning off" from "nothing overlaps".
   */
  decision: z.enum(['allow', 'warn', 'block']),
})

type OverlapItem = z.infer<typeof overlapItemSchema>

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

type EntryRow = Pick<
  StaffTimeEntry,
  | 'id'
  | 'staffMemberId'
  | 'durationMinutes'
  | 'startedAt'
  | 'endedAt'
  | 'notes'
  | 'taskId'
  | 'timeProjectId'
> & { date: unknown }

const EMPTY_OVERLAP_RESULT = { items: [], total: 0, decision: 'allow' as const }

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatLocalDate(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

function toDayString(value: unknown): string | null {
  if (typeof value === 'string') {
    const match = DATE_PREFIX_PATTERN.exec(value.trim())
    return match ? match[1] : null
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatLocalDate(value)
  return null
}

/**
 * Accepts either a wall clock (`11:45`, what the entry form sends) or a full
 * timestamp (what the timer endpoints persist), and always answers in the
 * calendar the rest of the module reads dates in.
 */
function toClock(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return formatClock(value.getHours() * 60 + value.getMinutes())
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const clock = parseClock(trimmed)
  if (clock !== null) return formatClock(clock)
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null
  return formatClock(parsed.getHours() * 60 + parsed.getMinutes())
}

function toRowSpan(row: EntryRow): OverlapSpan | null {
  const start = toClock(row.startedAt)
  if (!start) return null
  const date =
    (row.startedAt instanceof Date && !Number.isNaN(row.startedAt.getTime())
      ? formatLocalDate(row.startedAt)
      : null) ?? toDayString(row.date)
  if (!date) return null
  return {
    id: row.id,
    date,
    start,
    end: toClock(row.endedAt),
    durationMinutes: typeof row.durationMinutes === 'number' ? row.durationMinutes : null,
  }
}

function readQuery(params: URLSearchParams): z.infer<typeof querySchema> {
  const raw: Record<string, string> = {}
  for (const key of ['date', 'startedAt', 'endedAt', 'durationMinutes', 'excludeId', 'staffMemberId']) {
    const value = params.get(key)
    if (value !== null && value.trim().length > 0) raw[key] = value.trim()
  }
  return querySchema.parse(raw)
}

async function resolveGrantedFeatures(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  userId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<string[]> {
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return []
    return (await rbac.getGrantedFeatures(userId, scope)) ?? []
  } catch {
    return []
  }
}

async function resolveOverlapSettings(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  tenantId: string,
): Promise<{ assignmentGraceDays: number | null; warningsEnabled: boolean }> {
  try {
    const configService = container.resolve('moduleConfigService') as ModuleConfigService
    const settings = await readTimeTrackingSettings(configService, { tenantId })
    return {
      assignmentGraceDays: settings.access.assignmentGraceDays,
      warningsEnabled: settings.warnings.overlap,
    }
  } catch {
    // The same fail-safe the grace window uses: an unreadable settings row keeps
    // the advisory warning on, which is what the module default says.
    return { assignmentGraceDays: null, warningsEnabled: true }
  }
}

async function loadLabels(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  taskIds: string[],
  projectIds: string[],
): Promise<{ tasks: Map<string, string>; projects: Map<string, string> }> {
  const tasks = new Map<string, string>()
  const projects = new Map<string, string>()
  if (taskIds.length) {
    const rows = await findWithDecryption(
      em,
      StaffTimeTask,
      { id: { $in: taskIds }, ...scope, deletedAt: null },
      {},
      scope,
    )
    for (const row of rows) tasks.set(row.id, row.title)
  }
  if (projectIds.length) {
    const rows = await findWithDecryption(
      em,
      StaffTimeProject,
      { id: { $in: projectIds }, ...scope, deletedAt: null },
      {},
      scope,
    )
    for (const row of rows) projects.set(row.id, row.name)
  }
  return { tasks, projects }
}

/**
 * GET /api/staff/timesheets/time-entries/overlaps
 *
 * Advisory-only overlap probe for the time entry form (mockup screen 9). It is
 * read-only and never blocks a save: overlapping time is legitimate in
 * consulting work (a client call while taking notes), so the UI renders the
 * result as a warning with a suggested fix, never as a validation error. Any
 * failure here MUST degrade to "no warning" rather than break the form — the
 * route therefore answers `{ items: [], total: 0 }` for unusable input, a
 * caller without a linked staff member, or a lookup that yields nothing, and
 * the client is expected to ignore non-200 responses.
 *
 * Scoping: rows are always filtered by `tenant_id` + `organization_id` and
 * intersected with `resolveProjectAccess`, so the endpoint cannot be used to
 * probe entries on projects the caller cannot see. Asking about another staff
 * member requires `staff.timesheets.manage_all`; without it the request is
 * silently scoped back to the caller's own member instead of erroring.
 *
 * Query shape: the form calls this on blur, so the lookup reads a three-day
 * window (`date - 1 .. date + 1`) against the
 * `(organization_id, staff_member_id, date, started_at)` index. The adjacent
 * days cover midnight-crossing spans in both directions — a candidate that ends
 * after midnight, and a stored entry that started the previous evening — without
 * ever scanning history.
 */
export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
    }

    const orgScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = orgScope?.tenantId ?? auth.tenantId ?? null
    const organizationId = orgScope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, {
        error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
      })
    }

    const interceptors = await runTimesheetInterceptors({
      request: req,
      method: 'GET',
      scope: { container, userId: auth.sub, tenantId, organizationId },
      query: readSearchParamsRecord(req.url),
    })
    if (!interceptors.ok) return interceptors.response
    const { session } = interceptors

    const query = readQuery(session.searchParams)
    const candidate: OverlapSpan = {
      date: query.date,
      start: toClock(query.startedAt),
      end: toClock(query.endedAt),
      durationMinutes: query.durationMinutes ?? null,
    }
    const derived = deriveInterval({
      start: candidate.start,
      end: candidate.end,
      durationMinutes: candidate.durationMinutes,
    })
    if (!derived.start || derived.durationMinutes === null || derived.durationMinutes <= 0) {
      return session.respond(200, EMPTY_OVERLAP_RESULT)
    }

    const scope = { tenantId, organizationId }
    const em = (container.resolve('em') as EntityManager).fork()
    const userId = typeof auth.sub === 'string' ? auth.sub : null
    // Both questions go to the service. Asking one and inferring the other from a
    // grant array is how the two could disagree when the read failed.
    const manageAll = await resolveFeatureAccess(container, userId, [MANAGE_ALL_FEATURE], scope)
    const manageProjects = await resolveFeatureAccess(container, userId, [MANAGE_PROJECTS_FEATURE], scope)
    const canManageAll = manageAll.allowed

    const overlapSettings = await resolveOverlapSettings(container, tenantId)
    const access = await resolveProjectAccess({
      em,
      userId,
      tenantId,
      organizationId,
      canManageAll: manageProjects.allowed,
      userFeatures: manageAll.grantedFeatures,
      assignmentGraceDays: overlapSettings.assignmentGraceDays,
    })

    const staffMemberId =
      canManageAll && query.staffMemberId ? query.staffMemberId : access.staffMemberId
    if (!staffMemberId) return session.respond(200, EMPTY_OVERLAP_RESULT)
    const isSelfScope = staffMemberId === access.staffMemberId

    const where = {
      tenantId,
      organizationId,
      staffMemberId,
      deletedAt: null,
      date: { $gte: shiftDate(query.date, -1), $lte: shiftDate(query.date, 1) },
    } as unknown as FilterQuery<StaffTimeEntry>
    const rows = (await findWithDecryption(
      em,
      StaffTimeEntry,
      where,
      { orderBy: { startedAt: 'asc' }, limit: MAX_WINDOW_ROWS },
      scope,
    )) as unknown as EntryRow[]

    const visible = rows.filter(
      (row) =>
        assertProjectAccess(access, row.timeProjectId ?? null) ||
        (isSelfScope && !row.timeProjectId),
    )
    const byId = new Map(visible.map((row) => [row.id, row]))
    const spans = visible
      .map((row) => toRowSpan(row))
      .filter((span): span is OverlapSpan => span !== null)

    const candidateSpan: OverlapSpan = {
      date: query.date,
      start: derived.start,
      end: derived.end,
      durationMinutes: derived.durationMinutes,
    }
    const overlaps = findOverlaps(
      candidateSpan,
      spans,
      query.excludeId ? { excludeId: query.excludeId } : undefined,
    )
    const decision = evaluateOverlapPolicies(overlaps, {
      tenantId,
      organizationId,
      candidate: candidateSpan,
      warningsEnabled: overlapSettings.warningsEnabled,
      staffMemberId,
      excludeId: query.excludeId ?? null,
    })
    // The item list is unchanged by the policy: this endpoint answers "what
    // intersects", and `decision` answers "and what should happen". Collapsing
    // the list when a tenant turns the warning off would make the two
    // indistinguishable from "nothing intersects" for every other caller.
    if (!overlaps.length) return session.respond(200, { ...EMPTY_OVERLAP_RESULT, decision })

    const taskIds = new Set<string>()
    const projectIds = new Set<string>()
    for (const overlap of overlaps) {
      const row = overlap.id ? byId.get(overlap.id) : undefined
      if (row?.taskId) taskIds.add(row.taskId)
      if (row?.timeProjectId) projectIds.add(row.timeProjectId)
    }
    const labels = await loadLabels(em, scope, [...taskIds], [...projectIds])

    const items: OverlapItem[] = []
    for (const overlap of overlaps) {
      const row = overlap.id ? byId.get(overlap.id) : undefined
      if (!row) continue
      const interval = deriveInterval({
        start: overlap.entry.start,
        end: overlap.entry.end,
        durationMinutes: overlap.entry.durationMinutes,
      })
      items.push({
        id: row.id,
        staff_member_id: row.staffMemberId,
        date: overlap.entry.date,
        started_at: interval.start ?? '',
        ended_at: interval.end ?? '',
        duration_minutes: interval.durationMinutes ?? 0,
        overlap_minutes: overlap.overlapMinutes,
        crosses_midnight: interval.crossesMidnight,
        task_id: row.taskId ?? null,
        task_title: row.taskId ? labels.tasks.get(row.taskId) ?? null : null,
        time_project_id: row.timeProjectId ?? null,
        project_name: row.timeProjectId ? labels.projects.get(row.timeProjectId) ?? null : null,
        notes: row.notes ?? null,
      })
    }

    return session.respond(200, { items, total: items.length, decision })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('staff.errors.invalid_request', 'Invalid request'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('staff.timesheets.time-entries.overlaps GET failed', { err })
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Advisory time entry overlap check',
  methods: {
    GET: {
      summary: 'List time entries overlapping a candidate span',
      description:
        'Advisory, read-only lookup used by the time entry form to warn about conflicting entries. Overlapping time is allowed, so the result never blocks a save. Returns an empty list when the supplied time information is insufficient. Checking another staff member requires staff.timesheets.manage_all; without it the request is silently scoped to the caller.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Overlapping entries', schema: overlapsResponseSchema },
        { status: 400, description: 'Invalid query or missing scope', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
