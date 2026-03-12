import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { getSyncQueue } from '@open-mercato/core/modules/data_sync/lib/queue'
import {
  AKENEO_DELETE_IMPORTED_PRODUCTS_QUEUE,
  findAkeneoImportedProductIds,
} from '../../lib/delete-imported-products'

const requestSchema = z.object({
  confirm: z.literal(true),
})

const responseSchema = z.object({
  ok: z.boolean(),
  progressJobId: z.string().uuid().nullable(),
  message: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
}

export const openApi = {
  tags: ['Akeneo'],
  summary: 'Start deleting all Akeneo-imported products for the current organization',
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

  const parsed = requestSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return NextResponse.json(responseSchema.parse({
      ok: false,
      progressJobId: null,
      message: 'Invalid payload',
    }), { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const progressService = container.resolve('progressService') as ProgressService
  const scope = {
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    userId: auth.sub,
  }

  const productIds = await findAkeneoImportedProductIds(em, scope)
  if (productIds.length === 0) {
    return NextResponse.json(responseSchema.parse({
      ok: true,
      progressJobId: null,
      message: 'No Akeneo-imported products were found.',
    }))
  }

  const progressJob = await progressService.createJob(
    {
      jobType: 'sync_akeneo.delete_imported_products',
      name: 'Delete imported Akeneo products',
      description: `Deleting ${productIds.length} imported catalog products`,
      totalCount: productIds.length,
      cancellable: false,
      meta: {
        integrationId: 'sync_akeneo',
        entityType: 'products',
      },
    },
    {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
    },
  )

  const queue = getSyncQueue(AKENEO_DELETE_IMPORTED_PRODUCTS_QUEUE)
  await queue.enqueue({
    progressJobId: progressJob.id,
    scope,
  })

  return NextResponse.json(responseSchema.parse({
    ok: true,
    progressJobId: progressJob.id,
    message: 'Started deleting Akeneo-imported products.',
  }), { status: 202 })
}
