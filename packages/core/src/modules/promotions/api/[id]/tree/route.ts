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
import { promotionTreeUpdateSchema } from '../../../data/validators'
import { PROMOTION_RESOURCE_KIND, RULE_TREE_RECONCILE_COMMAND_ID, type RuleTreeReconcileInput } from '../../../commands/rule-tree'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('promotions')

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['promotions.update'] },
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

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: promotionId } = await params
    const context = await resolveRouteContext(req)
    const body = toRecord(await readJsonSafe(req, {}))

    let parsedBody: z.infer<typeof promotionTreeUpdateSchema>
    try {
      parsedBody = promotionTreeUpdateSchema.parse(body)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid rule tree payload', issues: err.issues }, { status: 422 })
      }
      throw err
    }

    const userId = context.ctx.auth?.sub
    if (!userId) {
      throw new CrudHttpError(401, { error: context.translate('promotions.errors.unauthorized', 'Unauthorized') })
    }

    const mutationPayload: Record<string, unknown> = { ...parsedBody, promotionId }

    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: PROMOTION_RESOURCE_KIND,
        resourceId: promotionId,
        operation: 'update',
        mutationPayload,
      },
    })
    if (!guarded.ok) return guarded.response

    // The command's own `ruleTreeReconcileInputSchema.parse(...)` is the authoritative
    // validation (including every Release 4 write-path rejection); this route only needs
    // to guarantee `promotionId` survives a guard's payload rewrite.
    const commandInput = {
      ...(guarded.modifiedPayload ?? mutationPayload),
      promotionId,
    } as unknown as RuleTreeReconcileInput

    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<RuleTreeReconcileInput, { promotionId: string }>(
      RULE_TREE_RECONCILE_COMMAND_ID,
      { input: commandInput, ctx: context.ctx },
    )

    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, promotionId: result?.promotionId ?? promotionId })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 422 })
    }
    logger.error('promotions.tree.put failed', { err })
    return NextResponse.json({ error: translate('promotions.errors.save_failed', 'Failed to save the promotion rule tree') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Replace a promotion rule tree',
  methods: {
    PUT: {
      summary: 'Atomically reconcile the full rule group tree for a promotion',
      requestBody: { contentType: 'application/json', schema: promotionTreeUpdateSchema },
      responses: [
        {
          status: 200,
          description: 'Rule tree reconciled',
          schema: z.object({ ok: z.boolean(), promotionId: z.string().uuid() }),
        },
        {
          status: 409,
          description: 'The promotion was modified concurrently — stale updatedAt',
        },
        {
          status: 422,
          description: 'The rule tree failed Release 4 write-path validation',
        },
      ],
    },
  },
}
