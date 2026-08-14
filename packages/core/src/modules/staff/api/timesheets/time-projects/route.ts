import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isIdsParamProvided, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { StaffTimeProject, StaffTimeProjectMember, StaffTeamMember } from '../../../data/entities'
import { staffTimeProjectCreateSchema, staffTimeProjectUpdateSchema } from '../../../data/validators'
import { resolveProjectAccess, type ProjectAccess } from '../../../lib/time-tracking/access'
import { readTimeTrackingSettings } from '../../../lib/time-tracking/settings'
import { sanitizeSearchTerm, parseBooleanFlag } from '../../helpers'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const logger = createLogger('staff').child({ component: 'api/timesheets/time-projects' })

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  name: 'name',
  code: 'code',
  description: 'description',
  project_type: 'project_type',
  color: 'color',
  status: 'status',
  customer_id: 'customer_id',
  customer_snapshot: 'customer_snapshot',
  owner_user_id: 'owner_user_id',
  cost_center: 'cost_center',
  start_date: 'start_date',
  hourly_rate: 'hourly_rate',
  currency_code: 'currency_code',
  billable_by_default: 'billable_by_default',
  budget_kind: 'budget_kind',
  budget_value: 'budget_value',
  budget_warn_at_percent: 'budget_warn_at_percent',
  created_at: 'created_at',
  updated_at: 'updated_at',
  deleted_at: 'deleted_at',
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.projects.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.timesheets.projects.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.timesheets.projects.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    q: z.string().optional(),
    ids: z.string().optional(),
    projectType: z.string().optional(),
    status: z.string().optional(),
    customerId: z.string().uuid().optional(),
    mine: z.string().optional(),
    include: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

/**
 * Discriminator returned with the 404 a project-scoped read answers when the
 * caller may not see the record. It is the whole body besides a generic error
 * string: naming the project or the customer here would confirm the resource to
 * someone who has no right to it (screen 17 note 1).
 *
 * Denied and genuinely-missing are deliberately indistinguishable for a caller
 * without `staff.timesheets.projects.manage` — both answer this same 404 — so the
 * endpoint cannot be used to enumerate which project ids exist. The discriminator
 * only tells the client "you are not a member", which is what screen 17 needs to
 * render the request-access affordance; a manager still gets a plain 200-empty
 * for an id that really does not exist.
 */
export const NO_PROJECT_ACCESS_REASON = 'no_project_access'

/**
 * Non-UUID sentinel used as the "match nothing" id filter. Kept in the shape the
 * `mine=true` branch has always used so both narrowing paths behave identically.
 */
const IMPOSSIBLE_PROJECT_ID = '00000000-0000-0000-0000-000000000000'

const DENIED_ACCESS: ProjectAccess = { canManageAll: false, projectIds: [], staffMemberId: null }

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

type ContainerLike = { resolve: (name: string) => unknown }

/**
 * Both entry points into a single request — the denial probe on `GET` and the
 * list narrowing in `buildFilters` — must agree on what the caller may see, and
 * neither should pay for the other's lookups. The resolved access is therefore
 * memoised per `Request`; the factory hands `buildFilters` the same object the
 * route received.
 */
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
    // Fail closed: an unreadable grant set is no grant set, so the caller falls
    // back to their project memberships instead of being treated as a manager.
    return []
  }
}

async function resolveAssignmentGraceDays(
  container: ContainerLike,
  tenantId: string,
): Promise<number | null> {
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
    logger.error('staff.timesheets.time-projects access resolution failed', { err })
    return { ...DENIED_ACCESS }
  }
}

function resolveRequestProjectAccess(
  request: Request | undefined,
  load: () => Promise<ProjectAccess>,
): Promise<ProjectAccess> {
  if (!request) return load()
  const cached = accessByRequest.get(request)
  if (cached) return cached
  const pending = load()
  accessByRequest.set(request, pending)
  return pending
}

function resolveCtxScope(ctx: CrudCtx): { tenantId: string | null; organizationId: string | null } {
  return {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  }
}

async function resolveListProjectAccess(ctx: CrudCtx): Promise<ProjectAccess> {
  const { tenantId, organizationId } = resolveCtxScope(ctx)
  return resolveRequestProjectAccess(ctx.request, () =>
    loadProjectAccess(ctx.container, ctx.auth?.sub ?? null, tenantId, organizationId),
  )
}

async function resolveCallerAssignedProjectIds(
  em: EntityManager,
  userId: string,
  tenantId: string,
  organizationId: string,
): Promise<string[]> {
  const scopeCtx = { tenantId, organizationId }
  const staffMember = await findOneWithDecryption(
    em.fork(),
    StaffTeamMember,
    { userId, tenantId, organizationId, deletedAt: null },
    {},
    scopeCtx,
  )
  if (!staffMember) return []
  const memberships = await em.fork().find(StaffTimeProjectMember, {
    staffMemberId: staffMember.id,
    tenantId,
    organizationId,
    status: 'active',
    deletedAt: null,
  })
  return Array.from(new Set(memberships.map((m) => m.timeProjectId)))
}

