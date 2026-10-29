import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function PUT(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const body = putBodySchema.parse(await req.json())
    const service = context.container.resolve('catalogCategorizationService') as CatalogCategorizationService

    const currentStatus = await service.getStatus({ tenantId: context.tenantId })
    if (body.settings.enabled && !currentStatus.available) {
      return NextResponse.json(
        { code: 'decision_model_unavailable', reason: currentStatus.reason ?? null },
        { status: 422 },
      )
    }

    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: context.actorId,
      resourceKind: 'catalog.ai_categorization_settings',
      resourceId: 'ai_categorization',
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: body.settings,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const moduleConfigService = context.container.resolve('moduleConfigService') as ModuleConfigService
    await writeAiCategorizationSettings(moduleConfigService, { tenantId: context.tenantId }, body.settings)

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: context.actorId,
        resourceKind: 'catalog.ai_categorization_settings',
        resourceId: 'ai_categorization',
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

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
