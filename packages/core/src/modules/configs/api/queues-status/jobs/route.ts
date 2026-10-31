import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { inspectRecentJobs } from '../../../lib/queue-job-inspector'
import { listRegisteredQueues } from '../../../lib/queue-status-registry'
import { isQueueReadTimeoutError } from '../../../lib/queue-status'
import { QUEUE_STATUS_ERROR_CODES, reportQueueStatusError } from '../../../lib/queue-status-telemetry'
import type { AccessLogService } from '@open-mercato/core/modules/audit_logs/services/accessLogService'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  configsTag,
  jobInspectorResponseDocSchema,
  jobInspectorQuerySchema,
  configErrorSchema,
} from '../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('configs')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['configs.queues_status.inspect_payloads'] },
} as const

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsedQuery = jobInspectorQuerySchema.safeParse({
    queue: url.searchParams.get('queue') ?? undefined,
    state: url.searchParams.get('state') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    id: url.searchParams.get('id') ?? undefined,
  })
  if (!parsedQuery.success) {
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('configs.queuesStatus.inspector.invalidQuery', 'Invalid query parameters'), details: parsedQuery.error.flatten() },
      { status: 400 },
    )
  }

  // The requested queue must be a REGISTERED queue — never an arbitrary caller-supplied
  // name handed straight to a queue strategy, which would let a caller probe or create
  // queues outside the known registry.
  const isRegistered = listRegisteredQueues().some((entry) => entry.queue === parsedQuery.data.queue)
  if (!isRegistered) {
    return NextResponse.json({ jobs: [], crossTenant: false })
  }

  try {
    const container = await createRequestContainer()
    const accessLogService = container.resolve('accessLogService') as AccessLogService
    // The access-log viewer filters by the organization the user has SELECTED, so the audit row
    // must carry that same organization or it disappears from the log while an org is selected.
    let auditOrganizationId: string | null = auth.orgId ?? null
    try {
      const featureContext = await resolveFeatureCheckContext({ container, auth, request: req })
      auditOrganizationId = featureContext.organizationId ?? null
    } catch {
      // Fall back to the token's organization; the audit row is still written.
    }

    const response = await inspectRecentJobs({
      queue: parsedQuery.data.queue,
      state: parsedQuery.data.state,
      type: parsedQuery.data.type,
      id: parsedQuery.data.id,
      limit: parsedQuery.data.limit ?? 20,
      actor: {
        actorUserId: auth.sub,
        tenantId: auth.tenantId,
        organizationId: auditOrganizationId,
        isSuperAdmin: auth.isSuperAdmin === true,
      },
      audit: accessLogService,
    })
    return NextResponse.json(response)
  } catch (error) {
    logger.error('failed to inspect queue job', { component: 'queues-status-jobs', err: error })
    const timedOut = isQueueReadTimeoutError(error)
    reportQueueStatusError(
      error,
      timedOut ? QUEUE_STATUS_ERROR_CODES.queueReadTimeout : QUEUE_STATUS_ERROR_CODES.inspectFailed,
      { queue: parsedQuery.data.queue },
    )
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('configs.queuesStatus.inspector.error', 'Failed to load job') },
      { status: timedOut ? 503 : 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: configsTag,
  summary: 'Job Inspector — last-X jobs or a single job, including payload (Tier 2, privileged)',
  methods: {
    GET: {
      summary: 'Inspect recent queue jobs',
      description:
        'Returns the last X jobs for a queue (optionally filtered by state/type), or a single job by id — the click-through path from a Tier 1 row. Includes the (redaction-applied) job payload. Tenant-isolated: a non-superadmin never sees another tenant\'s jobs, even by id. Every call is audited.',
      query: jobInspectorQuerySchema,
      responses: [
        { status: 200, description: 'Inspected jobs', schema: jobInspectorResponseDocSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: configErrorSchema },
        { status: 401, description: 'Unauthorized', schema: configErrorSchema },
        { status: 403, description: 'Missing configs.queues_status.inspect_payloads', schema: configErrorSchema },
        { status: 500, description: 'Failed to load job', schema: configErrorSchema },
        { status: 503, description: 'The queue backend did not answer in time', schema: configErrorSchema },
      ],
    },
  },
}
