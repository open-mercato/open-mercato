import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FmsOffer, FmsOfferLine } from '../../../data/entities'
import { FMS_OFFER_STATUSES } from '../../../data/types'

const updateSchema = z.object({
  status: z.enum(FMS_OFFER_STATUSES).optional(),
  validUntil: z.coerce.date().optional(),
  paymentTerms: z.string().trim().max(255).optional().nullable(),
  specialTerms: z.string().trim().max(2000).optional().nullable(),
  customerNotes: z.string().trim().max(2000).optional().nullable(),
})

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const filters: Record<string, unknown> = {
    id,
    deletedAt: null,
  }

  if (auth.tenantId) {
    filters.tenantId = auth.tenantId
  }

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) scope.filterIds.forEach((oid) => allowedOrgIds.add(oid))
  else if (auth.orgId) allowedOrgIds.add(auth.orgId)

  if (allowedOrgIds.size) {
    filters.organizationId = { $in: [...allowedOrgIds] }
  }

  const offer = await em.findOne(FmsOffer, filters, { populate: ['quote', 'lines'] })

  if (!offer) {
    return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  }

  return NextResponse.json(offer)
}

export async function PUT(req: Request, { params }: Params) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const body = await req.json()
  const validation = updateSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ error: 'Invalid input', details: validation.error }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const filters: Record<string, unknown> = {
    id,
    deletedAt: null,
  }

  if (auth.tenantId) {
    filters.tenantId = auth.tenantId
  }

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) scope.filterIds.forEach((oid) => allowedOrgIds.add(oid))
  else if (auth.orgId) allowedOrgIds.add(auth.orgId)

  if (allowedOrgIds.size) {
    filters.organizationId = { $in: [...allowedOrgIds] }
  }

  const offer = await em.findOne(FmsOffer, filters)

  if (!offer) {
    return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  }

  const data = validation.data

  if (data.status !== undefined) offer.status = data.status
  if (data.validUntil !== undefined) offer.validUntil = new Date(data.validUntil)
  if (data.paymentTerms !== undefined) offer.paymentTerms = data.paymentTerms
  if (data.specialTerms !== undefined) offer.specialTerms = data.specialTerms
  if (data.customerNotes !== undefined) offer.customerNotes = data.customerNotes

  offer.updatedAt = new Date()

  await em.flush()

  return NextResponse.json(offer)
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const filters: Record<string, unknown> = {
    id,
    deletedAt: null,
  }

  if (auth.tenantId) {
    filters.tenantId = auth.tenantId
  }

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) scope.filterIds.forEach((oid) => allowedOrgIds.add(oid))
  else if (auth.orgId) allowedOrgIds.add(auth.orgId)

  if (allowedOrgIds.size) {
    filters.organizationId = { $in: [...allowedOrgIds] }
  }

  const offer = await em.findOne(FmsOffer, filters, { populate: ['lines'] })

  if (!offer) {
    return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  }

  // Only allow deleting draft offers
  if (offer.status !== 'draft') {
    return NextResponse.json({ error: 'Only draft offers can be deleted' }, { status: 400 })
  }

  // Soft delete offer and its lines
  offer.deletedAt = new Date()
  for (const line of offer.lines) {
    line.deletedAt = new Date()
  }

  await em.flush()

  return NextResponse.json({ success: true })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_quotes.offers.view'] },
  PUT: { requireAuth: true, requireFeatures: ['fms_quotes.offers.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['fms_quotes.offers.manage'] },
}
