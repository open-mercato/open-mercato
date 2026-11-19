import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { PROBE_FEATURE_ID, isProbeEnabled } from '../../lib/availabilityStore'

const probeEnabled = isProbeEnabled()

export const metadata = {
  GET: probeEnabled
    ? { requireAuth: true, requireFeatures: [PROBE_FEATURE_ID] }
    : { requireAuth: false },
}

export async function GET() {
  if (!probeEnabled) {
    const { t: translate } = await resolveTranslations()
    return Response.json({ error: translate('api.errors.notFound', 'Not Found') }, { status: 404 })
  }
  return Response.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'ModuleAvailabilityProbe',
  methods: {
    GET: {
      summary: 'Test-only route guarded by a probe-owned feature (OM_TEST_MODE only, 404 otherwise)',
      tags: ['ModuleAvailabilityProbe'],
      responses: [
        { status: 200, description: 'The probe module is available to the tenant in scope', schema: z.object({ ok: z.literal(true) }) },
        { status: 403, description: 'The probe module is unavailable to the tenant in scope', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Not running under OM_TEST_MODE', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
