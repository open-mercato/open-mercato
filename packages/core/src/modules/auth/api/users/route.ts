import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { User, Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { splitCustomFieldPayload, loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'

const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
}).passthrough()

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  organizationId: z.string().uuid(),
  roles: z.array(z.string()).optional(),
})

const updateSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  organizationId: z.string().uuid().optional(),
  roles: z.array(z.string()).optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.users.list'] },
  POST: { requireAuth: true, requireFeatures: ['auth.users.create'] },
  PUT: { requireAuth: true, requireFeatures: ['auth.users.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['auth.users.delete'] },
}

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
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
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  let isSuperAdmin = false
  try {
    if (auth.sub) {
      const rbacService = resolve('rbacService') as any
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
  return NextResponse.json({ items, total: count, totalPages, isSuperAdmin })
}

export async function POST(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rawBody = await req.json().catch(() => ({}))
  const { base, custom } = splitCustomFieldPayload(rawBody)
  const parsed = createSchema.safeParse(base)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const de = resolve('dataEngine') as DataEngine
  let bus: any
  try { bus = resolve('eventBus') } catch { bus = null }
  const { email, password, organizationId, roles } = parsed.data
  // Resolve tenant from organization
  const org = await em.findOneOrFail(Organization, { id: organizationId }, { populate: ['tenant'] })
  const { hash } = await import('bcryptjs')
  const passwordHash = await hash(password, 10)
  const user = em.create(User, { email, passwordHash, isConfirmed: true, organizationId: org.id, tenantId: org.tenant.id })
  await em.persistAndFlush(user)
  if (roles && roles.length) {
    for (const name of roles) {
      let role = await em.findOne(Role, { name })
      if (!role) {
        const roleTenantId = user.tenantId ? String(user.tenantId) : null
        role = em.create(Role, { name, tenantId: roleTenantId })
        await em.persistAndFlush(role)
      }
      const link = em.create(UserRole, { user, role })
      await em.persistAndFlush(link)
    }
  }
  if (Object.keys(custom).length) {
    await de.setCustomFields({
      entityId: E.auth.user,
      recordId: String(user.id),
      organizationId: user.organizationId ? String(user.organizationId) : null,
      tenantId: user.tenantId ? String(user.tenantId) : null,
      values: custom,
      notify: false,
    })
  }
  if (bus) {
    try {
      const userOrgId = user.organizationId ? String(user.organizationId) : null
      const userTenantId = user.tenantId ? String(user.tenantId) : null
      await bus.emitEvent(
        'auth.user.created',
        {
          id: String(user.id),
          organizationId: userOrgId,
          tenantId: userTenantId,
        },
        { persistent: true },
      )
      await bus.emitEvent('query_index.upsert_one', {
        entityType: E.auth.user,
        recordId: String(user.id),
        organizationId: userOrgId,
        tenantId: userTenantId,
      })
    } catch {}
  }
  return NextResponse.json({ id: String(user.id) })
}

export async function PUT(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rawBody = await req.json().catch(() => ({}))
  const { base, custom } = splitCustomFieldPayload(rawBody)
  const parsed = updateSchema.safeParse(base)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const rbacService = resolve('rbacService') as any
  const de = resolve('dataEngine') as DataEngine
  let bus: any
  try { bus = resolve('eventBus') } catch { bus = null }
  const user = await em.findOne(User, { id: parsed.data.id })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  
  let shouldInvalidateCache = false
  
  if (parsed.data.email !== undefined) (user as any).email = parsed.data.email
  if (parsed.data.organizationId !== undefined) {
    (user as any).organizationId = parsed.data.organizationId
    shouldInvalidateCache = true // Organization changed affects ACL
  }
  if (parsed.data.password) {
    const { hash } = await import('bcryptjs')
    ;(user as any).passwordHash = await hash(parsed.data.password, 10)
  }
  await em.persistAndFlush(user)
  if (parsed.data.roles) {
    // Reset links to match provided roles
    const current = await em.find(UserRole, { user: user as any }, { populate: ['role'] })
    const currentNames = new Set(current.map((ur: any) => ur.role?.name).filter(Boolean) as string[])
    const desired = new Set(parsed.data.roles)
    for (const ur of current) {
      const name = String(ur.role?.name || '')
      if (!desired.has(name)) await em.remove(ur)
    }
    for (const name of desired) {
      if (!currentNames.has(name)) {
        let role = await em.findOne(Role, { name })
        if (!role) {
          const roleTenantId = user.tenantId ? String(user.tenantId) : null
          role = em.create(Role, { name, tenantId: roleTenantId })
          await em.persistAndFlush(role)
        }
        em.persist(em.create(UserRole, { user: user as any, role: role as any }))
      }
    }
    await em.flush()
    shouldInvalidateCache = true // Roles changed affects ACL
  }
  if (Object.keys(custom).length) {
    await de.setCustomFields({
      entityId: E.auth.user,
      recordId: String(user.id),
      organizationId: user.organizationId ? String(user.organizationId) : null,
      tenantId: user.tenantId ? String(user.tenantId) : null,
      values: custom,
      notify: false,
    })
  }
  if (bus) {
    try {
      const userOrgId = user.organizationId ? String(user.organizationId) : null
      const userTenantId = user.tenantId ? String(user.tenantId) : null
      await bus.emitEvent(
        'auth.user.updated',
        {
          id: String(user.id),
          organizationId: userOrgId,
          tenantId: userTenantId,
        },
        { persistent: true },
      )
      await bus.emitEvent('query_index.upsert_one', {
        entityType: E.auth.user,
        recordId: String(user.id),
        organizationId: userOrgId,
        tenantId: userTenantId,
      })
    } catch {}
  }
  
  // Invalidate cache if roles or organization changed
  if (shouldInvalidateCache) {
    await rbacService.invalidateUserCache(parsed.data.id)
    // Sidebar nav is cached per user; invalidate by rbac user tag
    try {
      const { resolve } = await createRequestContainer()
      const cache = resolve('cache') as any
      if (cache) await cache.deleteByTags([`rbac:user:${parsed.data.id}`])
    } catch {}
  }
  
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const rbacService = resolve('rbacService') as any
  let bus: any
  try { bus = resolve('eventBus') } catch { bus = null }
  const user = await em.findOne(User, { id })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const deletedOrgId = user.organizationId ? String(user.organizationId) : null
  const deletedTenantId = user.tenantId ? String(user.tenantId) : null
  await em.nativeDelete(UserRole, { user: user as any })
  await em.removeAndFlush(user)
  if (bus) {
    try {
      await bus.emitEvent(
        'auth.user.deleted',
        { id: String(id), organizationId: deletedOrgId, tenantId: deletedTenantId },
        { persistent: true },
      )
      await bus.emitEvent('query_index.delete_one', {
        entityType: E.auth.user,
        recordId: String(id),
        organizationId: deletedOrgId,
      })
    } catch {}
  }
  
  // Invalidate cache for deleted user
  await rbacService.invalidateUserCache(id)
  
  return NextResponse.json({ ok: true })
}
