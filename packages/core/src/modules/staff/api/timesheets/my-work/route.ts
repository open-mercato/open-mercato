/**
 * `GET /api/staff/timesheets/my-work` — the aggregate behind screen 1 (T5.6).
 *
 * The dashboard a Team Member lands on asks four questions at once (today, this
 * week, this month, how much of it is non-billable), then wants today's entries,
 * the projects they are on with their budget burn, and the tasks they last
 * touched. Answering that with the existing list routes would be six round trips
 * and three client-side aggregations of paginated data; this route answers it in
 * one, with the sums done by the database.
 *
 * Scoping and access:
 *
 *  * Everything is scoped to the CALLER's staff member. There is no
 *    `staffMemberId` parameter — this endpoint is "mine" by construction, so it
 *    can never become a way to read a colleague's day.
 *  * Projects come from the caller's own active memberships, which is the same
 *    set `resolveProjectAccess` would return for a non-manager. A manager sees
 *    their own memberships here too: My work is a personal surface, and the
 *    portfolio view is screen 3.
 *  * **Money is gated on `staff.timesheets.rates.view` and absent, not blanked**,
 *    for anyone else: no `hourlyRate`, no `currencyCode`, and no `amount` budget
 *    burn (which is a money statement). An `hours` budget is not money and stays.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import {
  StaffTeamMember,
  StaffTimeEntry,
  StaffTimeProject,
  StaffTimeProjectMember,
  StaffTimeTask,
} from '../../../data/entities'
import { computeProjectFinancials } from '../../../lib/timesheets-projects/computeProjectFinancials'
import { computeBudgetBurn } from '../../../lib/timesheets-projects/budgetBurn'
import {
  addUtcDays,
  getFirstDayOfMonthUtc,
  getFirstDayOfNextMonthUtc,
  getMondayUtc,
  toDateOnlyString,
} from '../../../lib/timesheets-projects/dateBuckets'
import { readTimeTrackingSettings } from '../../../lib/time-tracking/settings'
import { buildMyWorkKpis, pickRecentTaskIds, toMinutes } from './myWorkAggregate'
import {
  readSearchParamsRecord,
  runTimesheetInterceptors,
} from '../_shared/withTimesheetInterceptors'

const logger = createLogger('staff').child({ component: 'api/timesheets/my-work' })

const VIEW_FEATURE = 'staff.timesheets.view'
const RATES_FEATURE = 'staff.timesheets.rates.view'
const RECENT_TASK_LIMIT = 5
const MAX_PROJECTS = 50

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

type RbacServiceLike = {
  userHasAllFeatures?: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

const entrySchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  taskId: z.string().uuid().nullable(),
  taskTitle: z.string().nullable(),
  timeProjectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  description: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationMinutes: z.number().int(),
  isBillable: z.boolean(),
  isLocked: z.boolean(),
})

const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  color: z.string().nullable(),
  customerName: z.string().nullable(),
  myMinutes: z.number().int(),
  totalMinutes: z.number().int(),
  hourlyRate: z.number().nullable().optional(),
  currencyCode: z.string().nullable().optional(),
  budget: z
    .object({
      kind: z.enum(['hours', 'amount']),
      budgetValue: z.number(),
      usedValue: z.number(),
      percent: z.number(),
      barPercent: z.number(),
      tone: z.string(),
    })
    .nullable(),
})

const responseSchema = z.object({
  staffMember: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),
  today: z.string(),
  kpis: z.object({
    todayMinutes: z.number().int(),
    weekMinutes: z.number().int(),
    monthMinutes: z.number().int(),
    monthNonBillableMinutes: z.number().int(),
    dailyTargetMinutes: z.number().int().nullable(),
    weekTargetMinutes: z.number().int().nullable(),
    monthTargetMinutes: z.number().int().nullable(),
    weekWorkingDays: z.number().int(),
    monthWorkingDays: z.number().int(),
    nonBillableSharePercent: z.number().nullable(),
  }),
  entries: z.array(entrySchema),
  projects: z.array(projectSchema),
  recentTasks: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      timeProjectId: z.string().uuid(),
      projectName: z.string().nullable(),
    }),
  ),
})

type TotalsRow = {
  today_minutes: string | number | null
  week_minutes: string | number | null
  month_minutes: string | number | null
  month_nonbillable_minutes: string | number | null
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
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

    const em = container.resolve('em') as EntityManager
    const now = new Date()
    const todayDate = toDateOnlyString(now)
    const weekStart = getMondayUtc(now)
    const weekEnd = addUtcDays(weekStart, 6)
    const monthStart = getFirstDayOfMonthUtc(now)
    const nextMonthStart = getFirstDayOfNextMonthUtc(now)
    const monthEnd = addUtcDays(nextMonthStart, -1)

    let dailyHours: number | null = null
    try {
      const configService = container.resolve('moduleConfigService') as ModuleConfigService
      dailyHours = (await readTimeTrackingSettings(configService, { tenantId })).targets.dailyHours
    } catch {
      // A settings read failure must not empty the dashboard; the targets simply
      // go missing, which the UI already renders as "no target".
      dailyHours = null
    }

    const staffMember = await findOneWithDecryption(
      em.fork(),
      StaffTeamMember,
      { userId: auth.sub, tenantId, organizationId, deletedAt: null },
      {},
      { tenantId, organizationId },
    )

    const emptyKpis = buildMyWorkKpis(
      { todayMinutes: 0, weekMinutes: 0, monthMinutes: 0, monthNonBillableMinutes: 0 },
      {
        week: { from: toDateOnlyString(weekStart), to: toDateOnlyString(weekEnd) },
        month: { from: toDateOnlyString(monthStart), to: toDateOnlyString(monthEnd) },
      },
      dailyHours,
    )

    if (!staffMember) {
      // No staff profile yet: the shape is the same, so screen 1 renders its
      // "set up your profile" branch instead of failing.
      return session.respond(200, {
        staffMember: null,
        today: todayDate,
        kpis: emptyKpis,
        entries: [],
        projects: [],
        recentTasks: [],
      })
    }

    const rbac = container.resolve('rbacService') as RbacServiceLike
    const canSeeMoney =
      (await rbac?.userHasAllFeatures?.(auth.sub, [RATES_FEATURE], { tenantId, organizationId })) ?? false

    const totalsRows = (await em.getConnection().execute(
      `
        SELECT
          COALESCE(SUM(CASE WHEN date = ?::date THEN duration_minutes ELSE 0 END), 0)::bigint AS today_minutes,
          COALESCE(SUM(CASE WHEN date >= ?::date AND date <= ?::date THEN duration_minutes ELSE 0 END), 0)::bigint AS week_minutes,
          COALESCE(SUM(CASE WHEN date >= ?::date AND date <= ?::date THEN duration_minutes ELSE 0 END), 0)::bigint AS month_minutes,
          COALESCE(SUM(CASE WHEN date >= ?::date AND date <= ?::date AND is_billable = false THEN duration_minutes ELSE 0 END), 0)::bigint AS month_nonbillable_minutes
        FROM staff_time_entries
        WHERE tenant_id = ?
          AND organization_id = ?
          AND staff_member_id = ?
          AND deleted_at IS NULL
      `,
      [
        todayDate,
        toDateOnlyString(weekStart),
        toDateOnlyString(weekEnd),
        toDateOnlyString(monthStart),
        toDateOnlyString(monthEnd),
        toDateOnlyString(monthStart),
        toDateOnlyString(monthEnd),
        tenantId,
        organizationId,
        staffMember.id,
      ],
    )) as TotalsRow[]

    const totals = totalsRows[0]
    const kpis = buildMyWorkKpis(
      {
        todayMinutes: toMinutes(totals?.today_minutes),
        weekMinutes: toMinutes(totals?.week_minutes),
        monthMinutes: toMinutes(totals?.month_minutes),
        monthNonBillableMinutes: toMinutes(totals?.month_nonbillable_minutes),
      },
      {
        week: { from: toDateOnlyString(weekStart), to: toDateOnlyString(weekEnd) },
        month: { from: toDateOnlyString(monthStart), to: toDateOnlyString(monthEnd) },
      },
      dailyHours,
    )

    const memberships = await em.fork().find(StaffTimeProjectMember, {
      staffMemberId: staffMember.id,
      tenantId,
      organizationId,
      status: 'active',
      deletedAt: null,
    })
    const projectIds = Array.from(new Set(memberships.map((membership) => membership.timeProjectId))).slice(
      0,
      MAX_PROJECTS,
    )

    const projects =
      projectIds.length > 0
        ? await findWithDecryption(
            em.fork(),
            StaffTimeProject,
            { id: { $in: projectIds }, tenantId, organizationId, deletedAt: null },
            {},
            { tenantId, organizationId },
          )
        : []

    const hourlyRateByProjectId = new Map<string, number | null>(
      projects.map((project) => [
        project.id,
        project.hourlyRate === null || project.hourlyRate === undefined ? null : Number(project.hourlyRate),
      ]),
    )
    const [mine, everyone] = await Promise.all([
      computeProjectFinancials({
        em,
        tenantId,
        organizationId,
        projectIds: projects.map((project) => project.id),
        hourlyRateByProjectId,
        staffMemberId: staffMember.id,
      }),
      computeProjectFinancials({
        em,
        tenantId,
        organizationId,
        projectIds: projects.map((project) => project.id),
        hourlyRateByProjectId,
      }),
    ])

    const todaysEntries = await findWithDecryption(
      em.fork(),
      StaffTimeEntry,
      { staffMemberId: staffMember.id, tenantId, organizationId, date: new Date(`${todayDate}T00:00:00.000Z`), deletedAt: null },
      { orderBy: { startedAt: 'asc', createdAt: 'asc' } },
      { tenantId, organizationId },
    )

    const recentEntries = await findWithDecryption(
      em.fork(),
      StaffTimeEntry,
      {
        staffMemberId: staffMember.id,
        tenantId,
        organizationId,
        deletedAt: null,
        taskId: { $ne: null },
      },
      { orderBy: { date: 'desc' }, limit: 50 },
      { tenantId, organizationId },
    )
    const recentTaskIds = pickRecentTaskIds(
      recentEntries.map((entry) => ({
        id: entry.id,
        taskId: entry.taskId ?? null,
        date: toDateOnlyString(new Date(entry.date)),
      })),
      RECENT_TASK_LIMIT,
    )
    const referencedTaskIds = Array.from(
      new Set([
        ...recentTaskIds,
        ...todaysEntries.map((entry) => entry.taskId).filter((id): id is string => typeof id === 'string'),
      ]),
    )
    const tasks =
      referencedTaskIds.length > 0
        ? await em.fork().find(StaffTimeTask, {
            id: { $in: referencedTaskIds },
            tenantId,
            organizationId,
            deletedAt: null,
          })
        : []
    const taskById = new Map(tasks.map((task) => [task.id, task]))
    const projectNameById = new Map(projects.map((project) => [project.id, project.name]))

    const payload = {
      staffMember: { id: staffMember.id, displayName: staffMember.displayName },
      today: todayDate,
      kpis,
      entries: todaysEntries.map((entry) => ({
        id: entry.id,
        date: toDateOnlyString(new Date(entry.date)),
        taskId: entry.taskId ?? null,
        taskTitle: entry.taskId ? taskById.get(entry.taskId)?.title ?? null : null,
        timeProjectId: entry.timeProjectId ?? null,
        projectName: entry.timeProjectId ? projectNameById.get(entry.timeProjectId) ?? null : null,
        description: entry.notes ?? null,
        startedAt: entry.startedAt ? entry.startedAt.toISOString() : null,
        endedAt: entry.endedAt ? entry.endedAt.toISOString() : null,
        durationMinutes: entry.durationMinutes,
        isBillable: entry.isBillable !== false,
        isLocked: Boolean(entry.lockedReportId),
      })),
      projects: projects.map((project) => {
        const myFinancials = mine.get(project.id)
        const allFinancials = everyone.get(project.id)
        const snapshot = project.customerSnapshot ?? null
        const customerName =
          snapshot && typeof snapshot === 'object' && typeof (snapshot as { name?: unknown }).name === 'string'
            ? ((snapshot as { name?: string }).name as string)
            : null
        // An `amount` budget is a money statement, so it only exists for a caller
        // who may see money; an `hours` budget is not, and stays for everybody.
        const burn =
          project.budgetKind === 'amount' && !canSeeMoney
            ? null
            : computeBudgetBurn({
                kind: project.budgetKind,
                budgetValue:
                  project.budgetValue === null || project.budgetValue === undefined
                    ? null
                    : Number(project.budgetValue),
                warnAtPercent: project.budgetWarnAtPercent,
                totalMinutes: allFinancials?.totalMinutes ?? 0,
                cost: allFinancials?.cost ?? null,
              })
        return {
          id: project.id,
          name: project.name,
          code: project.code ?? null,
          color: project.color ?? null,
          customerName,
          myMinutes: myFinancials?.totalMinutes ?? 0,
          totalMinutes: allFinancials?.totalMinutes ?? 0,
          ...(canSeeMoney
            ? {
                hourlyRate: hourlyRateByProjectId.get(project.id) ?? null,
                currencyCode: project.currencyCode ?? null,
              }
            : {}),
          budget: burn
            ? {
                kind: burn.kind,
                budgetValue: burn.budgetValue,
                usedValue: burn.usedValue,
                percent: burn.percent,
                barPercent: burn.barPercent,
                tone: burn.tone,
              }
            : null,
        }
      }),
      recentTasks: recentTaskIds
        .map((taskId) => {
          const task = taskById.get(taskId)
          if (!task) return null
          return {
            id: task.id,
            title: task.title,
            timeProjectId: task.timeProjectId,
            projectName: projectNameById.get(task.timeProjectId) ?? null,
          }
        })
        .filter((task): task is NonNullable<typeof task> => task !== null),
    }

    return session.respond(200, payload)
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('staff.timesheets.my-work failed', { err })
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('staff.time_tracking.myWork.errors.load', 'Failed to load your work summary.') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'My work dashboard aggregate',
  methods: {
    GET: {
      summary: 'Today, this week and this month for the calling staff member',
      description:
        'One aggregate for the time tracking landing page: day/week/month/non-billable totals with working-day targets, today’s entries, the caller’s projects with budget burn, and the tasks they last logged against. Always scoped to the caller — there is no way to ask about another person. Rate and amount-budget fields are present only for holders of `staff.timesheets.rates.view`.',
      responses: [
        { status: 200, description: 'My work summary', schema: responseSchema },
        { status: 400, description: 'Missing scope', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 500, description: 'Aggregation failure', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
