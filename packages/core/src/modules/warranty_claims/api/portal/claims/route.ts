import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getCustomerAuthFromRequest, type CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { WarrantyClaim, WarrantyClaimLine } from '../../../data/entities'
import {
  portalIntakeInputSchema,
  type ClaimCreateInput,
  type PortalIntakeInput,
} from '../../../data/validators'
import { WARRANTY_CLAIM_RESOURCE_KIND } from '../../../commands/shared'

export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

type PortalContext = {
  auth: CustomerAuthContext
  customerId: string
  tenantId: string
  organizationId: string
  em: EntityManager
  commandCtx: CommandRuntimeContext
}

type LineSummary = {
  count: number
  creditTotal: string
  statuses: Record<string, number>
}

type OrderValidationResult = {
  orderId: string | null
  currencyCode: string | null
}

type PortalOrderLookup = {
  id: string
  currencyCode: string | null
}

type PortalOrderLineLookup = {
  id: string
  orderId: string
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value
  const record = toRecord(value)
  return typeof record.id === 'string' ? record.id : null
}

function decimalNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function decimalString(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, '')
}

function summarizeLines(lines: WarrantyClaimLine[]): LineSummary {
  let creditTotal = 0
  const statuses: Record<string, number> = {}
  for (const line of lines) {
    creditTotal += decimalNumber(line.creditAmount)
    statuses[line.lineStatus] = (statuses[line.lineStatus] ?? 0) + 1
  }
  return {
    count: lines.length,
    creditTotal: decimalString(creditTotal),
    statuses,
  }
}

function serializePortalClaim(claim: WarrantyClaim, lines: WarrantyClaimLine[]) {
  return {
    id: claim.id,
    claimNumber: claim.claimNumber,
    claimType: claim.claimType,
    status: claim.status,
    orderId: claim.orderId ?? null,
    reasonCode: claim.reasonCode ?? null,
    resolutionSummary: claim.resolutionSummary ?? null,
    createdAt: toIso(claim.createdAt),
    updatedAt: toIso(claim.updatedAt),
    lines: summarizeLines(lines),
  }
}

async function resolvePortalContext(req: Request): Promise<PortalContext | Response> {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }
  if (!auth.customerEntityId) {
    return NextResponse.json({ ok: false, error: 'Customer account is not linked to a customer record' }, { status: 403 })
  }
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const commandAuth: NonNullable<AuthContext> = {
    sub: auth.sub,
    sid: auth.sid,
    tenantId: auth.tenantId,
    orgId: auth.orgId,
    email: auth.email,
    customerEntityId: auth.customerEntityId ?? null,
    personEntityId: auth.personEntityId ?? null,
  }
  return {
    auth,
    customerId: auth.customerEntityId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    em,
    commandCtx: {
      container,
      auth: commandAuth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId,
      organizationIds: [auth.orgId],
      request: req,
    },
  }
}

