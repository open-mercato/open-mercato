import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FmsOfferLine, FmsOffer } from '../../data/entities'
import { fmsOfferLineCreateSchema } from '../../data/validators'

const listSchema = z.object({
  offerId: z.string().uuid(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const query = {
    offerId: url.searchParams.get('offerId'),
    page: url.searchParams.get('page') || '1',
    limit: url.searchParams.get('limit') || '50',
  }

  const parse = listSchema.safeParse(query)
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid query parameters', details: parse.error }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const filters: Record<string, unknown> = {
    offer: parse.data.offerId,
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

  const [items, total] = await em.findAndCount(FmsOfferLine, filters, {
    orderBy: { lineNumber: 'ASC', createdAt: 'ASC' },
    limit: parse.data.limit,
    offset: (parse.data.page - 1) * parse.data.limit,
  })

  return NextResponse.json({
    items,
    total,
    page: parse.data.page,
    limit: parse.data.limit,
    totalPages: Math.ceil(total / parse.data.limit),
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const validation = fmsOfferLineCreateSchema.partial().safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ error: 'Invalid input', details: validation.error }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const data = validation.data

  // Verify the offer exists and user has access
  const offer = await em.findOne(FmsOffer, { id: data.offerId, deletedAt: null })
  if (!offer) {
    return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  }

  const tenantId = auth.actorTenantId || auth.tenantId
  if (tenantId && offer.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  }

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) {
    scope.filterIds.forEach((id) => { if (typeof id === 'string') allowedOrgIds.add(id) })
  } else if (typeof auth.actorOrgId === 'string') {
    allowedOrgIds.add(auth.actorOrgId)
  } else if (typeof auth.orgId === 'string') {
    allowedOrgIds.add(auth.orgId)
  }

  if (allowedOrgIds.size && offer.organizationId && !allowedOrgIds.has(offer.organizationId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Get next line number
  const maxLine = await em.findOne(FmsOfferLine, { offer, deletedAt: null }, { orderBy: { lineNumber: 'DESC' } })
  const nextLineNumber = (maxLine?.lineNumber ?? -1) + 1

  const line = em.create(FmsOfferLine, {
    offer,
    organizationId: offer.organizationId,
    tenantId: offer.tenantId,
    lineNumber: data.lineNumber ?? nextLineNumber,
    chargeName: data.chargeName || 'New Charge',
    chargeCategory: data.chargeCategory || 'transport',
    chargeUnit: data.chargeUnit || 'per_container',
    containerType: data.containerType || null,
    quantity: data.quantity?.toString() || '1',
    currencyCode: data.currencyCode || offer.currencyCode || 'USD',
    unitPrice: data.unitPrice?.toString() || '0',
    amount: data.amount?.toString() || '0',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await em.persistAndFlush(line)

  return NextResponse.json(line, { status: 201 })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.view'] },
  POST: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.manage'] },
}
