import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { xrayErrorSchema, xrayStatusResponseSchema } from '../../../data/validators'
import { readXrayStatus } from '../../../lib/projection/jobs'
import { toXrayStatusResponse } from '../../../lib/projection/statusView'
import { resolveVisibleXrayProcessKeys, resolveXrayRouteContext, xrayInternalError, xrayJson } from '../../../lib/xrayRoutes'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.manage'] },
}

export async function GET(req: Request) {
  try {
    const context = await resolveXrayRouteContext(req)
    if (context instanceof NextResponse) return context
    const [status, visible] = await Promise.all([
      readXrayStatus(context.container, context.scope),
      resolveVisibleXrayProcessKeys(context),
    ])
    const response = toXrayStatusResponse(status)
    return xrayJson({
      ...response,
      registry: { ...response.registry, processes: response.registry.processes.filter((process) => visible.has(process.processKey)) },
      processes: response.processes.filter((process) => visible.has(process.processKey)),
    })
  } catch (error) {
    return xrayInternalError(error, 'xray.status')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray ingest status',
  description: 'Operational status of the Process X-Ray projection of the selected organization.',
  methods: {
    GET: {
      summary: 'Get Process X-Ray status',
      description: 'Returns the ingest cursor (projected through, state, active backfill or reconciliation scan, last error), the registered process declarations and per-process event and case counts. Identifiers and counts only. Processes (and their counts) are listed only when the caller holds the process\'s required features in the organization.',
      responses: [{ status: 200, description: 'Ingest status', schema: xrayStatusResponseSchema }],
      errors: [
        { status: 400, description: 'No organization is selected, or it does not belong to the tenant', schema: xrayErrorSchema },
        { status: 401, description: 'Authentication required', schema: xrayErrorSchema },
        { status: 403, description: 'Missing `insights.xray.manage` or no organization access', schema: xrayErrorSchema },
      ],
    },
  },
}
