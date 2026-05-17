import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { ProgressService } from '../../../../progress/lib/progressService'
import {
  CUSTOMERS_DEALS_BULK_UPDATE_STAGE_QUEUE,
  getCustomersQueue,
} from '../../../lib/bulkDeals'

const requestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(10000),
  pipelineStageId: z.string().uuid(),
})

const responseSchema = z.object({
  ok: z.boolean(),
  progressJobId: z.string().uuid().nullable(),
  message: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
}

export const openApi = {
  tags: ['Customers'],
  summary: 'Bulk update deal pipeline stage',
  description:
    'Queues a background job that moves the listed deals to the same pipeline stage. Returns a progress job id to poll for completion.',
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json(
      responseSchema.parse({
        ok: false,
        progressJobId: null,
        message: 'Unauthorized',
      }),
      { status: 401 },
    )
  }

  const parsed = requestSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return NextResponse.json(
      responseSchema.parse({
        ok: false,
        progressJobId: null,
        message: 'Invalid payload',
      }),
      { status: 400 },
    )
  }

  const ids = Array.from(new Set(parsed.data.ids))
  const container = await createRequestContainer()

  // Mutation-guard contract for custom write routes — lets injection modules (record-lock
  // conflict handling, scoped headers, undo-history reconciliation) run `onBeforeSave` /
  // `onAfterSave` for non-`makeCrudRoute` writes. The bulk operation targets multiple deals,
  // so `resourceId` is the comma-joined ID list — matching the convention used by the
  // client-side `runDealMutation` calls in the kanban page.
  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
    resourceKind: 'customers.deal',
    resourceId: ids.join(','),
    operation: 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: { ids, pipelineStageId: parsed.data.pipelineStageId },
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const progressService = container.resolve('progressService') as ProgressService

  const progressJob = await progressService.createJob(
    {
      jobType: 'customers.deals.bulk_update_stage',
      name: 'Move selected deals to a new stage',
      description: `${ids.length} deals queued for stage update`,
      totalCount: ids.length,
      cancellable: false,
      meta: {
        source: 'customers.deals.bulk-update-stage',
        pipelineStageId: parsed.data.pipelineStageId,
      },
    },
    {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
    },
  )

  const queue = getCustomersQueue(CUSTOMERS_DEALS_BULK_UPDATE_STAGE_QUEUE)
  await queue.enqueue({
    progressJobId: progressJob.id,
    ids,
    pipelineStageId: parsed.data.pipelineStageId,
    scope: {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      userId: auth.sub,
    },
  })

  // After-success half of the mutation-guard contract — fires `onAfterSave` injection
  // hooks. We invoke it here because enqueue succeeded; the worker takes over from here.
  // If an injection-side after-handler needs the bulk job's actual completion (rather than
  // enqueue), it should subscribe to the progress event stream — beyond the scope of the
  // synchronous guard contract.
  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
      resourceKind: 'customers.deal',
      resourceId: ids.join(','),
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

  return NextResponse.json(
    responseSchema.parse({
      ok: true,
      progressJobId: progressJob.id,
      message: 'Bulk stage update started.',
    }),
    { status: 202 },
  )
}
