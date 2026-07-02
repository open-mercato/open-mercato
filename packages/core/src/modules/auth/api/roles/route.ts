/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { logCrudAccess, makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Role, RoleAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { E } from '#generated/entities.ids.generated'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { roleCrudEvents, roleCrudIndexer } from '@open-mercato/core/modules/auth/commands/roles'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { assertActorCanModifySuperAdminRoleTarget } from '@open-mercato/core/modules/auth/lib/grantChecks'
import { enforceRoleTenantAccess } from '@open-mercato/core/modules/auth/lib/roleTenantGuard'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { runWithCacheTenant } from '@open-mercato/cache'
import {
  buildCollectionTags,
  isCrudCacheEnabled,
  resolveCrudCache,
} from '@open-mercato/shared/lib/crud/cache'

const ROLES_LIST_CACHE_TTL_MS = 120_000

function buildRolesListCacheKey(scope: {
  tenantId: string | null
  isSuperAdmin: boolean
  actorTenantId: string | null
  tenantFilter: string | null
  id?: string
  page: number
  pageSize: number
  search?: string
}): string {
  const parts = [
    'auth:roles:list',
    `tenant:${scope.tenantId ?? 'null'}`,
    `super:${scope.isSuperAdmin ? '1' : '0'}`,
    `actor:${scope.actorTenantId ?? 'null'}`,
    `filter:${scope.tenantFilter ?? 'null'}`,
    `id:${scope.id ?? ''}`,
    `page:${scope.page}`,
    `size:${scope.pageSize}`,
    `q:${scope.search ?? ''}`,
  ]
  return parts.join('|')
}

const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  tenantId: z.string().uuid().optional(),
}).passthrough()

const roleCreateSchema = z.object({
  name: z.string().min(2).max(100),
  tenantId: z.string().uuid().optional(),
})

const roleUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(100).optional(),
  tenantId: z.string().uuid().optional(),
})

const roleListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  usersCount: z.number().int().nonnegative(),
  tenantId: z.string().uuid().nullable(),
  tenantIds: z.array(z.string().uuid()).optional(),
  tenantName: z.string().nullable(),
  updatedAt: z.string().nullable().optional(),
})

const roleListResponseSchema = z.object({
  items: z.array(roleListItemSchema),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
  isSuperAdmin: z.boolean().optional(),
})

const okResponseSchema = z.object({ ok: z.literal(true) })

