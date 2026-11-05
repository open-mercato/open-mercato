import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveAvailability, availabilityItemKey } from '@open-mercato/shared/lib/availability'
import type { AvailabilityModuleConfigReader, AvailabilityQuery } from '@open-mercato/shared/lib/availability'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { tryResolve } from '../../lib/tryResolve'
import { findCatalogTargetIssue } from '../../lib/catalogTarget'
import { resolveAvailabilityOrganizationId } from '../../lib/organizationScope'
import type { PolicyResolutionService } from '../../lib/policyResolution'

/**
 * `POST /api/availability/check` — admin/debug reproduction of what a buyer saw,
 * including the per-field `policySourceId` trace. No public storefront endpoints
 * ship in this module (§8).
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['availability.check'] },
}

export const metadata = routeMetadata

const checkSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  storeId: z.uuid().nullable().optional(),
})

const checkResponseSchema = z.object({
  availability: z.record(z.string(), z.unknown()).nullable(),
  policyTrace: z.record(z.string(), z.unknown()).nullable(),
})
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Availability',
  summary: 'Reproduce the availability state and policy trace a buyer would see for one item.',
  methods: {
    POST: {
      summary: 'Check availability for one item',
      description: 'Admin/debug tool. Mirrors resolveAvailability() and includes the per-field policySourceId trace.',
      requestBody: { schema: checkSchema },
      responses: [{ status: 200, description: 'Availability result and policy trace', schema: checkResponseSchema }],
      errors: [
        {
          status: 400,
          description: 'Invalid request, missing organization scope, or a variant that does not belong to the product',
          schema: errorSchema,
        },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Product or variant not found', schema: errorSchema },
      ],
    },
  },
}

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ error: translate('availability.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const container = await createRequestContainer()
  const organizationId = await resolveAvailabilityOrganizationId(container, auth, req)
  if (!organizationId) return organizationScopeRequiredResponse()

  const body = await req.json().catch(() => ({}))
  const parsed = checkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: translate('availability.errors.invalidCheckRequest', 'Invalid request') },
      { status: 400 },
    )
  }
  const { productId, variantId, quantity, storeId } = parsed.data
  const tenantId = auth.tenantId

  const em = container.resolve('em') as EntityManager

  // Soft-resolved product/variant existence check — degrades gracefully when
  // `catalog` is ejected (Phase 1 gate: coherent behaviour without it).
  const targetIssue = await findCatalogTargetIssue(em, container, { tenantId, organizationId, productId, variantId })
  if (targetIssue === 'productNotFound') {
    return NextResponse.json(
      { error: translate('availability.errors.productNotFound', 'No such product') },
      { status: 404 },
    )
  }
  if (targetIssue === 'variantNotFound') {
    return NextResponse.json(
      { error: translate('availability.errors.variantNotFound', 'No such variant') },
      { status: 404 },
    )
  }
  if (targetIssue === 'variantProductMismatch') {
    return NextResponse.json(
      {
        error: translate(
          'availability.check.errors.variantProductMismatch',
          'The variant does not belong to the selected product',
        ),
      },
      { status: 400 },
    )
  }

  const query: AvailabilityQuery = {
    tenantId,
    organizationId,
    storeId: storeId ?? null,
    items: [{ catalogProductId: productId, catalogVariantId: variantId ?? null, quantity }],
  }

  const moduleConfig = tryResolve<AvailabilityModuleConfigReader>(container, 'moduleConfigService')
  const result = await resolveAvailability(query, moduleConfig ? { moduleConfig, container } : { container })
  const item = result.byItem[availabilityItemKey({ catalogProductId: productId, catalogVariantId: variantId ?? null })] ?? null

  const policyResolutionService = tryResolve<PolicyResolutionService>(container, 'policyResolutionService')
  const policyTrace = policyResolutionService
    ? await policyResolutionService.resolve(em, {
        tenantId,
        organizationId,
        storeId: storeId ?? null,
        productId,
        variantId: variantId ?? null,
      })
    : null

  return NextResponse.json({ availability: item, policyTrace })
}
