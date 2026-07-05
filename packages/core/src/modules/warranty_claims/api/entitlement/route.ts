import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type {
  WarrantyEntitlementInput,
  WarrantyEntitlementResolver,
  WarrantyEntitlementResult,
} from '../../services/entitlementResolver'

type EntitlementHistoryDb = {
  warranty_claim_lines: {
    claim_id: string
    organization_id: string
    tenant_id: string
    serial_number: string | null
    deleted_at: Date | null
  }
  warranty_claim_registrations: {
    id: string
    organization_id: string
    tenant_id: string
    serial_number: string | null
    deleted_at: Date | null
  }
}

type NumericAggregateValue = string | number | bigint | null

type EntitlementRouteContext = {
  tenantId: string
  organizationId: string
  em: EntityManager
  resolver: WarrantyEntitlementResolver
}

type EntitlementResponse = WarrantyEntitlementResult & {
  hasPriorClaims?: boolean
  priorClaimCount?: number
  priorRegistrationCount?: number
}

const UNKNOWN_ENTITLEMENT: WarrantyEntitlementResult = {
  warrantyStatus: 'unknown',
  coverageType: null,
  expiresAt: null,
  source: null,
}

const querySchema = z
  .object({
    serialNumber: z.string().trim().max(191).optional(),
    orderId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    variantId: z.string().uuid().optional(),
    sku: z.string().trim().max(191).optional(),
    purchaseDate: z.string().trim().max(80).optional(),
    excludeClaimId: z.string().uuid().optional(),
  })
  .strict()

const entitlementResultSchema = z.object({
  warrantyStatus: z.enum(['in_warranty', 'out_of_warranty', 'unknown']),
  coverageType: z.enum(['standard', 'extended', 'none']).nullable(),
  expiresAt: z.string().nullable(),
  source: z.enum(['registration', 'order', 'manual', 'resolver']).nullable(),
  hasPriorClaims: z.boolean().optional(),
  priorClaimCount: z.number().int().nonnegative().optional(),
  priorRegistrationCount: z.number().int().nonnegative().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.claim.view'] },
}

function hasAnyInput(input: WarrantyEntitlementInput): boolean {
  return Object.values(input).some((value) => typeof value === 'string' && value.trim().length > 0)
}

function normalizeInput(query: z.infer<typeof querySchema>): WarrantyEntitlementInput {
  return {
    serialNumber: query.serialNumber?.trim() || null,
    orderId: query.orderId ?? null,
    productId: query.productId ?? null,
    variantId: query.variantId ?? null,
    sku: query.sku?.trim() || null,
    purchaseDate: query.purchaseDate?.trim() || null,
  }
}

function parseNumeric(value: NumericAggregateValue | undefined): number {
  if (value === undefined || value === null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

async function resolveEntitlementContext(req: Request): Promise<EntitlementRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('warranty_claims.errors.organization_required', 'Organization context is required') })
  }
  return {
    tenantId: auth.tenantId,
    organizationId,
    em: container.resolve<EntityManager>('em').fork(),
    resolver: container.resolve<WarrantyEntitlementResolver>('warrantyEntitlementResolver'),
  }
}

async function resolveSerialHistory(
  context: Pick<EntitlementRouteContext, 'tenantId' | 'organizationId' | 'em'>,
  serialNumber: string | null | undefined,
  excludeClaimId?: string | null,
): Promise<Pick<EntitlementResponse, 'hasPriorClaims' | 'priorClaimCount' | 'priorRegistrationCount'>> {
  const serial = serialNumber?.trim()
  if (!serial) return {}
  const db = context.em.getKysely<EntitlementHistoryDb>()
  let claimQuery = db
    .selectFrom('warranty_claim_lines')
    .select(sql<NumericAggregateValue>`count(distinct claim_id)`.as('count'))
    .where('tenant_id', '=', context.tenantId)
    .where('organization_id', '=', context.organizationId)
    .where('serial_number', '=', serial)
    .where('deleted_at', 'is', null)
  if (excludeClaimId) {
    claimQuery = claimQuery.where('claim_id', '!=', excludeClaimId)
  }
  const claimRow = await claimQuery.executeTakeFirst()
  const registrationRow = await db
    .selectFrom('warranty_claim_registrations')
    .select(sql<NumericAggregateValue>`count(*)`.as('count'))
    .where('tenant_id', '=', context.tenantId)
    .where('organization_id', '=', context.organizationId)
    .where('serial_number', '=', serial)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  const priorClaimCount = parseNumeric(claimRow?.count)
  return {
    hasPriorClaims: priorClaimCount > 0,
    priorClaimCount,
    priorRegistrationCount: parseNumeric(registrationRow?.count),
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))
    const input = normalizeInput(query)
    const context = await resolveEntitlementContext(req)
    const history = await resolveSerialHistory(context, input.serialNumber, query.excludeClaimId)
    if (!hasAnyInput(input)) {
      return NextResponse.json({ ...UNKNOWN_ENTITLEMENT, ...history })
    }
    const result = await context.resolver.resolveEntitlement(
      input,
      { tenantId: context.tenantId, organizationId: context.organizationId },
      context.em,
    )
    return NextResponse.json({ ...result, ...history })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    console.error('warranty_claims.entitlement.get failed', err)
    return NextResponse.json({ error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Resolve warranty entitlement',
  methods: {
    GET: {
      summary: 'Resolve warranty entitlement for serial, order, product, SKU, or purchase date facts',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Resolved warranty entitlement',
          schema: entitlementResultSchema,
        },
      ],
    },
  },
}
