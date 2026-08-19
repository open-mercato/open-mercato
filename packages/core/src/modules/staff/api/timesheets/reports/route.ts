/**
 * Customer reports — the collection behind screens 13, 14 and 15.
 *
 * Two things beyond plain CRUD:
 *
 *  1. **Project access is intersected into the list.** `reports.view` is a Team
 *     Leader feature and a Team Leader normally also holds
 *     `staff.timesheets.projects.manage`, so the common path is unrestricted.
 *     A caller granted `reports.view` WITHOUT `projects.manage` is nonetheless
 *     narrowed to reports that include at least one project they are a member
 *     of — the same fail-closed shape the tasks and projects routes use, so a
 *     future grant can never turn this route into a customer-list oracle.
 *  2. **Writes go through the report commands**, which own the single-customer
 *     and single-currency assertions (risk R2) and the `RAP-<year>-<seq>`
 *     allocation. The factory's command path is also the mutation-guard wiring,
 *     so this file deliberately does not call `runRouteMutationGuards` itself.
 */

import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { StaffTimeReport, StaffTimeReportProject } from '../../../data/entities'
import { staffTimeReportCreateSchema, staffTimeReportUpdateSchema } from '../../../data/validators'
import { staffTimeReportCommandIds } from '../../../commands/timesheets-reports'
import { resolveFeatureAccess } from '../../../lib/time-tracking/featureAccess'
import { MANAGE_PROJECTS_FEATURE, resolveProjectAccess, type ProjectAccess } from '../../../lib/time-tracking/access'
import { readTimeTrackingSettings } from '../../../lib/time-tracking/settings'
import { sanitizeSearchTerm } from '../../helpers'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const logger = createLogger('staff').child({ component: 'api/timesheets/reports' })

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  customer_id: 'customer_id',
  customer_snapshot: 'customer_snapshot',
  reference: 'reference',
  title: 'title',
  period_kind: 'period_kind',
  period_from: 'period_from',
  period_to: 'period_to',
  currency_code: 'currency_code',
  grouping: 'grouping',
  nonbillable_mode: 'nonbillable_mode',
  include_already_reported: 'include_already_reported',
  show_rates: 'show_rates',
  rounding_unit_minutes: 'rounding_unit_minutes',
  rounding_direction: 'rounding_direction',
  status: 'status',
  total_billable_minutes: 'total_billable_minutes',
  total_nonbillable_minutes: 'total_nonbillable_minutes',
  total_amount: 'total_amount',
  closed_at: 'closed_at',
  closed_by_user_id: 'closed_by_user_id',
  created_by_user_id: 'created_by_user_id',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.reports.view'] },
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.reports.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.timesheets.reports.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.timesheets.reports.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    q: z.string().optional(),
    id: z.string().optional(),
    ids: z.string().optional(),
    customerId: z.string().uuid().optional(),
    status: z.enum(['draft', 'closed']).optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type ReportListQuery = z.infer<typeof listSchema>

const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000'

const DENIED_ACCESS: ProjectAccess = { canManageAll: false, projectIds: [], staffMemberId: null }

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

type ContainerLike = { resolve: (name: string) => unknown }

const accessByRequest = new WeakMap<Request, Promise<ProjectAccess>>()

