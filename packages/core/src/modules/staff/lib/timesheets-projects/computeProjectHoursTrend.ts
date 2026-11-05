import type { EntityManager } from '@mikro-orm/postgresql'
import { addUtcDays, getLastNWeekStarts, toDateOnlyString } from './dateBuckets'

export type HoursTrendScope = {
  em: EntityManager
  organizationId: string
  tenantId: string
  projectIds: string[]
  weekCount?: number
  staffMemberId?: string | null
  now?: Date
}

export type ProjectHoursTrend = {
  hoursWeek: number
  hoursTrend: number[]
}

const DEFAULT_WEEK_COUNT = 7

export async function computeProjectHoursTrend(
  scope: HoursTrendScope,
): Promise<Map<string, ProjectHoursTrend>> {
  const weekCount = scope.weekCount ?? DEFAULT_WEEK_COUNT
  const now = scope.now ?? new Date()
  const weekStarts = getLastNWeekStarts(weekCount, now)
  const oldestStart = weekStarts[0]
  const endExclusive = addUtcDays(weekStarts[weekStarts.length - 1], 7)

  const result = new Map<string, ProjectHoursTrend>()
  for (const id of scope.projectIds) {
    result.set(id, { hoursWeek: 0, hoursTrend: new Array(weekCount).fill(0) })
  }

  if (scope.projectIds.length === 0) return result

  const memberFilter = scope.staffMemberId ? 'AND staff_member_id = ?' : ''
  const projectPlaceholders = scope.projectIds.map(() => '?').join(', ')
  const params: unknown[] = [
    scope.organizationId,
    scope.tenantId,
    ...scope.projectIds,
    toDateOnlyString(oldestStart),
    toDateOnlyString(endExclusive),
  ]
  if (scope.staffMemberId) params.push(scope.staffMemberId)

  const sql = `
    SELECT
      time_project_id AS project_id,
      date_trunc('week', date)::date AS week_start,
      COALESCE(SUM(duration_minutes), 0)::bigint AS total_minutes
    FROM staff_time_entries
    WHERE organization_id = ?
      AND tenant_id = ?
      AND time_project_id IN (${projectPlaceholders})
      AND deleted_at IS NULL
      AND date >= ?
      AND date < ?
      ${memberFilter}
    GROUP BY 1, 2
  `

  type Row = { project_id: string; week_start: Date | string; total_minutes: string | number }
  const rows = (await scope.em.getConnection().execute(sql, params)) as Row[]

  const weekIndex = new Map<string, number>()
  weekStarts.forEach((d, idx) => weekIndex.set(toDateOnlyString(d), idx))

  for (const row of rows) {
    const bucket = result.get(row.project_id)
    if (!bucket) continue
    const weekKey =
      typeof row.week_start === 'string'
        ? row.week_start.slice(0, 10)
        : toDateOnlyString(row.week_start)
    const idx = weekIndex.get(weekKey)
    if (idx === undefined) continue
    const minutes = typeof row.total_minutes === 'string' ? Number(row.total_minutes) : row.total_minutes
    const hours = Math.round((minutes / 60) * 10) / 10
    bucket.hoursTrend[idx] = hours
  }

  for (const bucket of result.values()) {
    bucket.hoursWeek = bucket.hoursTrend[bucket.hoursTrend.length - 1] ?? 0
  }

  return result
}
