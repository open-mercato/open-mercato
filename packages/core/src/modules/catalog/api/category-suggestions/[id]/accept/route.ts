import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CatalogCategorizationService } from '../../../../lib/aiCategorization/categorizationService'
import { serializeCategorySuggestion } from '../../../../lib/aiCategorization/serializeSuggestion'
import { attachOperationHeader } from '../../../../lib/aiCategorization/operationHeader'
import { CatalogProductCategorySuggestion } from '../../../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'

const logger = createLogger('catalog')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['catalog.ai_categorization.use', 'catalog.products.manage'] },
}

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

const paramsSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({
  categoryId: z.string().uuid().optional(),
  makeMain: z.boolean().default(false),
})

export async function POST(req: Request, routeContext: RouteContext) {
  try {
    const { id: suggestionId } = paramsSchema.parse(await routeContext.params)
    const rawBody = await req.text()
    let bodyInput: unknown = {}
    if (rawBody) {
      const maybeJson = await readJsonSafe<unknown>(rawBody, undefined)
      if (maybeJson === undefined) {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
      }
      bodyInput = maybeJson
    }
    const parsedBody = bodySchema.safeParse(bodyInput)
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const body = parsedBody.data
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

    if (!auth.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: auth.sub, tenantId, organizationId },
      input: {
        resourceKind: 'catalog.category_suggestion',
        resourceId: suggestionId,
        operation: 'custom',
        mutationPayload: { id: suggestionId, categoryId: body.categoryId ?? null, makeMain: body.makeMain },
      },
    })
    if (!guarded.ok) return guarded.response
    const commandInput = guarded.modifiedPayload
      ? bodySchema.extend({ id: z.string().uuid() }).parse({
          ...guarded.modifiedPayload,
          // guard merge carries the original `categoryId: null` placeholder forward; the schema's optional UUID wants `undefined`, not `null`.
          categoryId: guarded.modifiedPayload.categoryId ?? undefined,
        })
      : { id: suggestionId, categoryId: body.categoryId, makeMain: body.makeMain }

    const commandBus = container.resolve('commandBus') as CommandBus
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      request: req,
    }
    const { result, logEntry } = await commandBus.execute('catalog.category_suggestions.accept', {
      input: commandInput,
      ctx,
    }) as { result: { suggestionId: string; product: { id: string; categoryIds: string[]; updatedAt: string } }; logEntry: unknown }
    await guarded.runAfterSuccess()

    const em = (container.resolve('em') as EntityManager).fork()
    const suggestion = await em.findOne(CatalogProductCategorySuggestion, { id: result.suggestionId })
    if (!suggestion) throw new CrudHttpError(404, { error: 'Catalog category suggestion not found' })

    return attachOperationHeader(
      NextResponse.json({ suggestion: serializeCategorySuggestion(suggestion), product: result.product }),
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
    logger.error('catalog.ai_categorization.category_suggestions.accept.POST Unexpected error', { err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'catalog',
      code: 'catalog.ai_categorization_accept_failed',
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const postDoc: OpenApiMethodDoc = {
  summary: 'Accept an AI category suggestion',
  tags: ['Catalog'],
  requestBody: { schema: bodySchema },
  responses: [
    {
      status: 200,
      description: 'Suggestion accepted',
      schema: z.object({
        suggestion: z.object({ id: z.string().uuid(), status: z.string() }),
        product: z.object({ id: z.string().uuid(), categoryIds: z.array(z.string().uuid()), updatedAt: z.string() }),
      }),
    },
  ],
  errors: [
    { status: 404, description: 'Suggestion or product not found' },
    { status: 409, description: 'AI categorization unavailable, optimistic-lock conflict, or non-pending suggestion' },
    { status: 422, description: 'Chosen category is unavailable (deleted, inactive, or in another organization)' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Accept catalog AI category suggestion',
  methods: { POST: postDoc },
}
