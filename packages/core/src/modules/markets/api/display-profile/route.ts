import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { MarketDisplayProfile } from '../../data/entities'
import { marketsTag, displayProfileResponseSchema, marketsErrorSchema } from '../openapi'

const logger = createLogger('markets').child({ component: 'display-profile-route' })

const RESOURCE_KIND = 'markets.market_display_profile'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['markets.view'] },
  PUT: { requireAuth: true, requireFeatures: ['markets.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['markets.manage'] },
} as const

function serialize(record: MarketDisplayProfile) {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    languageTag: record.languageTag,
    currencyCode: record.currencyCode,
    currencyDisplay: record.currencyDisplay,
    decimalSeparator: record.decimalSeparator ?? null,
    thousandsSeparator: record.thousandsSeparator ?? null,
    negativeStyle: record.negativeStyle,
    dateFormat: record.dateFormat,
    dateTimeFormat: record.dateTimeFormat,
    timeFormat: record.timeFormat,
    hourCycle: record.hourCycle,
    firstDayOfWeek: record.firstDayOfWeek,
    timeZone: record.timeZone,
    addressLayout: record.addressLayout,
    defaultCountryCode: record.defaultCountryCode,
    subdivisionRequired: record.subdivisionRequired,
    postalCodePattern: record.postalCodePattern ?? null,
    postalCodeLabelKey: record.postalCodeLabelKey,
    subdivisionLabelKey: record.subdivisionLabelKey,
    addressLine2LabelKey: record.addressLine2LabelKey,
    phoneNationalPattern: record.phoneNationalPattern ?? null,
    phoneDefaultDialCode: record.phoneDefaultDialCode ?? null,
    measurementSystem: record.measurementSystem,
    defaultWeightUnit: record.defaultWeightUnit,
    defaultLengthUnit: record.defaultLengthUnit,
    lengthDisplay: record.lengthDisplay,
    paperSize: record.paperSize,
    pricePresentation: record.pricePresentation,
    taxLineLabelKey: record.taxLineLabelKey,
    taxNoteKey: record.taxNoteKey ?? null,
    isActive: record.isActive,
    // `CrudForm` derives the optimistic lock header from this, so it must always ship.
    updatedAt: record.updatedAt ? record.updatedAt.toISOString() : null,
  }
}


/**
 * A rejected field is the caller's problem, not a server fault.
 *
 * Without this a zod failure would surface as an opaque 500 and the settings form would have
 * nothing to show against the field that is actually wrong.
 */
function validationErrorResponse(error: unknown): Response | null {
  if (!(error instanceof z.ZodError)) return null
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.')
    if (path && !fieldErrors[path]) fieldErrors[path] = issue.message
  }
  return Response.json({ error: 'Validation failed', fieldErrors }, { status: 400 })
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown } | null)?.features
  return Array.isArray(features) ? features.filter((value): value is string => typeof value === 'string') : []
}

async function resolveScope(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return { error: organizationScopeRequiredResponse() } as const
  const container = await createRequestContainer()
  return { auth, organizationId, tenantId: auth.tenantId, container } as const
}

export async function GET(req: Request) {
  const scope = await resolveScope(req)
  if ('error' in scope) return scope.error

  const em = (scope.container.resolve('em') as EntityManager).fork()
  const record = await em.findOne(MarketDisplayProfile, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  // `{ item: null }` rather than a 404: "this organization has not picked a market" is a normal
  // answer that the settings page renders as an empty form, not a missing resource.
  return Response.json({ item: record ? serialize(record) : null })
}

/**
 * Create or update the organization's single profile row.
 *
 * Which command runs is decided by whether a row exists, so the settings form can use one endpoint
 * for both "pick a market" and "adjust it".
 */
export async function PUT(req: Request) {
  const scope = await resolveScope(req)
  if ('error' in scope) return scope.error
  const { translate } = await resolveTranslations()

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: translate('markets.errors.invalidBody', 'Invalid request body.') }, { status: 400 })
  }

  const em = (scope.container.resolve('em') as EntityManager).fork()
  const existing = await em.findOne(MarketDisplayProfile, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  const guardInput: MutationGuardInput = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: scope.auth.sub,
    resourceKind: RESOURCE_KIND,
    resourceId: existing?.id ?? scope.organizationId,
    operation: existing ? 'update' : 'create',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: body as Record<string, unknown>,
  }
  const guard = bridgeLegacyGuard(scope.container)
  let afterSuccessCallbacks: Awaited<ReturnType<typeof runMutationGuards>>['afterSuccessCallbacks'] = []
  if (guard) {
    const guardResult = await runMutationGuards([guard], guardInput, { userFeatures: resolveUserFeatures(scope.auth) })
    if (!guardResult.ok) {
      return Response.json(guardResult.errorBody ?? { error: 'Blocked' }, { status: guardResult.errorStatus ?? 422 })
    }
    afterSuccessCallbacks = guardResult.afterSuccessCallbacks
  }

  const commandBus = scope.container.resolve('commandBus') as CommandBus
  const commandCtx = {
    container: scope.container,
    auth: scope.auth,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    request: req,
  }

  try {
    await commandBus.execute(
      existing ? 'markets.market_display_profile.update' : 'markets.market_display_profile.create',
      { input: existing ? { ...body, id: existing.id } : body, ctx: commandCtx },
    )
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return Response.json(error.body as Record<string, unknown>, { status: error.status })
    }
    // A command interceptor may reject with an explicit status; without this a deliberate 422
    // business block would degrade to the generic 500 below.
    const interceptorRejection = getCommandInterceptorHttpRejection(error)
    if (interceptorRejection) {
      return Response.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    const validation = validationErrorResponse(error)
    if (validation) return validation
    logger.error('Failed to save market display profile', {
      err: error,
      message: error instanceof Error ? error.message : String(error),
    })
    return Response.json(
      { error: translate('markets.errors.saveFailed', 'Failed to save the market display profile.') },
      { status: 500 },
    )
  }

  for (const callback of afterSuccessCallbacks) {
    if (!callback.guard.afterSuccess) continue
    await callback.guard.afterSuccess({
      tenantId: guardInput.tenantId,
      organizationId: guardInput.organizationId,
      userId: guardInput.userId,
      resourceKind: guardInput.resourceKind,
      resourceId: guardInput.resourceId ?? scope.organizationId,
      operation: guardInput.operation,
      requestMethod: guardInput.requestMethod,
      requestHeaders: guardInput.requestHeaders,
      metadata: callback.metadata ?? null,
    })
  }

  const saved = await (scope.container.resolve('em') as EntityManager).fork().findOne(MarketDisplayProfile, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  return Response.json({ item: saved ? serialize(saved) : null })
}

