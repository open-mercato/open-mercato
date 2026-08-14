import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember, StaffTimeProject } from './entities'
import { computeProjectHoursTrend } from '../lib/timesheets-projects/computeProjectHoursTrend'
import { computeProjectFinancials } from '../lib/timesheets-projects/computeProjectFinancials'
import type { ProjectBudgetKind } from '../lib/timesheets-projects/budgetBurn'
import {
  listProjectMembersPreview,
  type MemberPreview,
} from '../lib/timesheets-projects/listProjectMembersPreview'
import { computeTaskRollups, EMPTY_TASK_ROLLUP } from '../lib/timesheets-tasks/computeTaskRollups'

const MANAGE_FEATURE = 'staff.timesheets.projects.manage'
const RATES_FEATURE = 'staff.timesheets.rates.view'

type EntityRecord = Record<string, unknown> & { id: string }

type ProjectBudget = {
  kind: ProjectBudgetKind
  value: number | null
  warnAtPercent: number | null
}

type StaffEnrichment = {
  _staff: {
    hoursWeek: number
    hoursTrend: number[]
    myRole: string | null
    members?: MemberPreview[]
    memberCount?: number
    customerName?: string | null
    totalMinutes?: number
    billableMinutes?: number
    budget?: ProjectBudget
    hourlyRate?: number | null
    cost?: number | null
  }
}

const FALLBACK: StaffEnrichment = {
  _staff: {
    hoursWeek: 0,
    hoursTrend: [0, 0, 0, 0, 0, 0, 0],
    myRole: null,
  },
}

type InternalContext = EnricherContext & {
  em: EntityManager
  container: AwilixContainer
}

