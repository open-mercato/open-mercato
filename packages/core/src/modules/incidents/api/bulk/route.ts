import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { hasFeature } from '@open-mercato/shared/security/features'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ProgressService } from '../../../progress/lib/progressService'
import {
  INCIDENT_BULK_OPS_QUEUE,
  getIncidentBulkOpsQueue,
  runIncidentBulkGuards,
  serializeIncidentBulkRequestHeaders,
  type IncidentBulkAction,
} from '../../lib/bulkOps'

const requestSchema = z.object({
  action: z.enum(['acknowledge', 'close']),
  ids: z.array(z.string().uuid()).min(1).max(100),
  expectedUpdatedAtById: z.record(z.string().uuid(), z.string().nullable()).optional(),
})

const responseSchema = z.object({
  ok: z.boolean(),
  progressJobId: z.string().uuid().nullable(),
  message: z.string(),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

function jobName(action: IncidentBulkAction): string {
  return action === 'acknowledge' ? 'Acknowledge selected incidents' : 'Close selected incidents'
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
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
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    return NextResponse.json(responseSchema.parse({
      ok: false,
      progressJobId: null,
      message: 'Organization context is required',
    }), { status: 400 })
  }

  const ids = Array.from(new Set(parsed.data.ids))
  const action = parsed.data.action
  const userFeatures = resolveUserFeatures(auth)
  const expectedUpdatedAtById = Object.fromEntries(
    ids.map((id) => [id, parsed.data.expectedUpdatedAtById?.[id] ?? null]),
  )
  const isSuperAdmin = (auth as { isSuperAdmin?: boolean }).isSuperAdmin === true
  if (action === 'close' && !isSuperAdmin && !hasFeature(userFeatures, 'incidents.incident.close')) {
    return NextResponse.json(responseSchema.parse({
      ok: false,
      progressJobId: null,
      message: 'Close permission is required for bulk close',
    }), { status: 403 })
  }
  const guardInput = {
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub,
    resourceKind: 'incidents.incident',
    resourceId: 'bulk',
    operation: 'update' as const,
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: { action, ids, expectedUpdatedAtById },
  }
  const guardResult = await runIncidentBulkGuards(container, guardInput, userFeatures)
  if (!guardResult.ok) {
    return NextResponse.json(
      guardResult.errorBody ?? { error: 'Operation blocked by guard' },
      { status: guardResult.errorStatus ?? 422 },
    )
  }

  const progressService = container.resolve('progressService') as ProgressService
  const progressJob = await progressService.createJob(
    {
      jobType: `incidents.incident.bulk_${action}`,
      name: jobName(action),
      description: `${ids.length.toString()} incidents queued for ${action}`,
      totalCount: ids.length,
      cancellable: false,
      meta: {
        source: 'incidents.bulk',
        action,
      },
    },
    {
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub,
    },
  )

  const queue = getIncidentBulkOpsQueue(INCIDENT_BULK_OPS_QUEUE)
  await queue.enqueue({
    progressJobId: progressJob.id,
    action,
    ids,
    expectedUpdatedAtById,
    requestHeaders: serializeIncidentBulkRequestHeaders(req.headers),
    scope: {
      organizationId,
      tenantId: auth.tenantId,
      userId: auth.sub,
      userFeatures,
      isSuperAdmin: (auth as { isSuperAdmin?: unknown }).isSuperAdmin === true,
    },
  })

  return NextResponse.json(responseSchema.parse({
    ok: true,
    progressJobId: progressJob.id,
    message: 'Bulk incident operation started.',
  }), { status: 202 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Start a bulk incident operation',
  methods: {
    POST: {
      summary: 'Start a bulk acknowledge or close operation',
      description: 'Creates a progress job and enqueues a scoped worker job for selected incidents.',
      requestBody: { schema: requestSchema },
      responses: [
        { status: 202, description: 'Bulk operation queued', schema: responseSchema },
        { status: 400, description: 'Invalid request', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Forbidden', schema: errorResponseSchema },
        { status: 422, description: 'Blocked by mutation guard', schema: errorResponseSchema },
      ],
    },
  },
}
