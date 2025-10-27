/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logCrudAccess, makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { User, Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import type { EntityManager } from '@mikro-orm/postgresql'
import { userCrudEvents, userCrudIndexer } from '@open-mercato/core/modules/auth/commands/users'

const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
}).passthrough()

const rawBodySchema = z.object({}).passthrough()

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
      mapInput: async ({ parsed, req }) => {
        await assertCanAssignRoles(req, parsed.roles)
        return parsed
      },
      response: ({ result }) => ({ id: String(result.id) }),
      status: 201,
    },
    update: {
      commandId: 'auth.users.update',
      schema: rawBodySchema,
      mapInput: async ({ parsed, req }) => {
        await assertCanAssignRoles(req, parsed.roles)
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
  const em = container.resolve<EntityManager>('em')
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
  const where: any = { deletedAt: null }
  if (!isSuperAdmin) {
    if (!auth.tenantId) {
      return NextResponse.json({ items: [], total: 0, totalPages: 1, isSuperAdmin })
    }
    where.tenantId = auth.tenantId
  }
  if (organizationId) where.organizationId = organizationId
  if (search) where.email = { $ilike: `%${search}%` } as any
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
  if (idFilter && idFilter.size) {
    where.id = { $in: Array.from(idFilter) as any }
  } else if (id) {
    where.id = id
  }
  const [rows, count] = await em.findAndCount(User, where, { limit: pageSize, offset: (page - 1) * pageSize })
  const userIds = rows.map((u: any) => u.id)
  const links = userIds.length ? await em.find(UserRole, { user: { $in: userIds as any } } as any, { populate: ['role'] }) : []
  const roleMap: Record<string, string[]> = {}
  for (const l of links) {
    const uid = String((l as any).user?.id || (l as any).user)
    const rname = String((l as any).role?.name || '')
    if (!roleMap[uid]) roleMap[uid] = []
    if (rname) roleMap[uid].push(rname)
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
  const body = await req.clone().json().catch(() => ({}))
  await assertCanAssignRoles(req, body?.roles)
  return crud.POST(req)
}

export const PUT = async (req: Request) => {
  const body = await req.clone().json().catch(() => ({}))
  await assertCanAssignRoles(req, body?.roles)
  return crud.PUT(req)
}

export const DELETE = crud.DELETE

async function assertCanAssignRoles(req: Request, roles: unknown) {
  if (!Array.isArray(roles)) return
  if (!roles.includes('superadmin')) return
  const auth = await getAuthFromRequest(req)
  if (!auth) throw new Error('Unauthorized')
  const container = await createRequestContainer()
  const rbac = container.resolve('rbacService') as RbacService
  const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
  if (!acl?.isSuperAdmin) {
    throw new Error('Only superadmin users may assign the superadmin role')
  }
}
