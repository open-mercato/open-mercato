import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTimeProject, StaffTimeProjectMember } from '../../data/entities'
import {
  addUtcDays,
  getFirstDayOfMonthUtc,
  getFirstDayOfNextMonthUtc,
  getMondayUtc,
  toDateOnlyString,
} from './dateBuckets'

type WeekRow = { bucket: 'current' | 'previous'; total_minutes: string | number }

export type KpiScope = {
  em: EntityManager
  organizationId: string
  tenantId: string
  now?: Date
}

export type KpiDelta = {
  current: number
  previous: number
  deltaPct: number | null
}

export type ProjectKpisPmResult = {
  role: 'pm'
  totals: { total: number; active: number; onHold: number; completed: number }
  hoursWeek: KpiDelta
  hoursMonth: KpiDelta
  teamActive: { count: number }
  assignedToMe: { total: number; active: number }
}

export type ProjectKpisCollabResult = {
  role: 'collab'
  myProjects: { total: number; active: number }
  myHoursWeek: KpiDelta
  myHoursMonth: KpiDelta
}

function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100 * 10) / 10
}

function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10
}

export async function computePmProjectsKpis(
  scope: KpiScope & { callerStaffMemberId?: string | null },
): Promise<ProjectKpisPmResult> {
  const em = scope.em.fork()
  const now = scope.now ?? new Date()

  const projects = await em.find(StaffTimeProject, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })

  const totals = {
    total: projects.length,
    active: 0,
    onHold: 0,
    completed: 0,
  }
  for (const p of projects) {
    if (p.status === 'active') totals.active += 1
    else if (p.status === 'on_hold') totals.onHold += 1
    else if (p.status === 'completed') totals.completed += 1
  }

  const monthStart = getFirstDayOfMonthUtc(now)
  const nextMonthStart = getFirstDayOfNextMonthUtc(now)
  const prevMonthStart = getFirstDayOfMonthUtc(addUtcDays(monthStart, -1))
  const weekMonday = getMondayUtc(now)
  const nextMonday = addUtcDays(weekMonday, 7)
  const prevMonday = addUtcDays(weekMonday, -7)

  const hoursRows = (await em.getConnection().execute(
    `
      SELECT bucket, COALESCE(SUM(duration_minutes), 0)::bigint AS total_minutes
      FROM (
        SELECT
          CASE
            WHEN date >= ?::date AND date < ?::date THEN 'current'
            WHEN date >= ?::date AND date < ?::date THEN 'previous'
          END AS bucket,
          duration_minutes
        FROM staff_time_entries
        WHERE organization_id = ?
          AND tenant_id = ?
          AND deleted_at IS NULL
          AND date >= ?::date
          AND date < ?::date
      ) t
      WHERE bucket IS NOT NULL
      GROUP BY bucket
    `,
    [
      toDateOnlyString(monthStart),
      toDateOnlyString(nextMonthStart),
      toDateOnlyString(prevMonthStart),
      toDateOnlyString(monthStart),
      scope.organizationId,
      scope.tenantId,
      toDateOnlyString(prevMonthStart),
      toDateOnlyString(nextMonthStart),
    ],
  )) as WeekRow[]

  const weekRows = (await em.getConnection().execute(
    `
      SELECT bucket, COALESCE(SUM(duration_minutes), 0)::bigint AS total_minutes
      FROM (
        SELECT
          CASE
            WHEN date >= ?::date AND date < ?::date THEN 'current'
            WHEN date >= ?::date AND date < ?::date THEN 'previous'
          END AS bucket,
          duration_minutes
        FROM staff_time_entries
        WHERE organization_id = ?
          AND tenant_id = ?
          AND deleted_at IS NULL
          AND date >= ?::date
          AND date < ?::date
      ) t
      WHERE bucket IS NOT NULL
      GROUP BY bucket
    `,
    [
      toDateOnlyString(weekMonday),
      toDateOnlyString(nextMonday),
      toDateOnlyString(prevMonday),
      toDateOnlyString(weekMonday),
      scope.organizationId,
      scope.tenantId,
      toDateOnlyString(prevMonday),
      toDateOnlyString(nextMonday),
    ],
  )) as WeekRow[]

  let currentHours = 0
  let previousHours = 0
  for (const row of hoursRows) {
    const minutes = typeof row.total_minutes === 'string' ? Number(row.total_minutes) : row.total_minutes
    if (row.bucket === 'current') currentHours = minutesToHours(minutes)
    else previousHours = minutesToHours(minutes)
  }

  let weekCurrentHours = 0
  let weekPreviousHours = 0
  for (const row of weekRows) {
    const minutes = typeof row.total_minutes === 'string' ? Number(row.total_minutes) : row.total_minutes
    if (row.bucket === 'current') weekCurrentHours = minutesToHours(minutes)
    else weekPreviousHours = minutesToHours(minutes)
  }

  const teamRows = (await em.getConnection().execute(
    `
      SELECT COUNT(DISTINCT staff_member_id)::bigint AS count
      FROM staff_time_entries
      WHERE organization_id = ?
        AND tenant_id = ?
        AND deleted_at IS NULL
        AND date >= ?::date
        AND date < ?::date
    `,
    [
      scope.organizationId,
      scope.tenantId,
      toDateOnlyString(monthStart),
      toDateOnlyString(nextMonthStart),
    ],
  )) as Array<{ count: string | number }>
  const teamCount = teamRows.length ? Number(teamRows[0].count) : 0

  const assignedToMe = { total: 0, active: 0 }
  if (scope.callerStaffMemberId) {
    const memberships = await em.find(StaffTimeProjectMember, {
      staffMemberId: scope.callerStaffMemberId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: 'active',
      deletedAt: null,
    })
    const assignedProjectIds = memberships.map((m) => m.timeProjectId)
    const assignedProjects = projects.filter((p) => assignedProjectIds.includes(p.id))
    assignedToMe.total = assignedProjects.length
    assignedToMe.active = assignedProjects.filter((p) => p.status === 'active').length
  }

  return {
    role: 'pm',
    totals,
    hoursWeek: {
      current: weekCurrentHours,
      previous: weekPreviousHours,
      deltaPct: deltaPct(weekCurrentHours, weekPreviousHours),
    },
    hoursMonth: {
      current: currentHours,
      previous: previousHours,
      deltaPct: deltaPct(currentHours, previousHours),
    },
    teamActive: { count: teamCount },
    assignedToMe,
  }
}

