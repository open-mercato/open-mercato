import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { loadSalesSettings } from '../../../commands/settings'
import { quoteValiditySettingsSchema, quoteValiditySettingsResponseSchema, type QuoteValiditySettingsSaveInput } from '../../../data/validators'
import { normalizeQuoteValidityDays } from '../../../lib/quoteValidity'

const logger = createLogger('sales')

export const metadata = {
  GET: { requireAuth: true },
  PUT: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
}

async function resolveContext(req: Request, write: boolean) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth?.tenantId || !auth.sub) {
    throw new CrudHttpError(401, { error: translate('sales.settings.errors.unauthorized', 'Unauthorized') })
  }
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  if (organizationScope.selectionRejected) {
    throw new CrudHttpError(403, { error: translate('sales.documents.errors.forbidden', 'Forbidden') })
  }
  const organizationId = resolveSingleOrganizationIdOrDeny(organizationScope, auth)
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('sales.settings.errors.organization_required', 'Organization context is required') })
  }
  const scope = { tenantId: auth.tenantId, organizationId }
  const rbac = container.resolve('rbacService') as RbacService
  const permissions = write ? ['sales.settings.manage'] : ['sales.settings.manage', 'sales.quotes.manage']
  const allowed = await Promise.all(permissions.map((feature) => rbac.userHasAllFeatures(auth.sub, [feature], scope)))
  if (!allowed.some(Boolean)) {
    throw new CrudHttpError(403, { error: translate('sales.documents.errors.forbidden', 'Forbidden') })
  }
  const ctx: CommandRuntimeContext = {
    container, auth, organizationScope, selectedOrganizationId: organizationId,
    organizationIds: organizationScope?.filterIds ?? [organizationId], request: req,
  }
  return { ctx, scope, em: container.resolve('em') as EntityManager }
}

async function handleError(error: unknown) {
  if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
  const rejection = getCommandInterceptorHttpRejection(error)
  if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
  const { translate } = await resolveTranslations()
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: translate('sales.config.quoteValidity.errors.invalid', 'Enter a whole number of days from 1 to 365.') }, { status: 400 })
  }
  logger.error('sales.settings.quote-validity failed', { err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'sales', code: 'sales.quote_validity_settings_failed' })
  return NextResponse.json({ error: translate('sales.settings.errors.load_failed', 'Failed to load sales settings') }, { status: 500 })
}

export async function GET(req: Request) {
  try {
    const { em, scope } = await resolveContext(req, false)
    const settings = await loadSalesSettings(em, scope)
    return NextResponse.json({
      defaultQuoteValidityDays: normalizeQuoteValidityDays(settings?.defaultQuoteValidityDays),
      updatedAt: settings?.updatedAt.toISOString() ?? null,
    })
  } catch (error) {
    return handleError(error)
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, scope } = await resolveContext(req, true)
    const input = quoteValiditySettingsSchema.parse(await readJsonSafe(req, {}))
    const guardResult = await runRouteMutationGuards({
      container: ctx.container, req,
      auth: { ...scope, userId: ctx.auth!.sub },
      input: { resourceKind: 'sales.settings', resourceId: scope.organizationId, operation: 'update', mutationPayload: input },
    })
    if (!guardResult.ok) return guardResult.response
    const guardedInput = quoteValiditySettingsSchema.parse({ ...input, ...guardResult.modifiedPayload })
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<QuoteValiditySettingsSaveInput, { defaultQuoteValidityDays: number; updatedAt: string }>(
      'sales.settings.quote_validity.save', {
        input: {
          ...guardedInput, ...scope,
        }, ctx,
      },
    )
    await guardResult.runAfterSuccess()
    return NextResponse.json({ defaultQuoteValidityDays: result.defaultQuoteValidityDays, updatedAt: result.updatedAt })
  } catch (error) {
    return handleError(error)
  }
}

const errorSchema = z.object({ error: z.string(), code: z.string().optional() })
const errors = [
  { status: 400, description: 'Invalid input or missing organization', schema: errorSchema },
  { status: 401, description: 'Unauthorized', schema: errorSchema },
  { status: 403, description: 'Forbidden', schema: errorSchema },
]

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales', summary: 'Default quote validity settings',
  methods: {
    GET: {
      summary: 'Read the organization default quote validity (sales.settings.manage or sales.quotes.manage)',
      responses: [{ status: 200, description: 'Current settings', schema: quoteValiditySettingsResponseSchema }, ...errors],
    },
    PUT: {
      summary: 'Update the organization default quote validity',
      requestBody: { contentType: 'application/json', schema: quoteValiditySettingsSchema },
      responses: [
        { status: 200, description: 'Updated settings', schema: quoteValiditySettingsResponseSchema }, ...errors,
        { status: 409, description: 'Concurrent edit conflict', schema: errorSchema },
        { status: 423, description: 'Record locked', schema: errorSchema },
      ],
    },
  },
}
