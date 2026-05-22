import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Subscription } from '../../../data/entities'
import { subscriptionsTag } from '../../openapi'

export const metadata = {
  path: '/subscriptions/list',
  GET: { requireAuth: true, requireFeatures: ['subscriptions.admin'] },
}

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  externalAccountId: z.string().optional(),
  productCode: z.string().optional(),
  accessState: z.enum(['pending', 'granted', 'grace', 'blocked']).optional(),
})

export async function GET(req: Request) {
  try {
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
    const url = new URL(req.url)
    const parsed = listSchema.parse(Object.fromEntries(url.searchParams.entries()))

    const em = container.resolve('em') as EntityManager
    const filter: Record<string, unknown> = {
      tenantId,
      organizationId,
      deletedAt: null,
    }
    if (parsed.externalAccountId) filter.externalAccountId = parsed.externalAccountId
    if (parsed.accessState) filter.accessState = parsed.accessState
    if (parsed.productCode) {
      filter.plan = { productCode: parsed.productCode }
    }

    const limit = parsed.pageSize
    const offset = (parsed.page - 1) * parsed.pageSize
    const [rows, total] = await em.findAndCount(Subscription, filter, {
      orderBy: { updatedAt: 'desc' },
      limit,
      offset,
      populate: ['plan', 'price'],
    })

    const items = rows.map((sub) => ({
      id: sub.id,
      externalAccountId: sub.externalAccountId,
      planCode: sub.plan?.code ?? null,
      priceCode: sub.price?.code ?? null,
      productCode: sub.plan?.productCode ?? null,
      provider: sub.providerKey,
      providerStatus: sub.providerStatus,
      providerSubscriptionId: sub.providerSubscriptionId ?? null,
      accessState: sub.accessState,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
      updatedAt: sub.updatedAt?.toISOString() ?? null,
    }))

    return NextResponse.json({
      items,
      page: parsed.page,
      pageSize: parsed.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / parsed.pageSize)),
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    }
    console.error('subscriptions.list failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: subscriptionsTag,
  summary: 'List subscriptions',
  methods: {
    GET: {
      summary: 'List subscriptions (admin)',
      tags: [subscriptionsTag],
      responses: [
        { status: 200, description: 'Paged list' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}

export default GET
