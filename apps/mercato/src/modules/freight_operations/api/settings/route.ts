import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { BILLING_CYCLES } from '../../data/entities'
import { freightSettingsInputSchema } from '../../data/validators'
import {
  FREIGHT_SETTINGS_KEY,
  readFreightSettingsRecord,
  writeFreightSettings,
  type FreightSettingsRecord,
  type FreightSettingsScope,
} from '../../lib/freightSettings'

const logger = createLogger('freight_operations')

export const metadata = {
  path: '/freight_operations/settings',
  GET: { requireAuth: true, requireFeatures: ['freight.read'] },
  PUT: { requireAuth: true, requireFeatures: ['freight.settings.manage'] },
}

const SETTINGS_RESOURCE_KIND = 'freight_operations.settings'

type SettingsContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  tenantId: string
  organizationId: string | null
  actorId: string
  scope: FreightSettingsScope
}

async function resolveSettingsContext(req: Request): Promise<SettingsContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  }
  const actorId =
    (typeof auth.sub === 'string' && auth.sub.trim().length > 0 && auth.sub) ||
    (typeof auth.userId === 'string' && auth.userId.trim().length > 0 && auth.userId) ||
    'system'
  const organizationId = auth.orgId ?? null
  return {
    container,
    tenantId: auth.tenantId,
    organizationId,
    actorId,
    scope: { tenantId: auth.tenantId, organizationId },
  }
}

function configService(context: SettingsContext): ModuleConfigService {
  return context.container.resolve('moduleConfigService') as ModuleConfigService
}

function toResponse(record: FreightSettingsRecord) {
  return { ...record.settings, updatedAt: record.updatedAt }
}

async function GET(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const record = await readFreightSettingsRecord(configService(context), context.scope)
    return NextResponse.json(toResponse(record))
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('freight_operations.settings.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function PUT(req: Request) {
  try {
    const context = await resolveSettingsContext(req)
    const raw = await readJsonSafe(req, null)
    const input = freightSettingsInputSchema.parse(raw ?? {})

    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userId: context.actorId,
      resourceKind: SETTINGS_RESOURCE_KIND,
      resourceId: FREIGHT_SETTINGS_KEY,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const existing = await readFreightSettingsRecord(configService(context), context.scope)
    await enforceCommandOptimisticLockWithGuards(context.container, {
      resourceKind: SETTINGS_RESOURCE_KIND,
      resourceId: FREIGHT_SETTINGS_KEY,
      current: existing.updatedAt,
      request: req,
    })

    const record = await writeFreightSettings(configService(context), input, context.scope)

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        userId: context.actorId,
        resourceKind: SETTINGS_RESOURCE_KIND,
        resourceId: FREIGHT_SETTINGS_KEY,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json(toResponse(record))
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        { error: translate('freight_operations.errors.invalid_settings', 'Invalid freight settings'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('freight_operations.settings.PUT failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const settingsResponseSchema = z.object({
  defaultRequiresCustomerApproval: z.boolean(),
  defaultPaymentTermsDays: z.number(),
  defaultBillingCycle: z.enum(BILLING_CYCLES),
  defaultVatRate: z.number(),
  salesChannelId: z.string().nullable(),
  requirePodForBilling: z.boolean(),
  orderNumberPrefix: z.string(),
  contractNumberPrefix: z.string(),
  tripNumberPrefix: z.string(),
  abstractNumberPrefix: z.string(),
  updatedAt: z.string().nullable(),
})

const getDoc: OpenApiMethodDoc = {
  summary: 'Read the freight settings',
  tags: ['Freight Operations'],
  responses: [{ status: 200, description: 'Current settings merged with the shipped defaults', schema: settingsResponseSchema }],
}

const putDoc: OpenApiMethodDoc = {
  summary: 'Replace the freight settings',
  tags: ['Freight Operations'],
  requestBody: { schema: freightSettingsInputSchema },
  responses: [{ status: 200, description: 'Stored settings', schema: settingsResponseSchema }],
  errors: [
    { status: 400, description: 'Invalid request body' },
    { status: 401, description: 'Unauthorized' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Freight module settings',
  description: 'Defaults for new contracts and orders: approval mode, payment terms, VAT rate, numbering prefixes, POD policy, and the sales channel used by the invoice bridge.',
  methods: { GET: getDoc, PUT: putDoc },
}

export { GET, PUT }
