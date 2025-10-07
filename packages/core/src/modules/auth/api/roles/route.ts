import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
}).passthrough()

const createSchema = z.object({ name: z.string().min(2).max(100) })
const updateSchema = z.object({ id: z.string().uuid(), name: z.string().min(2).max(100).optional() })

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
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
    search: url.searchParams.get('search') || undefined,
  })
  if (!parsed.success) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const { page, pageSize, search } = parsed.data
  const where: any = {}
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
  const body = await req.json().catch(() => ({}))
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const role = em.create(Role, { name: parsed.data.name })
  await em.persistAndFlush(role)
  return NextResponse.json({ id: String(role.id) })
}

export async function PUT(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const role = await em.findOne(Role, { id: parsed.data.id })
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (parsed.data.name !== undefined) (role as any).name = parsed.data.name
  await em.persistAndFlush(role)
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
  await em.removeAndFlush(role)
  return NextResponse.json({ ok: true })
}


