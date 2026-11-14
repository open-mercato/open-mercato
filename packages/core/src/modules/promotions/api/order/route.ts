import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { promotionOrderBatchSchema, type PromotionOrderBatchInput } from '../../data/validators'
import {
  PROMOTION_RESOURCE_KIND,
  PROMOTION_REORDER_COMMAND_ID,
  type PromotionReorderResult,
} from '../../commands/rule-tree'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('promotions')

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['promotions.update'] },
}

type RouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function resolveRouteContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('promotions.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('promotions.errors.organization_required', 'Organization context is required') })
  }
  return {
    ctx: {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
    tenantId: auth.tenantId,
    organizationId,
    translate,
  }
}

export async function PATCH(req: Request) {
  try {
    const context = await resolveRouteContext(req)
    const body = toRecord(await readJsonSafe(req, {}))

    let parsedBody: PromotionOrderBatchInput
    try {
      parsedBody = promotionOrderBatchSchema.parse(body)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid order batch payload', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const userId = context.ctx.auth?.sub
    if (!userId) {
      throw new CrudHttpError(401, { error: context.translate('promotions.errors.unauthorized', 'Unauthorized') })
    }

    // The batch targets multiple promotions, so there is no single `resourceId` for the
    // guard call — each item's own optimistic-lock check happens inside the command,
    // per item (§API Contracts: "a stale updatedAt on any item 409s that item only").
    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: PROMOTION_RESOURCE_KIND,
        resourceId: null,
        operation: 'update',
        mutationPayload: parsedBody,
      },
    })
    if (!guarded.ok) return guarded.response

    const commandInput = (guarded.modifiedPayload ?? parsedBody) as unknown as PromotionOrderBatchInput

    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<PromotionOrderBatchInput, PromotionReorderResult>(
      PROMOTION_REORDER_COMMAND_ID,
      { input: commandInput, ctx: context.ctx },
    )

    await guarded.runAfterSuccess()

    return NextResponse.json({
      updated: result?.updated ?? [],
      conflicts: result?.conflicts ?? [],
    })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.order.patch failed', { err })
    return NextResponse.json({ error: translate('promotions.errors.save_failed', 'Failed to reorder promotions') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Batch-update promotion display order',
  methods: {
    PATCH: {
      summary: 'Drag-sort save — each item is optimistic-lock checked independently',
      requestBody: { contentType: 'application/json', schema: promotionOrderBatchSchema },
      responses: [
        {
          status: 200,
          description: 'Items that updated vs. items whose updatedAt was stale',
          schema: z.object({
            updated: z.array(z.string().uuid()),
            conflicts: z.array(z.object({ id: z.string().uuid(), currentUpdatedAt: z.string() })),
          }),
        },
      ],
    },
  },
}
