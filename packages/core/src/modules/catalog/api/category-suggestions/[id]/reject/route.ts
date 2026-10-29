import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CatalogCategorizationService } from '../../../../lib/aiCategorization/categorizationService'
import { serializeCategorySuggestion } from '../../../../lib/aiCategorization/serializeSuggestion'
import { attachOperationHeader } from '../../../../lib/aiCategorization/operationHeader'
import { CatalogProductCategorySuggestion } from '../../../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'

const logger = createLogger('catalog')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['catalog.ai_categorization.use'] },
}

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

const paramsSchema = z.object({ id: z.string().uuid() })

export async function POST(req: Request, routeContext: RouteContext) {
  try {
    const { id: suggestionId } = paramsSchema.parse(await routeContext.params)
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const tenantId = auth.tenantId
    const organizationId = resolveActiveOrganizationId(auth)
    if (!organizationId) return organizationScopeRequiredResponse()

    const container = await createRequestContainer()
    const categorizationService = container.resolve('catalogCategorizationService') as CatalogCategorizationService
    const status = await categorizationService.getStatus({ tenantId })
    if (!status.effective) {
      return NextResponse.json({ code: 'ai_categorization_unavailable', reason: status.reason ?? null }, { status: 409 })
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      request: req,
    }
    const { result, logEntry } = await commandBus.execute('catalog.category_suggestions.reject', {
      input: { id: suggestionId },
      ctx,
    }) as { result: { suggestionId: string }; logEntry: unknown }

    const em = (container.resolve('em') as EntityManager).fork()
    const suggestion = await em.findOne(CatalogProductCategorySuggestion, { id: result.suggestionId })
    if (!suggestion) throw new CrudHttpError(404, { error: 'Catalog category suggestion not found' })

    return attachOperationHeader(
      NextResponse.json({ suggestion: serializeCategorySuggestion(suggestion) }),
      logEntry,
    )
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    logger.error('catalog.ai_categorization.category_suggestions.reject.POST Unexpected error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const postDoc: OpenApiMethodDoc = {
  summary: 'Reject an AI category suggestion',
  tags: ['Catalog'],
  responses: [
    { status: 200, description: 'Suggestion rejected', schema: z.object({ suggestion: z.object({ id: z.string().uuid(), status: z.string() }) }) },
  ],
  errors: [
    { status: 404, description: 'Suggestion not found' },
    { status: 409, description: 'AI categorization unavailable, optimistic-lock conflict, or non-pending suggestion' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Reject catalog AI category suggestion',
  methods: { POST: postDoc },
}
