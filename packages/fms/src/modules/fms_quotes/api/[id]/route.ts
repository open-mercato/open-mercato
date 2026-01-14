import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FmsQuote } from '../../data/entities'
import { FmsLocation } from '../../../fms_locations/data/entities'
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

  const quote = await em.findOne(FmsQuote, filters, {
    populate: ['client', 'originPorts', 'destinationPorts'],
  })

  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  // Transform the response to include related entity data
  const response = {
    id: quote.id,
    organizationId: quote.organizationId,
    tenantId: quote.tenantId,
    quoteNumber: quote.quoteNumber,
    client: quote.client
      ? {
          id: quote.client.id,
          name: quote.client.name,
          shortName: quote.client.shortName ?? null,
        }
      : null,
    containerCount: quote.containerCount,
    status: quote.status,
    direction: quote.direction,
    incoterm: quote.incoterm,
    cargoType: quote.cargoType,
    originPorts: quote.originPorts.getItems().map((port) => ({
      id: port.id,
      locode: port.locode ?? null,
      name: port.name,
      city: port.city ?? null,
      country: port.country ?? null,
    })),
    destinationPorts: quote.destinationPorts.getItems().map((port) => ({
      id: port.id,
      locode: port.locode ?? null,
      name: port.name,
      city: port.city ?? null,
      country: port.country ?? null,
    })),
    validUntil: quote.validUntil,
    currencyCode: quote.currencyCode,
    notes: quote.notes,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
    deletedAt: quote.deletedAt,
  }

  return NextResponse.json(response)
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

  const quote = await em.findOne(FmsQuote, filters, {
    populate: ['originPorts', 'destinationPorts'],
  })

  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  const data = validation.data

  // Map camelCase input to entity fields
  if (data.quoteNumber !== undefined) quote.quoteNumber = data.quoteNumber
  if (data.clientId !== undefined) quote.client = data.clientId as any
  if (data.containerCount !== undefined) quote.containerCount = data.containerCount
  if (data.status !== undefined) quote.status = data.status
  if (data.direction !== undefined) quote.direction = data.direction
  if (data.incoterm !== undefined) quote.incoterm = data.incoterm
  if (data.cargoType !== undefined) quote.cargoType = data.cargoType
  if (data.validUntil !== undefined) quote.validUntil = data.validUntil ? new Date(data.validUntil) : null
  if (data.currencyCode !== undefined) quote.currencyCode = data.currencyCode
  if (data.notes !== undefined) quote.notes = data.notes

  // Handle origin ports collection
  if (data.originPortIds !== undefined) {
    if (Array.isArray(data.originPortIds) && data.originPortIds.length > 0) {
      const originPorts = await em.find(FmsLocation, { id: { $in: data.originPortIds } })
      quote.originPorts.set(originPorts)
    } else {
      quote.originPorts.removeAll()
    }
  }

  // Handle destination ports collection
  if (data.destinationPortIds !== undefined) {
    if (Array.isArray(data.destinationPortIds) && data.destinationPortIds.length > 0) {
      const destinationPorts = await em.find(FmsLocation, { id: { $in: data.destinationPortIds } })
      quote.destinationPorts.set(destinationPorts)
    } else {
      quote.destinationPorts.removeAll()
    }
  }

  quote.updatedAt = new Date()

  await em.flush()

  // Return populated response
  await em.populate(quote, ['client', 'originPorts', 'destinationPorts'])

  const response = {
    id: quote.id,
    organizationId: quote.organizationId,
    tenantId: quote.tenantId,
    quoteNumber: quote.quoteNumber,
    client: quote.client
      ? {
          id: quote.client.id,
          name: quote.client.name,
          shortName: quote.client.shortName ?? null,
        }
      : null,
    containerCount: quote.containerCount,
    status: quote.status,
    direction: quote.direction,
    incoterm: quote.incoterm,
    cargoType: quote.cargoType,
    originPorts: quote.originPorts.getItems().map((port) => ({
      id: port.id,
      locode: port.locode ?? null,
      name: port.name,
      city: port.city ?? null,
      country: port.country ?? null,
    })),
    destinationPorts: quote.destinationPorts.getItems().map((port) => ({
      id: port.id,
      locode: port.locode ?? null,
      name: port.name,
      city: port.city ?? null,
      country: port.country ?? null,
    })),
    validUntil: quote.validUntil,
    currencyCode: quote.currencyCode,
    notes: quote.notes,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
  }

  return NextResponse.json(response)
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
