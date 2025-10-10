/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Role, RoleAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { splitCustomFieldPayload, loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'

const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
}).passthrough()

const createSchema = z.object({
  name: z.string().min(2).max(100),
  tenantId: z.string().uuid().nullable().optional(),
})
const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(100).optional(),
  tenantId: z.string().uuid().nullable().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.roles.list'] },
  POST: { requireAuth: true, requireFeatures: ['auth.roles.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['auth.roles.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['auth.roles.manage'] },
}

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    id: url.searchParams.get('id') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
    search: url.searchParams.get('search') || undefined,
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
    console.error('roles: failed to resolve rbac', err)
  }
  const { id, page, pageSize, search } = parsed.data
  const where: any = { deletedAt: null }
  if (id) {
    where.id = id
  }
  if (search) where.name = { $ilike: `%${search}%` } as any
  const [rows, count] = await em.findAndCount(Role, where, { limit: pageSize, offset: (page - 1) * pageSize })
  const roleIds = rows.map((r: any) => r.id)
  const counts: Record<string, number> = {}
  if (roleIds.length) {
    const links = await em.find(UserRole, { role: { $in: roleIds as any } } as any)
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
    const tenants = await em.find(Tenant, { id: { $in: uniqueTenantIds as any }, deletedAt: null })
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
    ...Object.values(tenantByRole),
  ]))
  const cfByRole = roleIds.length
    ? await loadCustomFieldValues({
        em,
        entityId: E.auth.role,
        recordIds: roleIds.map((id: any) => String(id)),
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
      ...(cfByRole[idStr] || {}),
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
  const resolvedTenantId = parsed.data.tenantId === undefined ? auth.tenantId ?? null : parsed.data.tenantId
  const role = em.create(Role, { name: parsed.data.name, tenantId: resolvedTenantId })
  await em.persistAndFlush(role)
  if (Object.keys(custom).length) {
    await de.setCustomFields({
      entityId: E.auth.role,
      recordId: String(role.id),
      tenantId: resolvedTenantId ?? null,
      organizationId: null,
      values: custom,
      notify: false,
    })
  }
  await de.emitOrmEntityEvent({
    action: 'created',
    entity: role,
    identifiers: {
      id: String(role.id),
      organizationId: null,
      tenantId: resolvedTenantId ?? null,
    },
    events: { module: 'auth', entity: 'role', persistent: true },
    indexer: { entityType: E.auth.role },
  })
  return NextResponse.json({ id: String(role.id) })
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
  const de = resolve('dataEngine') as DataEngine
  const role = await em.findOne(Role, { id: parsed.data.id })
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (parsed.data.name !== undefined) (role as any).name = parsed.data.name
  if (parsed.data.tenantId !== undefined) (role as any).tenantId = parsed.data.tenantId ?? null
  await em.persistAndFlush(role)
  const roleTenantId = role?.tenantId ? String(role.tenantId) : null
  if (Object.keys(custom).length) {
    await de.setCustomFields({
      entityId: E.auth.role,
      recordId: String(role.id),
      tenantId: roleTenantId,
      organizationId: null,
      values: custom,
      notify: false,
    })
  }
  await de.emitOrmEntityEvent({
    action: 'updated',
    entity: role,
    identifiers: {
      id: String(role.id),
      organizationId: null,
      tenantId: roleTenantId,
    },
    events: { module: 'auth', entity: 'role', persistent: true },
    indexer: { entityType: E.auth.role },
  })
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
  const role = await em.findOne(Role, { id })
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const activeAssignments = await em.count(UserRole, { role, deletedAt: null })
  if (activeAssignments > 0) {
    return NextResponse.json({ error: 'Role has assigned users' }, { status: 400 })
  }
  await em.nativeDelete(RoleAcl, { role: id })
  const roleTenantId = role?.tenantId ? String(role.tenantId) : null
  await em.removeAndFlush(role)
  await de.emitOrmEntityEvent({
    action: 'deleted',
    entity: role,
    identifiers: {
      id: String(role.id),
      organizationId: null,
      tenantId: roleTenantId,
    },
    events: { module: 'auth', entity: 'role', persistent: true },
    indexer: { entityType: E.auth.role },
  })
  return NextResponse.json({ ok: true })
}
