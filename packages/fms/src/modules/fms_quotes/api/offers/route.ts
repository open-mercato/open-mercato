import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FmsOffer, FmsOfferLine, FmsQuote, FmsQuoteLine } from '../../data/entities'
import { fmsOfferCreateSchema } from '../../data/validators'

const listSchema = z.object({
  quoteId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const query = {
    quoteId: url.searchParams.get('quoteId') || undefined,
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
    deletedAt: null,
  }

  // Optional quoteId filter
  if (parse.data.quoteId) {
    filters.quote = parse.data.quoteId
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
    populate: ['quote', 'lines'],
  })

  return NextResponse.json({
    items,
    total,
    page: parse.data.page,
    limit: parse.data.limit,
    totalPages: Math.ceil(total / parse.data.limit),
  })
}

// Schema for creating offer with line selection
const createOfferSchema = z.object({
  quoteId: z.string().uuid(),
  lineIds: z.array(z.string().uuid()).optional(),
  validUntil: z.coerce.date(),
  paymentTerms: z.string().trim().max(255).optional().nullable(),
  specialTerms: z.string().trim().max(2000).optional().nullable(),
  customerNotes: z.string().trim().max(2000).optional().nullable(),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const validation = createOfferSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ error: 'Invalid input', details: validation.error }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const data = validation.data

  // Verify the quote exists and user has access
  const quote = await em.findOne(FmsQuote, { id: data.quoteId, deletedAt: null }, { populate: ['lines'] })
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

  // Count existing offers for this quote to determine version number
  const existingOffers = await em.count(FmsOffer, { quote: quote.id, deletedAt: null })
  const version = existingOffers + 1

  // Generate offer number (e.g., OFF-2026-0001)
  const year = new Date().getFullYear()
  const allOffersCount = await em.count(FmsOffer, {
    tenantId: quote.tenantId,
    organizationId: quote.organizationId,
  })
  const offerNumber = `OFF-${year}-${String(allOffersCount + 1).padStart(4, '0')}`

  // Get quote lines to include (all lines if no specific lineIds provided)
  const quoteLines = await em.find(FmsQuoteLine, {
    quote: quote.id,
    deletedAt: null,
    ...(data.lineIds?.length ? { id: { $in: data.lineIds } } : {}),
  })

  if (quoteLines.length === 0) {
    return NextResponse.json({ error: 'No lines to include in offer' }, { status: 400 })
  }

  // Calculate total from selected lines (sum of unitSales * quantity)
  let totalAmount = 0
  for (const line of quoteLines) {
    const qty = parseFloat(line.quantity) || 1
    const sales = parseFloat(line.unitSales) || 0
    totalAmount += qty * sales
  }

  const offer = em.create(FmsOffer, {
    quote,
    organizationId: quote.organizationId,
    tenantId: quote.tenantId,
    offerNumber,
    version,
    status: 'draft',
    contractType: 'spot',
    validUntil: new Date(data.validUntil),
    currencyCode: quote.currencyCode || 'USD',
    totalAmount: totalAmount.toFixed(4),
    paymentTerms: data.paymentTerms || null,
    specialTerms: data.specialTerms || null,
    customerNotes: data.customerNotes || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  em.persist(offer)

  // Create offer lines from quote lines (snapshot)
  for (let i = 0; i < quoteLines.length; i++) {
    const quoteLine = quoteLines[i]
    const qty = parseFloat(quoteLine.quantity) || 1
    const unitPrice = parseFloat(quoteLine.unitSales) || 0
    const amount = qty * unitPrice

    const offerLine = em.create(FmsOfferLine, {
      offer,
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      lineNumber: i + 1,
      productName: quoteLine.productName,
      chargeCode: quoteLine.chargeCode || null,
      containerSize: quoteLine.containerSize || null,
      quantity: quoteLine.quantity,
      currencyCode: quoteLine.currencyCode || 'USD',
      unitPrice: quoteLine.unitSales,
      amount: amount.toFixed(4),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    em.persist(offerLine)
  }

  await em.flush()

  // Reload offer with lines
  await em.refresh(offer, { populate: ['lines'] })

  return NextResponse.json(offer, { status: 201 })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_quotes.offers.view'] },
  POST: { requireAuth: true, requireFeatures: ['fms_quotes.offers.manage'] },
}
