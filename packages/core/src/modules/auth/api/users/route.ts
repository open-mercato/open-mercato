/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { logCrudAccess, makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { User, Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { E } from '#generated/entities.ids.generated'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import type { EntityManager } from '@mikro-orm/postgresql'
import { userCrudEvents, userCrudIndexer } from '@open-mercato/core/modules/auth/commands/users'
import { assertActorCanGrantRoleTokens } from '@open-mercato/core/modules/auth/lib/grantChecks'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import { sql } from 'kysely'

const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
}).passthrough()

const rawBodySchema = z.object({}).passthrough()

const passwordSchema = buildPasswordSchema()

const userCreateSchema = z.object({
  email: z.string().email(),
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
  password: passwordSchema.optional(),
  organizationId: z.string().uuid().optional(),
  roles: z.array(z.string()).optional(),
})

const userListItemSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  organizationId: z.string().uuid().nullable(),
  organizationName: z.string().nullable(),
  tenantId: z.string().uuid().nullable(),
  tenantName: z.string().nullable(),
  roles: z.array(z.string()),
  roleIds: z.array(z.string().uuid()).optional(),
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
          await assertCanAssignRoles(ctx.request, parsed.roles, parsed)
        }
        return parsed
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'auth.users.delete',
      response: () => ({ ok: true }),
    },
  },
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
  const url = new URL(req.url)
  const rawRoleIds = url.searchParams.getAll('roleId').filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  const parsed = querySchema.safeParse({
    id: url.searchParams.get('id') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
    search: url.searchParams.get('search') || undefined,
    organizationId: url.searchParams.get('organizationId') || undefined,
    roleIds: rawRoleIds.length ? rawRoleIds : undefined,
  })
  if (!parsed.success) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager)
  let isSuperAdmin = false
  try {
    if (auth.sub) {
      const rbacService = container.resolve('rbacService') as any
      const acl = await rbacService.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
      isSuperAdmin = !!acl?.isSuperAdmin
    }
  } catch (err) {
    console.error('users: failed to resolve rbac', err)
  }
  const { id, page, pageSize, search, organizationId, roleIds } = parsed.data
  const filters: any[] = [{ deletedAt: null }]
  const actorTenantId = auth.tenantId ? String(auth.tenantId) : null
  if (!isSuperAdmin) {
    if (!actorTenantId) {
      return NextResponse.json({ items: [], total: 0, totalPages: 1, isSuperAdmin })
    }
    filters.push({ tenantId: actorTenantId })
  }
  if (organizationId) filters.push({ organizationId })
  let idFilter: Set<string> | null = id ? new Set([id]) : null
  if (Array.isArray(roleIds) && roleIds.length > 0) {
    const uniqueRoleIds = Array.from(new Set(roleIds))
    const linksForRoles = await em.find(UserRole, { role: { $in: uniqueRoleIds as any } } as any)
    const roleUserIds = new Set<string>()
    for (const link of linksForRoles) {
      const uid = String((link as any).user?.id || (link as any).user || '')
      if (uid) roleUserIds.add(uid)
    }
    if (roleUserIds.size === 0) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
    if (idFilter) {
      for (const uid of Array.from(idFilter)) {
        if (!roleUserIds.has(uid)) idFilter.delete(uid)
      }
    } else {
      idFilter = roleUserIds
    }
    if (!idFilter || idFilter.size === 0) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
  }
  const trimmedSearch = typeof search === 'string' ? search.trim() : ''
  if (trimmedSearch) {
    // Email is encrypted at rest, so plaintext search must go through search_tokens.
    const tenantScope: string | null | undefined = isSuperAdmin ? undefined : auth.tenantId ?? null
    const searchFilters: any[] = []

    const matchedIds = await findUserIdsBySearchTokens(em, E.auth.user, trimmedSearch, tenantScope)
    if (matchedIds && matchedIds.length) {
      searchFilters.push({ id: { $in: matchedIds as any } })
    }

    const searchPattern = `%${escapeLikePattern(trimmedSearch)}%`
    const organizationSearchFilters: any[] = [
      { deletedAt: null },
      { name: { $ilike: searchPattern } },
    ]
    if (tenantScope) {
      organizationSearchFilters.push({ tenant: tenantScope })
    }
    const matchingOrganizations = await em.find(
      Organization,
      organizationSearchFilters.length > 1 ? { $and: organizationSearchFilters } : organizationSearchFilters[0],
    )
    const matchingOrganizationIds = matchingOrganizations
      .map((org) => (org?.id ? String(org.id) : null))
      .filter((orgId): orgId is string => typeof orgId === 'string' && orgId.length > 0)
    if (matchingOrganizationIds.length) {
      searchFilters.push({ organizationId: { $in: matchingOrganizationIds as any } })
    }

    const roleSearchFilters: any[] = [
      { deletedAt: null },
      { name: { $ilike: searchPattern } },
    ]
    if (tenantScope) {
      roleSearchFilters.push({ $or: [{ tenantId: tenantScope }, { tenantId: null }] })
    }
    const matchingRoles = await em.find(
      Role,
      roleSearchFilters.length > 1 ? { $and: roleSearchFilters } : roleSearchFilters[0],
    )
    const matchingRoleIds = matchingRoles
      .map((role) => (role?.id ? String(role.id) : null))
      .filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
    if (matchingRoleIds.length) {
      const roleSearchLinks = await em.find(
        UserRole,
        { role: { $in: matchingRoleIds as any } } as any,
      )
      const matchingRoleUserIds = Array.from(new Set(
        roleSearchLinks
          .map((link) => {
            const userRef = (link as any).user
            const userId = userRef?.id ?? userRef
            return userId ? String(userId) : null
          })
          .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
      ))
      if (matchingRoleUserIds.length) {
        searchFilters.push({ id: { $in: matchingRoleUserIds as any } })
      }
    }

    if (!searchFilters.length) {
      return NextResponse.json({ items: [], total: 0, totalPages: 1, isSuperAdmin })
    }

    filters.push(searchFilters.length > 1 ? { $or: searchFilters } : searchFilters[0])
  }
  if (idFilter && idFilter.size) {
    filters.push({ id: { $in: Array.from(idFilter) as any } })
  } else if (id) {
    filters.push({ id })
  }
  const where = filters.length > 1 ? { $and: filters } : filters[0]
  const [rows, count] = await em.findAndCount(User, where, { limit: pageSize, offset: (page - 1) * pageSize })
  const userIds = rows.map((u: any) => u.id)
  const links = userIds.length
    ? await findWithDecryption(
        em,
        UserRole,
        { user: { $in: userIds as any } } as any,
        { populate: ['role'] },
        { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
      )
    : []
  const roleMap: Record<string, string[]> = {}
  const roleIdMap: Record<string, string[]> = {}
  for (const l of links) {
    const uid = String((l as any).user?.id || (l as any).user)
    const rname = String((l as any).role?.name || '')
    const rid = String((l as any).role?.id ?? '')
    if (!roleMap[uid]) roleMap[uid] = []
    if (!roleIdMap[uid]) roleIdMap[uid] = []
    if (rname) roleMap[uid].push(rname)
    if (rid) roleIdMap[uid].push(rid)
  }
  const orgIds = rows
    .map((u: any) => (u.organizationId ? String(u.organizationId) : null))
    .filter((id): id is string => !!id)
  const uniqueOrgIds = Array.from(new Set(orgIds))
  let orgMap: Record<string, string> = {}
  if (uniqueOrgIds.length) {
    const organizations = await em.find(
      Organization,
      { id: { $in: uniqueOrgIds as any }, deletedAt: null },
    )
    orgMap = organizations.reduce<Record<string, string>>((acc, org) => {
      const orgId = org?.id ? String(org.id) : null
      if (!orgId) return acc
      const rawName = (org as any)?.name
      const orgName = typeof rawName === 'string' && rawName.length > 0 ? rawName : orgId
      acc[orgId] = orgName
      return acc
    }, {})
  }
  const tenantIds = rows
    .map((u: any) => (u.tenantId ? String(u.tenantId) : null))
    .filter((id): id is string => !!id)
  const uniqueTenantIds = Array.from(new Set(tenantIds))
  let tenantMap: Record<string, string> = {}
  if (uniqueTenantIds.length) {
    const tenants = await em.find(
      Tenant,
      { id: { $in: uniqueTenantIds as any }, deletedAt: null },
    )
    tenantMap = tenants.reduce<Record<string, string>>((acc, tenant) => {
      const tenantId = tenant?.id ? String(tenant.id) : null
      if (!tenantId) return acc
      const rawName = (tenant as any)?.name
      const tenantName = typeof rawName === 'string' && rawName.length > 0 ? rawName : tenantId
      acc[tenantId] = tenantName
      return acc
    }, {})
  }
  const tenantByUser: Record<string, string | null> = {}
  const organizationByUser: Record<string, string | null> = {}
  for (const u of rows) {
    const uid = String(u.id)
    tenantByUser[uid] = u.tenantId ? String(u.tenantId) : null
    organizationByUser[uid] = u.organizationId ? String(u.organizationId) : null
  }
  const cfByUser = userIds.length
    ? await loadCustomFieldValues({
        em,
        entityId: E.auth.user,
        recordIds: userIds.map(String),
        tenantIdByRecord: tenantByUser,
        organizationIdByRecord: organizationByUser,
        tenantFallbacks: auth.tenantId ? [auth.tenantId] : [],
      })
    : {}

  const items = rows.map((u: any) => {
    const uid = String(u.id)
    const orgId = u.organizationId ? String(u.organizationId) : null
    return {
      id: uid,
      email: String(u.email),
      organizationId: orgId,
      organizationName: orgId ? orgMap[orgId] ?? orgId : null,
      tenantId: u.tenantId ? String(u.tenantId) : null,
      tenantName: u.tenantId ? tenantMap[String(u.tenantId)] ?? String(u.tenantId) : null,
      roles: roleMap[uid] || [],
      roleIds: roleIdMap[uid] || [],
      hasPassword: !!u.passwordHash,
      ...(cfByUser[uid] || {}),
    }
  })
  const totalPages = Math.max(1, Math.ceil(count / pageSize))
  await logCrudAccess({
    container,
    auth,
    request: req,
    items,
    idField: 'id',
    resourceKind: 'auth.user',
    organizationId: null,
    tenantId: auth.tenantId ?? null,
    query: parsed.data,
    accessType: id ? 'read:item' : undefined,
  })
  return NextResponse.json({ items, total: count, totalPages, isSuperAdmin })
}

