import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  claimCreateReplacementOrderSchema,
  type ClaimCreateReplacementOrderInput,
} from '../../data/validators'
import { WARRANTY_CLAIM_RESOURCE_KIND } from '../../commands/shared'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

type ActionRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

type ReplacementOrderCommandResult = {
  claimId: string
  replacementOrderId: string
  replacementOrderUpdatedAt: string | null
  skippedLineIds: string[]
  pricing: 'zero' | 'original'
}

const replacementOrderRequestSchema = z
  .object({
    claimId: z.string().uuid(),
    pricing: z.enum(['zero', 'original']).optional(),
    updatedAt: z.string().datetime().nullable().optional(),
  })
  .strict()

type ReplacementOrderRequest = z.infer<typeof replacementOrderRequestSchema>

const replacementOrderResponseSchema = z.object({
  replacementOrderId: z.string().uuid(),
  skippedLineIds: z.array(z.string().uuid()),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage', 'sales.orders.manage'] },
}

function translateKey(key: string): string {
  return key
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function resolveActionContext(req: Request): Promise<ActionRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'warranty_claims.errors.unauthorized' })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.organization_required' })
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
    translate: translateKey,
  }
}

function toReplacementOrderRequest(payload: Record<string, unknown>): ReplacementOrderRequest {
  return replacementOrderRequestSchema.parse(payload)
}

function toCommandInput(
  input: ReplacementOrderRequest,
  context: ActionRouteContext,
): ClaimCreateReplacementOrderInput {
  const scopedPayload = withScopedPayload({
    id: input.claimId,
    pricing: input.pricing,
    updatedAt: input.updatedAt,
  }, context.ctx, context.translate)
  return claimCreateReplacementOrderSchema.parse(scopedPayload)
}

async function runGuard(
  req: Request,
  context: ActionRouteContext,
  input: ReplacementOrderRequest,
): Promise<RouteMutationGuardResult> {
  const userId = context.ctx.auth?.sub
  if (!userId) {
    throw new CrudHttpError(401, { error: 'warranty_claims.errors.unauthorized' })
  }
  return runRouteMutationGuards({
    container: context.ctx.container,
    req,
    auth: {
      userId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    },
    input: {
      resourceKind: WARRANTY_CLAIM_RESOURCE_KIND,
      resourceId: input.claimId,
      operation: 'custom',
      mutationPayload: { ...input },
    },
  })
}

export async function POST(req: Request) {
  try {
    const context = await resolveActionContext(req)
    const requestInput = toReplacementOrderRequest(toRecord(await readJsonSafe(req, {})))
    const guarded = await runGuard(req, context, requestInput)
    if (!guarded.ok) {
      return guarded.response
    }
    const guardedInput = guarded.modifiedPayload
      ? toReplacementOrderRequest(guarded.modifiedPayload)
      : requestInput
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<ClaimCreateReplacementOrderInput, ReplacementOrderCommandResult>(
      'warranty_claims.claim.create_replacement_order',
      { input: toCommandInput(guardedInput, context), ctx: context.ctx },
    )
    if (!result) throw new CrudHttpError(400, { error: 'warranty_claims.errors.save_failed' })
    await guarded.runAfterSuccess()
    return NextResponse.json({
      replacementOrderId: result.replacementOrderId,
      skippedLineIds: result.skippedLineIds,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'warranty_claims.errors.invalidInput' }, { status: 400 })
    }
    logger.error('warranty_claims.replacement-order.post failed', { err })
    return NextResponse.json({ error: 'warranty_claims.errors.save_failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Create a replacement sales order from a warranty claim',
  methods: {
    POST: {
      summary: 'Create and link a replacement order from eligible replace-disposition claim lines',
      description: 'Zero pricing is the default. Original pricing copies the source order lines\' pre-discount unit prices.',
      requestBody: { contentType: 'application/json', schema: replacementOrderRequestSchema },
      responses: [
        {
          status: 200,
          description: 'Replacement order created and linked; ineligible or unresolvable claim lines are reported as skipped',
          schema: replacementOrderResponseSchema,
        },
        { status: 400, description: 'Invalid request or claim is not eligible for replacement-order creation', schema: errorResponseSchema },
        { status: 401, description: 'Authentication required', schema: errorResponseSchema },
        { status: 403, description: 'Insufficient permissions', schema: errorResponseSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: errorResponseSchema },
      ],
    },
  },
}
