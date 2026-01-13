import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FmsOffer, FmsOfferLine } from '../../../data/entities'

const createVersionSchema = z.object({
  offerId: z.string().uuid(),
})

function generateOfferNumber(existingNumber: string, newVersion: number): string {
  // Keep the same base number, just increment version
  // Format: OFF-XXXX-XXXX stays the same, version is tracked separately
  return existingNumber
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const validation = createVersionSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ error: 'Invalid input', details: validation.error }, { status: 400 })
  }

  const { offerId } = validation.data

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const filters: Record<string, unknown> = {
    id: offerId,
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

  // Find the original offer with lines
  const originalOffer = await em.findOne(FmsOffer, filters, { populate: ['lines'] })

  if (!originalOffer) {
    return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  }

  // Cannot create new version from a draft
  if (originalOffer.status === 'draft') {
    return NextResponse.json({ error: 'Cannot create new version from a draft offer' }, { status: 400 })
  }

  // Cannot create new version from a superseded offer
  if (originalOffer.status === 'superseded') {
    return NextResponse.json({ error: 'Cannot create new version from a superseded offer' }, { status: 400 })
  }

  // Find all offers with same quote to get the max version
  const existingOffers = await em.find(
    FmsOffer,
    {
      quote: originalOffer.quote,
      deletedAt: null,
    },
    { orderBy: { version: 'DESC' } }
  )

  const maxVersion = existingOffers.length > 0 ? Math.max(...existingOffers.map((o) => o.version)) : 0
  const newVersion = maxVersion + 1

  // Create new offer
  const newOffer = new FmsOffer()
  newOffer.organizationId = originalOffer.organizationId
  newOffer.tenantId = originalOffer.tenantId
  newOffer.quote = originalOffer.quote
  newOffer.offerNumber = originalOffer.offerNumber // Keep same number
  newOffer.version = newVersion
  newOffer.status = 'draft'
  newOffer.validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days from now
  newOffer.paymentTerms = originalOffer.paymentTerms
  newOffer.specialTerms = originalOffer.specialTerms
  newOffer.customerNotes = originalOffer.customerNotes
  newOffer.currencyCode = originalOffer.currencyCode
  newOffer.totalAmount = originalOffer.totalAmount

  em.persist(newOffer)

  // Copy lines
  for (const originalLine of originalOffer.lines) {
    const newLine = new FmsOfferLine()
    newLine.organizationId = originalLine.organizationId
    newLine.tenantId = originalLine.tenantId
    newLine.offer = newOffer
    newLine.lineNumber = originalLine.lineNumber
    newLine.productName = originalLine.productName
    newLine.chargeCode = originalLine.chargeCode
    newLine.containerSize = originalLine.containerSize
    newLine.quantity = originalLine.quantity
    newLine.unitPrice = originalLine.unitPrice
    newLine.amount = originalLine.amount
    newLine.currencyCode = originalLine.currencyCode
    em.persist(newLine)
  }

  // Mark original offer as superseded
  originalOffer.status = 'superseded'
  originalOffer.supersededById = newOffer.id
  originalOffer.updatedAt = new Date()

  await em.flush()

  return NextResponse.json({
    id: newOffer.id,
    offerNumber: newOffer.offerNumber,
    version: newOffer.version,
  })
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['fms_quotes.offers.manage'] },
}
