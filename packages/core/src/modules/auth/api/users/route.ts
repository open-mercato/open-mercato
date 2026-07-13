import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { logCrudAccess, makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  queryUserList,
  type ResolvedUserListScope,
  type UserFilter,
} from './userListQuery'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { userCrudEvents, userCrudIndexer } from '@open-mercato/core/modules/auth/commands/users'
import {
  assertActorCanAccessUserTarget,
  assertActorCanGrantRoleTokens,
  assertActorCanModifySuperAdminUserTarget,
  listSuperAdminUserIds,
} from '@open-mercato/core/modules/auth/lib/grantChecks'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { normalizeDisplayNameInput } from '@open-mercato/core/modules/auth/lib/displayName'
import {
  getSelectedTenantFromRequest,
  resolveOrganizationScopeForRequest,
} from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('auth').child({ component: 'users' })

const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  name: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
}).passthrough()

const rawBodySchema = z.object({}).passthrough()

const passwordSchema = buildPasswordSchema()

const displayNameSchema = z.preprocess(
  normalizeDisplayNameInput,
  z.string().trim().min(1).max(120).nullable().optional(),
)

const userCreateSchema = z.object({
  email: z.string().email(),
  name: displayNameSchema,
  password: passwordSchema.optional(),
  sendInviteEmail: z.boolean().optional(),
  organizationId: z.string().uuid(),
  roles: z.array(z.string()).optional(),
}).refine(
  (data) => data.password || data.sendInviteEmail,
  { message: 'Either password or sendInviteEmail is required', path: ['password'] },
)

const userUpdateSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().optional(),
  name: displayNameSchema,
  password: passwordSchema.optional(),
  organizationId: z.string().uuid().optional(),
  roles: z.array(z.string()).optional(),
})

const userListItemSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  organizationId: z.string().uuid().nullable(),
  organizationName: z.string().nullable(),
  tenantId: z.string().uuid().nullable(),
  tenantName: z.string().nullable(),
  roles: z.array(z.string()),
  roleIds: z.array(z.string().uuid()).optional(),
  hasPassword: z.boolean().optional(),
  updatedAt: z.string().nullable().optional(),
})

const userListResponseSchema = z.object({
  items: z.array(userListItemSchema),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
  isSuperAdmin: z.boolean().optional(),
})

const okResponseSchema = z.object({ ok: z.literal(true) })

const errorResponseSchema = z.object({ error: z.string() })

type CrudInput = Record<string, unknown>
type ListQuery = z.infer<typeof querySchema>
type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
type RequestAuth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.users.list'] },
  POST: { requireAuth: true, requireFeatures: ['auth.users.create'] },
  PUT: { requireAuth: true, requireFeatures: ['auth.users.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['auth.users.delete'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: User,
    idField: 'id',
    orgField: null,
    tenantField: null,
    softDeleteField: 'deletedAt',
  },
  events: userCrudEvents,
  indexer: userCrudIndexer,
  actions: {
    create: {
      commandId: 'auth.users.create',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        if (ctx.request) {
          await assertCanAssignRoles(ctx.request, parsed.roles, parsed)
        }
        return parsed
      },
      response: ({ result }) => ({
        id: String(result.user.id),
        ...(result.warning ? { _warning: result.warning } : {}),
      }),
      status: 201,
    },
    update: {
      commandId: 'auth.users.update',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        if (ctx.request) {
          if (typeof parsed.id === 'string' && parsed.id.length) {
            await assertCanModifySuperAdminTarget(ctx.request, parsed.id)
            await assertCanAccessUserTarget(ctx.request, parsed.id)
          }
          await assertCanAssignRoles(ctx.request, parsed.roles, parsed)
        }
        return parsed
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'auth.users.delete',
      mapInput: async ({ parsed, raw, ctx }) => {
        const targetId = resolveDeleteTargetId(parsed, raw)
        if (ctx.request && targetId) {
          await assertCanModifySuperAdminTarget(ctx.request, targetId)
          await assertCanAccessUserTarget(ctx.request, targetId)
        }
        return parsed
      },
      response: () => ({ ok: true }),
    },
  },
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return emptyUserListResponse()
  const query = parseUsersListQuery(req)
  if (!query) return emptyUserListResponse()

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const isSuperAdmin = await resolveListerIsSuperAdmin(container, auth)

  const scopeResult = await resolveUsersListScope({ req, container, em, auth, isSuperAdmin })
  if (!scopeResult.ok) return scopeResult.response
  const { scope } = scopeResult

  const result = await queryUserList(em, {
    query,
    isSuperAdmin,
    scope,
    authTenantId: auth.tenantId ?? null,
  })
  if (result.kind === 'roleFilterEmpty') return emptyUserListResponse()
  if (result.kind === 'searchEmpty') return emptyUserListResponse({ isSuperAdmin })

  const totalPages = Math.max(1, Math.ceil(result.total / query.pageSize))
  await logCrudAccess({
    container,
    auth,
    request: req,
    items: result.items,
    idField: 'id',
    resourceKind: 'auth.user',
    organizationId: scope.effectiveSelectedOrganizationId,
    tenantId: scope.effectiveTenantId ?? auth.tenantId ?? null,
    query,
    accessType: query.id ? 'read:item' : undefined,
  })
  return NextResponse.json({ items: result.items, total: result.total, totalPages, isSuperAdmin })
}

