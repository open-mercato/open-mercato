import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Role, RoleAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

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
  const { id, page, pageSize, search } = parsed.data
  const where: any = {}
  if (id) where.id = id
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
  const items = rows.map((r: any) => ({ id: String(r.id), name: String(r.name), usersCount: counts[String(r.id)] || 0 }))
  const totalPages = Math.max(1, Math.ceil(count / pageSize))
  return NextResponse.json({ items, total: count, totalPages })
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