type ProjectEntryCountRow = {
  time_project_id: string
  entry_count: string | number
  locked_entry_count: string | number
}

type ProjectListItem = {
  id?: unknown
  entryCount?: number
  lockedEntryCount?: number
  currencyLocked?: boolean
}

function toCount(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * D-3 read-side signal: currency is read-only once hours have been logged, so the
 * project list/detail response carries the reason alongside the value.
 * `currencyLocked` tells the form to render the field read-only behind the explicit
 * change action, `entryCount` names why, and `lockedEntryCount` says whether even
 * that action will be refused (entries frozen in a closed report).
 *
 * One grouped aggregate for the whole page — never a per-row count.
 */
export async function decorateProjectCurrencyLock(
  items: ProjectListItem[],
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const ids = Array.from(
    new Set(items.map((item) => item.id).filter((value): value is string => typeof value === 'string' && value.length > 0)),
  )
  if (ids.length === 0) return

  const rows = (await em.getConnection().execute(
    `
      SELECT time_project_id,
             COUNT(*)::bigint AS entry_count,
             COUNT(locked_report_id)::bigint AS locked_entry_count
      FROM staff_time_entries
      WHERE tenant_id = ?
        AND organization_id = ?
        AND deleted_at IS NULL
        AND time_project_id = ANY(?)
      GROUP BY time_project_id
    `,
    [scope.tenantId, scope.organizationId, ids],
  )) as ProjectEntryCountRow[]

  const counts = new Map(rows.map((row) => [row.time_project_id, row]))
  for (const item of items) {
    const row = typeof item.id === 'string' ? counts.get(item.id) : undefined
    const entryCount = toCount(row?.entry_count)
    item.entryCount = entryCount
    item.lockedEntryCount = toCount(row?.locked_entry_count)
    item.currencyLocked = entryCount > 0
  }
}

/**
 * The list projection doubles as the detail projection (the edit page re-reads this
 * route with `?id=`), so every column the project form round-trips has to be here.
 */
export const timeProjectListFields = [
  F.id,
  F.organization_id,
  F.tenant_id,
  F.name,
  F.code,
  F.description,
  F.project_type,
  F.color,
  F.status,
  F.customer_id,
  F.customer_snapshot,
  F.owner_user_id,
  F.cost_center,
  F.start_date,
  F.hourly_rate,
  F.currency_code,
  F.billable_by_default,
  F.budget_kind,
  F.budget_value,
  F.budget_warn_at_percent,
  F.created_at,
  F.updated_at,
] as const

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTimeProject,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'staff:staff_time_project' },
  enrichers: { entityId: 'staff:staff_time_project' },
  list: {
    schema: listSchema,
    entityId: 'staff:staff_time_project',
    fields: [...timeProjectListFields],
    sortFieldMap: {
      name: F.name,
      code: F.code,
      status: F.status,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      startDate: F.start_date,
    },
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      let narrowIds: string[] | null = null
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        narrowIds = query.ids
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      }
      if (parseBooleanFlag(query.mine) && ctx.auth) {
        const em = ctx.container.resolve('em') as EntityManager
        const tenantId = ctx.auth.tenantId ?? ''
        const organizationId = ctx.selectedOrganizationId ?? ctx.auth.orgId ?? ''
        const assigned = await resolveCallerAssignedProjectIds(
          em,
          ctx.auth.sub,
          tenantId,
          organizationId,
        )
        narrowIds = narrowIds
          ? narrowIds.filter((id) => assigned.includes(id))
          : assigned
        if (narrowIds.length === 0) {
          filters[F.id] = { $in: [IMPOSSIBLE_PROJECT_ID] }
          return filters
        }
      }
      // Every project-scoped read filters through the one resolver: a caller
      // without `staff.timesheets.projects.manage` only ever sees the projects
      // they are an active member of. A non-member gets no row at all — not a
      // redacted one — so the customer and project name never leave the server.
      const access = await resolveListProjectAccess(ctx)
      if (!access.canManageAll) {
        narrowIds = narrowIds
          ? narrowIds.filter((id) => access.projectIds.includes(id))
          : [...access.projectIds]
        if (narrowIds.length === 0) {
          filters[F.id] = { $in: [IMPOSSIBLE_PROJECT_ID] }
          return filters
        }
      }
      if (narrowIds && narrowIds.length > 0) {
        filters[F.id] = { $in: narrowIds }
      }
      const term = sanitizeSearchTerm(query.q)
      if (term) {
        filters[F.name] = { $ilike: `%${escapeLikePattern(term)}%` }
      }
      if (typeof query.projectType === 'string' && query.projectType.trim().length > 0) {
        filters[F.project_type] = query.projectType.trim()
      }
      if (typeof query.status === 'string' && query.status.trim().length > 0) {
        filters[F.status] = query.status.trim()
      }
      if (typeof query.customerId === 'string' && query.customerId.trim().length > 0) {
        filters[F.customer_id] = query.customerId.trim()
      }
      return filters
    },
  },
  hooks: {
    afterList: async (res, ctx) => {
      const items = Array.isArray((res as { items?: unknown })?.items)
        ? ((res as { items: ProjectListItem[] }).items)
        : []
      if (items.length === 0) return
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      if (!tenantId || !organizationId) return
      const em = ctx.container.resolve('em') as EntityManager
      await decorateProjectCurrencyLock(items, em.fork(), { tenantId, organizationId })
    },
  },
  actions: {
    create: {
      commandId: 'staff.timesheets.time_projects.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeProjectCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.timeProjectId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'staff.timesheets.time_projects.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeProjectUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'staff.timesheets.time_projects.delete',
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

async function buildAccessDenialResponse(): Promise<Response> {
  const { translate } = await resolveTranslations()
  return NextResponse.json(
    {
      // Same string a genuinely missing record gets: the body must not tell the
      // caller which of the two it is beyond the membership discriminator.
      error: translate('staff.timesheets.projects.errors.notFound', 'Project not found.'),
      reason: NO_PROJECT_ACCESS_REASON,
    },
    { status: 404 },
  )
}

/**
 * The list route doubles as the detail read (`?ids=<id>`, and defensively `?id=`),
 * so a caller asking for one specific project needs an answer the UI can turn
 * into screen 17 rather than an indistinguishable empty page. Returning 404 for
 * denied *and* unknown ids alike keeps the endpoint useless for enumeration; the
 * `reason` discriminator carries only "you are not a member of this project",
 * never the project or customer it is refusing to describe.
 */
async function resolveProjectAccessDenial(req: Request): Promise<Response | null> {
  const url = new URL(req.url)
  const rawIds = url.searchParams.get('ids') ?? url.searchParams.get('id')
  if (!isIdsParamProvided(rawIds)) return null
  const requestedIds = parseIdsParam(rawIds)
  // Malformed ids match nothing on their own; the factory answers an empty list.
  if (requestedIds.length === 0) return null

  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    // Unauthenticated and unscoped requests are the factory's to reject.
    if (!auth) return null
    const orgScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = orgScope?.tenantId ?? auth.tenantId ?? null
    const organizationId = orgScope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) return null

    const access = await resolveRequestProjectAccess(req, () =>
      loadProjectAccess(
        container,
        typeof auth.sub === 'string' ? auth.sub : null,
        tenantId,
        organizationId,
      ),
    )
    if (access.canManageAll) return null
    if (requestedIds.some((id) => access.projectIds.includes(id))) return null
    return await buildAccessDenialResponse()
  } catch (err) {
    // Fail closed: an access decision that could not be made is a denial.
    logger.error('staff.timesheets.time-projects denial probe failed', { err })
    return await buildAccessDenialResponse()
  }
}

