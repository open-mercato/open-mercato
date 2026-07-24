import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { getOverrides } from '../../lib/queries'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { FeatureToggleOverride } from '../../data/entities'
import { buildContext } from '../../lib/utils'
import { resolveFeatureCheckContext } from "@open-mercato/core/modules/directory/utils/organizationScope"
import { ProcessedChangeOverrideStateInput } from '../../data/validators'
import {
  changeOverrideStateBaseSchema,
  overrideListQuerySchema,
  featureTogglesTag,
  featureToggleOverrideListResponseSchema,
  featureToggleErrorSchema,
  changeOverrideStateResponseSchema,
} from '../openapi'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('feature_toggles').child({ component: 'overrides' })

export async function GET(req: Request) {
  const { auth, ctx, scope } = await buildContext(req)

  const url = new URL(req.url)
  const parsed = overrideListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }
  const em = ctx.container.resolve('em') as EntityManager

  const tenant = await em.findOne(Tenant, {
    id: scope.tenantId,
  })

  if (!tenant) {
    return NextResponse.json({
      error: 'Tenant context required. Please select a tenant.'
    }, { status: 400 })
  }

  const result = await getOverrides(em, tenant, parsed.data)

  await logCrudAccess({
    container: ctx.container,
    auth,
    request: req,
    items: [...result.raw.toggles, ...result.raw.overrides],
    idField: 'id',
    resourceKind: 'feature_toggles.override_list',
    tenantId: scope.tenantId ?? null,
    query: parsed.data,
    accessType: 'read:list',
    fields: ['id', 'toggleId', 'tenantId', 'identifier', 'name', 'category']
  })

  return NextResponse.json({
    items: result.items,
    total: result.total,
    totalPages: result.totalPages,
    page: result.page,
    pageSize: result.pageSize,
    isSuperAdmin: auth.isSuperAdmin ?? false
  })
}

export async function PUT(req: Request) {
  try {
    const { ctx } = await buildContext(req)

    const parsed = changeOverrideStateBaseSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
    }

    const { scope, organizationId } = await resolveFeatureCheckContext({
      container: ctx.container,
      auth: ctx.auth,
      request: req
    })

    if (!scope.tenantId) {
      return NextResponse.json({
        error: 'Tenant context required. Please select a tenant.'
      }, { status: 400 })
    }

    // Optimistic lock: refuse a stale override overwrite when two admins edit the
    // same global toggle override in parallel. Only enforced when an override row
    // already exists (first set has no prior version). Strictly additive.
    const em = ctx.container.resolve('em') as EntityManager
    const existingOverride = await em.findOne(FeatureToggleOverride, {
      tenantId: scope.tenantId,
      toggle: { id: parsed.data.toggleId },
    })
    if (existingOverride) {
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: 'feature_toggles.feature_toggle_override',
        resourceId: existingOverride.id,
        current: existingOverride.updatedAt ?? null,
        request: req,
      })
    }

    // Run the CRUD mutation guard lifecycle so this custom write route honors
    // module-level guard injections (and after-success hooks) like every other
    // mutating endpoint. The override either updates an existing row or creates a
    // new one, so the resource id falls back to the toggle id when no row exists.
    const guardUserId = ctx.auth?.userId ?? ctx.auth?.sub ?? null
    if (!guardUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const guardResourceKind = 'feature_toggles.feature_toggle_override'
    const guardResourceId = existingOverride?.id ?? parsed.data.toggleId
    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId: scope.tenantId,
      organizationId: organizationId ?? null,
      userId: guardUserId,
      resourceKind: guardResourceKind,
      resourceId: guardResourceId,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: parsed.data,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<ProcessedChangeOverrideStateInput, { overrideToggleId: string | null }>('feature_toggles.overrides.changeState', {
      input: {
        toggleId: parsed.data.toggleId,
        tenantId: scope.tenantId,
        isOverride: parsed.data.isOverride,
        overrideValue: parsed.data.overrideValue,
      },
      ctx,
    })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId: scope.tenantId,
        organizationId: organizationId ?? null,
        userId: guardUserId,
        resourceKind: guardResourceKind,
        resourceId: result?.overrideToggleId ?? guardResourceId,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const response = NextResponse.json({
      ok: true,
      overrideToggleId: result?.overrideToggleId ?? null,
    })

    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'feature_toggles.override',
          resourceId: logEntry.resourceId ?? result?.overrideToggleId ?? null,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }

    return response
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message === 'NOT_FOUND') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (message === 'INVALID_STATE' || message === 'INVALID_TOGGLE_ID' || message === 'INVALID_TENANT_ID') {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    logger.error('Override state change failed', { err: error })
    return NextResponse.json({ error: 'Failed to update override' }, { status: 500 })
  }
}

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['feature_toggles.view'] },
  PUT: { requireAuth: true, requireFeatures: ['feature_toggles.manage'] },
}

export const metadata = routeMetadata

const overrideGetDoc: OpenApiMethodDoc = {
  summary: 'List overrides',
  description: 'Returns list of feature toggle overrides.',
  tags: [featureTogglesTag],
  query: overrideListQuerySchema,
  responses: [
    { status: 200, description: 'List of overrides', schema: featureToggleOverrideListResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid query parameters', schema: featureToggleErrorSchema },
    { status: 401, description: 'Authentication required', schema: featureToggleErrorSchema },
  ],
}

const overridePutDoc: OpenApiMethodDoc = {
  summary: 'Change override state',
  description: 'Enable, disable or inherit a feature toggle for a specific tenant.',
  tags: [featureTogglesTag],
  requestBody: {
    contentType: 'application/json',
    schema: changeOverrideStateBaseSchema,
    description: 'Override details.',
  },
  responses: [
    { status: 200, description: 'Override updated', schema: changeOverrideStateResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: featureToggleErrorSchema },
    { status: 401, description: 'Authentication required', schema: featureToggleErrorSchema },
    { status: 404, description: 'Not found', schema: featureToggleErrorSchema },
    { status: 500, description: 'Internal server error', schema: featureToggleErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: featureTogglesTag,
  summary: 'Manage feature toggle overrides',
  methods: {
    GET: overrideGetDoc,
    PUT: overridePutDoc,
  },
}