const errorResponseSchema = z.object({ error: z.string() })

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.roles.list'] },
  POST: { requireAuth: true, requireFeatures: ['auth.roles.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['auth.roles.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['auth.roles.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: Role,
    idField: 'id',
    orgField: null,
    tenantField: null,
    softDeleteField: 'deletedAt',
  },
  events: roleCrudEvents,
  indexer: roleCrudIndexer,
  actions: {
    create: {
      commandId: 'auth.roles.create',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) =>
        enforceRoleTenantAccess('create', parsed, { auth: ctx.auth, container: ctx.container }),
      response: ({ result }) => ({ id: String(result.id) }),
      status: 201,
    },
    update: {
      commandId: 'auth.roles.update',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        if (ctx.request && typeof parsed.id === 'string' && parsed.id.length) {
          await assertCanModifySuperAdminRole(ctx.request, parsed.id)
        }
        return enforceRoleTenantAccess('update', parsed, { auth: ctx.auth, container: ctx.container })
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'auth.roles.delete',
      mapInput: async ({ parsed, raw, ctx }) => {
        const targetId = resolveDeleteTargetId(parsed, raw)
        if (ctx.request && targetId) {
          await assertCanModifySuperAdminRole(ctx.request, targetId)
        }
        return enforceRoleTenantAccess('delete', parsed, { auth: ctx.auth, container: ctx.container })
      },
      response: () => ({ ok: true }),
    },
  },
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    id: url.searchParams.get('id') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
    search: url.searchParams.get('search') || undefined,
    tenantId: url.searchParams.get('tenantId') || undefined,
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
    console.error('roles: failed to resolve rbac', err)
  }
  const actorTenantId = auth.tenantId ? String(auth.tenantId) : null
  if (!isSuperAdmin && !actorTenantId) {
    return NextResponse.json({ items: [], total: 0, totalPages: 1, isSuperAdmin })
  }
  const { id, page, pageSize, search, tenantId: requestedTenantId } = parsed.data
  const tenantFilter = isSuperAdmin && requestedTenantId ? String(requestedTenantId) : null
  const cacheTenantId = auth.tenantId ? String(auth.tenantId) : null
  const cache = isCrudCacheEnabled() ? resolveCrudCache(container) : null
  const cacheKey = cache
    ? buildRolesListCacheKey({
        tenantId: cacheTenantId,
        isSuperAdmin,
        actorTenantId,
        tenantFilter,
        id,
        page,
        pageSize,
        search,
      })
    : null
  if (cache && cacheKey) {
    const cached = await runWithCacheTenant(cacheTenantId, () => cache.get(cacheKey))
    if (cached) return NextResponse.json(cached)
  }
  let superAdminRoleIds: Set<string> | null = null
  if (!isSuperAdmin && actorTenantId) {
    const superAdminAcls = await findWithDecryption(em, RoleAcl, { tenantId: actorTenantId, isSuperAdmin: true }, {}, { tenantId: actorTenantId, organizationId: null })
    if (superAdminAcls.length) {
      superAdminRoleIds = new Set(
        superAdminAcls
          .map((acl) => {
            const roleRef = acl.role
            const idValue = roleRef?.id
            return idValue ? String(idValue) : null
          })
          .filter((id): id is string => !!id),
      )
    } else {
      superAdminRoleIds = new Set()
    }
  }
  const filters: any[] = [{ deletedAt: null }]
  if (id) filters.push({ id })
  if (search) filters.push({ name: { $ilike: `%${escapeLikePattern(search)}%` } })
  if (!isSuperAdmin && actorTenantId) {
    filters.push({ tenantId: actorTenantId })
    filters.push({ name: { $ne: 'superadmin' } })
    if (superAdminRoleIds && superAdminRoleIds.size) {
      filters.push({ id: { $nin: Array.from(superAdminRoleIds) } })
    }
  } else if (tenantFilter) {
    filters.push({ tenantId: tenantFilter })
  }
  const where = filters.length > 1 ? { $and: filters } : filters[0]
  const [rows, count] = await em.findAndCount(Role, where, { limit: pageSize, offset: (page - 1) * pageSize })
  const roleIds = rows.map((r: any) => String(r.id))
  const counts: Record<string, number> = {}
  if (roleIds.length) {
    const userRoleFilter: FilterQuery<UserRole> = { role: { $in: roleIds }, deletedAt: null }
    const links = await findWithDecryption(em, UserRole, userRoleFilter, {}, { tenantId: null, organizationId: null })
    for (const l of links) {
      const rid = String((l as any).role?.id || (l as any).role)
      counts[rid] = (counts[rid] || 0) + 1
    }
  }
  const roleTenantIds = rows
    .map((role: any) => (role.tenantId ? String(role.tenantId) : null))
    .filter((tenantId): tenantId is string => typeof tenantId === 'string' && tenantId.length > 0)
  const uniqueTenantIds = Array.from(new Set(roleTenantIds))
  let tenantMap: Record<string, string> = {}
  if (uniqueTenantIds.length) {
    const tenants = await findWithDecryption(em, Tenant, { id: { $in: uniqueTenantIds as any }, deletedAt: null }, {}, { tenantId: null, organizationId: null })
    tenantMap = tenants.reduce<Record<string, string>>((acc, tenant) => {
      const tid = tenant?.id ? String(tenant.id) : null
      if (!tid) return acc
      const rawName = (tenant as any)?.name
      const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : tid
      acc[tid] = name
      return acc
    }, {})
  }
  const tenantByRole: Record<string, string | null> = {}
  for (const role of rows) {
    const rid = String(role.id)
    tenantByRole[rid] = role.tenantId ? String(role.tenantId) : null
  }
  const tenantFallbacks = Array.from(new Set<string | null>([
    auth.tenantId ?? null,
    tenantFilter ?? null,
    ...Object.values(tenantByRole),
  ]))
  const cfByRole = roleIds.length
    ? await loadCustomFieldValues({
        em,
        entityId: E.auth.role,
        recordIds: roleIds,
        tenantIdByRecord: tenantByRole,
        tenantFallbacks,
      })
    : {}
  const items = rows.map((r: any) => {
    const idStr = String(r.id)
    const tenantId = tenantByRole[idStr]
    const tenantName = tenantId ? tenantMap[tenantId] ?? tenantId : null
    const exposeTenant = isSuperAdmin || (tenantId && auth.tenantId && tenantId === auth.tenantId)
    return {
      id: idStr,
      name: String(r.name),
      usersCount: counts[idStr] || 0,
      tenantId: tenantId ?? null,
      tenantIds: exposeTenant && tenantId ? [tenantId] : [],
      tenantName: exposeTenant ? tenantName : null,
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : null,
      ...(cfByRole[idStr] || {}),
    }
  })
  const totalPages = Math.max(1, Math.ceil(count / pageSize))
  await logCrudAccess({
    container,
    auth,
    request: req,
    items,
    idField: 'id',
    resourceKind: 'auth.role',
    organizationId: null,
    tenantId: auth.tenantId ?? null,
    query: parsed.data,
    accessType: id ? 'read:item' : undefined,
  })
  const payload = { items, total: count, totalPages, isSuperAdmin }
  if (cache && cacheKey) {
    try {
      await runWithCacheTenant(cacheTenantId, () =>
        cache.set(cacheKey, payload, {
          ttl: ROLES_LIST_CACHE_TTL_MS,
          tags: [
            // Roles are tenant-level (org:null) — flushed on auth.roles.* command writes.
            ...buildCollectionTags('auth.role', cacheTenantId, [null]),
            // usersCount derives from UserRole grants — flushed on auth.users.* command
            // writes. Those writes also flush org-scoped collection tags, so the short
            // TTL backstops cross-org user mutations the org:null tag does not cover.
            ...buildCollectionTags('auth.user', cacheTenantId, [null]),
            // Role-ACL feature changes flush rbac:tenant:<T> from the roles/acl route.
            `rbac:tenant:${cacheTenantId ?? 'null'}`,
          ],
        }),
      )
    } catch (err) {
      console.warn('[auth:roles] Failed to set roles list cache', err)
    }
  }
  return NextResponse.json(payload)
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = async (req: Request) => {
  const targetId = new URL(req.url).searchParams.get('id')
  if (targetId) {
    try {
      await assertCanModifySuperAdminRole(req, targetId)
    } catch (err) {
      if (err instanceof CrudHttpError) {
        return NextResponse.json(err.body, { status: err.status })
      }
      throw err
    }
  }
  return crud.DELETE(req)
}

