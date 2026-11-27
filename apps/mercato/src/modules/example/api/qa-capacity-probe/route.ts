import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { exampleTag } from '../openapi'
import {
  QA_CAPACITY_PROBE_DAY_MINUTES,
  QA_CAPACITY_PROBE_LABEL,
  QA_CAPACITY_PROBE_PROVIDER_ID,
  isQaCapacityProbeAvailable,
  setQaCapacityProbeRequested,
} from '../../lib/qaCapacityProbe'

const PROBE_FEATURE = 'staff.timesheets.settings.manage'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [PROBE_FEATURE] },
  DELETE: { requireAuth: true, requireFeatures: [PROBE_FEATURE] },
}

function notFound() {
  return Response.json({ error: '[internal] qa capacity probe is integration-test only' }, { status: 404 })
}

export async function POST() {
  if (!isQaCapacityProbeAvailable()) return notFound()
  setQaCapacityProbeRequested(true)
  return Response.json({
    active: true,
    providerId: QA_CAPACITY_PROBE_PROVIDER_ID,
    label: QA_CAPACITY_PROBE_LABEL,
    dayMinutes: QA_CAPACITY_PROBE_DAY_MINUTES,
  })
}

export async function DELETE() {
  if (!isQaCapacityProbeAvailable()) return notFound()
  setQaCapacityProbeRequested(false)
  return Response.json({ active: false })
}

const activateResponseSchema = z.object({
  active: z.literal(true),
  providerId: z.string(),
  label: z.string(),
  dayMinutes: z.number().int(),
})

const deactivateResponseSchema = z.object({
  active: z.literal(false),
})

const notFoundSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  methods: {
    POST: {
      summary: 'Activate the QA capacity probe',
      description:
        'Integration-test only (404 unless OM_INTEGRATION_TEST is set). Requests the contributed EP-40 capacity probe, which the example module registers through the staff registry on the next request container, so TC-STAFF-049 can verify a contributed target end to end.',
      tags: [exampleTag],
      responses: [{ status: 200, description: 'Probe requested', schema: activateResponseSchema }],
      errors: [{ status: 404, description: 'Not an integration-test runtime', schema: notFoundSchema }],
    },
    DELETE: {
      summary: 'Deactivate the QA capacity probe',
      description: 'Integration-test only (404 unless OM_INTEGRATION_TEST is set). Withdraws the probe request; the next request container disposes its registration.',
      tags: [exampleTag],
      responses: [{ status: 200, description: 'Probe withdrawn', schema: deactivateResponseSchema }],
      errors: [{ status: 404, description: 'Not an integration-test runtime', schema: notFoundSchema }],
    },
  },
}