export const POST = async (req: Request) => {
  return crud.POST(req)
}

export const PUT = async (req: Request) => {
  return crud.PUT(req)
}

export const DELETE = crud.DELETE

async function findUserIdsBySearchTokens(
  em: EntityManager,
  entityType: string,
  search: string,
  tenantScope: string | null | undefined,
): Promise<string[] | null> {
  const trimmed = search.trim()
  if (!trimmed) return null
  const searchConfig = resolveSearchConfig()
  if (!searchConfig.enabled) return []
  const { hashes } = tokenizeText(trimmed, searchConfig)
  if (!hashes.length) return []

  const db = (em as any).getKysely() as any
  let query = db
    .selectFrom('search_tokens')
    .select('entity_id')
    .where('entity_type', '=', entityType)
    .where('token_hash', 'in', hashes)
    .groupBy('entity_id')
    .having(sql<boolean>`count(distinct token_hash) >= ${hashes.length}`)
  if (tenantScope !== undefined) {
    query = query.where(sql<boolean>`tenant_id is not distinct from ${tenantScope}`)
  }
  const rows = (await query.execute()) as Array<{ entity_id?: unknown }>
  return rows
    .map((row) => (typeof row.entity_id === 'string' ? row.entity_id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

async function assertCanAssignRoles(req: Request, roles: unknown, payload: Record<string, unknown>) {
  if (!Array.isArray(roles)) return
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) throw new CrudHttpError(401, { error: 'Unauthorized' })
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const tenantId = await resolveTargetTenantIdForRoleGrant(em, payload, auth.tenantId ?? null)
  await assertActorCanGrantRoleTokens({
    em,
    rbacService: container.resolve('rbacService') as RbacService,
    actorUserId: auth.sub,
    tenantId,
    organizationId: auth.orgId ?? null,
    roleTokens: roles,
  })
}

async function resolveTargetTenantIdForRoleGrant(
  em: EntityManager,
  payload: Record<string, unknown>,
  fallbackTenantId: string | null,
): Promise<string | null> {
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
  if (organizationId) {
    const organization = await em.findOne(Organization, { id: organizationId }, { populate: ['tenant'] })
    return organization?.tenant?.id ? String(organization.tenant.id) : fallbackTenantId
  }

  const userId = typeof payload.id === 'string' ? payload.id : null
  if (userId) {
    const user = await em.findOne(User, { id: userId, deletedAt: null })
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
        'Returns users for the current tenant. Search matches email, organization name, and role name. Super administrators may scope the response via organization or role filters.',
      query: querySchema,
      responses: [
        { status: 200, description: 'User collection', schema: userListResponseSchema },
      ],
    },
    POST: {
      summary: 'Create user',
      description: 'Creates a new confirmed user within the specified organization and optional roles.',
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
      description: 'Updates profile fields, organization assignment, credentials, or role memberships.',
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
