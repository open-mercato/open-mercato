import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FmsOffer, FmsQuote } from '../../data/entities'
import { fmsOfferCreateSchema } from '../../data/validators'

const listSchema = z.object({
  quoteId: z.string().uuid(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const query = {
    quoteId: url.searchParams.get('quoteId'),
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
    quote: parse.data.quoteId,
    deletedAt: null,
  }

  if (auth.tenantId) {
    filters.tenantId = auth.tenantId
  }

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
  else if (auth.orgId) allowedOrgIds.add(auth.orgId)

  if (allowedOrgIds.size) {
    filters.organizationId = { $in: [...allowedOrgIds] }
  }

  const [items, total] = await em.findAndCount(FmsOffer, filters, {
    orderBy: { createdAt: 'DESC' },
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
  const validation = fmsOfferCreateSchema.partial().safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ error: 'Invalid input', details: validation.error }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const data = validation.data

  // Verify the quote exists and user has access
  const quote = await em.findOne(FmsQuote, { id: data.quoteId, deletedAt: null })
  if (!quote) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  if (auth.tenantId && quote.tenantId !== auth.tenantId) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
  else if (auth.orgId) allowedOrgIds.add(auth.orgId)

  if (allowedOrgIds.size && quote.organizationId && !allowedOrgIds.has(quote.organizationId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const offer = em.create(FmsOffer, {
    quote,
    organizationId: quote.organizationId,
    tenantId: quote.tenantId,
    offerNumber: data.offerNumber || `OFF-${Date.now()}`,
    status: data.status || 'draft',
    contractType: data.contractType || 'spot',
    carrierName: data.carrierName || null,
    validUntil: data.validUntil ? new Date(data.validUntil) : null,
    currencyCode: data.currencyCode || quote.currencyCode || 'USD',
    totalAmount: data.totalAmount?.toString() || '0',
    notes: data.notes || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await em.persistAndFlush(offer)

  return NextResponse.json(offer, { status: 201 })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.view'] },
  POST: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.manage'] },
}
