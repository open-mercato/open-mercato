import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runWithCacheTenant } from '@open-mercato/cache'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { aiCategorizationSettingsSchema } from '../../../data/validators'
import { writeAiCategorizationSettings } from '../../../lib/aiCategorizationSettings'
import type {
  CatalogCategorizationService,
  CatalogCategorizationStatus,
} from '../../../lib/aiCategorization/categorizationService'

const logger = createLogger('catalog')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.settings.manage'] },
}

const putBodySchema = z.object({
  settings: aiCategorizationSettingsSchema,
})

const responseSchema = z.object({
  settings: aiCategorizationSettingsSchema,
  available: z.boolean(),
  reason: z.string().optional(),
  effective: z.boolean(),
})

type SettingsContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  tenantId: string
  organizationId: string | null
  actorId: string
}

async function resolveSettingsContext(req: Request): Promise<SettingsContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  const actorId =
    (typeof auth.sub === 'string' && auth.sub.trim().length > 0 && auth.sub) ||
    (typeof auth.userId === 'string' && auth.userId.trim().length > 0 && auth.userId) ||
    (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0 && auth.keyId) ||
    'system'
  return {
    container,
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
    actorId,
  }
}

async function invalidateSidebarNavCache(container: SettingsContext['container'], tenantId: string) {
  try {
    const cache = container.resolve('cache') as {
      deleteByTags?: (tags: string[]) => Promise<unknown>
    } | null
    await runWithCacheTenant(tenantId, () => cache?.deleteByTags?.([`nav:sidebar:tenant:${tenantId}`]))
  } catch (err) {
    logger.warn('catalog.ai_categorization.settings.PUT Sidebar cache invalidation failed', { err })
  }
}

function buildResponse(status: CatalogCategorizationStatus) {
  return {
    settings: status.settings,
    available: status.available,
    ...(status.reason ? { reason: status.reason } : {}),
    effective: status.effective,
  }
}

async function GET(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const service = context.container.resolve('catalogCategorizationService') as CatalogCategorizationService
    const status = await service.getStatus({ tenantId: context.tenantId })
    return NextResponse.json(buildResponse(status))
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('catalog.ai_categorization.settings.GET Unexpected error', { err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'catalog',
      code: 'catalog.ai_categorization_settings_get_failed',
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function PUT(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const parsedBody = putBodySchema.safeParse(await readJsonSafe(req))
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const body = parsedBody.data
    const service = context.container.resolve('catalogCategorizationService') as CatalogCategorizationService

    const currentStatus = await service.getStatus({ tenantId: context.tenantId })
    if (body.settings.enabled && !currentStatus.available) {
      return NextResponse.json(
        { code: 'decision_model_unavailable', reason: currentStatus.reason ?? null },
        { status: 422 },
      )
    }

    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: context.actorId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: 'catalog.ai_categorization_settings',
        resourceId: 'ai_categorization',
        operation: 'custom',
        mutationPayload: body.settings,
      },
    })
    if (!guarded.ok) return guarded.response
    const effectiveSettings = guarded.modifiedPayload
      ? aiCategorizationSettingsSchema.parse({ ...body.settings, ...guarded.modifiedPayload })
      : body.settings
    // A transforming guard can turn `enabled` on (or raise `applyMode`) after the
    // raw-body check above already passed — re-validate against the final payload
    // so a guard can never enable the feature while the decision model is unavailable.
    if (effectiveSettings.enabled && !currentStatus.available) {
      return NextResponse.json(
        { code: 'decision_model_unavailable', reason: currentStatus.reason ?? null },
        { status: 422 },
      )
    }

    const moduleConfigService = context.container.resolve('moduleConfigService') as ModuleConfigService
    await writeAiCategorizationSettings(moduleConfigService, { tenantId: context.tenantId }, effectiveSettings)

    await invalidateSidebarNavCache(context.container, context.tenantId)
    await guarded.runAfterSuccess()

    const nextStatus = await service.getStatus({ tenantId: context.tenantId })
    return NextResponse.json(buildResponse(nextStatus))
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: err.issues }, { status: 400 })
    }
    logger.error('catalog.ai_categorization.settings.PUT Unexpected error', { err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'catalog',
      code: 'catalog.ai_categorization_settings_put_failed',
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const getDoc: OpenApiMethodDoc = {
  summary: 'Read catalog AI category-suggestion settings',
  tags: ['Catalog'],
  responses: [
    { status: 200, description: 'AI categorization settings and availability', schema: responseSchema },
  ],
}

const putDoc: OpenApiMethodDoc = {
  summary: 'Update catalog AI category-suggestion settings',
  tags: ['Catalog'],
  requestBody: { schema: putBodySchema },
  responses: [
    { status: 200, description: 'Updated AI categorization settings and availability', schema: responseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid request body' },
    { status: 422, description: 'Cannot enable while no decision model is configured' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Catalog AI category-suggestion settings',
  methods: {
    GET: getDoc,
    PUT: putDoc,
  },
}

export { GET, PUT }
