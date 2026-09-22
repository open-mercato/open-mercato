import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createPolicyResolutionService } from '../../../lib/policyResolution'

/**
 * `GET /api/availability/policies/resolve-preview` — the currently PERSISTED
 * resolution chain for a (product, variant, store) target, used by the policy
 * edit/create form to show "which level currently decides each field" (US-A2)
 * before the admin saves an override.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['availability.policies.view'] },
}

export const metadata = routeMetadata

export const openApi = {
  tags: ['Availability'],
  summary: 'Preview the currently persisted policy resolution chain for a product/variant/store target.',
}

const querySchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  storeId: z.uuid().nullable().optional(),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    productId: url.searchParams.get('productId') ?? undefined,
    variantId: url.searchParams.get('variantId') ?? undefined,
    storeId: url.searchParams.get('storeId') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = createPolicyResolutionService(container)
  const trace = await service.resolve(em, {
    tenantId: auth.tenantId,
    organizationId,
    storeId: parsed.data.storeId ?? null,
    productId: parsed.data.productId,
    variantId: parsed.data.variantId ?? null,
  })

  return NextResponse.json({ policyTrace: trace })
}
