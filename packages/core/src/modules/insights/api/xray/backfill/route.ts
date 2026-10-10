import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards, type RouteMutationGuardPassed } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { xrayBackfillRequestSchema, xrayBackfillResponseSchema, xrayErrorSchema } from '../../../data/validators'
import { XRAY_BACKFILL_RESOURCE_KIND, startXrayBackfill } from '../../../lib/projection/jobs'
import { resolveXrayRouteContext, xrayInternalError, xrayJson } from '../../../lib/xrayRoutes'

const logger = createLogger('insights').child({ component: 'xray-backfill-route' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['insights.xray.manage'] },
}

async function runAfterSuccessSafely(guarded: RouteMutationGuardPassed): Promise<void> {
  try {
    await guarded.runAfterSuccess()
  } catch (error) {
    logger.error('[internal] X-Ray backfill mutation guard after-success callback failed', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_guard_after_success_failed' })
  }
}

export async function POST(req: Request) {
  try {
    const context = await resolveXrayRouteContext(req)
    if (context instanceof NextResponse) return context
    const { translate } = await resolveTranslations()
    const body = await readJsonSafe<unknown>(req, {})
    const parsed = xrayBackfillRequestSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return xrayJson({ error: translate('insights.xray.errors.invalidBackfill', 'Invalid backfill request'), code: 'invalid_request' }, 400)
    }
    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: context.auth.sub ?? '', tenantId: context.scope.tenantId, organizationId: context.scope.organizationId },
      input: {
        resourceKind: XRAY_BACKFILL_RESOURCE_KIND,
        resourceId: context.scope.organizationId,
        operation: 'update',
        mutationPayload: { ...parsed.data },
      },
    })
    if (!guarded.ok) return guarded.response
    if (guarded.modifiedPayload) xrayBackfillRequestSchema.parse({ ...parsed.data, ...guarded.modifiedPayload })
    const started = await startXrayBackfill(context.container, context.scope, {
      userId: context.auth.sub ?? null,
      name: translate('insights.xray.backfill.jobName', 'Process X-Ray backfill'),
      description: translate('insights.xray.backfill.jobDescription', 'Projects the audit history of this organization into Process X-Ray.'),
    })
    if (!started.ok) {
      const messages: Record<typeof started.reason, string> = {
        no_processes: translate('insights.xray.errors.noProcesses', 'No module declares a process for Process X-Ray.'),
        disabled: translate('insights.xray.errors.disabled', 'Process X-Ray ingest is disabled for this organization.'),
        lease_busy: translate('insights.xray.errors.busy', 'Process X-Ray is busy. Try again in a moment.'),
      }
      return xrayJson({ error: messages[started.reason], code: started.reason }, 409)
    }
    const response = xrayJson({
      ok: true,
      progressJobId: started.progressJobId,
      scanId: started.scanId,
      scheduleRegistered: started.scheduleRegistered,
    }, 202)
    await runAfterSuccessSafely(guarded)
    return response
  } catch (error) {
    if (error instanceof z.ZodError) return xrayJson({ error: 'invalid_request', code: 'invalid_request' }, 400)
    return xrayInternalError(error, 'xray.backfill')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Start a Process X-Ray backfill',
  description: 'Projects the audit history of the selected organization (within its retention window) into Process X-Ray.',
  methods: {
    POST: {
      summary: 'Start a Process X-Ray backfill',
      description: 'Starts (or restarts) a resumable backfill tracked by a progress job, enrolls the organization in the system ingest tick and runs the registered mutation guards (`insights.xray_backfill`, resource id = organization id). A running backfill of the organization is superseded. Idempotent: projected rows are never duplicated.',
      requestBody: { contentType: 'application/json', schema: xrayBackfillRequestSchema },
      responses: [{ status: 202, description: 'Backfill started', schema: xrayBackfillResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request, no organization selected, or the organization does not belong to the tenant', schema: xrayErrorSchema },
        { status: 401, description: 'Authentication required', schema: xrayErrorSchema },
        { status: 403, description: 'Missing `insights.xray.manage` or no organization access', schema: xrayErrorSchema },
        { status: 409, description: 'No process declared, ingest disabled, or the projection is busy (`code`)', schema: xrayErrorSchema },
        { status: 422, description: 'Blocked by a mutation guard', schema: xrayErrorSchema },
      ],
    },
  },
}
