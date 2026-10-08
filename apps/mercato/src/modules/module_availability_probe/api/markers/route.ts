import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { PROBE_FEATURE_ID, isProbeEnabled } from '../../lib/availabilityStore'
import { PROBE_MARKER_COMMAND_ID } from '../../lib/markers'

const probeEnabled = isProbeEnabled()

export const metadata = {
  POST: probeEnabled
    ? { requireAuth: true, requireFeatures: [PROBE_FEATURE_ID] }
    : { requireAuth: false },
}

const markerResponseSchema = z.object({
  ok: z.literal(true),
  markerId: z.string().uuid(),
})

export async function POST(req: Request) {
  const { t: translate } = await resolveTranslations()
  if (!probeEnabled) return Response.json({ error: translate('api.errors.notFound', 'Not Found') }, { status: 404 })
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return Response.json({ error: translate('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }
  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const commandBus = container.resolve<CommandBus>('commandBus')
  const markerId = randomUUID()
  await commandBus.execute(PROBE_MARKER_COMMAND_ID, {
    input: { markerId },
    ctx: {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: scope.selectedId,
      organizationIds: scope.filterIds,
      request: req,
    },
  })
  return Response.json({ ok: true, markerId })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'ModuleAvailabilityProbe',
  methods: {
    POST: {
      summary: 'Test-only route that runs the undoable probe marker command, so audit-log replay of a probe-owned command can be exercised (OM_TEST_MODE only, 404 otherwise)',
      tags: ['ModuleAvailabilityProbe'],
      responses: [
        { status: 200, description: 'The marker command ran and wrote an undoable action-log entry', schema: markerResponseSchema },
        { status: 403, description: 'The probe module is unavailable to the tenant in scope', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Not running under OM_TEST_MODE', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
