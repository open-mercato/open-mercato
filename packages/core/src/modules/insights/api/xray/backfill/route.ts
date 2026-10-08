import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { xrayBackfillRequestSchema, xrayBackfillResponseSchema, xrayErrorSchema } from '../../../data/validators'
import { startXrayBackfill } from '../../../lib/projection/jobs'
import { resolveXrayRouteContext, xrayInternalError, xrayJson } from '../../../lib/xrayRoutes'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['insights.xray.manage'] },
}

export async function POST(req: Request) {
  try {
    const context = await resolveXrayRouteContext(req)
    if (context instanceof NextResponse) return context
    const { translate } = await resolveTranslations()
    const body = await readJsonSafe<unknown>(req, {})
    if (!xrayBackfillRequestSchema.safeParse(body ?? {}).success) {
      return xrayJson({ error: translate('insights.xray.errors.invalidBackfill', 'Invalid backfill request'), code: 'invalid_request' }, 400)
    }
    const started = await startXrayBackfill(context.container, context.scope, {
      userId: context.auth.sub ?? null,
      name: translate('insights.xray.backfill.jobName', 'Process X-Ray backfill'),
      description: translate('insights.xray.backfill.jobDescription', 'Projects the audit history of this organization into Process X-Ray.'),
    })
    if (!started.ok) {
      const messages: Record<typeof started.reason, string> = {
        no_processes: translate('insights.xray.errors.noProcesses', 'No module declares a process for Process X-Ray.'),
        disabled: translate('insights.xray.errors.disabled', 'Process X-Ray ingest is disabled for this organization.'),
        rebuild_required: translate('insights.xray.errors.rebuildRequired', 'The process declarations changed. Rebuild the projection first.'),
        lease_busy: translate('insights.xray.errors.busy', 'Process X-Ray is busy. Try again in a moment.'),
      }
      return xrayJson({ error: messages[started.reason], code: started.reason }, 409)
    }
    return xrayJson({
      ok: true,
      progressJobId: started.progressJobId,
      scanId: started.scanId,
      scheduleRegistered: started.scheduleRegistered,
    }, 202)
  } catch (error) {
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
      description: 'Starts (or restarts) a resumable backfill tracked by a progress job and registers the organization\'s ingest schedule. A running backfill of the organization is superseded. Idempotent: projected rows are never duplicated.',
      requestBody: { contentType: 'application/json', schema: xrayBackfillRequestSchema },
      responses: [{ status: 202, description: 'Backfill started', schema: xrayBackfillResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request or no organization selected', schema: xrayErrorSchema },
        { status: 401, description: 'Authentication required', schema: xrayErrorSchema },
        { status: 403, description: 'Missing `insights.xray.manage` or no organization access', schema: xrayErrorSchema },
        { status: 409, description: 'No process declared, ingest disabled, or a rebuild is required (`code`)', schema: xrayErrorSchema },
      ],
    },
  },
}
