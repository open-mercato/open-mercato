import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  CATALOG_SETTINGS_MODULE_ID,
  UNIT_PRICE_DISPLAY_ENABLED_DEFAULT,
  UNIT_PRICE_DISPLAY_ENABLED_KEY,
} from '../../lib/settings'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('catalog')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.settings.manage'] },
}

const bodySchema = z.object({
  unitPriceDisplayEnabled: z.boolean(),
})

const responseSchema = z.object({
  unitPriceDisplayEnabled: z.boolean(),
})

type SettingsContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
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
    auth,
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
    actorId,
  }
}

async function readUnitPriceDisplayEnabled(context: SettingsContext): Promise<boolean> {
  const configService = context.container.resolve('moduleConfigService') as ModuleConfigService
  const value = await configService.getValue<boolean>(
    CATALOG_SETTINGS_MODULE_ID,
    UNIT_PRICE_DISPLAY_ENABLED_KEY,
    { defaultValue: UNIT_PRICE_DISPLAY_ENABLED_DEFAULT, scope: { tenantId: context.tenantId } },
  )
  return typeof value === 'boolean' ? value : UNIT_PRICE_DISPLAY_ENABLED_DEFAULT
}

async function GET(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const unitPriceDisplayEnabled = await readUnitPriceDisplayEnabled(context)
    return NextResponse.json({ unitPriceDisplayEnabled })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('catalog.settings.GET Unexpected error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function PUT(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const body = bodySchema.parse(await req.json())

    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: context.actorId,
      resourceKind: 'catalog.settings',
      resourceId: UNIT_PRICE_DISPLAY_ENABLED_KEY,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { unitPriceDisplayEnabled: body.unitPriceDisplayEnabled },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const configService = context.container.resolve('moduleConfigService') as ModuleConfigService
    await configService.setValue(
      CATALOG_SETTINGS_MODULE_ID,
      UNIT_PRICE_DISPLAY_ENABLED_KEY,
      body.unitPriceDisplayEnabled,
      { tenantId: context.tenantId },
    )

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: context.actorId,
        resourceKind: 'catalog.settings',
        resourceId: UNIT_PRICE_DISPLAY_ENABLED_KEY,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({ unitPriceDisplayEnabled: body.unitPriceDisplayEnabled })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: err.issues }, { status: 400 })
    }
    logger.error('catalog.settings.PUT Unexpected error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const getDoc: OpenApiMethodDoc = {
  summary: 'Read catalog settings',
  tags: ['Catalog'],
  responses: [
    { status: 200, description: 'Catalog settings', schema: responseSchema },
  ],
}

const putDoc: OpenApiMethodDoc = {
  summary: 'Update catalog settings',
  tags: ['Catalog'],
  requestBody: { schema: bodySchema },
  responses: [
    { status: 200, description: 'Updated catalog settings', schema: responseSchema },
  ],
  errors: [{ status: 400, description: 'Invalid request body' }],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Catalog module settings',
  methods: {
    GET: getDoc,
    PUT: putDoc,
  },
}

export { GET, PUT }