function emptyUserListResponse(fields?: { isSuperAdmin: boolean }): NextResponse {
  return NextResponse.json({ items: [], total: 0, totalPages: 1, ...(fields ?? {}) })
}

function parseUsersListQuery(req: Request): ListQuery | null {
  const url = new URL(req.url)
  const rawRoleIds = url.searchParams
    .getAll('roleId')
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  const parsed = querySchema.safeParse({
    id: url.searchParams.get('id') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
    search: url.searchParams.get('search') || undefined,
    name: url.searchParams.get('name') || undefined,
    organizationId: url.searchParams.get('organizationId') || undefined,
    roleIds: rawRoleIds.length ? rawRoleIds : undefined,
  })
  return parsed.success ? parsed.data : null
}

async function resolveListerIsSuperAdmin(container: RequestContainer, auth: RequestAuth): Promise<boolean> {
  let isSuperAdmin = auth.isSuperAdmin === true
  if (auth.sub) {
    try {
      const rbacService = container.resolve('rbacService') as RbacService
      const acl = await rbacService.loadAcl(auth.sub, {
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
      })
      isSuperAdmin = isSuperAdmin || !!acl?.isSuperAdmin
    } catch (err) {
      logger.error('Failed to resolve rbac', { err })
    }
  }
  return isSuperAdmin
}

async function resolveUsersListScope(args: {
  req: Request
  container: RequestContainer
  em: EntityManager
  auth: RequestAuth
  isSuperAdmin: boolean
}): Promise<{ ok: true; scope: ResolvedUserListScope } | { ok: false; response: NextResponse }> {
  const { req, container, em, auth, isSuperAdmin } = args
  const baseFilters: UserFilter[] = [{ deletedAt: null }]
  const actorTenantId = auth.tenantId ? String(auth.tenantId) : null
  let effectiveTenantId: string | null = null
  let effectiveOrganizationIds: string[] | null = null
  let effectiveSelectedOrganizationId: string | null = null
  let usesSelectedTenantScope = false

  if (!isSuperAdmin) {
    if (!actorTenantId) {
      return { ok: false, response: emptyUserListResponse({ isSuperAdmin }) }
    }
    effectiveTenantId = actorTenantId
    const superAdminUserIds = await listSuperAdminUserIds(em, actorTenantId)
    if (superAdminUserIds.size) {
      baseFilters.push({ id: { $nin: Array.from(superAdminUserIds) } } as UserFilter)
    }
  } else {
    const selectedTenantId = getSelectedTenantFromRequest(req)
    if (typeof selectedTenantId === 'string' && selectedTenantId.trim().length > 0) {
      const scope = await resolveOrganizationScopeForRequest({
        container,
        auth,
        request: req,
        tenantId: selectedTenantId.trim(),
      })
      if (!scope.tenantId) {
        return { ok: false, response: emptyUserListResponse({ isSuperAdmin }) }
      }
      effectiveTenantId = scope.tenantId
      effectiveSelectedOrganizationId = scope.selectedId
      usesSelectedTenantScope = true
      if (Array.isArray(scope.filterIds)) {
        if (scope.filterIds.length === 0) {
          return { ok: false, response: emptyUserListResponse({ isSuperAdmin }) }
        }
        effectiveOrganizationIds = scope.filterIds
      }
    }
  }

  if (effectiveTenantId) baseFilters.push({ tenantId: effectiveTenantId })
  if (effectiveOrganizationIds) {
    baseFilters.push({ organizationId: { $in: effectiveOrganizationIds } } as UserFilter)
  }
  const scopeOrganizationId = usesSelectedTenantScope
    ? effectiveSelectedOrganizationId
    : auth.orgId ?? null

  return {
    ok: true,
    scope: {
      baseFilters,
      effectiveTenantId,
      effectiveSelectedOrganizationId,
      scopeOrganizationId,
    },
  }
}

export const POST = async (req: Request) => {
  return crud.POST(req)
}

export const PUT = async (req: Request) => {
  return crud.PUT(req)
}

