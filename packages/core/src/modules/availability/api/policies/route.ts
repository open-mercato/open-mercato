import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { AvailabilityPolicy } from '../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { availabilityPolicyCreateSchema, availabilityPolicyUpdateSchema } from '../../data/validators'
import {
  createAvailabilityCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['availability.policies.view'] },
  POST: { requireAuth: true, requireFeatures: ['availability.policies.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['availability.policies.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['availability.policies.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).loose()
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: AvailabilityPolicy,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: {
    module: 'availability',
    entity: 'policy',
    persistent: true,
  },
  actions: {
    create: {
      commandId: 'availability.policies.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String(result.policyId) }),
      status: 201,
    },
    update: {
      commandId: 'availability.policies.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'availability.policies.delete',
      schema: rawBodySchema,
      mapInput: ({ raw, ctx }) => ({
        id: ((raw as Record<string, unknown>).query as Record<string, unknown> | undefined)?.id as string | undefined,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? undefined,
        tenantId: ctx.auth?.tenantId ?? undefined,
      }),
      response: () => ({ ok: true }),
    },
  },
})

const listQuerySchema = z.object({
  id: z.uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  storeId: z.uuid().optional(),
  productId: z.uuid().optional(),
  variantId: z.uuid().optional(),
  isActive: z.enum(['true', 'false']).optional(),
  sortField: z.enum(['createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).loose()

type AvailabilityPolicyRow = {
  id: string
  organizationId: string
  tenantId: string
  storeId: string | null
  productId: string | null
  variantId: string | null
  isStockManaged: boolean
  allowBackorder: boolean
  backorderLeadTimeDays: number | null
  preorderReleaseAt: string | null
  lowStockThreshold: number | null
  minOrderQuantity: number | null
  maxOrderQuantity: number | null
  quantityIncrement: number | null
  hideWhenOutOfStock: boolean
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
}

const toRow = (policy: AvailabilityPolicy): AvailabilityPolicyRow => ({
  id: String(policy.id),
  organizationId: String(policy.organizationId),
  tenantId: String(policy.tenantId),
  storeId: policy.storeId ?? null,
  productId: policy.productId ?? null,
  variantId: policy.variantId ?? null,
  isStockManaged: !!policy.isStockManaged,
  allowBackorder: !!policy.allowBackorder,
  backorderLeadTimeDays: policy.backorderLeadTimeDays ?? null,
  preorderReleaseAt: policy.preorderReleaseAt ? policy.preorderReleaseAt.toISOString() : null,
  lowStockThreshold: policy.lowStockThreshold ?? null,
  minOrderQuantity: policy.minOrderQuantity ?? null,
  maxOrderQuantity: policy.maxOrderQuantity ?? null,
  quantityIncrement: policy.quantityIncrement ?? null,
  hideWhenOutOfStock: !!policy.hideWhenOutOfStock,
  isActive: !!policy.isActive,
  createdAt: policy.createdAt ? policy.createdAt.toISOString() : null,
  updatedAt: policy.updatedAt ? policy.updatedAt.toISOString() : null,
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 401 })
  }
  const organizationId = resolveActiveOrganizationId(auth)
  // A superadmin with no organization selected legitimately sees every
  // organization in the tenant (om_selected_org=__all__); anyone else with
  // an unresolved scope gets the standard 400, never a 401 (that reads as an
  // expired session to the client and redirect-loops through session
  // refresh — see organizationScope.ts).
  if (!organizationId && !auth.isSuperAdmin) return organizationScopeRequiredResponse()

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse({
    id: url.searchParams.get('id') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    storeId: url.searchParams.get('storeId') ?? undefined,
    productId: url.searchParams.get('productId') ?? undefined,
    variantId: url.searchParams.get('variantId') ?? undefined,
    isActive: url.searchParams.get('isActive') ?? undefined,
    sortField: url.searchParams.get('sortField') ?? undefined,
    sortDir: url.searchParams.get('sortDir') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const { id, page, pageSize, storeId, productId, variantId, isActive, sortField, sortDir } = parsed.data
  const filter: FilterQuery<AvailabilityPolicy> = {
    tenantId: auth.tenantId,
    deletedAt: null,
  }
  if (organizationId) filter.organizationId = organizationId
  if (id) filter.id = id
  if (storeId) filter.storeId = storeId
  if (productId) filter.productId = productId
  if (variantId) filter.variantId = variantId
  if (isActive === 'true') filter.isActive = true
  if (isActive === 'false') filter.isActive = false

  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  orderBy[sortField ?? 'createdAt'] = sortDir === 'asc' ? 'ASC' : 'DESC'

  const offset = (page - 1) * pageSize
  const [rows, total] = await em.findAndCount(AvailabilityPolicy, filter, { orderBy, limit: pageSize, offset })
  const items = rows.map(toRow)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const availabilityPolicyListItemSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  storeId: z.uuid().nullable(),
  productId: z.uuid().nullable(),
  variantId: z.uuid().nullable(),
  isStockManaged: z.boolean(),
  allowBackorder: z.boolean(),
  backorderLeadTimeDays: z.number().nullable(),
  preorderReleaseAt: z.string().nullable(),
  lowStockThreshold: z.number().nullable(),
  minOrderQuantity: z.number().nullable(),
  maxOrderQuantity: z.number().nullable(),
  quantityIncrement: z.number().nullable(),
  hideWhenOutOfStock: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const openApi = createAvailabilityCrudOpenApi({
  resourceName: 'AvailabilityPolicy',
  pluralName: 'AvailabilityPolicies',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(availabilityPolicyListItemSchema),
  create: {
    schema: availabilityPolicyCreateSchema,
    description: 'Creates a new availability policy.',
  },
  update: {
    schema: availabilityPolicyUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing availability policy by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an availability policy by id.',
  },
})
