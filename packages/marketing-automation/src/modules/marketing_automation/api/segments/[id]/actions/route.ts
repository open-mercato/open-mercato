import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { MarketingSegment } from '../../../../data/entities.js'
import { enqueueSegmentAction } from '../../../../lib/queue.js'
import { readPathUuid } from '../../../shared.js'

/**
 * Starts a bulk action over everybody in a segment.
 *
 * Returns 202 with a progress job id and does none of the work: tagging ten thousand customers is not a
 * request, and an operator who navigates away must not cancel it by accident.
 *
 * The job carries the SEGMENT, not the member list — membership is resolved when it runs, so an action acts
 * on who is in the segment then rather than on a list that was stale before it was written.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const bodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add_tag'), tagId: z.string().uuid() }),
  z.object({
    kind: z.literal('add_points'),
    points: z.number().int().refine((value) => value !== 0, { message: 'points must not be zero' }),
    reason: z.string().trim().max(200).optional(),
  }),
])

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // .../segments/<id>/actions
  const segmentId = readPathUuid(req, 2)
  if (!segmentId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      {
        error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload',
        code: 'marketing_automation.validation.invalidPayload',
      },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const segment = await em.findOne(MarketingSegment, { id: segmentId, ...scope, deletedAt: null })
  if (!segment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let progress: ProgressService
  try {
    progress = container.resolve<ProgressService>('progressService')
  } catch {
    // Without the progress module there is nothing to track the work with, and starting untrackable bulk
    // work is worse than declining it.
    return NextResponse.json(
      { error: 'Progress tracking is not available in this installation', code: 'marketing_automation.errors.progressUnavailable' },
      { status: 503 },
    )
  }

  const actorId = typeof auth.sub === 'string' ? auth.sub : null
  const progressContext = { tenantId: scope.tenantId, organizationId: scope.organizationId, userId: actorId }

  const job = await progress.createJob(
    {
      jobType: 'marketing_automation.segment_action',
      name: parsed.data.kind === 'add_tag'
        ? `Tag members of ${segment.name}`
        : `Award points to members of ${segment.name}`,
      description: `Segment ${segment.slug}`,
      // Unknown until membership is resolved, which the worker does; it sets the total then.
      totalCount: 0,
      cancellable: true,
      meta: { segmentId: segment.id, action: parsed.data.kind },
    },
    progressContext,
  )

  await enqueueSegmentAction({
    scope,
    segmentId: segment.id,
    progressJobId: job.id,
    actorId,
    action: parsed.data,
  })

  return NextResponse.json({ ok: true, progressJobId: job.id }, { status: 202 })
}

export const openApi = {
  POST: {
    summary: 'Apply an action to everybody in a segment',
    description:
      'Queues the work and answers 202 with a progress job id. Membership is resolved when the job runs, not when it is requested, so the action applies to who is in the segment then.',
    tags: ['Marketing Automation'],
    responses: {
      202: { description: 'Queued, with the progress job id' },
      404: { description: 'No such segment' },
      503: { description: 'No progress tracking in this installation' },
    },
  },
}
