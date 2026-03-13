import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerDealLine } from '../../../../data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CommandExecuteResult } from '@open-mercato/shared/lib/commands/types'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const createLineSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  productVariantId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(255),
  sku: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  quantity: z.coerce.number().min(0).default(1),
  unit: z.string().trim().max(50).nullable().optional(),
  unitPrice: z.coerce.number().min(0).default(0),
  discountPercent: z.coerce.number().min(0).max(100).nullable().optional(),
  discountAmount: z.coerce.number().min(0).nullable().optional(),
  taxRate: z.coerce.number().min(0).nullable().optional(),
  currency: z.string().trim().max(3).nullable().optional(),
  productSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
})

const updateLineSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid().nullable().optional(),
  productVariantId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  sku: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  quantity: z.coerce.number().min(0).optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  unitPrice: z.coerce.number().min(0).optional(),
  discountPercent: z.coerce.number().min(0).max(100).nullable().optional(),
  discountAmount: z.coerce.number().min(0).nullable().optional(),
  taxRate: z.coerce.number().min(0).nullable().optional(),
  currency: z.string().trim().max(3).nullable().optional(),
  productSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
})

const deleteLineSchema = z.object({
  id: z.string().uuid(),
})

async function resolveAuth(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    throw new CrudHttpError(401, { error: 'Authentication required' })
  }
  return { container, auth }
}

async function checkFeature(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  auth: { sub?: string | null; tenantId?: string | null; orgId?: string | null },
  features: string[],
) {
  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
  } catch {
    rbac = null
  }
  if (!rbac || !auth?.sub) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, features, {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }
}

function computeLineTotals(lines: CustomerDealLine[]) {
  let subtotal = 0
  let discountTotal = 0
  let taxTotal = 0
  let currency: string | null = null

  for (const line of lines) {
    const lineTotal = Number(line.lineTotal) || 0
    const quantity = Number(line.quantity) || 0
    const unitPrice = Number(line.unitPrice) || 0
    const grossAmount = quantity * unitPrice

    const discountPercent = Number(line.discountPercent) || 0
    const discountAmount = Number(line.discountAmount) || 0
    const lineDiscount = discountAmount > 0
      ? discountAmount
      : grossAmount * (discountPercent / 100)

    const afterDiscount = grossAmount - lineDiscount
    const taxRate = Number(line.taxRate) || 0
    const lineTax = afterDiscount * (taxRate / 100)

    subtotal += grossAmount
    discountTotal += lineDiscount
    taxTotal += lineTax

    if (!currency && line.currency) {
      currency = line.currency
    }
  }

  const grandTotal = subtotal - discountTotal + taxTotal

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discountTotal: Math.round(discountTotal * 100) / 100,
    taxTotal: Math.round(taxTotal * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
    currency,
  }
}

