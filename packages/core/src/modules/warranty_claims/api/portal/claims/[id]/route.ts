import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getCustomerAuthFromRequest, type CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { WarrantyClaim, WarrantyClaimLine } from '../../../../data/entities'

export const metadata = {
  GET: { requireAuth: false },
}

type RouteParams = { id: string }
type RouteContext = { params: Promise<RouteParams> }

type PortalContext = {
  auth: CustomerAuthContext
  customerId: string
  tenantId: string
  organizationId: string
  em: EntityManager
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

async function resolveClaimId(ctx: RouteContext): Promise<string | null> {
  try {
    const params = await ctx.params
    return typeof params.id === 'string' && params.id.trim().length ? params.id.trim() : null
  } catch {
    return null
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
  return {
    auth,
    customerId: auth.customerEntityId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    em,
  }
}

function serializeLine(line: WarrantyClaimLine) {
  return {
    id: line.id,
    lineNo: line.lineNo,
    productId: line.productId ?? null,
    sku: line.sku ?? null,
    productName: line.productName ?? null,
    orderLineId: line.orderLineId ?? null,
    serialNumber: line.serialNumber ?? null,
    faultCode: line.faultCode ?? null,
    faultDescription: line.faultDescription ?? null,
    qtyClaimed: line.qtyClaimed,
    qtyApproved: line.qtyApproved ?? null,
    disposition: line.disposition ?? null,
    lineStatus: line.lineStatus,
    creditAmount: line.creditAmount ?? null,
    createdAt: toIso(line.createdAt),
    updatedAt: toIso(line.updatedAt),
  }
}

function serializeClaim(claim: WarrantyClaim, lines: WarrantyClaimLine[]) {
  return {
    id: claim.id,
    claimNumber: claim.claimNumber,
    claimType: claim.claimType,
    status: claim.status,
    channel: claim.channel,
    priority: claim.priority,
    customerId: claim.customerId ?? null,
    customerName: claim.customerName ?? null,
    orderId: claim.orderId ?? null,
    orderNumber: claim.orderNumber ?? null,
    reasonCode: claim.reasonCode ?? null,
    rejectionReasonCode: claim.rejectionReasonCode ?? null,
    resolutionSummary: claim.resolutionSummary ?? null,
    slaDueAt: toIso(claim.slaDueAt),
    submittedAt: toIso(claim.submittedAt),
    resolvedAt: toIso(claim.resolvedAt),
    closedAt: toIso(claim.closedAt),
    createdAt: toIso(claim.createdAt),
    updatedAt: toIso(claim.updatedAt),
    lines: lines.map(serializeLine),
  }
}

export async function GET(req: Request, ctx: RouteContext) {
  const contextOrResponse = await resolvePortalContext(req)
  if (contextOrResponse instanceof Response) return contextOrResponse
  const context = contextOrResponse
  const claimId = await resolveClaimId(ctx)
  if (!claimId) {
    return NextResponse.json({ ok: false, error: 'Claim not found' }, { status: 404 })
  }
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const claim = await findOneWithDecryption(
    context.em,
    WarrantyClaim,
    {
      id: claimId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      customerId: context.customerId,
      deletedAt: null,
    },
    {},
    scope,
  )
  if (!claim) {
    return NextResponse.json({ ok: false, error: 'Claim not found' }, { status: 404 })
  }
  const lines = await findWithDecryption(
    context.em,
    WarrantyClaimLine,
    { claim: claim.id, tenantId: context.tenantId, organizationId: context.organizationId, deletedAt: null },
    { orderBy: { lineNo: 'ASC' } },
    scope,
  )
  return NextResponse.json({ item: serializeClaim(claim, lines) })
}

const lineSchema = z.object({
  id: z.string().uuid(),
  lineNo: z.number().int(),
  productId: z.string().uuid().nullable(),
  sku: z.string().nullable(),
  productName: z.string().nullable(),
  orderLineId: z.string().uuid().nullable(),
  serialNumber: z.string().nullable(),
  faultCode: z.string().nullable(),
  faultDescription: z.string().nullable(),
  qtyClaimed: z.string(),
  qtyApproved: z.string().nullable(),
  disposition: z.string().nullable(),
  lineStatus: z.string(),
  creditAmount: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const claimSchema = z.object({
  id: z.string().uuid(),
  claimNumber: z.string(),
  claimType: z.string(),
  status: z.string(),
  channel: z.string(),
  priority: z.string(),
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  orderId: z.string().uuid().nullable(),
  orderNumber: z.string().nullable(),
  reasonCode: z.string().nullable(),
  rejectionReasonCode: z.string().nullable(),
  resolutionSummary: z.string().nullable(),
  slaDueAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  lines: z.array(lineSchema),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims Portal',
  summary: 'Customer portal warranty claim detail',
  methods: {
    GET: {
      summary: 'Read one authenticated customer claim',
      responses: [
        {
          status: 200,
          description: 'Customer claim detail',
          schema: z.object({ item: claimSchema }),
        },
      ],
    },
  },
}