async function resolveAssignmentGraceDays(container: ContainerLike, tenantId: string): Promise<number | null> {
  try {
    const configService = container.resolve('moduleConfigService') as ModuleConfigService
    const settings = await readTimeTrackingSettings(configService, { tenantId })
    return settings.access.assignmentGraceDays
  } catch {
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
    logger.error('staff.timesheets.reports access resolution failed', { err })
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
 * Reports the caller may see when they are not a project manager: those whose
 * selection touches at least one project they are an active member of.
 */
async function reportIdsForProjects(
  ctx: CrudCtx,
  projectIds: readonly string[],
): Promise<string[]> {
  if (projectIds.length === 0) return []
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) return []
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const rows = await em.find(StaffTimeReportProject, {
    timeProjectId: { $in: [...projectIds] },
    tenantId,
    organizationId,
  })
  return Array.from(new Set(rows.map((row) => row.reportId)))
}

export async function buildReportListFilters(
  query: ReportListQuery,
  ctx: CrudCtx,
): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}

  let narrowIds: string[] | null = null
  for (const raw of [query.ids, query.id]) {
    const parsed = splitIdList(raw)
    if (parsed === null) continue
    narrowIds = narrowIds ? narrowIds.filter((id) => parsed.includes(id)) : parsed
  }

  const access = await resolveListProjectAccess(ctx)
  if (!access.canManageAll) {
    const allowed = await reportIdsForProjects(ctx, access.projectIds)
    narrowIds = narrowIds ? narrowIds.filter((id) => allowed.includes(id)) : allowed
    if (narrowIds.length === 0) {
      filters[F.id] = { $in: [IMPOSSIBLE_ID] }
      return filters
    }
  }

  if (narrowIds !== null) {
    if (narrowIds.length === 0) {
      filters[F.id] = { $in: [IMPOSSIBLE_ID] }
      return filters
    }
    filters[F.id] = { $in: narrowIds }
  }

  if (typeof query.customerId === 'string' && query.customerId.trim().length > 0) {
    filters[F.customer_id] = query.customerId.trim()
  }
  if (typeof query.status === 'string' && query.status.length > 0) {
    filters[F.status] = query.status
  }

  const term = sanitizeSearchTerm(query.q)
  if (term) {
    filters[F.title] = { $ilike: `%${escapeLikePattern(term)}%` }
  }

  return filters
}

export const reportListFields = [
  F.id,
  F.organization_id,
  F.tenant_id,
  F.customer_id,
  F.customer_snapshot,
  F.reference,
  F.title,
  F.period_kind,
  F.period_from,
  F.period_to,
  F.currency_code,
  F.grouping,
  F.nonbillable_mode,
  F.include_already_reported,
  F.show_rates,
  F.rounding_unit_minutes,
  F.rounding_direction,
  F.status,
  F.total_billable_minutes,
  F.total_nonbillable_minutes,
  F.total_amount,
  F.closed_at,
  F.closed_by_user_id,
  F.created_by_user_id,
  F.created_at,
  F.updated_at,
] as const

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTimeReport,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'staff:staff_time_report' },
  list: {
    schema: listSchema,
    entityId: 'staff:staff_time_report',
    fields: [...reportListFields],
    defaultSort: { field: F.created_at, dir: 'desc' },
    tiebreakSortField: F.id,
    sortFieldMap: {
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      reference: F.reference,
      title: F.title,
      periodFrom: F.period_from,
      periodTo: F.period_to,
      status: F.status,
      totalAmount: F.total_amount,
    },
    buildFilters: buildReportListFilters,
  },
  actions: {
    create: {
      commandId: staffTimeReportCommandIds.create,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeReportCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.reportId ?? null }),
      status: 201,
    },
    update: {
      commandId: staffTimeReportCommandIds.update,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeReportUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: staffTimeReportCommandIds.delete,
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

export const reportListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  customer_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  reference: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  period_kind: z.string().nullable().optional(),
  period_from: z.string().nullable().optional(),
  period_to: z.string().nullable().optional(),
  currency_code: z.string().nullable().optional(),
  grouping: z.string().nullable().optional(),
  nonbillable_mode: z.string().nullable().optional(),
  include_already_reported: z.boolean().nullable().optional(),
  show_rates: z.boolean().nullable().optional(),
  rounding_unit_minutes: z.number().int().nullable().optional(),
  rounding_direction: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  total_billable_minutes: z.number().int().nullable().optional(),
  total_nonbillable_minutes: z.number().int().nullable().optional(),
  total_amount: z.union([z.string(), z.number()]).nullable().optional(),
  closed_at: z.string().nullable().optional(),
  closed_by_user_id: z.string().uuid().nullable().optional(),
  created_by_user_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'TimeReport',
  pluralName: 'Time Reports',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(reportListItemSchema),
  create: {
    schema: staffTimeReportCreateSchema,
    description:
      'Creates a draft customer report and allocates its RAP-<year>-<seq> reference. Every selected project must belong to `customerId` and the projects must agree on a currency; a mismatch is refused with 422 report_currency_conflict naming the offenders.',
  },
  update: {
    schema: staffTimeReportUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a draft report. A closed report is refused with 409 report_closed — unlock it first. Replacing `timeProjectIds` re-asserts the single-customer and single-currency rules.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Soft-deletes a draft report. A closed report is refused with 409 report_closed, because deleting it would strand the entries it froze.',
  },
})
