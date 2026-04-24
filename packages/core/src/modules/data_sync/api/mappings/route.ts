import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncMapping } from '@open-mercato/core/modules/data_sync/data/entities'

const listMappingsQuerySchema = z.object({
  integrationId: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const createMappingSchema = z.object({
  integrationId: z.string().min(1),
  entityType: z.string().min(1),
  mapping: z.record(z.string(), z.unknown()),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
  POST: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'List or create field mappings',
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listMappingsQuerySchema.safeParse({
    integrationId: url.searchParams.get('integrationId') ?? undefined,
    entityType: url.searchParams.get('entityType') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }

  const where: FilterQuery<SyncMapping> = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  }
  if (parsed.data.integrationId) where.integrationId = parsed.data.integrationId
  if (parsed.data.entityType) where.entityType = parsed.data.entityType

  const [items, total] = await findAndCountWithDecryption(
    em,
    SyncMapping,
    where,
    {
      orderBy: { createdAt: 'DESC' },
      limit: parsed.data.pageSize,
      offset: (parsed.data.page - 1) * parsed.data.pageSize,
    },
    scope,
  )

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      integrationId: item.integrationId,
      entityType: item.entityType,
      mapping: item.mapping,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)),
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await req.json().catch(() => null)
  const parsed = createMappingSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }

  const existing = await findOneWithDecryption(
    em,
    SyncMapping,
    {
      integrationId: parsed.data.integrationId,
      entityType: parsed.data.entityType,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    undefined,
    scope,
  )

  if (existing) {
    existing.mapping = parsed.data.mapping
    await em.flush()
    return NextResponse.json({
      id: existing.id,
      integrationId: existing.integrationId,
      entityType: existing.entityType,
      mapping: existing.mapping,
    })
  }

  const created = em.create(SyncMapping, {
    integrationId: parsed.data.integrationId,
    entityType: parsed.data.entityType,
    mapping: parsed.data.mapping,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  await em.persist(created).flush()

  return NextResponse.json({
    id: created.id,
    integrationId: created.integrationId,
    entityType: created.entityType,
    mapping: created.mapping,
  }, { status: 201 })
}
