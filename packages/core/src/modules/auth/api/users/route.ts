import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { User, Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'

const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  roleId: z.string().uuid().optional(),
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
  const parsed = querySchema.safeParse({
    id: url.searchParams.get('id') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
    search: url.searchParams.get('search') || undefined,
    organizationId: url.searchParams.get('organizationId') || undefined,
    roleId: url.searchParams.get('roleId') || undefined,
  })
  if (!parsed.success) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const { id, page, pageSize, search, organizationId, roleId } = parsed.data
  const where: any = {}
  if (id) where.id = id
  if (organizationId) where.organizationId = organizationId
  if (search) where.email = { $ilike: `%${search}%` } as any
  let baseIds: string[] | null = null
  if (roleId) {
    const linksForRole = await em.find(UserRole, { role: roleId as any })
    baseIds = linksForRole.map((l: any) => String(l.user?.id || l.user)).filter(Boolean)
    if (baseIds.length === 0) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
    where.id = { $in: baseIds as any }
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
  const items = rows.map((u: any) => ({ id: String(u.id), email: String(u.email), organizationId: u.organizationId ? String(u.organizationId) : null, tenantId: u.tenantId ? String(u.tenantId) : null, roles: roleMap[String(u.id)] || [] }))
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
  const { email, password, organizationId, roles } = parsed.data
  // Resolve tenant from organization
  const org = await em.findOneOrFail(require('@open-mercato/core/modules/directory/data/entities').Organization, { id: organizationId }, { populate: ['tenant'] })
  const { hash } = await import('bcryptjs')
  const passwordHash = await hash(password, 10)
  const user = em.create(User, { email, passwordHash, isConfirmed: true, organizationId: org.id, tenantId: org.tenant.id })
  await em.persistAndFlush(user)
  if (roles && roles.length) {
    for (const name of roles) {
      let role = await em.findOne(Role, { name })
      if (!role) { role = em.create(Role, { name }); await em.persistAndFlush(role) }
      const link = em.create(UserRole, { user, role })
      await em.persistAndFlush(link)
    }
  }
  return NextResponse.json({ id: String(user.id) })
}

export async function PUT(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const user = await em.findOne(User, { id: parsed.data.id })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (parsed.data.email !== undefined) (user as any).email = parsed.data.email
  if (parsed.data.organizationId !== undefined) (user as any).organizationId = parsed.data.organizationId
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
        if (!role) { role = em.create(Role, { name }); await em.persistAndFlush(role) }
        em.persist(em.create(UserRole, { user: user as any, role: role as any }))
      }
    }
    await em.flush()
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
  const user = await em.findOne(User, { id })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await em.removeAndFlush(user)
  return NextResponse.json({ ok: true })
}


