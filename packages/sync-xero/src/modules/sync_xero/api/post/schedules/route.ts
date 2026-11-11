import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { authorizeXeroRoute } from '../../../lib/route-auth'
import { xeroErrorResponse } from '../../../lib/route-errors'
import { ensureDefaultSchedules } from '../../../lib/schedules'
import { XERO_OPENAPI_TAG, xeroErrorSchema, xeroRuleOneErrors, xeroScheduleSchema } from '../../openapi'

const FEATURES = ['data_sync.configure', 'integrations.view']

export const metadata = {
  path: '/sync_xero/schedules',
  POST: { requireAuth: true, requireFeatures: FEATURES },
}

export async function POST(req: Request): Promise<Response> {
  const authorized = await authorizeXeroRoute(req, FEATURES)
  if (!authorized.ok) return authorized.response
  const { container, scope, userId } = authorized.context

  const ensured = await ensureDefaultSchedules({ container, scope, guard: { req, userId } })
  if (ensured.failed.length > 0) return xeroErrorResponse(503, 'xero.schedule_create_failed', { schedules: ensured.schedules })
  return NextResponse.json({ schedules: ensured.schedules })
}

export const openApi: OpenApiRouteDoc = {
  tag: XERO_OPENAPI_TAG,
  summary: 'Create the default Xero schedules',
  methods: {
    POST: {
      summary: 'Create the hourly default schedule of every xero.* entity type that has none',
      description:
        'Idempotent: an existing schedule, enabled or not, is never changed. Each missing schedule is created behind the data_sync.schedule create guard.',
      tags: [XERO_OPENAPI_TAG],
      responses: [{ status: 200, description: 'The xero.* schedules', schema: z.object({ schedules: z.array(xeroScheduleSchema) }) }],
      errors: [
        ...xeroRuleOneErrors('data_sync.configure and integrations.view'),
        { status: 503, description: 'xero.schedule_create_failed, with the schedules as they are now', schema: xeroErrorSchema },
      ],
    },
  },
}

export default POST
