/**
 * Time entries — the timesheet grid of screen 10 and the full entry form of
 * screen 8, served from one collection.
 *
 * Three things this route owns beyond plain CRUD:
 *
 *  1. **Project access is intersected into every query.** A caller without
 *     `staff.timesheets.projects.manage` sees entries on the projects they are an
 *     active member of, plus their own project-less entries — nobody else's. The
 *     resolution is memoised per request and fails closed, mirroring the projects
 *     and tasks routes.
 *  2. **`description` is returned beside `notes`.** The column is `notes`; every
 *     consulting-suite screen calls it `description`. UPGRADE_NOTES.md promises
 *     both keys on read for at least one minor release, so both are emitted here
 *     and both are accepted on write (the command folds them, `description` wins).
 *  3. **Money is added, not hidden.** `cost`, `currencyCode` and the stored rate
 *     override only exist in the payload for a caller holding
 *     `staff.timesheets.rates.view`; everyone else gets a response with no money
 *     keys at all, the same shape the project portfolio enricher uses.
 *
 * `cost` is computed from `rounded_minutes` — never from `duration_minutes` — via
 * `entryAmount`, so a non-billable entry reads `null` rather than `0`: zero is a
 * price, and out-of-scope work does not have one (D-7).
 */

import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { StaffTimeEntry, StaffTimeEntryTag, StaffTimeProject, StaffTimeTag } from '../../../data/entities'
import { staffTimeEntryCreateSchema, staffTimeEntryUpdateSchema } from '../../../data/validators'
import { buildTimeEntryListFilters, isParseableDateFilter } from '../../../lib/timesheets/timeEntryListFilters'
import { staffTimeEntryCommandIds } from '../../../lib/crud'
import { resolveProjectAccess, type ProjectAccess } from '../../../lib/time-tracking/access'
import { readTimeTrackingSettings } from '../../../lib/time-tracking/settings'
import { entryAmount } from '../../../lib/time-tracking/cost'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const logger = createLogger('staff').child({ component: 'api/timesheets/time-entries' })

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  staff_member_id: 'staff_member_id',
  date: 'date',
  duration_minutes: 'duration_minutes',
  rounded_minutes: 'rounded_minutes',
  started_at: 'started_at',
  ended_at: 'ended_at',
  notes: 'notes',
  time_project_id: 'time_project_id',
  task_id: 'task_id',
  customer_id: 'customer_id',
  deal_id: 'deal_id',
  order_id: 'order_id',
  is_billable: 'is_billable',
  rate_override_amount: 'rate_override_amount',
  rate_currency_code: 'rate_currency_code',
  locked_report_id: 'locked_report_id',
  locked_at: 'locked_at',
  source: 'source',
  created_at: 'created_at',
  updated_at: 'updated_at',
  deleted_at: 'deleted_at',
} as const

export const RATES_FEATURE = 'staff.timesheets.rates.view'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.view'] },
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const dateFilterSchema = z
  .string()
  .refine(isParseableDateFilter, { message: 'Invalid date' })
  .optional()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    staffMemberId: z.string().uuid().optional(),
    from: dateFilterSchema,
    to: dateFilterSchema,
    projectId: z.string().uuid().optional(),
    /**
     * One task id, or a comma-separated list of them. The list form is what the
     * task drawer needs: a parent and its subtasks are one question ("what has
     * been logged against this task?"), so answering it must not cost one request
     * per child.
     */
    taskId: z.string().optional(),
    ids: z.string().optional(),
    running: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type EntryListQuery = z.infer<typeof listSchema>

/** Non-UUID sentinel used as the "match nothing" filter, mirroring the tasks route. */
const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000'

const DENIED_ACCESS: ProjectAccess = { canManageAll: false, projectIds: [], staffMemberId: null }

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * Splits `?taskId=a,b,c` into ids the database can be asked about.
 *
 * A token that is not a UUID is dropped rather than passed through: the column is
 * `uuid`, so a malformed id would fail the whole query instead of matching
 * nothing. `null` means the caller asked no task question at all; an empty array
 * means they asked one no row can answer.
 */
function splitTaskIdList(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => UUID_PATTERN.test(entry))
}

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
  userHasAllFeatures?: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

type ContainerLike = { resolve: (name: string) => unknown }

/** One access decision per request, shared by every filter that needs it. */
const accessByRequest = new WeakMap<Request, Promise<ProjectAccess>>()

async function resolveGrantedFeatures(
  container: ContainerLike,
  userId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<string[]> {
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return []
    return (await rbac.getGrantedFeatures(userId, scope)) ?? []
  } catch {
    // Fail closed: an unreadable grant set is no grant set.
    return []
  }
}

