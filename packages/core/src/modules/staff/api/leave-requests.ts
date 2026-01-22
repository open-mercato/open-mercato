import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffLeaveRequest, StaffTeamMember } from '../data/entities'
import {
  staffLeaveRequestCreateSchema,
  staffLeaveRequestUpdateSchema,
  staffLeaveRequestDecisionSchema,
} from '../data/validators'
import { sanitizeSearchTerm } from './helpers'
import { E } from '#generated/entities.ids.generated'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

const MANAGE_FEATURE = 'staff.leave_requests.manage'
const SEND_FEATURE = 'staff.leave_requests.send'
const MY_VIEW_FEATURE = 'staff.my_leave_requests.view'
const MY_SEND_FEATURE = 'staff.my_leave_requests.send'

const routeMetadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true },
  PUT: { requireAuth: true },
  DELETE: { requireAuth: true },
}

export const metadata = routeMetadata

// Field constants for StaffLeaveRequest entity
const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  member_id: 'member_id',
  start_date: 'start_date',
  end_date: 'end_date',
  timezone: 'timezone',
  status: 'status',
  unavailability_reason_entry_id: 'unavailability_reason_entry_id',
  unavailability_reason_value: 'unavailability_reason_value',
  note: 'note',
  decision_comment: 'decision_comment',
  submitted_by_user_id: 'submitted_by_user_id',
  decided_by_user_id: 'decided_by_user_id',
  decided_at: 'decided_at',
  created_at: 'created_at',
  updated_at: 'updated_at',
  deleted_at: 'deleted_at',
} as const

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    memberId: z.string().uuid().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type LeaveRequestAccess = {
  canManage: boolean
  canSend: boolean
  canView: boolean
  memberId: string | null
}

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

function resolveActorUserId(ctx: { auth?: { sub?: string | null; isApiKey?: boolean } | null }): string | null {
  if (!ctx.auth || ctx.auth.isApiKey) return null
  const sub = ctx.auth.sub ?? null
  if (!sub || !uuidRegex.test(sub)) return null
  return sub
}

