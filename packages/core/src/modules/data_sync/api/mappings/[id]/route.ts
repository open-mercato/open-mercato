import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SyncMapping } from '../../../data/entities'

const idParamsSchema = z.object({ id: z.string().uuid() })

const updateMappingSchema = z.object({
  mapping: z.record(z.string(), z.unknown()),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_sync.view'] },
  PUT: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
  DELETE: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'Get, update, or delete a field mapping',
}

async function resolveParams(ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const rawParams = (ctx.params && typeof (ctx.params as Promise<unknown>).then === 'function')
    ? await (ctx.params as Promise<{ id?: string }>)
    : (ctx.params as { id?: string } | undefined)
  return idParamsSchema.safeParse(rawParams)
}

export async function GET(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsedParams = await resolveParams(ctx)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid mapping id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const mapping = await em.findOne(SyncMapping, {
    id: parsedParams.data.id,
    organizationId: auth.orgId as string,
    tenantId: auth.tenantId,
  })

  if (!mapping) {
    return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: mapping.id,
    integrationId: mapping.integrationId,
    entityType: mapping.entityType,
    mapping: mapping.mapping,
    createdAt: mapping.createdAt.toISOString(),
    updatedAt: mapping.updatedAt.toISOString(),
  })
}

export async function PUT(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsedParams = await resolveParams(ctx)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid mapping id' }, { status: 400 })
  }

  const parsedBody = updateMappingSchema.safeParse(await req.json())
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsedBody.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const mapping = await em.findOne(SyncMapping, {
    id: parsedParams.data.id,
    organizationId: auth.orgId as string,
    tenantId: auth.tenantId,
  })

  if (!mapping) {
    return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })
  }

  mapping.mapping = parsedBody.data.mapping
  await em.flush()

  return NextResponse.json({
    id: mapping.id,
    integrationId: mapping.integrationId,
    entityType: mapping.entityType,
    mapping: mapping.mapping,
    updatedAt: mapping.updatedAt.toISOString(),
  })
}

export async function DELETE(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsedParams = await resolveParams(ctx)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid mapping id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const mapping = await em.findOne(SyncMapping, {
    id: parsedParams.data.id,
    organizationId: auth.orgId as string,
    tenantId: auth.tenantId,
  })

  if (!mapping) {
    return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })
  }

  em.remove(mapping)
  await em.flush()

  return NextResponse.json({ deleted: true })
}
