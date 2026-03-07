import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerDealStageHistory } from '../../../../data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function GET(request: Request, context: { params?: Record<string, unknown> }) {
  const parsedParams = paramsSchema.safeParse(context.params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
  } catch {
    rbac = null
  }

  if (!rbac || !auth?.sub) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, ['customers.deals.view'], {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const em = (container.resolve('em') as EntityManager)
  const decryptionScope = { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null }

  const deal = await findOneWithDecryption(
    em,
    CustomerDeal,
    { id: parsedParams.data.id, deletedAt: null },
    {},
    decryptionScope,
  )
  if (!deal) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  if (auth.tenantId && deal.tenantId && auth.tenantId !== deal.tenantId) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const query = querySchema.parse(Object.fromEntries(url.searchParams))

  const history = await findWithDecryption(
    em,
    CustomerDealStageHistory,
    {
      dealId: deal.id,
      organizationId: deal.organizationId,
      tenantId: deal.tenantId,
    },
    {
      orderBy: { createdAt: 'DESC' },
      limit: query.limit,
      offset: query.offset,
    },
    decryptionScope,
  )

  const total = await em.count(CustomerDealStageHistory, {
    dealId: deal.id,
    organizationId: deal.organizationId,
    tenantId: deal.tenantId,
  })

  return NextResponse.json({
    data: history.map((entry) => ({
      id: entry.id,
      dealId: entry.dealId,
      fromStageId: entry.fromStageId ?? null,
      toStageId: entry.toStageId,
      fromStageLabel: entry.fromStageLabel ?? null,
      toStageLabel: entry.toStageLabel,
      fromPipelineId: entry.fromPipelineId ?? null,
      toPipelineId: entry.toPipelineId,
      changedByUserId: entry.changedByUserId ?? null,
      durationSeconds: entry.durationSeconds ?? null,
      createdAt: entry.createdAt,
    })),
    meta: {
      total,
      limit: query.limit,
      offset: query.offset,
    },
  })
}

export const metadata = {
  methods: ['GET'],
  requireAuth: true,
  requireFeatures: ['customers.deals.view'],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Deal stage history',
  methods: {
    GET: {
      summary: 'List deal stage history',
      description: 'Returns the stage transition history for a specific deal, ordered by most recent first.',
      responses: [
        { status: 200, description: 'Stage history entries' },
        { status: 401, description: 'Authentication required' },
        { status: 403, description: 'Access denied' },
        { status: 404, description: 'Deal not found' },
      ],
    },
  },
}
