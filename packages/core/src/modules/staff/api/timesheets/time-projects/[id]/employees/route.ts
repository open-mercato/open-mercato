import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { staffTimeProjectMemberCrudEvents } from '../../../../../lib/crud'
import { emitStaffEvent } from '../../../../../events'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { StaffTimeProjectMember } from '../../../../../data/entities'
import { staffTimeProjectMemberAssignSchema, staffTimeProjectMemberUpdateSchema } from '../../../../../data/validators'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../../../openapi'
import { resolveFeatureAccess } from '../../../../../lib/time-tracking/featureAccess'
import { MANAGE_PROJECTS_FEATURE, resolveProjectAccess, assertProjectAccess, type ProjectAccess } from '../../../../../lib/time-tracking/access'
import { readTimeTrackingSettings } from '../../../../../lib/time-tracking/settings'

/**
 * Mirrors `NO_PROJECT_ACCESS_REASON` from `../../../route.ts` (the project-list
 * route). Restated rather than imported so this route stays independent of a
 * sibling route module's internals; `__tests__/route.access.test.ts` pins the
 * literal to the same denial shape.
 */
export const NO_PROJECT_ACCESS_REASON = 'no_project_access'

function extractProjectIdFromUrl(request?: Request): string | null {
  if (!request?.url) return null
  try {
    const url = new URL(request.url)
    const match = url.pathname.match(/\/time-projects\/([^/]+)\/employees/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  time_project_id: 'time_project_id',
  staff_member_id: 'staff_member_id',
  role: 'role',
  status: 'status',
  assigned_start_date: 'assigned_start_date',
  assigned_end_date: 'assigned_end_date',
  is_assigner: 'is_assigner',
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
    timeProjectId: z.string().uuid().optional(),
    status: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const logger = createLogger('staff').child({ component: 'api/timesheets/time-projects/employees' })

function readMemberId(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const value = (result as { timeProjectMemberId?: unknown }).timeProjectMemberId
  return typeof value === 'string' && value.length > 0 ? value : null
}

const DENIED_ACCESS: ProjectAccess = { canManageAll: false, projectIds: [], staffMemberId: null }

async function resolveAssignmentGraceDays(
  container: { resolve: (name: string) => unknown },
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
  container: { resolve: (name: string) => unknown },
  userId: string | null,
  tenantId: string | null,
  organizationId: string | null,
): Promise<ProjectAccess> {
  if (!tenantId || !organizationId) return { ...DENIED_ACCESS }
  const scope = { tenantId, organizationId }
  try {
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
    logger.error('staff.timesheets.time-projects employees access resolution failed', { err })
    return { ...DENIED_ACCESS }
  }
}

async function buildAccessDenialResponse(): Promise<Response> {
  const { translate } = await resolveTranslations()
  return NextResponse.json(
    {
      // Same string a genuinely missing project gets on the project-list route:
      // this sub-resource must not tell a non-member whether the project id
      // behind it even exists.
      error: translate('staff.timesheets.projects.errors.notFound', 'Project not found.'),
      reason: NO_PROJECT_ACCESS_REASON,
    },
    { status: 404 },
  )
}

/**
 * Authorizes the caller against the project named in the URL *before* the CRUD
 * factory runs — including before any list-cache lookup, which reads the cache
 * ahead of `buildFilters` and would otherwise serve another caller's cached
 * membership rows straight past a filters-only guard. The URL segment is the
 * only project identity this check (or the list filter below) will honor; a
 * caller cannot widen or redirect it via `?timeProjectId=`.
 */
async function resolveEmployeesAccessDenial(req: Request): Promise<Response | null> {
  const projectId = extractProjectIdFromUrl(req)
  if (!projectId) return null

  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    // Unauthenticated requests are the factory's `requireAuth` guard to reject.
    if (!auth) return null
    const orgScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = orgScope?.tenantId ?? auth.tenantId ?? null
    const organizationId = resolveSingleOrganizationIdOrDeny(orgScope, auth) ?? null
    // Fail closed: a caller the scope resolver cannot place gets the denial,
    // not an unscoped read.
    if (!tenantId || !organizationId) return await buildAccessDenialResponse()

    const access = await loadProjectAccess(
      container,
      typeof auth.sub === 'string' ? auth.sub : null,
      tenantId,
      organizationId,
    )
    if (assertProjectAccess(access, projectId)) return null
    return await buildAccessDenialResponse()
  } catch (err) {
    // Fail closed: an access decision that could not be made is a denial.
    logger.error('staff.timesheets.time-projects employees denial probe failed', { err })
    return await buildAccessDenialResponse()
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTimeProjectMember,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: staffTimeProjectMemberCrudEvents,
  indexer: { entityType: 'staff:staff_time_project_member' },
  list: {
    schema: listSchema,
    entityId: 'staff:staff_time_project_member',
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.time_project_id,
      F.staff_member_id,
      F.role,
      F.status,
      F.assigned_start_date,
      F.assigned_end_date,
      F.is_assigner,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      assignedStartDate: F.assigned_start_date,
    },
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      // The URL segment is authoritative: `?timeProjectId=` must never redirect
      // a caller, already authorized against the URL's project, onto a
      // different one it was not checked against.
      const projectId = extractProjectIdFromUrl(ctx?.request) ?? query.timeProjectId ?? null
      if (typeof projectId === 'string' && projectId.trim().length > 0) {
        filters[F.time_project_id] = projectId.trim()
      }
      if (typeof query.status === 'string' && query.status.trim().length > 0) {
        filters[F.status] = query.status.trim()
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'staff.timesheets.time_project_members.assign',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const projectId = extractProjectIdFromUrl(ctx?.request) ?? null
        const body = { ...raw, timeProjectId: raw?.timeProjectId ?? projectId }
        return parseScopedCommandInput(staffTimeProjectMemberAssignSchema, body, ctx, translate)
      },
      // The assignment IS the grant: `timeTrackingAccessResolver` reads exactly this
      // table, so a module wiring an approval workflow onto `access-requests` learns
      // the outcome here rather than by polling the membership list.
      response: ({ result, ctx }) => {
        const timeProjectMemberId = readMemberId(result)
        if (timeProjectMemberId) {
          void emitStaffEvent('staff.timesheets.time_project_access.granted', {
            id: timeProjectMemberId,
            tenantId: ctx.auth?.tenantId ?? null,
            organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
          }, { persistent: true }).catch((err) => {
            logger.error('staff.timesheets emit time_project_access.granted failed', { err })
          })
        }
        return { id: timeProjectMemberId }
      },
      status: 201,
    },
    // Re-dating an assignment (D-12) is an update of the existing row, not a
    // replacement pair, so the audit trail reads as a change to
    // `assignedEndDate`. `timeProjectId` comes from the URL, never from the
    // body: the command uses it to refuse a membership id belonging to another
    // project. Guard wiring, tenant/org scoping and the optimistic-lock header
    // come from `makeCrudRoute`'s command path — this route MUST NOT hand-roll
    // them (see `runRouteMutationGuards` for the non-factory equivalent).
    update: {
      commandId: 'staff.timesheets.time_project_members.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          raw?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, {
            error: translate('staff.timesheets.errors.memberRequired', 'Time project member id is required.'),
          })
        }
        const parsed = staffTimeProjectMemberUpdateSchema.parse({ ...raw, id })
        const projectId = extractProjectIdFromUrl(ctx?.request)
        return projectId ? { ...parsed, timeProjectId: projectId } : parsed
      },
      response: ({ result }) => ({ id: result?.timeProjectMemberId ?? null }),
    },
    delete: {
      commandId: 'staff.timesheets.time_project_members.unassign',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, {
            error: translate('staff.timesheets.errors.memberRequired', 'Time project member id is required.'),
          })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export async function GET(req: Request): Promise<Response> {
  const denial = await resolveEmployeesAccessDenial(req)
  if (denial) return denial
  return crud.GET(req)
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const projectMemberListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  time_project_id: z.string().uuid().nullable().optional(),
  staff_member_id: z.string().uuid().nullable().optional(),
  role: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  assigned_start_date: z.string().nullable().optional(),
  assigned_end_date: z.string().nullable().optional(),
  is_assigner: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

const projectAccessDeniedResponseSchema = z.object({
  error: z.string(),
  reason: z.literal(NO_PROJECT_ACCESS_REASON),
})

const baseOpenApi = createStaffCrudOpenApi({
  resourceName: 'TimeProjectMember',
  pluralName: 'Time Project Members',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(projectMemberListItemSchema),
  create: {
    schema: staffTimeProjectMemberAssignSchema,
    description: 'Assigns an employee to a time project.',
  },
  update: {
    schema: staffTimeProjectMemberUpdateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Updates an existing assignment (role, status, assignment end date) without unassigning the employee.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Unassigns an employee from a time project.',
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
            description: `${baseOpenApi.methods.GET.description ?? ''} Requires active membership on the URL's project unless the caller holds staff.timesheets.projects.manage; a non-member or an unknown project id both answer 404 with reason=${NO_PROJECT_ACCESS_REASON}.`.trim(),
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
