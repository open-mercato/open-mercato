import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import {
  EXAMPLE_CATALOG_PRODUCT_BULK_DELETE_QUEUE,
  getExampleQueue,
} from '../../lib/catalogProductBulkDelete'

const requestSchema = z.object({
  confirm: z.literal(true),
  ids: z.array(z.string().uuid()).min(1).max(10000),
  scope: z.enum(['selected', 'filtered']),
})

const responseSchema = z.object({
  ok: z.boolean(),
  progressJobId: z.string().uuid().nullable(),
  message: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['catalog.products.manage'] },
}

export const openApi = {
  tags: ['Example'],
  summary: 'Start bulk deleting catalog products from the example UMES widget',
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

  const parsed = requestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(responseSchema.parse({
      ok: false,
      progressJobId: null,
      message: 'Invalid payload',
    }), { status: 400 })
  }

  const ids = Array.from(new Set(parsed.data.ids))
  const container = await createRequestContainer()
  const progressService = container.resolve('progressService') as ProgressService

  const progressJob = await progressService.createJob(
    {
      jobType: 'example.catalog.bulk_delete',
      name: parsed.data.scope === 'filtered'
        ? 'Delete filtered catalog products'
        : 'Delete selected catalog products',
      description: `${ids.length} catalog products queued for deletion`,
      totalCount: ids.length,
      cancellable: false,
      meta: {
        source: 'example.catalog.bulk-delete',
        scope: parsed.data.scope,
      },
    },
    {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
    },
  )

  const queue = getExampleQueue(EXAMPLE_CATALOG_PRODUCT_BULK_DELETE_QUEUE)
  await queue.enqueue({
    progressJobId: progressJob.id,
    ids,
    scope: {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      userId: auth.sub,
    },
  })

  return NextResponse.json(responseSchema.parse({
    ok: true,
    progressJobId: progressJob.id,
    message: 'Bulk delete started.',
  }), { status: 202 })
}
