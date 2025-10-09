import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Role, RoleAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'

const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
}).passthrough()

const createSchema = z.object({ name: z.string().min(2).max(100) })
const updateSchema = z.object({ id: z.string().uuid(), name: z.string().min(2).max(100).optional() })

type SplitBodyResult = { base: Record<string, any>; custom: Record<string, any> }

function splitCustomFieldPayload(raw: any): SplitBodyResult {
  const base: Record<string, any> = {}
  const custom: Record<string, any> = {}
  if (!raw || typeof raw !== 'object') return { base, custom }
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'customFields' && value && typeof value === 'object') {
      for (const [ck, cv] of Object.entries(value as Record<string, any>)) custom[String(ck)] = cv
      continue
    }
    if (key.startsWith('cf_')) {
      custom[key.slice(3)] = value
      continue
    }
    if (key.startsWith('cf:')) {
      custom[key.slice(3)] = value
      continue
    }
    base[key] = value
  }
  return { base, custom }
}

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
  let allowedRoleIds: Set<string> | null = null
  if (!isSuperAdmin) {
    if (!auth.tenantId) {
      return NextResponse.json({ items: [], total: 0, totalPages: 1, isSuperAdmin })
    }
    const tenantRoleAcls = await em.find(RoleAcl, { tenantId: auth.tenantId as any, deletedAt: null })
    allowedRoleIds = new Set(
      tenantRoleAcls
        .map((acl: any) => {
          const rid = acl?.role?.id ?? acl?.role
          return typeof rid === 'string' ? rid : null
        })
        .filter((rid): rid is string => !!rid),
    )
    if (allowedRoleIds.size === 0) {
      return NextResponse.json({ items: [], total: 0, totalPages: 1, isSuperAdmin })
    }
  }
  if (id) {
    if (allowedRoleIds && !allowedRoleIds.has(id)) {
      return NextResponse.json({ items: [], total: 0, totalPages: 1, isSuperAdmin })
    }
    where.id = id
  } else if (allowedRoleIds) {
    where.id = { $in: Array.from(allowedRoleIds) as any }
  }
  if (search) where.name = { $ilike: `%${search}%` } as any
  const [rows, count] = await em.findAndCount(Role, where, { limit: pageSize, offset: (page - 1) * pageSize })
  // Optional: include user counts
  const roleIds = rows.map((r: any) => r.id)
  const counts: Record<string, number> = {}
  if (roleIds.length) {
    const links = await em.find(UserRole, { role: { $in: roleIds as any } } as any)
    for (const l of links) {
      const rid = String((l as any).role?.id || (l as any).role)
      counts[rid] = (counts[rid] || 0) + 1
    }
  }
  const roleTenantMap = new Map<string, Set<string>>()
  if (roleIds.length) {
    const aclRows = await em.find(RoleAcl, { role: { $in: roleIds as any }, deletedAt: null })
    for (const acl of aclRows) {
      const roleId = String((acl as any).role?.id ?? (acl as any).role)
      const tenantRaw = (acl as any).tenantId
      if (!tenantRaw) continue
      const tenantId = String(tenantRaw)
      if (!roleTenantMap.has(roleId)) roleTenantMap.set(roleId, new Set())
      roleTenantMap.get(roleId)!.add(tenantId)
    }
  }
  const allTenantIds = new Set<string>()
  for (const ids of roleTenantMap.values()) {
    for (const tid of ids) allTenantIds.add(tid)
  }
  let tenantMap: Record<string, string> = {}
  if (allTenantIds.size) {
    const tenants = await em.find(Tenant, { id: { $in: Array.from(allTenantIds) as any }, deletedAt: null })
    tenantMap = tenants.reduce<Record<string, string>>((acc, tenant) => {
      const tid = tenant?.id ? String(tenant.id) : null
      if (!tid) return acc
      const rawName = (tenant as any)?.name
      const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : tid
      acc[tid] = name
      return acc
    }, {})
  }
  const cfByRole: Record<string, Record<string, unknown>> = {}
  if (roleIds.length) {
    const cfTenantIds = isSuperAdmin
      ? Array.from(allTenantIds)
      : auth.tenantId
        ? [auth.tenantId]
        : []
    const cfWhere: Record<string, any> = {
      entityId: E.auth.role as any,
      recordId: { $in: roleIds.map((id: any) => String(id)) as any },
      organizationId: null,
      deletedAt: null,
    }
    if (cfTenantIds.length) {
      cfWhere.tenantId = { $in: [...cfTenantIds, null] as any }
    } else {
      cfWhere.tenantId = null
    }
    const cfRows = await em.find(CustomFieldValue, cfWhere)
    for (const row of cfRows) {
      const recordId = String((row as any).recordId)
      const key = String((row as any).fieldKey)
      const value =
        (row as any).valueText ??
        (row as any).valueMultiline ??
        ((row as any).valueInt !== null && (row as any).valueInt !== undefined ? (row as any).valueInt : undefined) ??
        ((row as any).valueFloat !== null && (row as any).valueFloat !== undefined ? (row as any).valueFloat : undefined) ??
        ((row as any).valueBool !== null && (row as any).valueBool !== undefined ? (row as any).valueBool : undefined)
      if (value === undefined) continue
      const bucket = cfByRole[recordId] || (cfByRole[recordId] = {})
      const existing = bucket[key]
      if (existing === undefined) {
        bucket[key] = value
      } else if (Array.isArray(existing)) {
        bucket[key] = [...existing, value]
      } else {
        bucket[key] = [existing, value]
      }
    }
  }
  const items = rows.map((r: any) => {
    const idStr = String(r.id)
    const tenantSet = roleTenantMap.get(idStr) ?? new Set<string>()
    const visibleTenantIds = isSuperAdmin
      ? Array.from(tenantSet)
      : auth.tenantId
        ? Array.from(tenantSet).filter((tid) => tid === auth.tenantId)
        : []
    const tenantNames = visibleTenantIds.map((tid) => tenantMap[tid] ?? tid)
    const cfEntries = cfByRole[idStr] || {}
    const customFields: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cfEntries)) customFields[`cf_${k}`] = v
    return {
      id: idStr,
      name: String(r.name),
      usersCount: counts[idStr] || 0,
      tenantIds: visibleTenantIds,
      tenantName: tenantNames.length ? tenantNames.join(', ') : null,
      ...customFields,
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
  const role = em.create(Role, { name: parsed.data.name })
  await em.persistAndFlush(role)
  if (Object.keys(custom).length) {
    await de.setCustomFields({
      entityId: E.auth.role,
      recordId: String(role.id),
      tenantId: auth.tenantId ?? null,
      organizationId: null,
      values: custom,
      notify: false,
    })
  }
  if (bus) {
    try {
      await bus.emitEvent('auth.role.created', { id: String(role.id), tenantId: auth.tenantId ?? null, organizationId: null }, { persistent: true })
      await bus.emitEvent('query_index.upsert_one', { entityType: E.auth.role, recordId: String(role.id), organizationId: null, tenantId: auth.tenantId ?? null })
    } catch {}
  }
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
  let bus: any
  try { bus = resolve('eventBus') } catch { bus = null }
  const role = await em.findOne(Role, { id: parsed.data.id })
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (parsed.data.name !== undefined) (role as any).name = parsed.data.name
  await em.persistAndFlush(role)
  if (Object.keys(custom).length) {
    await de.setCustomFields({
      entityId: E.auth.role,
      recordId: String(role.id),
      tenantId: auth.tenantId ?? null,
      organizationId: null,
      values: custom,
      notify: false,
    })
  }
  if (bus) {
    try {
      await bus.emitEvent('auth.role.updated', { id: String(role.id), tenantId: auth.tenantId ?? null, organizationId: null }, { persistent: true })
      await bus.emitEvent('query_index.upsert_one', { entityType: E.auth.role, recordId: String(role.id), organizationId: null, tenantId: auth.tenantId ?? null })
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
  const role = await em.findOne(Role, { id })
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const activeAssignments = await em.count(UserRole, { role, deletedAt: null })
  if (activeAssignments > 0) {
    return NextResponse.json({ error: 'Role has assigned users' }, { status: 400 })
  }
  await em.nativeDelete(RoleAcl, { role: id })
  await em.removeAndFlush(role)
  try {
    const bus = resolve('eventBus') as any
    await bus.emitEvent('auth.role.deleted', { id: String(role.id), tenantId: auth.tenantId ?? null, organizationId: null }, { persistent: true })
    await bus.emitEvent('query_index.delete_one', { entityType: E.auth.role, recordId: String(role.id), organizationId: null })
  } catch {}
  return NextResponse.json({ ok: true })
}
