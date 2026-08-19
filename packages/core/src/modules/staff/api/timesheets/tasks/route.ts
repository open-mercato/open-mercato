/**
 * Tasks — the board of screen 6, the drawer of screen 7 and the subtask checklist
 * inside it, all served from one collection (D-2: a subtask is a child task).
 *
 * Two things this route is responsible for beyond plain CRUD:
 *
 *  1. **Project access is intersected into every query.** A caller without
 *     `staff.timesheets.projects.manage` only sees tasks belonging to projects they
 *     are an active member of — including when they ask for one id. A route that
 *     leaves that to the caller leaks another client's task titles, which is exactly
 *     the defect the projects route was fixed for; the resolution is memoised per
 *     request and fails closed, so an access decision that could not be made denies.
 *  2. **`topLevelOnly` is what the board asks for.** Children render inside their
 *     parent's drawer, never as their own card, so the board filters
 *     `parent_task_id IS NULL` rather than post-filtering a page it already paid for.
 *
 * The rollup fields (`ownMinutes`, `loggedMinutes`, `childCount`) are added by the
 * `staff.timesheets-tasks-rollup` response enricher rather than by a query in this
 * file, so the board pays one grouped aggregate per page instead of one per card.
 * `loggedMinutes` is the inclusive rollup (own + children, D-2); `ownMinutes` is this
 * task's entries alone. They are never summed together — see the enricher's note on
 * risk R10.
 */

import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { StaffTimeTask, StaffTimeTaskTag } from '../../../data/entities'
import { staffTimeTaskCreateSchema, staffTimeTaskUpdateSchema } from '../../../data/validators'
import { staffTimeTaskCommandIds } from '../../../commands/timesheets-tasks'
import { resolveFeatureAccess } from '../../../lib/time-tracking/featureAccess'
import { MANAGE_PROJECTS_FEATURE, resolveProjectAccess, type ProjectAccess } from '../../../lib/time-tracking/access'
import { readTimeTrackingSettings } from '../../../lib/time-tracking/settings'
import { sanitizeSearchTerm, parseBooleanFlag } from '../../helpers'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const logger = createLogger('staff').child({ component: 'api/timesheets/tasks' })

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  time_project_id: 'time_project_id',
  parent_task_id: 'parent_task_id',
  task_status_id: 'task_status_id',
  sequence_number: 'sequence_number',
  reference: 'reference',
  title: 'title',
  description: 'description',
  assignee_staff_member_id: 'assignee_staff_member_id',
  position: 'position',
  created_by_user_id: 'created_by_user_id',
  closed_at: 'closed_at',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.tasks.view'] },
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.tasks.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.timesheets.tasks.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.timesheets.tasks.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    q: z.string().optional(),
    /** Prefix match on the denormalised `<CODE>-<n>` reference. */
    reference: z.string().optional(),
    id: z.string().optional(),
    ids: z.string().optional(),
    timeProjectId: z.string().uuid().optional(),
    taskStatusId: z.string().uuid().optional(),
    assigneeStaffMemberId: z.string().uuid().optional(),
    parentTaskId: z.string().uuid().optional(),
    tagIds: z.string().optional(),
    topLevelOnly: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type TaskListQuery = z.infer<typeof listSchema>

/**
 * Non-UUID sentinel used as the "match nothing" filter, mirroring the projects route
 * so both narrowing paths behave identically.
 */
const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000'

const DENIED_ACCESS: ProjectAccess = { canManageAll: false, projectIds: [], staffMemberId: null }

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

type ContainerLike = { resolve: (name: string) => unknown }

/** One access decision per request, shared by every filter that needs it. */
const accessByRequest = new WeakMap<Request, Promise<ProjectAccess>>()

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
    // One lookup, one authority, and a failure that says so. The previous
    // `catch → []` could not tell "denied" from "could not ask", so an RBAC
    // hiccup silently demoted a manager to their own memberships.
    const access = await resolveFeatureAccess(container, userId, [MANAGE_PROJECTS_FEATURE], scope)
    const em = container.resolve('em') as EntityManager
    return await resolveProjectAccess({
      em: em.fork(),
      userId,
      tenantId,
      organizationId,
      canManageAll: access.allowed,
      userFeatures: access.grantedFeatures,
      assignmentGraceDays: await resolveAssignmentGraceDays(container, tenantId),
    })
  } catch (err) {
    logger.error('staff.timesheets.tasks access resolution failed', { err })
    return { ...DENIED_ACCESS }
  }
}

