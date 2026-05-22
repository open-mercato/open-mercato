import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { accessQuerySchema } from '../../../data/validators'
import { computeAccessSnapshotCached } from '../../../lib/access-service'
import { subscriptionsTag } from '../../openapi'

export const metadata = {
  path: '/subscriptions/access',
  GET: { requireAuth: true, requireFeatures: ['subscriptions.access'] },
}

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
    const parsed = accessQuerySchema.parse({
      externalAccountId: url.searchParams.get('externalAccountId') ?? '',
      productCode: url.searchParams.get('productCode') ?? 'external-app',
    })

    const em = container.resolve('em') as EntityManager
    let cache: ConstructorParameters<typeof Object>[0] | null = null
    try {
      cache = container.resolve('cache') as Record<string, unknown>
    } catch {
      cache = null
    }

    const snapshot = await computeAccessSnapshotCached({
      em,
      cache: cache as Parameters<typeof computeAccessSnapshotCached>[0]['cache'],
      scope: { tenantId, organizationId },
      externalAccountId: parsed.externalAccountId,
      productCode: parsed.productCode,
    })
    return NextResponse.json(snapshot)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    }
    console.error('subscriptions.access failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const responseSchema = z.object({
  subscriptionId: z.string().uuid().nullable(),
  externalAccountId: z.string(),
  productCode: z.string(),
  planCode: z.string().nullable(),
  priceCode: z.string().nullable(),
  provider: z.string().nullable(),
  providerStatus: z.string().nullable(),
  accessState: z.enum(['pending', 'granted', 'grace', 'blocked']),
  currentPeriodStart: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  entitlements: z.record(z.string(), z.unknown()).nullable(),
  updatedAt: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: subscriptionsTag,
  summary: 'Read access snapshot',
  methods: {
    GET: {
      summary: 'Return a normalized access snapshot for an external account and product',
      tags: [subscriptionsTag],
      responses: [
        { status: 200, description: 'Snapshot', schema: responseSchema },
        { status: 400, description: 'Validation failed' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}

export default GET
