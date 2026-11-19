/**
 * Failure-queue bulk replay (spec §8.4)
 *
 * Endpoint:
 * - POST /api/workflows/instances/bulk-replay
 *
 * Queues the work through the progress module rather than doing it inline:
 * replaying a page of parked instances re-executes that many real workflows,
 * which cannot happen inside an HTTP handler and must survive the operator
 * navigating away (`progress/AGENTS.md` MUST rules 1-4).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { ProgressService } from '../../../../progress/lib/progressService'
import { BULK_REPLAY_MAX_IDS, getBulkReplayQueue } from '../../../lib/bulk-replay'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

const requestSchema = z.object({
  action: z.enum(['retry', 'cancel']),
  ids: z.array(z.string().uuid()).min(1).max(BULK_REPLAY_MAX_IDS),
})

const responseSchema = z.object({
  ok: z.boolean(),
  progressJobId: z.string().uuid().nullable(),
  message: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['workflows.instances.bulk_ops'] },
}

const JOB_NAMES: Record<'retry' | 'cancel', string> = {
  retry: 'Replay workflow instances',
  cancel: 'Cancel workflow instances',
}

export async function POST(request: Request) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId || !auth.orgId) {
      return NextResponse.json(
        responseSchema.parse({ ok: false, progressJobId: null, message: 'Unauthorized' }),
        { status: 401 }
      )
    }

    const parsed = requestSchema.safeParse(await readJsonSafe(request))
    if (!parsed.success) {
      return NextResponse.json(
        responseSchema.parse({ ok: false, progressJobId: null, message: 'Invalid payload' }),
        { status: 400 }
      )
    }

    const container = await createRequestContainer()

    // The declarative `requireFeatures` guard already gates the route; this is
    // the same defence-in-depth check the single-instance retry/cancel routes
    // perform, and it is the one that is scoped to the caller's organization.
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.instances.bulk_ops'],
      { tenantId: auth.tenantId, organizationId: auth.orgId }
    )
    if (!hasPermission) {
      return NextResponse.json(
        responseSchema.parse({ ok: false, progressJobId: null, message: 'Insufficient permissions' }),
        { status: 403 }
      )
    }

    const ids = Array.from(new Set(parsed.data.ids))
    const progressService = container.resolve('progressService') as ProgressService
    const progressJob = await progressService.createJob(
      {
        jobType: `workflows.instances.bulk_${parsed.data.action}`,
        name: JOB_NAMES[parsed.data.action],
        description: `${ids.length} workflow instances queued`,
        totalCount: ids.length,
        cancellable: false,
        meta: { source: 'workflows.failure-queue', action: parsed.data.action },
      },
      { tenantId: auth.tenantId, organizationId: auth.orgId, userId: auth.sub }
    )

    await getBulkReplayQueue().enqueue({
      progressJobId: progressJob.id,
      action: parsed.data.action,
      ids,
      // The worker re-reads every instance under this scope, so an id from
      // another tenant resolves to nothing and is skipped rather than acted on.
      scope: { tenantId: auth.tenantId, organizationId: auth.orgId, userId: auth.sub },
    })

    return NextResponse.json(
      responseSchema.parse({
        ok: true,
        progressJobId: progressJob.id,
        message: 'Bulk replay started.',
      }),
      { status: 202 }
    )
  } catch (error) {
    logger.error('Error starting workflow bulk replay', { err: error })
    return NextResponse.json(
      responseSchema.parse({ ok: false, progressJobId: null, message: 'Failed to start bulk replay' }),
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    POST: {
      summary: 'Bulk retry or cancel workflow instances',
      description:
        'Queue a bulk retry or cancel over the failure queue. Work runs in a queue worker and reports through the progress module; the response returns the progress job id immediately.',
      tags: ['Workflows'],
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
        description: 'Action to apply and the instance ids to apply it to.',
      },
      responses: [
        { status: 202, description: 'Bulk replay queued', schema: responseSchema },
        { status: 400, description: 'Invalid payload', schema: responseSchema },
        { status: 401, description: 'Unauthorized', schema: responseSchema },
        { status: 403, description: 'Insufficient permissions', schema: responseSchema },
        { status: 500, description: 'Internal server error', schema: responseSchema },
      ],
    },
  },
}