async function assertCanModifySuperAdminRole(req: Request, targetRoleId: string) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) throw new CrudHttpError(401, { error: 'Unauthorized' })
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  await assertActorCanModifySuperAdminRoleTarget({
    em,
    rbacService: container.resolve('rbacService') as RbacService,
    actorUserId: auth.sub,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    targetRoleId,
  })
}

function resolveDeleteTargetId(parsed: unknown, raw: unknown): string | null {
  const fromParsed = readId(parsed as Record<string, unknown> | null | undefined)
  if (fromParsed) return fromParsed
  const rawRecord = raw as { body?: Record<string, unknown>; query?: Record<string, unknown> } | null | undefined
  return readId(rawRecord?.query) ?? readId(rawRecord?.body)
}

function readId(record: Record<string, unknown> | null | undefined): string | null {
  const value = record?.id
  return typeof value === 'string' && value.length > 0 ? value : null
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Role management',
  methods: {
    GET: {
      summary: 'List roles',
      description:
        'Returns available roles within the current tenant. Super administrators receive visibility across tenants.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Role collection', schema: roleListResponseSchema },
      ],
    },
    POST: {
      summary: 'Create role',
      description: 'Creates a new role anchored to the caller\'s tenant. Non-superadmins cannot target another tenant; supplying a foreign `tenantId` is rejected.',
      requestBody: {
        contentType: 'application/json',
        schema: roleCreateSchema,
      },
      responses: [
        {
          status: 201,
          description: 'Role created',
          schema: z.object({ id: z.string().uuid() }),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
    PUT: {
      summary: 'Update role',
      description: 'Updates mutable fields on an existing role.',
      requestBody: {
        contentType: 'application/json',
        schema: roleUpdateSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Role updated',
          schema: okResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Role not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Delete role',
      description: 'Deletes a role by identifier. Fails when users remain assigned.',
      query: z.object({ id: z.string().uuid().describe('Role identifier') }),
      responses: [
        { status: 200, description: 'Role deleted', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Role cannot be deleted', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Role not found', schema: errorResponseSchema },
      ],
    },
  },
}
