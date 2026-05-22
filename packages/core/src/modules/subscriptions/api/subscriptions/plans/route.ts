import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SubscriptionPlan, SubscriptionPrice } from '../../../data/entities'
import { subscriptionsTag } from '../../openapi'

export const metadata = {
  path: '/subscriptions/plans',
  GET: { requireAuth: true, requireFeatures: ['subscriptions.view'] },
}

export async function GET(req: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const tenantId = auth.tenantId
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return NextResponse.json({ error: 'Organization scope required' }, { status: 400 })
  }
  const em = container.resolve('em') as EntityManager

  const plans = await findWithDecryption(
    em,
    SubscriptionPlan,
    { tenantId, organizationId, deletedAt: null, isActive: true },
    { orderBy: { code: 'asc' } },
    { tenantId, organizationId },
  )
  const prices = plans.length
    ? await findWithDecryption(
      em,
      SubscriptionPrice,
      {
        tenantId,
        organizationId,
        deletedAt: null,
        isActive: true,
        plan: { $in: plans.map((plan) => plan.id) },
      },
      { orderBy: { code: 'asc' } },
      { tenantId, organizationId },
    )
    : []
  const pricesByPlanId = new Map<string, typeof prices>()
  for (const price of prices) {
    const planId = (price as { plan?: { id?: string } | string }).plan
    const planIdValue = typeof planId === 'string' ? planId : planId?.id
    if (!planIdValue) continue
    const bucket = pricesByPlanId.get(planIdValue) ?? []
    bucket.push(price)
    pricesByPlanId.set(planIdValue, bucket)
  }

  const items = plans.map((plan) => ({
    code: plan.code,
    productCode: plan.productCode,
    title: plan.title,
    description: plan.description,
    entitlements: plan.entitlementsJson ?? {},
    prices: (pricesByPlanId.get(plan.id) ?? []).map((price) => ({
      code: price.code,
      currencyCode: price.currencyCode,
      interval: price.interval,
      intervalCount: price.intervalCount,
      unitAmountMinor: price.unitAmountMinor,
      trialDays: price.trialDays ?? null,
      isDefault: price.isDefault,
    })),
  }))

  return NextResponse.json({ items })
}

const planPriceSchema = z.object({
  code: z.string(),
  currencyCode: z.string(),
  interval: z.enum(['month', 'year']),
  intervalCount: z.number().int(),
  unitAmountMinor: z.number().int(),
  trialDays: z.number().int().nullable(),
  isDefault: z.boolean(),
})

const planItemSchema = z.object({
  code: z.string(),
  productCode: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  entitlements: z.record(z.string(), z.unknown()),
  prices: z.array(planPriceSchema),
})

const responseSchema = z.object({ items: z.array(planItemSchema) })

export const openApi: OpenApiRouteDoc = {
  tag: subscriptionsTag,
  summary: 'List subscription plans',
  methods: {
    GET: {
      summary: 'List active plans available for subscription',
      tags: [subscriptionsTag],
      responses: [
        { status: 200, description: 'List of active plans', schema: responseSchema },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}

export default GET
