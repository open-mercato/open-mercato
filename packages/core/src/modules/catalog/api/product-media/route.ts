import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { CatalogProduct } from '../../data/entities'
import { E } from '@open-mercato/generated/entity-ids'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
}

const querySchema = z.object({
  productId: z.string().uuid(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = querySchema.safeParse({ productId: url.searchParams.get('productId') })
  if (!parsed.success) {
    return NextResponse.json({ error: 'productId is required' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(request)
  if (!auth) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const product = await em.findOne(
    CatalogProduct,
    {
      id: parsed.data.productId,
      organizationId: auth.orgId ?? undefined,
      tenantId: auth.tenantId ?? undefined,
    },
    { fields: ['id', 'organizationId', 'tenantId'] },
  )
  if (!product) {
    throw new CrudHttpError(404, { error: 'Product not found' })
  }

  const attachments = await em.find(
    Attachment,
    {
      entityId: E.catalog.catalog_product,
      recordId: product.id,
      organizationId: product.organizationId ?? undefined,
      tenantId: product.tenantId ?? undefined,
    },
    { fields: ['id', 'fileName', 'url'] },
  )

  const items = attachments.map((attachment) => ({
    id: attachment.id,
    fileName: attachment.fileName,
    url: attachment.url,
    thumbnailUrl: buildAttachmentImageUrl(attachment.id, {
      width: 360,
      height: 360,
      slug: slugifyAttachmentFileName(attachment.fileName),
    }),
  }))

  return NextResponse.json({ items })
}

const mediaItemSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  url: z.string(),
  thumbnailUrl: z.string(),
})

const mediaListResponseSchema = z.object({
  items: z.array(mediaItemSchema),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Product Media management',
  methods: {
    GET: {
      summary: 'List product media',
      description: 'Returns a list of media attachments for a specific product.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'List of product media',
          schema: mediaListResponseSchema,
        },
      ],
    },
  },
}
