import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import {
  StaffTeamMember,
  StaffTimeProject,
  StaffTimeReport,
  StaffTimeReportEntry,
  StaffTimeReportEvent,
  StaffTimeTask,
  StaffTimeTaskStatus,
} from './entities'
import { decorateTimeEntryRows } from '../lib/timesheets/timeEntryDecoration'
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

/**
 * The CRUD factory looks an enricher up by the `enrichers.entityId` its route
 * declares — the colon form, `staff:staff_time_entry`. The query engine looks the
 * same enricher up by the query entity id with `:` replaced by `.`
 * (`entityIdToEventEntity`, `query-extension-runner.ts`), so an enricher that only
 * declares the colon form never participates in a query-engine pipeline no matter
 * what its `queryEngine` config says.
 *
 * `withQueryEngineSurface` publishes a second registry entry for the same enricher
 * under the dot form, carrying the query-engine opt-in. The two entries never both
 * match one lookup — the API surface asks for the colon form and the query-engine
 * surface asks for the dot form — so nothing runs twice.
 */
function withQueryEngineSurface<TRecord, TEnriched>(
  enricher: ResponseEnricher<TRecord, TEnriched>,
): ResponseEnricher<TRecord, TEnriched> {
  return {
    ...enricher,
    id: `${enricher.id}.query-engine`,
    targetEntity: enricher.targetEntity.replace(/:/g, '.'),
    queryEngine: { enabled: true },
  }
}

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

/**
 * Second line of defence behind the write-side denormalization: a row written
 * before the commands derived the snapshot — or by any path that bypassed them —
 * still carries the FK, so the name is read live for exactly those projects,
 * in one scoped query for the page rather than one per row. A customers module
 * that is absent degrades to no name, never to a failed list.
 */
