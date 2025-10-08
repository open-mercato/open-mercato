import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { tenantCreateSchema, tenantUpdateSchema } from '@open-mercato/core/modules/directory/data/validators'

const listQuerySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  sortField: z.enum(['name', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
}).passthrough()

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['directory.tenants.view'] },
  POST: { requireAuth: true, requireFeatures: ['directory.tenants.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['directory.tenants.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['directory.tenants.manage'] },
}

type TenantRow = {
  id: string
  name: string
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
}

const toRow = (tenant: Tenant): TenantRow => ({
  id: String(tenant.id),
  name: String(tenant.name),
  isActive: !!tenant.isActive,
  createdAt: tenant.createdAt ? tenant.createdAt.toISOString() : null,
  updatedAt: tenant.updatedAt ? tenant.updatedAt.toISOString() : null,
})

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 401 })

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse({
    id: url.searchParams.get('id') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    sortField: url.searchParams.get('sortField') ?? undefined,
    sortDir: url.searchParams.get('sortDir') ?? undefined,
    isActive: url.searchParams.get('isActive') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  const { id, page, pageSize, search, sortField, sortDir, isActive } = parsed.data
  const where: any = { deletedAt: null }
  if (id) where.id = id
  if (search) where.name = { $ilike: `%${search}%` } as any
  if (isActive === 'true') where.isActive = true
  if (isActive === 'false') where.isActive = false

  const fieldMap: Record<string, string> = { name: 'name', createdAt: 'createdAt', updatedAt: 'updatedAt' }
  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    const mapped = fieldMap[sortField] || 'name'
    orderBy[mapped] = (sortDir === 'desc' ? 'DESC' : 'ASC')
  } else {
    orderBy.name = 'ASC'
  }

  const [rows, total] = await em.findAndCount(Tenant, where, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    orderBy,
  })

  const items = rows.map((row: Tenant) => toRow(row))
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export async function POST(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const parsed = tenantCreateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const tenant = em.create(Tenant, {
    name: parsed.data.name,
    isActive: parsed.data.isActive ?? true,
  })
  await em.persistAndFlush(tenant)
  return NextResponse.json({ id: String(tenant.id) })
}

export async function PUT(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const parsed = tenantUpdateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const tenant = await em.findOne(Tenant, { id: parsed.data.id, deletedAt: null })
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (parsed.data.name !== undefined) tenant.name = parsed.data.name
  if (parsed.data.isActive !== undefined) tenant.isActive = parsed.data.isActive
  tenant.updatedAt = new Date()

  await em.persistAndFlush(tenant)
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
  const tenant = await em.findOne(Tenant, { id, deletedAt: null })
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  tenant.deletedAt = new Date()
  tenant.isActive = false
  await em.persistAndFlush(tenant)
  return NextResponse.json({ ok: true })
}