export const DELETE = async (req: Request) => {
  const targetId = new URL(req.url).searchParams.get('id')
  if (targetId) {
    try {
      await assertCanModifySuperAdminTarget(req, targetId)
      await assertCanAccessUserTarget(req, targetId)
    } catch (err) {
      if (err instanceof CrudHttpError) {
        return NextResponse.json(err.body, { status: err.status })
      }
      throw err
    }
  }
  return crud.DELETE(req)
}

type ActorRbacContext = {
  actorUserId: string
  tenantId: string | null
  organizationId: string | null
  em: EntityManager
  rbacService: RbacService
}

async function resolveActorRbacContext(req: Request): Promise<ActorRbacContext> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) throw new CrudHttpError(401, { error: 'Unauthorized' })
  const container = await createRequestContainer()
  return {
    actorUserId: auth.sub,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    em: container.resolve('em') as EntityManager,
    rbacService: container.resolve('rbacService') as RbacService,
  }
}

async function assertCanModifySuperAdminTarget(req: Request, targetUserId: string) {
  const actor = await resolveActorRbacContext(req)
  await assertActorCanModifySuperAdminUserTarget({ ...actor, targetUserId })
}

async function assertCanAccessUserTarget(req: Request, targetUserId: string) {
  const actor = await resolveActorRbacContext(req)
  await assertActorCanAccessUserTarget({ ...actor, targetUserId })
}

function resolveDeleteTargetId(parsed: unknown, raw: unknown): string | null {
  const fromParsed = readId((parsed as Record<string, unknown> | null | undefined))
  if (fromParsed) return fromParsed
  const rawRecord = raw as { body?: Record<string, unknown>; query?: Record<string, unknown> } | null | undefined
  return readId(rawRecord?.query) ?? readId(rawRecord?.body)
}

function readId(record: Record<string, unknown> | null | undefined): string | null {
  const value = record?.id
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function assertCanAssignRoles(req: Request, roles: unknown, payload: Record<string, unknown>) {
  if (!Array.isArray(roles)) return
  const actor = await resolveActorRbacContext(req)
  const tenantId = await resolveTargetTenantIdForRoleGrant(actor.em, payload, actor.tenantId)
  await assertActorCanGrantRoleTokens({ ...actor, tenantId, roleTokens: roles })
}

async function resolveTargetTenantIdForRoleGrant(
  em: EntityManager,
  payload: Record<string, unknown>,
  fallbackTenantId: string | null,
): Promise<string | null> {
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
  if (organizationId) {
    const organization = await findOneWithDecryption(
      em,
      Organization,
      { id: organizationId },
      { populate: ['tenant'] },
      { tenantId: null, organizationId },
    )
    return organization?.tenant?.id ? String(organization.tenant.id) : fallbackTenantId
  }

  const userId = typeof payload.id === 'string' ? payload.id : null
  if (userId) {
    const user = await findOneWithDecryption(
      em,
      User,
      { id: userId, deletedAt: null },
      {},
      { tenantId: null, organizationId: null },
    )
    return user?.tenantId ? String(user.tenantId) : fallbackTenantId
  }

  return fallbackTenantId
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'User management',
  methods: {
    GET: {
      summary: 'List users',
      description:
        'Returns users for the effective selected tenant and organization scope. Search matches email, organization name, and role name. Super administrators may scope the response via the topbar context, organization filters, or role filters.',
      query: querySchema,
      responses: [
        { status: 200, description: 'User collection', schema: userListResponseSchema },
      ],
    },
    POST: {
      summary: 'Create user',
      description: 'Creates a new confirmed user within the specified organization, optional display name, and optional roles.',
      requestBody: {
        contentType: 'application/json',
        schema: userCreateSchema,
      },
      responses: [
        {
          status: 201,
          description: 'User created',
          schema: z.object({ id: z.string().uuid() }),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload or duplicate email', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Attempted to assign privileged roles', schema: errorResponseSchema },
      ],
    },
    PUT: {
      summary: 'Update user',
      description: 'Updates profile fields including display name, organization assignment, credentials, or role memberships.',
      requestBody: {
        contentType: 'application/json',
        schema: userUpdateSchema,
      },
      responses: [
        { status: 200, description: 'User updated', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Attempted to assign privileged roles', schema: errorResponseSchema },
        { status: 404, description: 'User not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Delete user',
      description: 'Deletes a user by identifier. Undo support is provided via the command bus.',
      query: z.object({ id: z.string().uuid().describe('User identifier') }),
      responses: [
        { status: 200, description: 'User deleted', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'User cannot be deleted', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'User not found', schema: errorResponseSchema },
      ],
    },
  },
}
