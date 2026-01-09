import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FmsQuote } from '../../data/entities'
import { fmsQuoteUpdateSchema } from '../../data/validators'

// Schema for PUT body - id comes from URL params, not body
const updateBodySchema = fmsQuoteUpdateSchema.omit({ id: true })

const paramsSchema = z.object({
  id: z.string().uuid(),
})

// Helper to build scope-aware filters matching CRUD factory behavior
function buildScopeFilters(
  auth: { tenantId?: string | null; orgId?: string | null },
  scope: { tenantId?: string | null; selectedId?: string | null; filterIds?: string[] | null } | null
): { tenantId?: string; organizationId?: { $in: string[] } } {
  const filters: { tenantId?: string; organizationId?: { $in: string[] } } = {}

  // CRUD factory uses auth.tenantId directly for tenant filtering
  if (typeof auth.tenantId === 'string') {
    filters.tenantId = auth.tenantId
  }

  // Build org filter from scope?.filterIds or fallback to scope?.selectedId ?? auth.orgId
  // This matches CRUD factory's ctx.organizationIds or ctx.selectedOrganizationId logic
  const allowedOrgIds = new Set<string>()
  const filterIds = scope?.filterIds
  if (Array.isArray(filterIds) && filterIds.length > 0) {
    filterIds.forEach((id) => {
      if (typeof id === 'string') allowedOrgIds.add(id)
    })
  } else {
    // Fallback to selectedId or auth.orgId (matching CRUD factory's selectedOrganizationId ?? auth.orgId)
    const fallbackOrgId = scope?.selectedId ?? auth.orgId
    if (typeof fallbackOrgId === 'string') {
      allowedOrgIds.add(fallbackOrgId)
    }
  }

  if (allowedOrgIds.size > 0) {
    filters.organizationId = { $in: [...allowedOrgIds] }
  }

  return filters
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid quote id' }, { status: 400 })

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const scopeFilters = buildScopeFilters(auth, scope)
  const filters: Record<string, unknown> = {
    id: parse.data.id,
    deletedAt: null,
    ...scopeFilters,
  }

  const quote = await em.findOne(FmsQuote, filters)

  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  return NextResponse.json(quote)
}

export async function PUT(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid quote id' }, { status: 400 })

  const body = await req.json()
  const validation = updateBodySchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ error: 'Invalid input', details: validation.error }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const scopeFilters = buildScopeFilters(auth, scope)
  const filters: Record<string, unknown> = {
    id: parse.data.id,
    deletedAt: null,
    ...scopeFilters,
  }

  const quote = await em.findOne(FmsQuote, filters)

  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  const data = validation.data

  // Map camelCase input to entity fields
  if (data.quoteNumber !== undefined) quote.quoteNumber = data.quoteNumber
  if (data.clientName !== undefined) quote.clientName = data.clientName
  if (data.containerCount !== undefined) quote.containerCount = data.containerCount
  if (data.status !== undefined) quote.status = data.status
  if (data.direction !== undefined) quote.direction = data.direction
  if (data.incoterm !== undefined) quote.incoterm = data.incoterm
  if (data.cargoType !== undefined) quote.cargoType = data.cargoType
  if (data.originPortCode !== undefined) quote.originPortCode = data.originPortCode
  if (data.destinationPortCode !== undefined) quote.destinationPortCode = data.destinationPortCode
  if (data.validUntil !== undefined) quote.validUntil = data.validUntil ? new Date(data.validUntil) : null
  if (data.currencyCode !== undefined) quote.currencyCode = data.currencyCode
  if (data.notes !== undefined) quote.notes = data.notes

  quote.updatedAt = new Date()

  await em.flush()

  return NextResponse.json(quote)
}

export async function DELETE(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid quote id' }, { status: 400 })

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const scopeFilters = buildScopeFilters(auth, scope)
  const filters: Record<string, unknown> = {
    id: parse.data.id,
    deletedAt: null,
    ...scopeFilters,
  }

  const quote = await em.findOne(FmsQuote, filters)

  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  // Soft delete
  quote.deletedAt = new Date()
  await em.flush()

  return NextResponse.json({ success: true })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.view'] },
  PUT: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.manage'] },
}