export async function resolveListProjectAccess(ctx: CrudCtx): Promise<ProjectAccess> {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const load = () => loadProjectAccess(ctx.container, ctx.auth?.sub ?? null, tenantId, organizationId)
  const request = ctx.request
  if (!request) return load()
  const cached = accessByRequest.get(request)
  if (cached) return cached
  const pending = load()
  accessByRequest.set(request, pending)
  return pending
}

function splitIdList(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const ids = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return ids.length > 0 ? ids : []
}

/**
 * Task ids carrying **every** requested tag (W9).
 *
 * AND rather than OR, because that is what the board's chips already mean
 * (`matchesBoardTagFilter` requires every selected tag), and a server filter that
 * disagreed with the chips would change the result set on the same selection.
 *
 * Returning `[]` narrows to nothing, which is the correct answer both when no task
 * carries the combination and when the lookup failed: a filter that cannot be
 * applied must not silently widen the page back to every task.
 */
async function resolveTaskIdsForTags(ctx: CrudCtx, tagIds: string[]): Promise<string[]> {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) return []
  try {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const rows = await em.find(
      StaffTimeTaskTag,
      { tagId: { $in: tagIds }, tenantId, organizationId },
      { fields: ['taskId', 'tagId'] },
    )
    const seen = new Map<string, Set<string>>()
    for (const row of rows) {
      const taskId = row.taskId
      if (!taskId) continue
      const bucket = seen.get(taskId) ?? new Set<string>()
      bucket.add(row.tagId)
      seen.set(taskId, bucket)
    }
    const required = new Set(tagIds).size
    return [...seen.entries()].filter(([, tags]) => tags.size >= required).map(([taskId]) => taskId)
  } catch (err) {
    logger.error('staff.timesheets.tasks tag filter resolution failed', { err })
    return []
  }
}

/**
 * Every task query narrows to the projects the caller may actually see. Exported so
 * the access intersection is testable without standing up the CRUD factory.
 */
export async function buildTaskListFilters(
  query: TaskListQuery,
  ctx: CrudCtx,
): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}

  let narrowIds: string[] | null = null
  for (const raw of [query.ids, query.id]) {
    const parsed = splitIdList(raw)
    if (parsed === null) continue
    narrowIds = narrowIds ? narrowIds.filter((id) => parsed.includes(id)) : parsed
  }

  const requestedTagIds = splitIdList(query.tagIds)
  if (requestedTagIds !== null) {
    const tagged = requestedTagIds.length === 0 ? [] : await resolveTaskIdsForTags(ctx, requestedTagIds)
    narrowIds = narrowIds ? narrowIds.filter((id) => tagged.includes(id)) : tagged
  }

  const access = await resolveListProjectAccess(ctx)
  let projectIds: string[] | null = null
  if (!access.canManageAll) {
    projectIds = [...access.projectIds]
    if (typeof query.timeProjectId === 'string' && query.timeProjectId.trim().length > 0) {
      const requested = query.timeProjectId.trim()
      projectIds = projectIds.filter((id) => id === requested)
    }
    if (projectIds.length === 0) {
      // A non-member gets no row at all — not a redacted one — so a task title and
      // its project never leave the server.
      filters[F.time_project_id] = { $in: [IMPOSSIBLE_ID] }
      return filters
    }
    filters[F.time_project_id] = { $in: projectIds }
  } else if (typeof query.timeProjectId === 'string' && query.timeProjectId.trim().length > 0) {
    filters[F.time_project_id] = query.timeProjectId.trim()
  }

  if (narrowIds !== null) {
    if (narrowIds.length === 0) {
      filters[F.id] = { $in: [IMPOSSIBLE_ID] }
      return filters
    }
    filters[F.id] = { $in: narrowIds }
  }

  if (typeof query.taskStatusId === 'string' && query.taskStatusId.trim().length > 0) {
    filters[F.task_status_id] = query.taskStatusId.trim()
  }
  if (typeof query.assigneeStaffMemberId === 'string' && query.assigneeStaffMemberId.trim().length > 0) {
    filters[F.assignee_staff_member_id] = query.assigneeStaffMemberId.trim()
  }
  if (typeof query.parentTaskId === 'string' && query.parentTaskId.trim().length > 0) {
    // The drawer's checklist: one parent's children, in position order.
    filters[F.parent_task_id] = query.parentTaskId.trim()
  } else if (parseBooleanFlag(query.topLevelOnly)) {
    // The board: cards only, never a child that already renders inside a drawer.
    filters[F.parent_task_id] = { $eq: null }
  }

  const term = sanitizeSearchTerm(query.q)
  if (term) {
    // A reference is the thing people actually type — "AWR-9" is how a task is
    // named out loud — so searching only the title made the one identifier the
    // UI shows everywhere unusable as a search key.
    //
    // The query engine's filter compiler has no OR across fields (`normalizeFilters`
    // treats a top-level `$or` array as a field name), so the term is routed by
    // shape instead: anything that looks like a code or a code-and-number goes to
    // `reference`, everything else to `title`. A reference is `<CODE>-<n>` with no
    // spaces, which is not a shape task titles take.
    filters[F.title] = { $ilike: `%${escapeLikePattern(term)}%` }
  }

  // Searching by reference is a separate parameter rather than a shape-guess on
  // `q`, because the guess is not decidable: "Booking" is a title word and "AWR"
  // is a code, and both are single alphanumeric tokens. The query engine's filter
  // compiler has no OR across fields — `normalizeFilters` reads a top-level `$or`
  // array as a field name — so a caller that wants both asks for both and merges.
  const referenceTerm = sanitizeSearchTerm(query.reference)
  if (referenceTerm) {
    filters[F.reference] = { $ilike: `${escapeLikePattern(referenceTerm)}%` }
  }

  return filters
}

