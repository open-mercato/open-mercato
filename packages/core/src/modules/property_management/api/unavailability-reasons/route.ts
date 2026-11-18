import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { listUnavailabilityReasons } from '../../lib/unavailabilityReasons'
import { localToday } from '../../lib/leaseTerm'
import { handleRouteError, resolveStaffContext } from '../routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
}

export async function GET(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    const items = await listUnavailabilityReasons(context.em, { tenantId: context.tenantId, organizationId: context.organizationId })
    return NextResponse.json({ items, today: localToday() })
  } catch (err) {
    return handleRouteError(err, 'property_management.unavailability_reasons_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Unavailability reasons',
  methods: {
    GET: {
      summary: 'Entries of the `property_management.unavailability-reasons` dictionary',
      description: 'Empty while the dictionary is inactive. `today` is the deployment-local calendar date: an unavailable period cannot start before it.',
      responses: [
        {
          status: 200,
          description: 'Reasons',
          schema: z.object({
            items: z.array(z.object({ id: z.string().uuid(), value: z.string(), label: z.string() })),
            today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          }),
        },
      ],
    },
  },
}
