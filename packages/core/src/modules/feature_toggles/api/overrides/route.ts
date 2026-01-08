import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { getOverrides } from '../../lib/queries'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
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

export async function GET(req: Request) {
  const { auth, organizationId } = await buildContext(req)

  const url = new URL(req.url)
  const parsed = overrideListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const tenant = await em.findOne(Tenant, {
    id: auth?.tenantId,
  })

  if (!tenant) {
    return NextResponse.json({
      error: 'Tenant context required. Please select a tenant.'
    }, { status: 400 })
  }

  const result = await getOverrides(em, tenant, parsed.data)

  await logCrudAccess({
    container,
    auth,
    request: req,
    items: [...result.raw.toggles, ...result.raw.overrides],
    idField: 'id',
    resourceKind: 'feature_toggles.override_list',
    tenantId: auth.tenantId ?? null,
    query: parsed.data,
    accessType: 'read:list',
    fields: ['id', 'toggleId', 'tenantId', 'overrideState', 'identifier', 'name', 'category', 'defaultState']
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

    const { scope } = await resolveFeatureCheckContext({
      container: ctx.container,
      auth: ctx.auth,
      request: req
    })

    if (!scope.tenantId) {
      return NextResponse.json({
        error: 'Tenant context required. Please select a tenant.'
      }, { status: 400 })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<ProcessedChangeOverrideStateInput, { overrideToggleId: string | null }>('feature_toggles.overrides.changeState', {
      input: {
        toggleId: parsed.data.toggleId,
        tenantId: scope.tenantId,
        state: parsed.data.state,
      },
      ctx,
    })

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
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message === 'NOT_FOUND') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (message === 'INVALID_STATE' || message === 'INVALID_TOGGLE_ID' || message === 'INVALID_TENANT_ID') {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    console.error('feature_toggles.overrides.changeState failed', error)
    return NextResponse.json({ error: 'Failed to update override' }, { status: 500 })
  }
}

const routeMetadata = {
  GET: { requireAuth: true, requireRoles: ['superadmin'] },
  PUT: { requireAuth: true, requireRoles: ['superadmin'] },
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