export async function GET(request: Request, context: { params?: Record<string, unknown> }) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.deals.view'])

    const em = (container.resolve('em') as EntityManager)
    const decryptionScope = {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    }
    const deal = await findOneWithDecryption(
      em,
      CustomerDeal,
      { id: parsedParams.data.id, deletedAt: null, tenantId: auth.tenantId, organizationId: auth.orgId },
      {},
      decryptionScope,
    )
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const lines = await findWithDecryption(
      em,
      CustomerDealLine,
      { deal: deal.id, deletedAt: null },
      { orderBy: { lineNumber: 'ASC' } },
      decryptionScope,
    )

    const totals = computeLineTotals(lines)

    return NextResponse.json({
      items: lines.map((line) => ({
        id: line.id,
        dealId: deal.id,
        lineNumber: line.lineNumber,
        productId: line.productId ?? null,
        productVariantId: line.productVariantId ?? null,
        name: line.name,
        sku: line.sku ?? null,
        description: line.description ?? null,
        quantity: Number(line.quantity),
        unit: line.unit ?? null,
        unitPrice: Number(line.unitPrice),
        discountPercent: line.discountPercent != null ? Number(line.discountPercent) : null,
        discountAmount: line.discountAmount != null ? Number(line.discountAmount) : null,
        taxRate: line.taxRate != null ? Number(line.taxRate) : null,
        lineTotal: Number(line.lineTotal),
        currency: line.currency ?? null,
        productSnapshot: line.productSnapshot ?? null,
        createdAt: line.createdAt.toISOString(),
        updatedAt: line.updatedAt.toISOString(),
      })),
      totals,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request, context: { params?: Record<string, unknown> }) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.deals.manage'])

    const em = (container.resolve('em') as EntityManager)
    const decryptionScope = {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    }
    const deal = await findOneWithDecryption(
      em,
      CustomerDeal,
      { id: parsedParams.data.id, deletedAt: null, tenantId: auth.tenantId, organizationId: auth.orgId },
      {},
      decryptionScope,
    )
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = createLineSchema.parse(body)

    const commandBus = (container.resolve('commandBus') as CommandBus)
    const { result } = (await commandBus.execute(
      'customers.deal-line.create',
      {
        input: {
          dealId: deal.id,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
          ...parsed,
        },
        ctx: { container, auth, organizationScope: null, selectedOrganizationId: auth.orgId ?? null, organizationIds: auth.orgId ? [auth.orgId] : null },
      },
    )) as CommandExecuteResult<{ id: string }>

    return NextResponse.json({ id: result.id, ok: true }, { status: 201 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: Request, context: { params?: Record<string, unknown> }) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.deals.manage'])

    const em = (container.resolve('em') as EntityManager)
    const decryptionScope = {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    }
    const deal = await findOneWithDecryption(
      em,
      CustomerDeal,
      { id: parsedParams.data.id, deletedAt: null, tenantId: auth.tenantId, organizationId: auth.orgId },
      {},
      decryptionScope,
    )
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = updateLineSchema.parse(body)

    const commandBus = (container.resolve('commandBus') as CommandBus)
    await commandBus.execute(
      'customers.deal-line.update',
      {
        input: {
          dealId: deal.id,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
          ...parsed,
        },
        ctx: { container, auth, organizationScope: null, selectedOrganizationId: auth.orgId ?? null, organizationIds: auth.orgId ? [auth.orgId] : null },
      },
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: { params?: Record<string, unknown> }) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const { container, auth } = await resolveAuth(request)
    await checkFeature(container, auth, ['customers.deals.manage'])

    const em = (container.resolve('em') as EntityManager)
    const decryptionScope = {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    }
    const deal = await findOneWithDecryption(
      em,
      CustomerDeal,
      { id: parsedParams.data.id, deletedAt: null, tenantId: auth.tenantId, organizationId: auth.orgId },
      {},
      decryptionScope,
    )
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = deleteLineSchema.parse(body)

    const commandBus = (container.resolve('commandBus') as CommandBus)
    await commandBus.execute(
      'customers.deal-line.delete',
      {
        input: {
          id: parsed.id,
          dealId: deal.id,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
        },
        ctx: { container, auth, organizationScope: null, selectedOrganizationId: auth.orgId ?? null, organizationIds: auth.orgId ? [auth.orgId] : null },
      },
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
}

const lineItemSchema = z.object({
  id: z.string().uuid(),
  dealId: z.string().uuid(),
  lineNumber: z.number(),
  productId: z.string().uuid().nullable(),
  productVariantId: z.string().uuid().nullable(),
  name: z.string(),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  quantity: z.number(),
  unit: z.string().nullable(),
  unitPrice: z.number(),
  discountPercent: z.number().nullable(),
  discountAmount: z.number().nullable(),
  taxRate: z.number().nullable(),
  lineTotal: z.number(),
  currency: z.string().nullable(),
  productSnapshot: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const totalsSchema = z.object({
  subtotal: z.number(),
  discountTotal: z.number(),
  taxTotal: z.number(),
  grandTotal: z.number(),
  currency: z.string().nullable(),
})

const listResponseSchema = z.object({
  items: z.array(lineItemSchema),
  totals: totalsSchema,
})

const createResponseSchema = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
})

const okResponseSchema = z.object({
  ok: z.boolean(),
})

const errorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Deal line items',
  methods: {
    GET: {
      summary: 'List deal line items',
      description: 'Returns all line items for a specific deal with computed totals.',
      responses: [
        { status: 200, description: 'Line items with totals', schema: listResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Access denied', schema: errorSchema },
        { status: 404, description: 'Deal not found', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Create deal line item',
      description: 'Adds a new line item to a deal.',
      requestBody: { contentType: 'application/json', schema: createLineSchema },
      responses: [
        { status: 201, description: 'Line item created', schema: createResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation error', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Access denied', schema: errorSchema },
        { status: 404, description: 'Deal not found', schema: errorSchema },
      ],
    },
    PUT: {
      summary: 'Update deal line item',
      description: 'Updates an existing line item on a deal.',
      requestBody: { contentType: 'application/json', schema: updateLineSchema },
      responses: [
        { status: 200, description: 'Line item updated', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation error', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Access denied', schema: errorSchema },
        { status: 404, description: 'Deal not found', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete deal line item',
      description: 'Soft-deletes a line item from a deal.',
      requestBody: { contentType: 'application/json', schema: deleteLineSchema },
      responses: [
        { status: 200, description: 'Line item deleted', schema: okResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Access denied', schema: errorSchema },
        { status: 404, description: 'Deal not found', schema: errorSchema },
      ],
    },
  },
}
