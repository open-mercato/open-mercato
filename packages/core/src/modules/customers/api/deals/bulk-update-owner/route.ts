import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
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
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json(
      responseSchema.parse({
        ok: false,
        progressJobId: null,
        message: translate('customers.errors.unauthorized', 'Unauthorized'),
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
        message: translate('customers.errors.invalid_payload', 'Invalid payload'),
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
      name: translate(
        'customers.deals.kanban.bulk.changeOwner.progress.name',
        'Reassign selected deals to a new owner',
      ),
      description: translate(
        'customers.deals.kanban.bulk.changeOwner.progress.description',
        '{count} deals queued for owner reassignment',
        { count: ids.length },
      ),
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
  try {
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
  } catch (error) {
    // See bulk-update-stage route for rationale: without this guard the progress
    // job hangs in `pending` because the worker will never pick it up after a
    // failed enqueue, and the top-bar polls indefinitely.
    await progressService
      .failJob(
        progressJob.id,
        {
          errorMessage:
            error instanceof Error
              ? error.message
              : translate('customers.errors.bulk_enqueue_failed', 'Failed to enqueue bulk job'),
        },
        {
          tenantId: auth.tenantId,
          organizationId: auth.orgId,
          userId: auth.sub,
        },
      )
      .catch((failErr) => {
        console.warn('[customers.deals.bulk-update-owner] failed to mark progress job as failed', failErr)
      })
    throw error
  }

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
      message: translate(
        'customers.deals.kanban.bulk.changeOwner.queued',
        'Bulk owner update started ({count} deals).',
        { count: ids.length },
      ),
    }),
    { status: 202 },
  )
}
