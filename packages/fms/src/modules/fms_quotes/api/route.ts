import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { FmsQuote } from '../data/entities'
import { fmsQuoteCreateSchema, fmsQuoteUpdateSchema } from '../data/validators'
import type { SearchService } from '@open-mercato/search'
import { E } from '@open-mercato/fms/generated/entities.ids.generated'

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    q: z.string().optional(),
    status: z.string().optional(),
    direction: z.string().optional(),
    cargo_type: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.view'] },
  POST: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.manage'] },
}

export const metadata = routeMetadata

async function buildSearchFilters(
  query: z.infer<typeof listSchema>,
  ctx: { container: { resolve: (key: string) => unknown }; auth?: { tenantId?: string | null } | null }
): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}
  const tenantId = ctx.auth?.tenantId

  if (query.q && query.q.trim().length > 0 && tenantId) {
    try {
      const searchService = ctx.container.resolve('searchService') as SearchService | undefined

      if (searchService) {
        const results = await searchService.search(query.q.trim(), {
          tenantId,
          organizationId: null,
          limit: 100,
          strategies: ['fulltext'],
          entityTypes: ['fms_quotes:fms_quote'],
        })

        if (results.length > 0) {
          filters.id = { $in: results.map((r) => r.recordId) }
        } else {
          filters.id = { $in: ['00000000-0000-0000-0000-000000000000'] }
        }
      }
    } catch (error) {
      console.error('[fms_quotes:search] Search service error:', error)
    }
  }

  if (query.status) {
    filters.status = query.status
  }

  if (query.direction) {
    filters.direction = query.direction
  }

  if (query.cargo_type) {
    filters.cargo_type = query.cargo_type
  }

  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: FmsQuote,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.fms_quotes.fms_quote,
    fields: [
      'id',
      'quote_number',
      'client_name',
      'container_count',
      'status',
      'direction',
      'incoterm',
      'cargo_type',
      'origin_port_code',
      'destination_port_code',
      'valid_until',
      'currency_code',
      'notes',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      quoteNumber: 'quote_number',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query, ctx) => buildSearchFilters(query, ctx),
    transformItem: (item: any) => ({
      id: item.id,
      quote_number: item.quote_number ?? null,
      client_name: item.client_name ?? null,
      container_count: item.container_count ?? null,
      status: item.status ?? 'draft',
      direction: item.direction ?? null,
      incoterm: item.incoterm ?? null,
      cargo_type: item.cargo_type ?? null,
      origin_port_code: item.origin_port_code ?? null,
      destination_port_code: item.destination_port_code ?? null,
      valid_until: item.valid_until ?? null,
      currency_code: item.currency_code ?? 'USD',
      notes: item.notes ?? null,
      organization_id: item.organization_id ?? null,
      tenant_id: item.tenant_id ?? null,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }),
  },
  create: {
    schema: fmsQuoteCreateSchema.partial(),
    mapToEntity: (input) => ({
      ...input,
      status: input.status ?? 'draft',
      currencyCode: input.currencyCode ?? 'USD',
    }),
  },
  update: {
    schema: fmsQuoteUpdateSchema.partial(),
    applyToEntity: (entity, input) => {
      if (input.quoteNumber !== undefined) entity.quoteNumber = input.quoteNumber
      if (input.containerCount !== undefined) entity.containerCount = input.containerCount
      if (input.status !== undefined) entity.status = input.status
      if (input.direction !== undefined) entity.direction = input.direction
      if (input.incoterm !== undefined) entity.incoterm = input.incoterm
      if (input.cargoType !== undefined) entity.cargoType = input.cargoType
      if (input.validUntil !== undefined) entity.validUntil = input.validUntil
      if (input.currencyCode !== undefined) entity.currencyCode = input.currencyCode
      if (input.notes !== undefined) entity.notes = input.notes
      entity.updatedAt = new Date()
    },
  },
  del: {
    softDelete: true,
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