type PortalSalesDb = {
  sales_orders: {
    id: string
    currency_code: string
    customer_entity_id: string | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
  sales_order_lines: {
    id: string
    order_id: string
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
}

async function loadOwnedOrder(context: PortalContext, orderId: string): Promise<PortalOrderLookup | null> {
  try {
    const db = context.em.fork().getKysely<PortalSalesDb>()
    const row = await db
      .selectFrom('sales_orders')
      .select(['id', 'currency_code'])
      .where('id', '=', orderId)
      .where('tenant_id', '=', context.tenantId)
      .where('organization_id', '=', context.organizationId)
      .where('customer_entity_id', '=', context.customerId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    if (!row) return null
    return { id: row.id, currencyCode: row.currency_code ?? null }
  } catch {
    return null
  }
}

async function loadOwnedOrderLine(
  context: PortalContext,
  orderLineId: string,
): Promise<{ line: PortalOrderLineLookup; order: PortalOrderLookup } | null> {
  try {
    const db = context.em.fork().getKysely<PortalSalesDb>()
    const row = await db
      .selectFrom('sales_order_lines')
      .select(['id', 'order_id'])
      .where('id', '=', orderLineId)
      .where('tenant_id', '=', context.tenantId)
      .where('organization_id', '=', context.organizationId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    if (!row || !row.order_id) return null
    const order = await loadOwnedOrder(context, row.order_id)
    return order ? { line: { id: row.id, orderId: row.order_id }, order } : null
  } catch {
    return null
  }
}

async function validatePortalOrderOwnership(
  context: PortalContext,
  input: PortalIntakeInput,
): Promise<OrderValidationResult | Response> {
  let resolvedOrder: PortalOrderLookup | null = null
  if (input.orderId) {
    resolvedOrder = await loadOwnedOrder(context, input.orderId)
    if (!resolvedOrder) {
      return NextResponse.json({ ok: false, error: 'Claim order not found' }, { status: 404 })
    }
  }

  for (const line of input.lines) {
    if (!line.orderLineId) continue
    const resolvedLine = await loadOwnedOrderLine(context, line.orderLineId)
    if (!resolvedLine) {
      return NextResponse.json({ ok: false, error: 'Claim order line not found' }, { status: 404 })
    }
    if (resolvedOrder && resolvedLine.order.id !== resolvedOrder.id) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        { ok: false, error: translate('warranty_claims.errors.orderLineMismatch', 'Order line does not belong to the selected order') },
        { status: 400 },
      )
    }
    if (!resolvedOrder) resolvedOrder = resolvedLine.order
  }

  return {
    orderId: resolvedOrder?.id ?? input.orderId ?? null,
    currencyCode: resolvedOrder?.currencyCode ?? null,
  }
}

async function runPortalCreateGuard(
  req: Request,
  context: PortalContext,
  mutationPayload: Record<string, unknown>,
): Promise<RouteMutationGuardResult> {
  return runRouteMutationGuards({
    container: context.commandCtx.container,
    req,
    auth: {
      userId: context.auth.sub,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userFeatures: [],
    },
    input: {
      resourceKind: WARRANTY_CLAIM_RESOURCE_KIND,
      resourceId: null,
      operation: 'create',
      mutationPayload,
    },
  })
}

export async function GET(req: Request) {
  const contextOrResponse = await resolvePortalContext(req)
  if (contextOrResponse instanceof Response) return contextOrResponse
  const context = contextOrResponse
  const url = new URL(req.url)
  const query = listQuerySchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!query.success) {
    return NextResponse.json({ ok: false, error: 'Invalid input' }, { status: 400 })
  }
  const { page, pageSize } = query.data
  const where = {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    customerId: context.customerId,
    deletedAt: null,
  }
  const total = await context.em.count(WarrantyClaim, where)
  const claims = await findWithDecryption(
    context.em,
    WarrantyClaim,
    where,
    {
      orderBy: { createdAt: 'DESC' },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    },
    { tenantId: context.tenantId, organizationId: context.organizationId },
  )
  const claimIds = claims.map((claim) => claim.id)
  const lines = claimIds.length
    ? await findWithDecryption(
        context.em,
        WarrantyClaimLine,
        { claim: { $in: claimIds }, tenantId: context.tenantId, organizationId: context.organizationId, deletedAt: null },
        {},
        { tenantId: context.tenantId, organizationId: context.organizationId },
      )
    : []
  const linesByClaim = new Map<string, WarrantyClaimLine[]>()
  for (const line of lines) {
    const claimId = relationId(line.claim)
    if (!claimId) continue
    const bucket = linesByClaim.get(claimId) ?? []
    bucket.push(line)
    linesByClaim.set(claimId, bucket)
  }
  return NextResponse.json({
    items: claims.map((claim) => serializePortalClaim(claim, linesByClaim.get(claim.id) ?? [])),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  })
}

export async function POST(req: Request) {
  const contextOrResponse = await resolvePortalContext(req)
  if (contextOrResponse instanceof Response) return contextOrResponse
  const context = contextOrResponse
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
  const parsed = portalIntakeInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed' }, { status: 400 })
  }
  const ownership = await validatePortalOrderOwnership(context, parsed.data)
  if (ownership instanceof Response) return ownership

  const createInput: ClaimCreateInput = {
    organizationId: context.organizationId,
    tenantId: context.tenantId,
    claimType: 'warranty',
    channel: 'portal',
    priority: 'normal',
    customerId: context.customerId,
    customerName: context.auth.displayName || null,
    orderId: ownership.orderId,
    reasonCode: parsed.data.reasonCode,
    notes: parsed.data.notes ?? null,
    currencyCode: ownership.currencyCode,
    lines: parsed.data.lines.map((line, index) => ({
      lineNo: index + 1,
      orderLineId: line.orderLineId ?? null,
      productId: line.productId ?? null,
      productName: line.productName ?? null,
      sku: line.sku ?? null,
      serialNumber: line.serialNumber ?? null,
      faultCode: line.faultCode ?? null,
      faultDescription: line.faultDescription,
      qtyClaimed: line.qtyClaimed ?? 1,
    })),
  }

  const guarded = await runPortalCreateGuard(req, context, { ...createInput })
  if (!guarded.ok) {
    return guarded.response
  }
  const effectiveInput: ClaimCreateInput = guarded.modifiedPayload
    ? {
        ...createInput,
        ...guarded.modifiedPayload,
        tenantId: createInput.tenantId,
        organizationId: createInput.organizationId,
        customerId: createInput.customerId,
        channel: createInput.channel,
        claimType: createInput.claimType,
        orderId: createInput.orderId,
        currencyCode: createInput.currencyCode,
        lines: createInput.lines,
      }
    : createInput

  const commandBus = context.commandCtx.container.resolve('commandBus') as CommandBus
  try {
    const createResult = await commandBus.execute<ClaimCreateInput, { claimId: string }>(
      'warranty_claims.claim.create',
      { input: effectiveInput, ctx: context.commandCtx },
    )
    const claimId = createResult.result?.claimId
    if (typeof claimId !== 'string') {
      return NextResponse.json({ ok: false, error: 'Claim could not be created' }, { status: 400 })
    }
    try {
      await commandBus.execute<{ id: string }, { claimId: string }>(
        'warranty_claims.claim.submit',
        { input: { id: claimId }, ctx: context.commandCtx },
      )
    } catch (submitError) {
      await commandBus.execute<{ id: string }, { claimId: string }>(
        'warranty_claims.claim.delete',
        { input: { id: claimId }, ctx: context.commandCtx },
      ).catch(() => undefined)
      throw submitError
    }

    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, claimId }, { status: 201 })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }
}

const lineSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  creditTotal: z.string(),
  statuses: z.record(z.string(), z.number().int().nonnegative()),
})

const portalClaimSchema = z.object({
  id: z.string().uuid(),
  claimNumber: z.string(),
  claimType: z.string(),
  status: z.string(),
  orderId: z.string().uuid().nullable(),
  reasonCode: z.string().nullable(),
  resolutionSummary: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  lines: lineSummarySchema,
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims Portal',
  summary: 'Customer portal warranty claims',
  methods: {
    GET: {
      summary: 'List the authenticated customer account claims',
      query: listQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Customer claims',
          schema: z.object({
            items: z.array(portalClaimSchema),
            total: z.number().int().nonnegative(),
            page: z.number().int().min(1),
            pageSize: z.number().int().min(1),
            totalPages: z.number().int().min(1),
          }),
        },
      ],
    },
    POST: {
      summary: 'Submit a customer portal claim intake',
      requestBody: { contentType: 'application/json', schema: portalIntakeInputSchema },
      responses: [
        {
          status: 201,
          description: 'Claim created and submitted',
          schema: z.object({ ok: z.boolean(), claimId: z.string().uuid() }),
        },
      ],
    },
  },
}
