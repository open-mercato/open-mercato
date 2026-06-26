import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { salesSettingsUpsertSchema, type SalesSettingsUpsertInput } from '../../../data/validators'
import { loadSalesSettings } from '../../../commands/settings'
import { SalesDocumentNumberGenerator } from '../../../services/salesDocumentNumberGenerator'
import { DOCUMENT_NUMBER_TOKENS, DEFAULT_ORDER_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT } from '../../../lib/documentNumberTokens'
import { withScopedPayload } from '../../utils'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
}

type SettingsRouteContext = {
  ctx: CommandRuntimeContext
  em: EntityManager
  generator: SalesDocumentNumberGenerator
  translate: (key: string, fallback?: string) => string
  organizationId: string
  tenantId: string
}

async function resolveSettingsContext(req: Request): Promise<SettingsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('sales.settings.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('sales.settings.errors.organization_required', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  const em = container.resolve('em') as EntityManager
  const generator = container.resolve('salesDocumentNumberGenerator') as SalesDocumentNumberGenerator

  return {
    ctx,
    em,
    generator,
    translate,
    tenantId: auth.tenantId,
    organizationId,
  }
}

export async function GET(req: Request) {
  try {
    const { em, generator, organizationId, tenantId } = await resolveSettingsContext(req)
    const record = await loadSalesSettings(em, { tenantId, organizationId })
    const sequences = await generator.peekSequences({ organizationId, tenantId })
    return NextResponse.json({
      orderNumberFormat: record?.orderNumberFormat ?? DEFAULT_ORDER_NUMBER_FORMAT,
      quoteNumberFormat: record?.quoteNumberFormat ?? DEFAULT_QUOTE_NUMBER_FORMAT,
      nextOrderNumber: sequences.order,
      nextQuoteNumber: sequences.quote,
      tokens: DOCUMENT_NUMBER_TOKENS,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.settings.document-numbers.get failed', err)
    return NextResponse.json(
      { error: translate('sales.settings.errors.load_failed', 'Failed to load sales settings') },
      { status: 400 }
    )
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, translate, generator, organizationId, tenantId } = await resolveSettingsContext(req)
    const payload = await readJsonSafe(req, {})
    const scoped = withScopedPayload(payload, ctx, translate)
    const input = salesSettingsUpsertSchema.parse(scoped)

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      userId: ctx.auth!.sub,
      resourceKind: 'sales.settings',
      resourceId: organizationId,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      SalesSettingsUpsertInput,
      {
        settingsId: string
        orderNumberFormat: string
        quoteNumberFormat: string
        nextOrderNumber: number
        nextQuoteNumber: number
      }
    >('sales.settings.save', { input, ctx })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        userId: ctx.auth!.sub,
        resourceKind: 'sales.settings',
        resourceId: organizationId,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const sequences = await generator.peekSequences({ organizationId, tenantId })

    return NextResponse.json({
      orderNumberFormat: result?.orderNumberFormat ?? input.orderNumberFormat,
      quoteNumberFormat: result?.quoteNumberFormat ?? input.quoteNumberFormat,
      nextOrderNumber: result?.nextOrderNumber ?? sequences.order,
      nextQuoteNumber: result?.nextQuoteNumber ?? sequences.quote,
      tokens: DOCUMENT_NUMBER_TOKENS,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.settings.document-numbers.put failed', err)
    return NextResponse.json(
      { error: translate('sales.settings.errors.save_failed', 'Failed to save sales settings') },
      { status: 400 }
    )
  }
}

const settingsResponseSchema = z.object({
  orderNumberFormat: z.string(),
  quoteNumberFormat: z.string(),
  nextOrderNumber: z.number(),
  nextQuoteNumber: z.number(),
  tokens: z
    .array(
      z.object({
        token: z.string(),
        description: z.string(),
      })
    )
    .optional(),
})

const settingsErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Sales document numbering settings',
  methods: {
    GET: {
      summary: 'Get document numbering settings',
      responses: [
        { status: 200, description: 'Current numbering formats and counters', schema: settingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 400, description: 'Missing scope', schema: settingsErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update document numbering settings',
      requestBody: {
        contentType: 'application/json',
        schema: salesSettingsUpsertSchema,
      },
      responses: [
        { status: 200, description: 'Updated numbering formats and counters', schema: settingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 400, description: 'Invalid payload', schema: settingsErrorSchema },
      ],
    },
  },
}