export async function DELETE(req: Request) {
  const scope = await resolveScope(req)
  if ('error' in scope) return scope.error
  const { translate } = await resolveTranslations()

  const em = (scope.container.resolve('em') as EntityManager).fork()
  const existing = await em.findOne(MarketDisplayProfile, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!existing) {
    return Response.json(
      { error: translate('markets.errors.notFound', 'No market display profile to clear.') },
      { status: 404 },
    )
  }

  const guardInput: MutationGuardInput = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: scope.auth.sub,
    resourceKind: RESOURCE_KIND,
    resourceId: existing.id,
    operation: 'delete',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: { id: existing.id },
  }
  const guard = bridgeLegacyGuard(scope.container)
  let afterSuccessCallbacks: Awaited<ReturnType<typeof runMutationGuards>>['afterSuccessCallbacks'] = []
  if (guard) {
    const guardResult = await runMutationGuards([guard], guardInput, { userFeatures: resolveUserFeatures(scope.auth) })
    if (!guardResult.ok) {
      return Response.json(guardResult.errorBody ?? { error: 'Blocked' }, { status: guardResult.errorStatus ?? 422 })
    }
    afterSuccessCallbacks = guardResult.afterSuccessCallbacks
  }

  const commandBus = scope.container.resolve('commandBus') as CommandBus
  try {
    await commandBus.execute('markets.market_display_profile.delete', {
      input: { id: existing.id },
      ctx: {
        container: scope.container,
        auth: scope.auth,
        organizationScope: null,
        selectedOrganizationId: scope.organizationId,
        organizationIds: [scope.organizationId],
        request: req,
      },
    })
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return Response.json(error.body as Record<string, unknown>, { status: error.status })
    }
    // A command interceptor may reject with an explicit status; without this a deliberate 422
    // business block would degrade to the generic 500 below.
    const interceptorRejection = getCommandInterceptorHttpRejection(error)
    if (interceptorRejection) {
      return Response.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    const validation = validationErrorResponse(error)
    if (validation) return validation
    logger.error('Failed to clear market display profile', {
      err: error,
      message: error instanceof Error ? error.message : String(error),
    })
    return Response.json(
      { error: translate('markets.errors.deleteFailed', 'Failed to clear the market display profile.') },
      { status: 500 },
    )
  }

  for (const callback of afterSuccessCallbacks) {
    if (!callback.guard.afterSuccess) continue
    await callback.guard.afterSuccess({
      tenantId: guardInput.tenantId,
      organizationId: guardInput.organizationId,
      userId: guardInput.userId,
      resourceKind: guardInput.resourceKind,
      resourceId: existing.id,
      operation: guardInput.operation,
      requestMethod: guardInput.requestMethod,
      requestHeaders: guardInput.requestHeaders,
      metadata: callback.metadata ?? null,
    })
  }

  return Response.json({ item: null })
}

export const openApi: OpenApiRouteDoc = {
  tag: marketsTag,
  summary: 'Market display profile',
  methods: {
    GET: {
      summary: 'Get the market display profile',
      description:
        'Returns the resolved profile for the caller\'s organization, or `{ "item": null }` when no market has been picked. Scope comes from the authenticated session, never from the query string.',
      responses: [{ status: 200, description: 'The profile, or null', schema: displayProfileResponseSchema }],
      errors: [
        { status: 400, description: 'Organization scope required', schema: marketsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: marketsErrorSchema },
      ],
    },
    PUT: {
      summary: 'Create or update the market display profile',
      description:
        'Creates the single row for the organization, or updates it. `code` is required; every other field falls back to the named seed template, so the settings form can post a partial change. Honors the optimistic lock header derived from `updatedAt`.',
      responses: [{ status: 200, description: 'The saved profile', schema: displayProfileResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: marketsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: marketsErrorSchema },
        { status: 403, description: 'Missing markets.manage', schema: marketsErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: marketsErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Clear the market display profile',
      description:
        'Soft deletes the row, returning the organization to the legacy display defaults. This is the documented way back out of a market.',
      responses: [{ status: 200, description: 'Cleared', schema: displayProfileResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: marketsErrorSchema },
        { status: 403, description: 'Missing markets.manage', schema: marketsErrorSchema },
        { status: 404, description: 'No profile to clear', schema: marketsErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: marketsErrorSchema },
      ],
    },
  },
}