async function resolveAssignmentGraceDays(container: ContainerLike, tenantId: string): Promise<number | null> {
  try {
    const configService = container.resolve('moduleConfigService') as ModuleConfigService
    const settings = await readTimeTrackingSettings(configService, { tenantId })
    return settings.access.assignmentGraceDays
  } catch {
    // Fail safe to the documented default rather than widening the window.
    return null
  }
}

async function loadProjectAccess(
  container: ContainerLike,
  userId: string | null,
  tenantId: string | null,
  organizationId: string | null,
): Promise<ProjectAccess> {
  if (!tenantId || !organizationId) return { ...DENIED_ACCESS }
  const scope = { tenantId, organizationId }
  try {
    const grantedFeatures = userId ? await resolveGrantedFeatures(container, userId, scope) : []
    const em = container.resolve('em') as EntityManager
    return await resolveProjectAccess({
      em: em.fork(),
      userId,
      tenantId,
      organizationId,
      userFeatures: grantedFeatures,
      assignmentGraceDays: await resolveAssignmentGraceDays(container, tenantId),
    })
  } catch (err) {
    logger.error('staff.timesheets.time-entries access resolution failed', { err })
    return { ...DENIED_ACCESS }
  }
}

function resolveCtxScope(ctx: CrudCtx): { tenantId: string | null; organizationId: string | null } {
  return {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  }
}

export async function resolveListProjectAccess(ctx: CrudCtx): Promise<ProjectAccess> {
  const { tenantId, organizationId } = resolveCtxScope(ctx)
  const load = () => loadProjectAccess(ctx.container, ctx.auth?.sub ?? null, tenantId, organizationId)
  const request = ctx.request
  if (!request) return load()
  const cached = accessByRequest.get(request)
  if (cached) return cached
  const pending = load()
  accessByRequest.set(request, pending)
  return pending
}

/**
 * Every entry query narrows to what the caller may actually see: entries on the
 * projects they belong to, plus their OWN entries that name no project. A
 * project-less entry has no membership to check, so the only person it can belong
 * to is the member who logged it.
 *
 * Exported so the intersection is testable without standing up the CRUD factory.
 */
export async function buildScopedTimeEntryListFilters(
  query: EntryListQuery,
  ctx: CrudCtx,
): Promise<Record<string, unknown>> {
  const filters = buildTimeEntryListFilters(query)

  // The task narrowing is applied before the access branches and never instead of
  // them: asking for a task the caller may not see must return nothing, not the
  // task's entries.
  const taskIds = splitTaskIdList(query.taskId)
  if (taskIds !== null) {
    filters[F.task_id] = { $in: taskIds.length > 0 ? taskIds : [IMPOSSIBLE_ID] }
  }

  const access = await resolveListProjectAccess(ctx)
  if (access.canManageAll) return filters

  const branches: Record<string, unknown>[] = []
  if (access.projectIds.length > 0) {
    branches.push({ [F.time_project_id]: { $in: access.projectIds } })
  }
  if (access.staffMemberId) {
    branches.push({ [F.time_project_id]: { $eq: null }, [F.staff_member_id]: access.staffMemberId })
  }
  if (branches.length === 0) {
    // A caller with no membership and no staff record gets no row at all — not a
    // redacted one — so an entry's note and its project never leave the server.
    filters[F.id] = { $in: [IMPOSSIBLE_ID] }
    return filters
  }
  filters.$or = branches
  return filters
}

export const timeEntryListFields = [
  F.id,
  F.organization_id,
  F.tenant_id,
  F.staff_member_id,
  F.date,
  F.duration_minutes,
  F.rounded_minutes,
  F.started_at,
  F.ended_at,
  F.notes,
  F.time_project_id,
  F.task_id,
  F.customer_id,
  F.deal_id,
  F.order_id,
  F.is_billable,
  F.rate_override_amount,
  F.rate_currency_code,
  F.locked_report_id,
  F.locked_at,
  F.source,
  F.created_at,
  F.updated_at,
] as const

type ListItem = Record<string, unknown>

export type TimeEntryTagSummary = {
  id: string
  slug: string
  label: string
  color: string | null
}

function readValue(item: ListItem, snakeKey: string, camelKey: string): unknown {
  const snake = item[snakeKey]
  if (snake !== undefined) return snake
  return item[camelKey]
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1) return true
  if (value === 'false' || value === 0) return false
  return fallback
}

