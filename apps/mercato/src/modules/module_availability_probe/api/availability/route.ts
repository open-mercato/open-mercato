import { z } from 'zod'
import type { CacheStrategy } from '@open-mercato/cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  TENANT_MODULE_AVAILABILITY_DI_KEY,
  type TenantModuleAvailability,
} from '@open-mercato/shared/security/tenantModuleAvailability'
import { isProbeEnabled, setProbeModuleAvailability } from '../../lib/availabilityStore'

const probeEnabled = isProbeEnabled()

export const metadata = {
  PUT: { requireAuth: probeEnabled },
}

const SWITCH_FEATURE = 'auth.acl.manage'

const availabilityRequestSchema = z.object({
  available: z.boolean(),
})

const availabilityResponseSchema = z.object({
  ok: z.literal(true),
  tenantId: z.string(),
  available: z.boolean(),
})

export async function PUT(req: Request) {
  const { t: translate } = await resolveTranslations()
  if (!probeEnabled) return Response.json({ error: translate('api.errors.notFound', 'Not Found') }, { status: 404 })
  const auth = await getAuthFromRequest(req)
  const tenantId = auth?.tenantId ?? null
  if (!auth || !tenantId) {
    return Response.json({ error: translate('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }
  const parsed = availabilityRequestSchema.safeParse(await readJsonSafe<unknown>(req))
  if (!parsed.success) {
    return Response.json({ error: translate('api.errors.invalidPayload', 'Invalid payload.') }, { status: 400 })
  }
  const container = await createRequestContainer()
  const rbac = container.resolve<RbacService>('rbacService')
  const allowed = await rbac.userHasAllFeatures(auth.sub, [SWITCH_FEATURE], {
    tenantId,
    organizationId: auth.orgId ?? null,
  })
  if (!allowed) {
    return Response.json({ error: translate('api.errors.forbidden', 'Forbidden') }, { status: 403 })
  }
  await setProbeModuleAvailability(container.resolve<CacheStrategy>('cache'), tenantId, parsed.data.available)
  const availability = container.resolve<TenantModuleAvailability | null>(TENANT_MODULE_AVAILABILITY_DI_KEY)
  await availability?.invalidate(tenantId)
  return Response.json({ ok: true, tenantId, available: parsed.data.available })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'ModuleAvailabilityProbe',
  methods: {
    PUT: {
      summary: 'Test-only switch for the probe module availability of the caller tenant (OM_TEST_MODE only, 404 otherwise). It checks auth.acl.manage itself instead of declaring requireFeatures, so the switch keeps working while the probe module is unavailable',
      tags: ['ModuleAvailabilityProbe'],
      requestBody: { contentType: 'application/json', schema: availabilityRequestSchema },
      responses: [
        { status: 200, description: 'Availability stored and the tenant availability cache invalidated', schema: availabilityResponseSchema },
        { status: 404, description: 'Not running under OM_TEST_MODE', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