export async function computeCollabProjectsKpis(
  scope: KpiScope & { staffMemberId: string },
): Promise<ProjectKpisCollabResult> {
  const em = scope.em.fork()
  const now = scope.now ?? new Date()

  const memberships = await em.find(StaffTimeProjectMember, {
    staffMemberId: scope.staffMemberId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'active',
    deletedAt: null,
  })

  const projectIds = memberships.map((m) => m.timeProjectId)
  const myProjects = { total: projectIds.length, active: 0 }

  if (projectIds.length > 0) {
    const projects = await em.find(StaffTimeProject, {
      id: { $in: projectIds },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: 'active',
      deletedAt: null,
    })
    myProjects.active = projects.length
  }

  const weekMonday = getMondayUtc(now)
  const nextMonday = addUtcDays(weekMonday, 7)
  const prevMonday = addUtcDays(weekMonday, -7)

  const monthStart = getFirstDayOfMonthUtc(now)
  const nextMonthStart = getFirstDayOfNextMonthUtc(now)
  const prevMonthStart = getFirstDayOfMonthUtc(addUtcDays(monthStart, -1))

  const rows = (await em.getConnection().execute(
    `
      SELECT bucket, COALESCE(SUM(duration_minutes), 0)::bigint AS total_minutes
      FROM (
        SELECT
          CASE
            WHEN date >= ?::date AND date < ?::date THEN 'week_current'
            WHEN date >= ?::date AND date < ?::date THEN 'week_previous'
            WHEN date >= ?::date AND date < ?::date THEN 'month_current'
            WHEN date >= ?::date AND date < ?::date THEN 'month_previous'
          END AS bucket,
          duration_minutes
        FROM staff_time_entries
        WHERE organization_id = ?
          AND tenant_id = ?
          AND staff_member_id = ?
          AND deleted_at IS NULL
          AND date >= LEAST(?::date, ?::date)
          AND date < GREATEST(?::date, ?::date)
      ) t
      WHERE bucket IS NOT NULL
      GROUP BY bucket
    `,
    [
      toDateOnlyString(weekMonday),
      toDateOnlyString(nextMonday),
      toDateOnlyString(prevMonday),
      toDateOnlyString(weekMonday),
      toDateOnlyString(monthStart),
      toDateOnlyString(nextMonthStart),
      toDateOnlyString(prevMonthStart),
      toDateOnlyString(monthStart),
      scope.organizationId,
      scope.tenantId,
      scope.staffMemberId,
      toDateOnlyString(prevMonday),
      toDateOnlyString(prevMonthStart),
      toDateOnlyString(nextMonday),
      toDateOnlyString(nextMonthStart),
    ],
  )) as Array<{ bucket: string; total_minutes: string | number }>

  let weekCurrent = 0
  let weekPrevious = 0
  let monthCurrent = 0
  let monthPrevious = 0
  for (const row of rows) {
    const minutes = typeof row.total_minutes === 'string' ? Number(row.total_minutes) : row.total_minutes
    const hours = minutesToHours(minutes)
    if (row.bucket === 'week_current') weekCurrent = hours
    else if (row.bucket === 'week_previous') weekPrevious = hours
    else if (row.bucket === 'month_current') monthCurrent = hours
    else if (row.bucket === 'month_previous') monthPrevious = hours
  }

  return {
    role: 'collab',
    myProjects,
    myHoursWeek: {
      current: weekCurrent,
      previous: weekPrevious,
      deltaPct: deltaPct(weekCurrent, weekPrevious),
    },
    myHoursMonth: {
      current: monthCurrent,
      previous: monthPrevious,
      deltaPct: deltaPct(monthCurrent, monthPrevious),
    },
  }
}

export { deltaPct as __testDeltaPct, minutesToHours as __testMinutesToHours }
