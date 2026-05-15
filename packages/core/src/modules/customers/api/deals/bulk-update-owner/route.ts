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
  CUSTOMERS_DEALS_BULK_UPDATE_OWNER_QUEUE,
  getCustomersQueue,
} from '../../../lib/bulkDeals'

const requestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(10000),
  ownerUserId: z.string().uuid().nullable(),
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
  summary: 'Bulk reassign deal owner',
  description:
    'Queues a background job that reassigns the listed deals to a new owner (or clears the owner when null).',
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

  // Mutation-guard contract for custom write routes — see comment on bulk-update-stage
  // route for full rationale. The bulk operation targets multiple deals so `resourceId`
  // is the comma-joined ID list, mirroring the client-side `runDealMutation` convention.
  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
    resourceKind: 'customers.deal',
    resourceId: ids.join(','),
    operation: 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: { ids, ownerUserId: parsed.data.ownerUserId },
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const progressService = container.resolve('progressService') as ProgressService

  const progressJob = await progressService.createJob(
    {
      jobType: 'customers.deals.bulk_update_owner',
      name: 'Reassign selected deals to a new owner',
      description: `${ids.length} deals queued for owner reassignment`,
      totalCount: ids.length,
      cancellable: false,
      meta: {
        source: 'customers.deals.bulk-update-owner',
        ownerUserId: parsed.data.ownerUserId,
      },
    },
    {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
    },
  )

  const queue = getCustomersQueue(CUSTOMERS_DEALS_BULK_UPDATE_OWNER_QUEUE)
  await queue.enqueue({
    progressJobId: progressJob.id,
    ids,
    ownerUserId: parsed.data.ownerUserId,
    scope: {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      userId: auth.sub,
    },
  })

  // After-success half of the mutation-guard contract — see bulk-update-stage route.
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
      message: 'Bulk owner update started.',
    }),
    { status: 202 },
  )
}