async function callerHasRatesView(ctx: CrudCtx): Promise<boolean> {
  const userId = ctx.auth?.sub
  if (!userId) return false
  const { tenantId, organizationId } = resolveCtxScope(ctx)
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.userHasAllFeatures) return false
    return await rbac.userHasAllFeatures(userId, [RATES_FEATURE], { tenantId, organizationId })
  } catch {
    // Fail closed: an unreadable grant set never opens the money fields.
    return false
  }
}

async function loadEntryTags(
  em: EntityManager,
  entryIds: string[],
  tenantId: string,
  organizationId: string,
): Promise<Map<string, TimeEntryTagSummary[]>> {
  const byEntryId = new Map<string, TimeEntryTagSummary[]>()
  if (entryIds.length === 0) return byEntryId
  const assignments = await em.find(StaffTimeEntryTag, {
    timeEntryId: { $in: entryIds },
    tenantId,
    organizationId,
  })
  if (assignments.length === 0) return byEntryId
  const tags = await em.find(StaffTimeTag, {
    id: { $in: Array.from(new Set(assignments.map((row) => row.tagId))) },
    tenantId,
    organizationId,
    deletedAt: null,
  })
  const tagById = new Map(tags.map((tag) => [tag.id, tag]))
  for (const assignment of assignments) {
    const tag = tagById.get(assignment.tagId)
    if (!tag) continue
    const list = byEntryId.get(assignment.timeEntryId) ?? []
    list.push({ id: tag.id, slug: tag.slug, label: tag.label, color: tag.color ?? null })
    byEntryId.set(assignment.timeEntryId, list)
  }
  return byEntryId
}

type ProjectMoney = { hourlyRate: number | null; currencyCode: string | null }

async function loadProjectMoney(
  em: EntityManager,
  projectIds: string[],
  tenantId: string,
  organizationId: string,
): Promise<Map<string, ProjectMoney>> {
  const byId = new Map<string, ProjectMoney>()
  if (projectIds.length === 0) return byId
  const projects = await em.find(StaffTimeProject, {
    id: { $in: projectIds },
    tenantId,
    organizationId,
    deletedAt: null,
  })
  for (const project of projects) {
    byId.set(project.id, {
      hourlyRate: toNullableNumber(project.hourlyRate),
      currencyCode: toNullableString(project.currencyCode),
    })
  }
  return byId
}

/**
 * Adds the consulting-suite response fields to every listed entry. Money keys are
 * added only for a caller holding `staff.timesheets.rates.view`; for everyone else
 * the stored rate override is stripped, so the absence is in the payload rather
 * than only in the UI.
 */
export async function decorateTimeEntryList(payload: unknown, ctx: CrudCtx): Promise<void> {
  const items = (payload as { items?: unknown })?.items
  if (!Array.isArray(items) || items.length === 0) return
  const rows = items as ListItem[]

  const { tenantId, organizationId } = resolveCtxScope(ctx)
  const canSeeRates = await callerHasRatesView(ctx)

  let tagsByEntryId = new Map<string, TimeEntryTagSummary[]>()
  let moneyByProjectId = new Map<string, ProjectMoney>()
  if (tenantId && organizationId) {
    try {
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const entryIds = rows
        .map((row) => readValue(row, F.id, 'id'))
        .filter((value): value is string => typeof value === 'string')
      tagsByEntryId = await loadEntryTags(em, entryIds, tenantId, organizationId)
      if (canSeeRates) {
        const projectIds = Array.from(
          new Set(
            rows
              .map((row) => readValue(row, F.time_project_id, 'timeProjectId'))
              .filter((value): value is string => typeof value === 'string'),
          ),
        )
        moneyByProjectId = await loadProjectMoney(em, projectIds, tenantId, organizationId)
      }
    } catch (err) {
      // A decoration failure must not fail the list; the entry rows themselves are
      // already correct and scoped.
      logger.error('staff.timesheets.time-entries response decoration failed', { err })
    }
  }

  for (const row of rows) {
    const entryId = readValue(row, F.id, 'id')
    const lockedReportId = toNullableString(readValue(row, F.locked_report_id, 'lockedReportId'))
    const roundedMinutes = toNullableNumber(readValue(row, F.rounded_minutes, 'roundedMinutes'))
    const isBillable = toBoolean(readValue(row, F.is_billable, 'isBillable'), true)

    // The published alias: same value, second name, both keys returned.
    row.description = toNullableString(readValue(row, F.notes, 'notes'))
    row.roundedMinutes = roundedMinutes
    row.isLocked = lockedReportId !== null
    row.lockedReportId = lockedReportId
    row.tags = typeof entryId === 'string' ? tagsByEntryId.get(entryId) ?? [] : []

    if (!canSeeRates) {
      delete row[F.rate_override_amount]
      delete row.rateOverrideAmount
      delete row[F.rate_currency_code]
      delete row.rateCurrencyCode
      continue
    }

    const projectId = readValue(row, F.time_project_id, 'timeProjectId')
    const money = typeof projectId === 'string' ? moneyByProjectId.get(projectId) : undefined
    row.currencyCode =
      toNullableString(readValue(row, F.rate_currency_code, 'rateCurrencyCode')) ?? money?.currencyCode ?? null
    // A non-billable entry has no price at all — `null`, never `0`, which would
    // read as free work rather than work that is out of scope.
    row.cost = entryAmount(
      {
        isBillable,
        roundedMinutes: roundedMinutes ?? 0,
        rateOverrideAmount: toNullableNumber(readValue(row, F.rate_override_amount, 'rateOverrideAmount')),
      },
      { hourlyRate: money?.hourlyRate ?? null },
    )
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTimeEntry,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'staff:staff_time_entry' },
  list: {
    schema: listSchema,
    entityId: 'staff:staff_time_entry',
    fields: [...timeEntryListFields],
    sortFieldMap: {
      date: F.date,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      durationMinutes: F.duration_minutes,
      roundedMinutes: F.rounded_minutes,
    },
    buildFilters: buildScopedTimeEntryListFilters,
  },
  hooks: {
    afterList: decorateTimeEntryList,
  },
  actions: {
    create: {
      commandId: staffTimeEntryCommandIds.create,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeEntryCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.timeEntryId ?? null }),
      status: 201,
    },
    update: {
      commandId: staffTimeEntryCommandIds.update,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeEntryUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: staffTimeEntryCommandIds.delete,
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const timeEntryTagSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  label: z.string(),
  color: z.string().nullable(),
})

const timeEntryListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  staff_member_id: z.string().uuid().nullable().optional(),
  date: z.string().nullable().optional(),
  duration_minutes: z.number().nullable().optional(),
  rounded_minutes: z.number().nullable().optional(),
  started_at: z.string().nullable().optional(),
  ended_at: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  time_project_id: z.string().uuid().nullable().optional(),
  task_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  deal_id: z.string().uuid().nullable().optional(),
  order_id: z.string().uuid().nullable().optional(),
  is_billable: z.boolean().nullable().optional(),
  /** Present only for a caller holding `staff.timesheets.rates.view`. */
  rate_override_amount: z.union([z.string(), z.number()]).nullable().optional(),
  /** Present only for a caller holding `staff.timesheets.rates.view`. */
  rate_currency_code: z.string().nullable().optional(),
  locked_report_id: z.string().uuid().nullable().optional(),
  locked_at: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  /** Alias of `notes`; both keys are returned (see UPGRADE_NOTES.md). */
  description: z.string().nullable().optional(),
  /** Raw minutes rounded by the tenant's rule at write time; the only input to cost (D-7). */
  roundedMinutes: z.number().nullable().optional(),
  isLocked: z.boolean().optional(),
  lockedReportId: z.string().uuid().nullable().optional(),
  tags: z.array(timeEntryTagSchema).optional(),
  /** Present only for a caller holding `staff.timesheets.rates.view`; `null` when non-billable. */
  cost: z.number().nullable().optional(),
  /** Present only for a caller holding `staff.timesheets.rates.view`. */
  currencyCode: z.string().nullable().optional(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'TimeEntry',
  pluralName: 'TimeEntries',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(timeEntryListItemSchema),
  create: {
    schema: staffTimeEntryCreateSchema,
    description:
      'Creates a time entry for a staff member. The note is accepted under either `notes` or `description` (`description` wins when both are sent). `roundedMinutes` is derived from the tenant rounding rule at write time and stored; `isBillable` falls back to the project default then the tenant default; `rateCurrencyCode` snapshots the project currency. `tagIds` is applied through the tag assignment command.',
  },
  update: {
    schema: staffTimeEntryUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a time entry by id. `durationMinutes`, `startedAt` and `endedAt` are reconciled so the stored set never contradicts itself: sending both clocks recomputes the duration from them (a duration sent alongside is advisory), sending one clock with a duration derives the other clock, and sending only a duration shifts `endedAt` while `startedAt` anchors. An `endedAt` earlier than its `startedAt` is stored on the next calendar day (a midnight crossing) and `date` still names the day the work started. Any change to the effective duration recomputes the stored rounded minutes from the tenant rounding rule; changing the project re-snapshots the currency. `tagIds` replaces the entry tag set through the tag assignment commands, which refuse an entry locked in a closed report.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a time entry by id.',
  },
})
