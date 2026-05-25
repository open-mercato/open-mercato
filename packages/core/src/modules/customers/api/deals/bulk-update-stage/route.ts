import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { ProgressService } from '../../../../progress/lib/progressService'
import {
  CUSTOMERS_DEALS_BULK_UPDATE_STAGE_QUEUE,
  getCustomersQueue,
} from '../../../lib/bulkDeals'
import {
  dealsBulkUpdateStageSchema as requestSchema,
  dealsBulkUpdateResponseSchema as responseSchema,
} from '../../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
}

export const openApi = {
  tags: ['Customers'],
  summary: 'Bulk update deal pipeline stage',
  description:
    'Queues a background job that moves the listed deals to the same pipeline stage. Returns a progress job id to poll for completion.',
}

async function postImpl(req: Request, translate: TranslateWithFallbackFn): Promise<NextResponse> {
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

  // Mutation-guard contract for custom write routes — lets injection modules (record-lock
  // conflict handling, scoped headers, undo-history reconciliation) run `onBeforeSave` /
  // `onAfterSave` for non-`makeCrudRoute` writes. Per-record locks are enforced by the
  // worker (the worker calls `customers.deals.update` per id, which itself goes through
  // the single-record route + guard). The guard at the bulk-entry point is best-effort:
  // it gives lock-aware modules a chance to register a bulk activity log, but failures
  // (e.g. a guard that expects a single-record id, or transient lock-table errors) must
  // NOT take the whole bulk enqueue down. Swallow the error so the bulk job still gets
  // queued and per-record enforcement happens downstream.
  let guardResult: Awaited<ReturnType<typeof validateCrudMutationGuard>> = null
  try {
    guardResult = await validateCrudMutationGuard(container, {
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
  } catch (guardError) {
    console.warn('[customers.deals.bulk-update-stage] mutation-guard skipped', guardError)
    guardResult = null
  }
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  let progressService: ProgressService
  try {
    progressService = container.resolve('progressService') as ProgressService
  } catch (resolveError) {
    console.error('[customers.deals.bulk-update-stage] progressService resolve failed', resolveError)
    throw new Error(
      `progressService resolve failed: ${resolveError instanceof Error ? resolveError.message : String(resolveError)}`,
    )
  }

  let progressJob: Awaited<ReturnType<ProgressService['createJob']>>
  try {
    progressJob = await progressService.createJob(
      {
        jobType: 'customers.deals.bulk_update_stage',
        name: translate(
          'customers.deals.kanban.bulk.changeStage.progress.name',
          'Move selected deals to a new stage',
        ),
        description: translate(
          'customers.deals.kanban.bulk.changeStage.progress.description',
          '{count} deals queued for stage update',
          { count: ids.length },
        ),
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
  } catch (createError) {
    console.error('[customers.deals.bulk-update-stage] progressService.createJob failed', createError)
    throw new Error(
      `progressService.createJob failed: ${createError instanceof Error ? createError.message : String(createError)}`,
    )
  }

  const queue = getCustomersQueue(CUSTOMERS_DEALS_BULK_UPDATE_STAGE_QUEUE)
  try {
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
  } catch (error) {
    // Without this guard the progress row sits in `pending` forever — the worker
    // never picks the job up, and the top-bar polls a job that will never finish.
    // Mark it failed so the operator gets a deterministic UX (a failure toast +
    // ability to retry) instead of an invisible stuck job.
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
        console.warn('[customers.deals.bulk-update-stage] failed to mark progress job as failed', failErr)
      })
    throw error
  }

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
      message: translate(
        'customers.deals.kanban.bulk.changeStage.queued',
        'Bulk stage update started ({count} deals).',
        { count: ids.length },
      ),
    }),
    { status: 202 },
  )
}

// Outer wrapper: every uncaught error from `postImpl` becomes a controlled 500 with
// diagnostic JSON instead of Next.js's default HTML error page. Routes that throw
// produced opaque 500s in CI integration tests (no body, no message), making the
// root cause invisible. With this wrapper the operator sees the actual error string
// in the response body and the server log, and the test framework can surface it.
export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    return await postImpl(req, translate)
  } catch (error) {
    console.error('[customers.deals.bulk-update-stage] route failed', error)
    return NextResponse.json(
      responseSchema.parse({
        ok: false,
        progressJobId: null,
        message:
          error instanceof Error
            ? error.message
            : translate('customers.errors.bulk_enqueue_failed', 'Failed to enqueue bulk job'),
      }),
      { status: 500 },
    )
  }
}