async function callerHasFeature(ctx: InternalContext, feature: string): Promise<boolean> {
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacService
    return await rbac.userHasAllFeatures(ctx.userId, [feature], {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  } catch {
    return false
  }
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function resolveCustomerName(snapshot: Record<string, unknown> | null | undefined): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  for (const key of ['displayName', 'name', 'companyName', 'label', 'email']) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

async function resolveCallerStaffMemberId(ctx: InternalContext): Promise<string | null> {
  const member = await findOneWithDecryption(
    ctx.em.fork(),
    StaffTeamMember,
    {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    {},
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  return member?.id ?? null
}

const portfolioEnricher: ResponseEnricher<EntityRecord, StaffEnrichment> = {
  id: 'staff.timesheets-projects-portfolio',
  targetEntity: 'staff:staff_time_project',
  // ACL is enforced by the route (`requireFeatures: ['staff.timesheets.projects.view']`).
  // Per-field gating (e.g. `members` for manage-only) happens inline below via rbacService.
  priority: 10,
  timeout: 3000,
  critical: false,
  fallback: FALLBACK,

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context) {
    if (records.length === 0) return records as (EntityRecord & StaffEnrichment)[]

    const ctx = context as InternalContext
    const projectIds = records.map((r) => r.id)

    const [callerStaffMemberId, hasManage, hasRates] = await Promise.all([
      resolveCallerStaffMemberId(ctx),
      callerHasFeature(ctx, MANAGE_FEATURE),
      callerHasFeature(ctx, RATES_FEATURE),
    ])
    const ownEntriesOnly = hasManage ? null : callerStaffMemberId

    const projects = await ctx.em.fork().find(StaffTimeProject, {
      id: { $in: projectIds },
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    })
    const projectById = new Map(projects.map((project) => [project.id, project]))
    const hourlyRateByProjectId = new Map(
      projects.map((project) => [project.id, toNullableNumber(project.hourlyRate)]),
    )

    const [trendMap, membersMap, financialsMap] = await Promise.all([
      computeProjectHoursTrend({
        em: ctx.em,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        projectIds,
        staffMemberId: ownEntriesOnly,
      }),
      listProjectMembersPreview({
        em: ctx.em,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        projectIds,
        callerStaffMemberId,
      }),
      computeProjectFinancials({
        em: ctx.em.fork(),
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        projectIds,
        hourlyRateByProjectId,
        staffMemberId: ownEntriesOnly,
      }),
    ])

    return records.map((record) => {
      const trend = trendMap.get(record.id) ?? {
        hoursWeek: 0,
        hoursTrend: [0, 0, 0, 0, 0, 0, 0],
      }
      const members = membersMap.get(record.id)
      const financials = financialsMap.get(record.id)
      const project = projectById.get(record.id)
      const enrichment: StaffEnrichment['_staff'] = {
        hoursWeek: trend.hoursWeek,
        hoursTrend: trend.hoursTrend,
        myRole: members?.myRole ?? null,
        customerName: resolveCustomerName(project?.customerSnapshot),
        totalMinutes: financials?.totalMinutes ?? 0,
        billableMinutes: financials?.billableMinutes ?? 0,
        budget: {
          kind: project?.budgetKind ?? 'none',
          value: toNullableNumber(project?.budgetValue),
          warnAtPercent: project?.budgetWarnAtPercent ?? null,
        },
      }
      if (hasManage && members) {
        enrichment.members = members.preview
        enrichment.memberCount = members.total
      }
      if (hasRates) {
        enrichment.hourlyRate = toNullableNumber(project?.hourlyRate)
        enrichment.cost = financials?.cost ?? null
      }
      return { ...record, _staff: enrichment }
    })
  },
}

/**
 * `ownMinutes` is this task's own entries; `loggedMinutes` is the inclusive rollup
 * (own + every child's), which is what every hours display shows (D-2).
 *
 * The two names are the guard against risk R10: a caller that sums parent and child
 * `loggedMinutes` double-counts, because the parent's figure already contains the
 * child's. `ownMinutes` is the field to sum when a total spans both levels.
 *
 * These land at the top level rather than under the usual `_staff` namespace.
 * The namespace exists so one module's enrichment cannot collide with another's
 * fields — here staff enriches its own entity, and the spec fixes these exact names as
 * the task contract. Publishing the same number twice, under two paths, is precisely
 * the ambiguity D-2 removes.
 */
type TaskRollupEnrichment = {
  ownMinutes: number
  loggedMinutes: number
  childCount: number
  /**
   * How many of those children sit in a done column (D-2). Published beside
   * `childCount` so `3/5` is readable from the row itself — deriving it costs a
   * page of child rows per opened task, for a number the same aggregate knows.
   */
  doneChildCount: number
}

const taskRollupEnricher: ResponseEnricher<EntityRecord, TaskRollupEnrichment> = {
  id: 'staff.timesheets-tasks-rollup',
  targetEntity: 'staff:staff_time_task',
  // ACL is enforced by the route (`requireFeatures: ['staff.timesheets.tasks.view']`),
  // which also intersects the page with the caller's project access; the aggregate
  // narrows entries to the projects of that already-filtered page.
  priority: 10,
  timeout: 3000,
  critical: false,
  fallback: { ...EMPTY_TASK_ROLLUP },
  // Minutes come from `staff_time_entries`, a table the task list cache never
  // invalidates on, so the rollup must be recomputed on every hit.
  cacheableOnListHit: false,

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context) {
    if (records.length === 0) return records as (EntityRecord & TaskRollupEnrichment)[]

    const ctx = context as InternalContext
    const rollups = await computeTaskRollups({
      em: ctx.em.fork(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      taskIds: records.map((record) => record.id).filter((id): id is string => typeof id === 'string'),
    })

    return records.map((record) => ({ ...record, ...(rollups.get(record.id) ?? EMPTY_TASK_ROLLUP) }))
  },
}

/**
 * The tags a task carries, as ids and as renderable chips.
 *
 * `tagIds` is the contract the board and the drawer read: the board resolves the
 * labels once per page through `/api/staff/timesheets/tags?ids=`, so it needs
 * nothing but the ids, while a surface with no such lookup can render `tags`
 * directly. Both come from the same row, so publishing the second costs nothing.
 *
 * Without this, a tag assigned to a task is invisible to every reader — the
 * assignment route only writes — so the drawer could add a tag it could never
 * show or remove.
 */
type TaskTagSummary = {
  id: string
  slug: string
  label: string
  color: string | null
}

type TaskTagEnrichment = {
  tagIds: string[]
  tags: TaskTagSummary[]
}

const EMPTY_TASK_TAGS: TaskTagEnrichment = { tagIds: [], tags: [] }

type TaskTagRow = {
  task_id: string
  tag_id: string
  slug: string | null
  label: string | null
  color: string | null
}

/**
 * One join per page, never one per card: the assignment table is filtered by the
 * page's already-access-filtered task ids, and the tag row travels with it rather
 * than costing a second lookup.
 */
async function loadTaskTags(
  em: EntityManager,
  taskIds: readonly string[],
  tenantId: string,
  organizationId: string,
): Promise<Map<string, TaskTagEnrichment>> {
  const byTaskId = new Map<string, TaskTagEnrichment>()
  const ids = [...new Set(taskIds)].filter((id) => typeof id === 'string' && id.length > 0)
  if (ids.length === 0) return byTaskId

  const placeholders = ids.map(() => '?').join(', ')
  const sql = `
    SELECT
      tt.task_id,
      tt.tag_id,
      tg.slug,
      tg.label,
      tg.color
    FROM staff_time_task_tags tt
    JOIN staff_time_tags tg
      ON tg.id = tt.tag_id
     AND tg.tenant_id = tt.tenant_id
     AND tg.organization_id = tt.organization_id
     AND tg.deleted_at IS NULL
    WHERE tt.tenant_id = ?
      AND tt.organization_id = ?
      AND tt.task_id IN (${placeholders})
    ORDER BY tg.label ASC, tg.id ASC
  `

  const rows = (await em.getConnection().execute(sql, [tenantId, organizationId, ...ids])) as TaskTagRow[]
  for (const row of rows) {
    if (typeof row.task_id !== 'string' || typeof row.tag_id !== 'string') continue
    const bucket = byTaskId.get(row.task_id) ?? { tagIds: [], tags: [] }
    if (bucket.tagIds.includes(row.tag_id)) continue
    bucket.tagIds.push(row.tag_id)
    bucket.tags.push({
      id: row.tag_id,
      slug: row.slug ?? '',
      label: row.label ?? row.tag_id,
      color: row.color ?? null,
    })
    byTaskId.set(row.task_id, bucket)
  }
  return byTaskId
}

const taskTagEnricher: ResponseEnricher<EntityRecord, TaskTagEnrichment> = {
  id: 'staff.timesheets-tasks-tags',
  targetEntity: 'staff:staff_time_task',
  // ACL is enforced by the route (`requireFeatures: ['staff.timesheets.tasks.view']`),
  // which also intersects the page with `resolveProjectAccess`; the join is keyed by
  // that already-filtered page, so a tag can only be read through a task the caller
  // may already see.
  priority: 10,
  timeout: 3000,
  critical: false,
  fallback: { ...EMPTY_TASK_TAGS },
  // Assignments live in `staff_time_task_tags`, a table the task list cache never
  // invalidates on, so the chips must be re-read on every hit.
  cacheableOnListHit: false,

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context) {
    if (records.length === 0) return records as (EntityRecord & TaskTagEnrichment)[]

    const ctx = context as InternalContext
    if (!ctx.tenantId || !ctx.organizationId) {
      return records.map((record) => ({ ...record, tagIds: [], tags: [] }))
    }

    const tagsByTaskId = await loadTaskTags(
      ctx.em.fork(),
      records.map((record) => record.id).filter((id): id is string => typeof id === 'string'),
      ctx.tenantId,
      ctx.organizationId,
    )

    return records.map((record) => {
      const assigned = tagsByTaskId.get(record.id)
      return { ...record, tagIds: assigned?.tagIds ?? [], tags: assigned?.tags ?? [] }
    })
  },
}

export const enrichers: ResponseEnricher[] = [portfolioEnricher, taskRollupEnricher, taskTagEnricher]

export default enrichers