async function loadCustomerNames(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  customerIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const ids = [...new Set(customerIds)]
  if (ids.length === 0) return names
  try {
    const customers = await findWithDecryption(
      em,
      CustomerEntity,
      { id: { $in: ids }, tenantId, organizationId, deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )
    for (const customer of customers) {
      const name = customer.displayName?.trim() || customer.primaryEmail?.trim()
      if (name) names.set(customer.id, name)
    }
  } catch {
    return names
  }
  return names
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

    const customerIdsMissingSnapshot = projects
      .filter((project) => !resolveCustomerName(project.customerSnapshot))
      .map((project) => project.customerId)
      .filter((customerId): customerId is string => typeof customerId === 'string' && customerId.length > 0)

    const [trendMap, membersMap, financialsMap, customerNameById] = await Promise.all([
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
      loadCustomerNames(ctx.em.fork(), ctx.tenantId, ctx.organizationId, customerIdsMissingSnapshot),
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
        customerName:
          resolveCustomerName(project?.customerSnapshot)
          ?? (project?.customerId ? customerNameById.get(project.customerId) ?? null : null),
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

/**
 * The consulting-suite fields on a time-entry row: the `description` alias, the
 * rounded minutes, the lock state, the assigned tags, and — only for a caller
 * holding `staff.timesheets.rates.view` — `cost` and `currencyCode`, with the
 * stored rate override stripped for everyone else.
 *
 * This was a route-private `hooks.afterList` until EP-14. As a declared enricher a
 * third-party enricher for the same entity composes with it and can read what it
 * added, and the CRUD list cache stores the pre-enrichment rows instead of one
 * caller's decorated copy.
 */
type TimeEntryEnrichment = Record<string, unknown>

const timeEntryEnricher: ResponseEnricher<EntityRecord, TimeEntryEnrichment> = {
  id: 'staff.timesheets-time-entries',
  targetEntity: 'staff:staff_time_entry',
  // ACL is enforced by the route (`requireFeatures: ['staff.timesheets.view']`),
  // which also intersects the page with `resolveProjectAccess`. The money fields
  // below are gated per caller on `staff.timesheets.rates.view`.
  priority: 10,
  timeout: 3000,
  critical: false,
  // Tags live in `staff_time_entry_tags` and rates in `staff_time_projects` —
  // neither invalidates the entry list cache, and the money keys are per-caller,
  // so the decoration must be recomputed on every hit.
  cacheableOnListHit: false,

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context) {
    if (records.length === 0) return records as (EntityRecord & TimeEntryEnrichment)[]

    const ctx = context as InternalContext
    // Copies, so the enricher stays additive with respect to its input while the
    // shared decoration keeps writing in place.
    const rows = records.map((record) => ({ ...record }))
    await decorateTimeEntryRows(rows, {
      em: ctx.em,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      canSeeRates: await callerHasFeature(ctx, RATES_FEATURE),
    })
    return rows as (EntityRecord & TimeEntryEnrichment)[]
  },
}

/**
 * The context a task row needs to render outside its own board: the project it
 * belongs to, the column it sits in and who it is assigned to. Without it every
 * task table pays one lookup per row for three names the same page already knows.
 *
 * `hourlyRate` / `currencyCode` are the PROJECT's rate, which is money, so they
 * exist only for a caller holding `staff.timesheets.rates.view`.
 */
type TaskContextEnrichment = {
  _staff: {
    projectName: string | null
    projectCode: string | null
    projectColor: string | null
    statusName: string | null
    statusIsDone: boolean | null
    assigneeName: string | null
    hourlyRate?: number | null
    currencyCode?: string | null
  }
}

const EMPTY_TASK_CONTEXT: TaskContextEnrichment = {
  _staff: {
    projectName: null,
    projectCode: null,
    projectColor: null,
    statusName: null,
    statusIsDone: null,
    assigneeName: null,
  },
}

const taskContextEnricher: ResponseEnricher<EntityRecord, TaskContextEnrichment> = {
  id: 'staff.timesheets-tasks-context',
  targetEntity: 'staff:staff_time_task',
  // ACL is enforced by the route (`requireFeatures: ['staff.timesheets.tasks.view']`),
  // which intersects the page with `resolveProjectAccess`; every lookup below is keyed
  // by that already-filtered page and re-scoped to the caller tenant and organization.
  priority: 5,
  timeout: 3000,
  critical: false,
  fallback: { ...EMPTY_TASK_CONTEXT },
  cacheableOnListHit: false,

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context) {
    if (records.length === 0) return records as (EntityRecord & TaskContextEnrichment)[]

    const ctx = context as InternalContext
    if (!ctx.tenantId || !ctx.organizationId) {
      return records.map((record) => ({ ...record, ...EMPTY_TASK_CONTEXT }))
    }

    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const taskIds = records.map((record) => record.id).filter((id): id is string => typeof id === 'string')
    const tasks = await ctx.em.fork().find(StaffTimeTask, { id: { $in: taskIds }, ...scope, deletedAt: null })
    const taskById = new Map(tasks.map((task) => [task.id, task]))

    const projectIds = [...new Set(tasks.map((task) => task.timeProjectId).filter(Boolean))]
    const statusIds = [...new Set(tasks.map((task) => task.taskStatusId).filter(Boolean))]
    const assigneeIds = [
      ...new Set(
        tasks
          .map((task) => task.assigneeStaffMemberId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ]

    const hasRates = await callerHasFeature(ctx, RATES_FEATURE)

    const [projects, statuses, assignees] = await Promise.all([
      projectIds.length
        ? ctx.em.fork().find(StaffTimeProject, { id: { $in: projectIds }, ...scope, deletedAt: null })
        : Promise.resolve([]),
      statusIds.length
        ? ctx.em.fork().find(StaffTimeTaskStatus, { id: { $in: statusIds }, ...scope, deletedAt: null })
        : Promise.resolve([]),
      assigneeIds.length
        ? findWithDecryption(
            ctx.em.fork(),
            StaffTeamMember,
            { id: { $in: assigneeIds }, ...scope, deletedAt: null },
            undefined,
            scope,
          )
        : Promise.resolve([]),
    ])

    const projectById = new Map(projects.map((project) => [project.id, project]))
    const statusById = new Map(statuses.map((status) => [status.id, status]))
    const assigneeById = new Map(assignees.map((member) => [member.id, member]))

    return records.map((record) => {
      const task = taskById.get(record.id)
      if (!task) return { ...record, ...EMPTY_TASK_CONTEXT }
      const project = projectById.get(task.timeProjectId)
      const status = statusById.get(task.taskStatusId)
      const assignee = task.assigneeStaffMemberId ? assigneeById.get(task.assigneeStaffMemberId) : undefined
      const enrichment: TaskContextEnrichment['_staff'] = {
        projectName: project?.name ?? null,
        projectCode: project?.code ?? null,
        projectColor: project?.color ?? null,
        statusName: status?.name ?? null,
        statusIsDone: status ? status.isDone : null,
        assigneeName: assignee?.displayName ?? null,
      }
      if (hasRates) {
        enrichment.hourlyRate = toNullableNumber(project?.hourlyRate)
        enrichment.currencyCode = project?.currencyCode ?? null
      }
      return { ...record, _staff: enrichment }
    })
  },
}

/**
 * What a report row cannot say about itself: whether it is frozen, how many entries
 * the freeze holds, and whether anyone has taken a file out of it.
 *
 * `lockedEntryCount` counts the frozen `staff_time_report_entries` rows, which is the
 * number a close actually wrote — the report's own columns carry only minute and
 * amount totals. The export history comes from the append-only
 * `staff_time_report_events` audit (screen 14 note 5: an export never locks), so
 * "last exported" is answerable without opening the report.
 *
 * `totalAmount` is money and exists only for a caller holding
 * `staff.timesheets.rates.view`; the minute totals are not money and stay for everyone.
 */
type ReportEnrichment = {
  _staff: {
    isClosed: boolean
    closedAt: string | null
    billableMinutes: number
    nonbillableMinutes: number
    totalMinutes: number
    lockedEntryCount: number
    exportCount: number
    lastExportedAt: string | null
    lastExportFormat: string | null
    totalAmount?: number | null
    currencyCode?: string | null
  }
}

const EMPTY_REPORT_ENRICHMENT: ReportEnrichment = {
  _staff: {
    isClosed: false,
    closedAt: null,
    billableMinutes: 0,
    nonbillableMinutes: 0,
    totalMinutes: 0,
    lockedEntryCount: 0,
    exportCount: 0,
    lastExportedAt: null,
    lastExportFormat: null,
  },
}

type ReportExportSummary = { count: number; lastAt: Date | null; lastFormat: string | null }

function readExportFormat(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const format = metadata.format
  return typeof format === 'string' && format.length > 0 ? format : null
}

const reportEnricher: ResponseEnricher<EntityRecord, ReportEnrichment> = {
  id: 'staff.timesheets-reports',
  targetEntity: 'staff:staff_time_report',
  // ACL is enforced by the route (`requireFeatures: ['staff.timesheets.reports.view']`);
  // `totalAmount` is gated per caller on `staff.timesheets.rates.view` below.
  priority: 10,
  timeout: 3000,
  critical: false,
  fallback: { ...EMPTY_REPORT_ENRICHMENT },
  // The freeze and export counts live in tables the report list cache never
  // invalidates on, so they are re-read on every hit.
  cacheableOnListHit: false,

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context) {
    if (records.length === 0) return records as (EntityRecord & ReportEnrichment)[]

    const ctx = context as InternalContext
    if (!ctx.tenantId || !ctx.organizationId) {
      return records.map((record) => ({ ...record, ...EMPTY_REPORT_ENRICHMENT }))
    }

    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const reportIds = records.map((record) => record.id).filter((id): id is string => typeof id === 'string')
    if (reportIds.length === 0) {
      return records.map((record) => ({ ...record, ...EMPTY_REPORT_ENRICHMENT }))
    }

    const [reports, frozenEntries, exportEvents, hasRates] = await Promise.all([
      ctx.em.fork().find(StaffTimeReport, { id: { $in: reportIds }, ...scope, deletedAt: null }),
      ctx.em.fork().find(
        StaffTimeReportEntry,
        { reportId: { $in: reportIds }, ...scope },
        { fields: ['reportId'] },
      ),
      ctx.em.fork().find(
        StaffTimeReportEvent,
        { reportId: { $in: reportIds }, eventType: 'exported', ...scope },
        { orderBy: { createdAt: 'desc' } },
      ),
      callerHasFeature(ctx, RATES_FEATURE),
    ])

    const reportById = new Map(reports.map((report) => [report.id, report]))
    const frozenCountByReportId = new Map<string, number>()
    for (const entry of frozenEntries) {
      frozenCountByReportId.set(entry.reportId, (frozenCountByReportId.get(entry.reportId) ?? 0) + 1)
    }
    const exportsByReportId = new Map<string, ReportExportSummary>()
    for (const event of exportEvents) {
      const summary = exportsByReportId.get(event.reportId) ?? { count: 0, lastAt: null, lastFormat: null }
      summary.count += 1
      // The rows arrive newest first, so the first one seen for a report is the last export.
      if (summary.lastAt === null) {
        summary.lastAt = event.createdAt ?? null
        summary.lastFormat = readExportFormat(event.metadata)
      }
      exportsByReportId.set(event.reportId, summary)
    }

    return records.map((record) => {
      const report = reportById.get(record.id)
      if (!report) return { ...record, ...EMPTY_REPORT_ENRICHMENT }
      const exports = exportsByReportId.get(report.id)
      const billableMinutes = report.totalBillableMinutes ?? 0
      const nonbillableMinutes = report.totalNonbillableMinutes ?? 0
      const enrichment: ReportEnrichment['_staff'] = {
        isClosed: report.status === 'closed',
        closedAt: report.closedAt ? report.closedAt.toISOString() : null,
        billableMinutes,
        nonbillableMinutes,
        totalMinutes: billableMinutes + nonbillableMinutes,
        lockedEntryCount: frozenCountByReportId.get(report.id) ?? 0,
        exportCount: exports?.count ?? 0,
        lastExportedAt: exports?.lastAt ? exports.lastAt.toISOString() : null,
        lastExportFormat: exports?.lastFormat ?? null,
      }
      if (hasRates) {
        enrichment.totalAmount = toNullableNumber(report.totalAmount)
        enrichment.currencyCode = report.currencyCode ?? null
      }
      return { ...record, _staff: enrichment }
    })
  },
}

/**
 * The API-response surface. Every one of these also participates in query-engine
 * pipelines through the dot-form aliases below, so a dashboard, an export or an AI
 * tool that passes `QueryOptions.extensions` sees the same enrichment the REST
 * response carries.
 */
const apiEnrichers: ResponseEnricher[] = [
  portfolioEnricher,
  taskRollupEnricher,
  taskTagEnricher,
  taskContextEnricher,
  timeEntryEnricher,
  reportEnricher,
]

export const enrichers: ResponseEnricher[] = [
  ...apiEnrichers,
  ...apiEnrichers.map((enricher) => withQueryEngineSurface(enricher)),
]

export default enrichers