export async function GET(req: Request): Promise<Response> {
  const denial = await resolveProjectAccessDenial(req)
  if (denial) return denial
  return crud.GET(req)
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const timeProjectListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  project_type: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  customer_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  cost_center: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  // numeric(14,4) reaches the client as a decimal string; a number stays accepted
  // for callers that read the column through a numeric-casting driver.
  hourly_rate: z.union([z.string(), z.number()]).nullable().optional(),
  currency_code: z.string().nullable().optional(),
  billable_by_default: z.boolean().nullable().optional(),
  budget_kind: z.string().nullable().optional(),
  budget_value: z.union([z.string(), z.number()]).nullable().optional(),
  budget_warn_at_percent: z.number().int().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  entryCount: z.number().int().optional(),
  lockedEntryCount: z.number().int().optional(),
  currencyLocked: z.boolean().optional(),
})

export const projectAccessDeniedResponseSchema = z.object({
  error: z.string(),
  reason: z.literal(NO_PROJECT_ACCESS_REASON),
})

const baseOpenApi = createStaffCrudOpenApi({
  resourceName: 'TimeProject',
  pluralName: 'Time Projects',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(timeProjectListItemSchema),
  create: {
    schema: staffTimeProjectCreateSchema,
    description: 'Creates a time project.',
  },
  update: {
    schema: staffTimeProjectUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a time project by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a time project by id.',
  },
})

export const openApi = {
  ...baseOpenApi,
  methods: {
    ...baseOpenApi.methods,
    ...(baseOpenApi.methods?.GET
      ? {
          GET: {
            ...baseOpenApi.methods.GET,
            description: `${baseOpenApi.methods.GET.description ?? ''} Rows are intersected with the caller's project access: without staff.timesheets.projects.manage only projects the caller is an active member of are returned. Asking for a single id the caller may not see answers 404 with reason=${NO_PROJECT_ACCESS_REASON} and never names the project or its customer; the same 404 covers ids that do not exist, so the endpoint cannot be used to enumerate projects.`.trim(),
            responses: [
              ...(baseOpenApi.methods.GET.responses ?? []),
              {
                status: 404,
                description: 'The caller is not a member of the requested project (or it does not exist)',
                schema: projectAccessDeniedResponseSchema,
              },
            ],
          },
        }
      : {}),
  },
} satisfies typeof baseOpenApi