export const taskListFields = [
  F.id,
  F.organization_id,
  F.tenant_id,
  F.time_project_id,
  F.parent_task_id,
  F.task_status_id,
  F.sequence_number,
  F.reference,
  F.title,
  F.description,
  F.assignee_staff_member_id,
  F.position,
  F.created_by_user_id,
  F.closed_at,
  F.created_at,
  F.updated_at,
] as const

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTimeTask,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'staff:staff_time_task' },
  list: {
    schema: listSchema,
    entityId: 'staff:staff_time_task',
    fields: [...taskListFields],
    // Cards stack in `position` order inside their column, so that is the board's
    // natural sort rather than created-at.
    defaultSort: { field: F.position, dir: 'asc' },
    tiebreakSortField: F.created_at,
    sortFieldMap: {
      position: F.position,
      title: F.title,
      reference: F.reference,
      sequenceNumber: F.sequence_number,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      closedAt: F.closed_at,
    },
    buildFilters: buildTaskListFilters,
  },
  enrichers: { entityId: 'staff:staff_time_task' },
  actions: {
    create: {
      commandId: staffTimeTaskCommandIds.create,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeTaskCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.taskId ?? null }),
      status: 201,
    },
    update: {
      commandId: staffTimeTaskCommandIds.update,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeTaskUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: staffTimeTaskCommandIds.delete,
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

export const taskListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  time_project_id: z.string().uuid().nullable().optional(),
  parent_task_id: z.string().uuid().nullable().optional(),
  task_status_id: z.string().uuid().nullable().optional(),
  sequence_number: z.number().int().nullable().optional(),
  reference: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  assignee_staff_member_id: z.string().uuid().nullable().optional(),
  position: z.number().int().nullable().optional(),
  created_by_user_id: z.string().uuid().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  /** This task's own entries, in raw minutes. */
  ownMinutes: z.number().int().optional(),
  /** The inclusive rollup: own entries plus every live child's (D-2). */
  loggedMinutes: z.number().int().optional(),
  /** Live children only — soft-deleted subtasks are not counted. */
  childCount: z.number().int().optional(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'TimeTask',
  pluralName: 'Time Tasks',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(taskListItemSchema),
  create: {
    schema: staffTimeTaskCreateSchema,
    description:
      'Creates a task. Only `title` is required beyond scoping and `timeProjectId`: the task lands on the project default column with the creator assigned unless the request says otherwise. Supplying `parentTaskId` creates a subtask; a parent that is itself a subtask is refused with 400 subtask_depth_exceeded.',
  },
  update: {
    schema: staffTimeTaskUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a task. Re-parenting under a subtask, or turning a task that already has subtasks into one, is refused with 400 subtask_depth_exceeded; moving a task to another project is refused with 400 task_project_move_unsupported. Moving into a done column stamps closed_at, moving out clears it.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Soft-deletes a task. Deleting a parent soft-deletes its subtasks in the same transaction; time entries keep pointing at the deleted task so closed reports still resolve their labels.',
  },
})
