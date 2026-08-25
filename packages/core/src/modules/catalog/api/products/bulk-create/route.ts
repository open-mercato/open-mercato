import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { ProgressService } from '../../../../progress/lib/progressService'
import { productsBulkCreateSchema } from '../../../data/validators'
import {
  CATALOG_PRODUCT_BULK_CREATE_QUEUE,
  getCatalogQueue,
} from '../../../lib/bulkCreateProducts'

const responseSchema = z.object({
  ok: z.boolean(),
  progressJobId: z.string().uuid().nullable(),
  message: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['catalog.products.manage'] },
}

export const openApi = {
  tags: ['Catalog'],
  summary: 'Start bulk creating catalog products',
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json(responseSchema.parse({
      ok: false,
      progressJobId: null,
      message: 'Unauthorized',
    }), { status: 401 })
  }

  const parsed = productsBulkCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return NextResponse.json(responseSchema.parse({
      ok: false,
      progressJobId: null,
      message: 'Invalid payload',
    }), { status: 400 })
  }

  const items = parsed.data.items
  const container = await createRequestContainer()
  const progressService = container.resolve('progressService') as ProgressService

  const progressJob = await progressService.createJob(
    {
      jobType: 'catalog.products.bulk_create',
      name: 'Bulk create products',
      description: `${items.length} catalog products queued for creation`,
      totalCount: items.length,
      cancellable: true,
      meta: {
        source: 'catalog.bulk-create',
        checkpointInterval: 20,
        lastCompletedRowIndex: -1,
      },
    },
    {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
    },
  )

  const queue = getCatalogQueue(CATALOG_PRODUCT_BULK_CREATE_QUEUE)
  await queue.enqueue({
    progressJobId: progressJob.id,
    items,
    scope: {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      userId: auth.sub,
    },
  })

  return NextResponse.json(responseSchema.parse({
    ok: true,
    progressJobId: progressJob.id,
    message: 'Bulk create started.',
  }), { status: 202 })
}
