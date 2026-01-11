import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FmsQuoteLine } from '../../../data/entities'
import { fmsQuoteLineUpdateSchema } from '../../../data/validators'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid line id' }, { status: 400 })

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const filters: Record<string, unknown> = {
    id: parse.data.id,
    deletedAt: null,
  }

  const tenantId = auth.actorTenantId || auth.tenantId
  if (tenantId) {
    filters.tenantId = tenantId
  }

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) {
    scope.filterIds.forEach((id) => { if (typeof id === 'string') allowedOrgIds.add(id) })
  } else if (typeof auth.actorOrgId === 'string') {
    allowedOrgIds.add(auth.actorOrgId)
  } else if (typeof auth.orgId === 'string') {
    allowedOrgIds.add(auth.orgId)
  }

  if (allowedOrgIds.size) {
    filters.organizationId = { $in: [...allowedOrgIds] }
  }

  const line = await em.findOne(FmsQuoteLine, filters)

  if (!line) return NextResponse.json({ error: 'Line not found' }, { status: 404 })

  return NextResponse.json(line)
}

export async function PUT(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid line id' }, { status: 400 })

  const body = await req.json()
  const validation = fmsQuoteLineUpdateSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ error: 'Invalid input', details: validation.error }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const filters: Record<string, unknown> = {
    id: parse.data.id,
    deletedAt: null,
  }

  const tenantId = auth.actorTenantId || auth.tenantId
  if (tenantId) {
    filters.tenantId = tenantId
  }

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) {
    scope.filterIds.forEach((id) => { if (typeof id === 'string') allowedOrgIds.add(id) })
  } else if (typeof auth.actorOrgId === 'string') {
    allowedOrgIds.add(auth.actorOrgId)
  } else if (typeof auth.orgId === 'string') {
    allowedOrgIds.add(auth.orgId)
  }

  if (allowedOrgIds.size) {
    filters.organizationId = { $in: [...allowedOrgIds] }
  }

  const line = await em.findOne(FmsQuoteLine, filters)

  if (!line) return NextResponse.json({ error: 'Line not found' }, { status: 404 })

  const data = validation.data

  // Update fields if provided
  if (data.lineNumber !== undefined) line.lineNumber = data.lineNumber
  if (data.productId !== undefined) line.productId = data.productId
  if (data.variantId !== undefined) line.variantId = data.variantId
  if (data.priceId !== undefined) line.priceId = data.priceId
  if (data.productName !== undefined) line.productName = data.productName
  if (data.chargeCode !== undefined) line.chargeCode = data.chargeCode || null
  if (data.productType !== undefined) line.productType = data.productType || null
  if (data.providerName !== undefined) line.providerName = data.providerName || null
  if (data.containerSize !== undefined) line.containerSize = data.containerSize || null
  if (data.contractType !== undefined) line.contractType = data.contractType || null
  if (data.quantity !== undefined) line.quantity = data.quantity.toString()
  if (data.currencyCode !== undefined) line.currencyCode = data.currencyCode
  if (data.unitCost !== undefined) line.unitCost = data.unitCost.toString()
  if (data.marginPercent !== undefined) line.marginPercent = data.marginPercent.toString()
  if (data.unitSales !== undefined) line.unitSales = data.unitSales.toString()

  line.updatedAt = new Date()

  await em.flush()

  return NextResponse.json(line)
}

export async function DELETE(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid line id' }, { status: 400 })

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const filters: Record<string, unknown> = {
    id: parse.data.id,
    deletedAt: null,
  }

  const tenantId = auth.actorTenantId || auth.tenantId
  if (tenantId) {
    filters.tenantId = tenantId
  }

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) {
    scope.filterIds.forEach((id) => { if (typeof id === 'string') allowedOrgIds.add(id) })
  } else if (typeof auth.actorOrgId === 'string') {
    allowedOrgIds.add(auth.actorOrgId)
  } else if (typeof auth.orgId === 'string') {
    allowedOrgIds.add(auth.orgId)
  }

  if (allowedOrgIds.size) {
    filters.organizationId = { $in: [...allowedOrgIds] }
  }

  const line = await em.findOne(FmsQuoteLine, filters)

  if (!line) return NextResponse.json({ error: 'Line not found' }, { status: 404 })

  // Soft delete
  line.deletedAt = new Date()
  await em.flush()

  return NextResponse.json({ success: true })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.view'] },
  PUT: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.manage'] },
}
