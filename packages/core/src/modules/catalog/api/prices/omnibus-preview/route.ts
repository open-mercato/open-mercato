import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CatalogOmnibusService } from '../../../services/catalogOmnibusService'
import { omnibusPreviewQuerySchema } from '../../../data/validators'
import { CatalogProduct } from '../../../data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.price_history.view'] },
}

export async function GET(req: NextRequest) {
  const container = await createRequestContainer()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId || !auth?.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parseResult = omnibusPreviewQuerySchema.safeParse(searchParams)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid query parameters', details: parseResult.error.flatten() }, { status: 400 })
    }
    const query = parseResult.data
    const { tenantId } = auth
    const organizationId = auth.orgId

    const catalogOmnibusService = container.resolve<CatalogOmnibusService>('catalogOmnibusService')
    const em = container.resolve<EntityManager>('em')

    let omnibusExempt: boolean | null = null
    let firstListedAt: Date | null = null
    if (query.productId) {
      const product = await findOneWithDecryption(
        em,
        CatalogProduct,
        { id: query.productId, organizationId, tenantId },
        {},
        { tenantId, organizationId },
      )
      if (product) {
        omnibusExempt = product.omnibusExempt ?? null
        firstListedAt = product.firstListedAt ?? null
      }
    }

    const omnibusCtx = {
      tenantId,
      organizationId,
      productId: query.productId ?? null,
      variantId: query.variantId ?? null,
      offerId: query.offerId ?? null,
      priceKindId: query.priceKindId,
      currencyCode: query.currencyCode,
      channelId: query.channelId ?? null,
      isStorefront: false,
      omnibusExempt,
      firstListedAt,
    }

    const block = await catalogOmnibusService.resolveOmnibusBlock(em, omnibusCtx, null, false)
    return NextResponse.json(block)
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') await disposable.dispose()
  }
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: {
      tags: ['Catalog'],
      summary: 'Omnibus price preview',
      description: 'Returns the Omnibus reference price block for a price editing context.',
      query: omnibusPreviewQuerySchema,
      responses: [
        { status: 200, description: 'Omnibus block or null when disabled' },
      ],
    },
  },
}