async function resolveLeaveRequestAccess(ctx: any): Promise<LeaveRequestAccess> {
  const auth = ctx.auth
  if (!auth || !auth.sub || auth.isApiKey) {
    return { canManage: false, canSend: false, canView: false, memberId: null }
  }
  const tenantId = ctx.organizationScope?.tenantId ?? auth.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? auth.orgId ?? null
  const rbac = (ctx.container.resolve('rbacService') as RbacService)
  const [canManage, canSendLegacy, canSendSelf, canViewSelf] = await Promise.all([
    rbac.userHasAllFeatures(auth.sub, [MANAGE_FEATURE], { tenantId, organizationId }),
    rbac.userHasAllFeatures(auth.sub, [SEND_FEATURE], { tenantId, organizationId }),
    rbac.userHasAllFeatures(auth.sub, [MY_SEND_FEATURE], { tenantId, organizationId }),
    rbac.userHasAllFeatures(auth.sub, [MY_VIEW_FEATURE], { tenantId, organizationId }),
  ])
  const canSend = canSendLegacy || canSendSelf
  const canView = canManage || canSend || canViewSelf
  if (!canManage && !canView) {
    return { canManage, canSend, canView, memberId: null }
  }
  const member = await findOneWithDecryption(
    ctx.container.resolve('em') as EntityManager,
    StaffTeamMember,
    { userId: auth.sub, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  return { canManage, canSend, canView, memberId: member?.id ?? null }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffLeaveRequest,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.staff.staff_leave_request },
  list: {
    schema: listSchema,
    entityId: E.staff.staff_leave_request,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.member_id,
      F.start_date,
      F.end_date,
      F.timezone,
      F.status,
      F.unavailability_reason_entry_id,
      F.unavailability_reason_value,
      F.note,
      F.decision_comment,
      F.submitted_by_user_id,
      F.decided_by_user_id,
      F.decided_at,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      startDate: F.start_date,
      endDate: F.end_date,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
        if (ids.length > 0) {
          filters[F.id] = { $in: ids }
        }
      }
      if (query.status) {
        filters[F.status] = query.status
      }
      if (query.memberId) {
        filters[F.member_id] = query.memberId
      }
      const term = sanitizeSearchTerm(query.search)
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        const em = (ctx.container.resolve('em') as EntityManager).fork()
        const members = await findWithDecryption(
          em,
          StaffTeamMember,
          { displayName: { $ilike: like }, deletedAt: null },
          { fields: ['id'] },
          { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
        )
        const memberIds = members.map((member) => member.id)
        if (!memberIds.length) {
          filters[F.id] = '__no_match__'
        } else {
          filters[F.member_id] = { $in: memberIds }
        }
      }

      const access = await resolveLeaveRequestAccess(ctx)
      if (!access.canManage) {
        if (!access.canView || !access.memberId) {
          filters[F.id] = '__no_access__'
        } else {
          filters[F.member_id] = access.memberId
        }
      }
      return filters
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items: Array<Record<string, unknown>> = Array.isArray(payload?.items)
        ? (payload.items as Array<Record<string, unknown>>)
        : []
      if (!items.length) {
        payload.viewer = await resolveLeaveRequestAccess(ctx)
        return
      }
      const memberIds = new Set<string>()
      items.forEach((item) => {
        const memberId = typeof item.memberId === 'string'
          ? item.memberId
          : typeof item.member_id === 'string'
            ? item.member_id
            : null
        if (memberId) memberIds.add(memberId)
      })
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const members = memberIds.size
        ? await findWithDecryption(
            em,
            StaffTeamMember,
            { id: { $in: Array.from(memberIds) } },
            undefined,
            { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
          )
        : []
      const memberById = new Map(members.map((member) => [member.id, member]))
      items.forEach((item) => {
        const memberId = typeof item.memberId === 'string'
          ? item.memberId
          : typeof item.member_id === 'string'
            ? item.member_id
            : null
        if (!memberId) return
        const member = memberById.get(memberId)
        if (!member) return
        item.member = {
          id: member.id,
          displayName: member.displayName,
          userId: member.userId ?? null,
        }
      })
      payload.viewer = await resolveLeaveRequestAccess(ctx)
    },
  },
  actions: {
    create: {
      commandId: 'staff.leave-requests.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const access = await resolveLeaveRequestAccess(ctx)
        if (!access.canManage && !access.canSend) {
          throw new CrudHttpError(403, { error: translate('staff.leaveRequests.errors.forbidden', 'Forbidden') })
        }
        const payload = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}
        const actorUserId = resolveActorUserId(ctx)
        if (actorUserId) payload.submittedByUserId = actorUserId
        if (!access.canManage) {
          if (!access.memberId) {
            throw new CrudHttpError(400, { error: translate('staff.leaveRequests.errors.profileRequired', 'Create your profile first.') })
          }
          payload.memberId = access.memberId
        }
        return parseScopedCommandInput(staffLeaveRequestCreateSchema, payload, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.requestId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'staff.leave-requests.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const parsed = parseScopedCommandInput(staffLeaveRequestUpdateSchema, raw ?? {}, ctx, translate)
        const access = await resolveLeaveRequestAccess(ctx)
        if (!access.canManage && !access.canSend) {
          throw new CrudHttpError(403, { error: translate('staff.leaveRequests.errors.forbidden', 'Forbidden') })
        }
        if (!access.canManage) {
          if (!access.memberId) {
            throw new CrudHttpError(403, { error: translate('staff.leaveRequests.errors.forbidden', 'Forbidden') })
          }
          const em = (ctx.container.resolve('em') as EntityManager)
          const request = await findOneWithDecryption(
            em,
            StaffLeaveRequest,
            { id: parsed.id, deletedAt: null },
            undefined,
            { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
          )
          const memberId = request ? (typeof request.member === 'string' ? request.member : request.member.id) : null
          if (!request || memberId !== access.memberId) {
            throw new CrudHttpError(403, { error: translate('staff.leaveRequests.errors.forbidden', 'Forbidden') })
          }
          if (parsed.memberId && parsed.memberId !== memberId) {
            throw new CrudHttpError(403, { error: translate('staff.leaveRequests.errors.forbidden', 'Forbidden') })
          }
        }
        return parsed
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'staff.leave-requests.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        const access = await resolveLeaveRequestAccess(ctx)
        if (!access.canManage && !access.canSend) {
          throw new CrudHttpError(403, { error: translate('staff.leaveRequests.errors.forbidden', 'Forbidden') })
        }
        if (!access.canManage) {
          if (!access.memberId) {
            throw new CrudHttpError(403, { error: translate('staff.leaveRequests.errors.forbidden', 'Forbidden') })
          }
          const em = (ctx.container.resolve('em') as EntityManager)
          const request = await findOneWithDecryption(
            em,
            StaffLeaveRequest,
            { id, deletedAt: null },
            undefined,
            { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
          )
          const memberId = request ? (typeof request.member === 'string' ? request.member : request.member.id) : null
          if (!request || memberId !== access.memberId) {
            throw new CrudHttpError(403, { error: translate('staff.leaveRequests.errors.forbidden', 'Forbidden') })
          }
        }
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

const leaveRequestListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  member_id: z.string().uuid().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).nullable().optional(),
  unavailability_reason_entry_id: z.string().uuid().nullable().optional(),
  unavailability_reason_value: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  decision_comment: z.string().nullable().optional(),
  submitted_by_user_id: z.string().uuid().nullable().optional(),
  decided_by_user_id: z.string().uuid().nullable().optional(),
  decided_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  member: z
    .object({
      id: z.string().uuid().nullable().optional(),
      displayName: z.string().nullable().optional(),
      userId: z.string().uuid().nullable().optional(),
    })
    .nullable()
    .optional(),
})

const leaveRequestListResponseSchema = createPagedListResponseSchema(leaveRequestListItemSchema).extend({
  viewer: z
    .object({
      canManage: z.boolean(),
      canSend: z.boolean(),
      canView: z.boolean(),
      memberId: z.string().uuid().nullable(),
    })
    .optional(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'Leave request',
  pluralName: 'Leave requests',
  querySchema: listSchema,
  listResponseSchema: leaveRequestListResponseSchema,
  create: {
    schema: staffLeaveRequestCreateSchema,
    description: 'Creates a leave request for a staff member.',
  },
  update: {
    schema: staffLeaveRequestUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a leave request by id.',
  },
  del: {
    schema: staffLeaveRequestDecisionSchema.pick({ id: true }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a leave request by id.',
  },
})
