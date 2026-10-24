import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { buildQueueStatusSnapshot } from '../../lib/queue-status'
import type { QueueStatusSnapshot } from '../../lib/queue-status.types'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  configsTag,
  queueStatusResponseSchema,
  queueStatusQuerySchema,
  configErrorSchema,
} from '../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('configs')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['configs.queues_status.view'] },
} as const

/**
 * Whether this session ALSO holds the privileged `.inspect_payloads` feature (#3105) —
 * echoed in the snapshot so the UI knows whether to render Tier 1 rows as click-through
 * into the Job Inspector. This is advisory only: the Inspector route re-checks the feature
 * itself via `requireFeatures`, so a stale/forged echo here cannot grant payload access.
 */
async function resolveCanInspectPayloads(auth: { sub: string; tenantId: string | null; orgId: string | null }): Promise<boolean> {
  try {
    const container = await createRequestContainer()
    const rbacService = container.resolve('rbacService') as RbacService
    return await rbacService.userHasAllFeatures(
      auth.sub,
      ['configs.queues_status.inspect_payloads'],
      { tenantId: auth.tenantId, organizationId: auth.orgId },
    )
  } catch {
    return false
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsedQuery = queueStatusQuerySchema.safeParse({
    queue: url.searchParams.get('queue') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
  })
  if (!parsedQuery.success) {
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('configs.queuesStatus.invalidQuery', 'Invalid query parameters'), details: parsedQuery.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const canInspectPayloads = await resolveCanInspectPayloads(auth)
    const snapshot: QueueStatusSnapshot = await buildQueueStatusSnapshot({
      queue: parsedQuery.data.queue ?? null,
      type: parsedQuery.data.type ?? null,
      canInspectPayloads,
    })
    return NextResponse.json(snapshot)
  } catch (error) {
    logger.error('failed to build queue status snapshot', { component: 'queues-status', err: error })
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('configs.queuesStatus.error', 'Failed to load queue status') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: configsTag,
  summary: 'Queue health and failed-job visibility (Tier 1, payload-free)',
  methods: {
    GET: {
      summary: 'Get queue status snapshot',
      description:
        'Returns per-registered-queue job counts, a bounded recent-failures window, processing-time metrics, and in-flight/aged-waiting job timing. Never includes job payloads. Optionally narrowed by ?queue= and/or ?type=.',
      query: z.object({ queue: z.string().optional(), type: z.string().optional() }),
      responses: [
        { status: 200, description: 'Queue status snapshot', schema: queueStatusResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: configErrorSchema },
        { status: 401, description: 'Unauthorized', schema: configErrorSchema },
        { status: 403, description: 'Missing configs.queues_status.view', schema: configErrorSchema },
        { status: 500, description: 'Failed to load queue status', schema: configErrorSchema },
      ],
    },
  },
}
