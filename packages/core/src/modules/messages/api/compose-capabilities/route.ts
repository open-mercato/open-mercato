import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { resolveMessageContext } from '../../lib/routeHelpers'
import { getScheduleMaxDays } from '../../lib/scheduleLimits'
import { isSchedulingAvailableFor } from '../../lib/scheduledSend'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['messages.compose'] },
}

const composeCapabilitiesResponseSchema = z.object({
  schedulingAvailable: z.boolean(),
  scheduleMaxDays: z.number().int().positive(),
})

export async function GET(req: Request) {
  const { ctx, scope } = await resolveMessageContext(req)
  return Response.json({
    schedulingAvailable: isSchedulingAvailableFor(ctx.container, scope.organizationId),
    scheduleMaxDays: getScheduleMaxDays(),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'Compose capabilities (scheduled sending availability and limit)',
      responses: [
        { status: 200, description: 'Compose capabilities', schema: composeCapabilitiesResponseSchema },
      ],
    },
  },
}
