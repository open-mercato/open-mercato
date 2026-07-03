import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  clearModuleResourceUsageData,
  getModuleResourceUsageReport,
} from '@open-mercato/shared/lib/modules/resource-usage'
import {
  configErrorSchema,
  configsTag,
  moduleTelemetryClearResponseSchema,
  moduleTelemetryResponseSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['configs.system_status.view'] },
  // Clearing telemetry shouldn't itself perturb the very telemetry it just cleared.
  DELETE: { requireAuth: true, requireFeatures: ['configs.system_status.view'], skipModuleResourceUsageTracking: true },
} as const

function canClearModuleTelemetry(): boolean {
  return process.env.NODE_ENV === 'development'
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    ...getModuleResourceUsageReport(),
    canClearTelemetry: canClearModuleTelemetry(),
  })
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canClearModuleTelemetry()) {
    return NextResponse.json({ error: 'Clearing module telemetry is only available in development mode.' }, { status: 403 })
  }

  clearModuleResourceUsageData()
  return NextResponse.json({ cleared: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: configsTag,
  summary: 'Module telemetry usage',
  methods: {
    GET: {
      summary: 'Get module resource usage telemetry',
      description: 'Returns in-process module resource attribution for API routes, event subscribers, and queue workers.',
      responses: [
        { status: 200, description: 'Module resource usage report', schema: moduleTelemetryResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: configErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Clear module telemetry data',
      description: 'Development-only endpoint that clears in-memory module telemetry and local process telemetry files.',
      responses: [
        { status: 200, description: 'Module telemetry cleared', schema: moduleTelemetryClearResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: configErrorSchema },
        { status: 403, description: 'Forbidden outside development mode', schema: configErrorSchema },
      ],
    },
  },
}
