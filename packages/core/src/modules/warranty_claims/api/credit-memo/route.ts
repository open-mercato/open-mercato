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
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  claimCreateCreditMemoSchema,
  type ClaimCreateCreditMemoInput,
} from '../../data/validators'
import { WARRANTY_CLAIM_RESOURCE_KIND } from '../../commands/shared'

const logger = createLogger('warranty_claims')

type ActionRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

type CreditMemoCommandResult = {
  claimId: string
  creditMemoId: string
  creditMemoUpdatedAt: string | null
  skippedLineIds: string[]
  grandTotalGrossAmount: string
  currencyCode: string
}

const creditMemoRequestSchema = z
  .object({
    claimId: z.string().uuid(),
    updatedAt: z.string().datetime().nullable().optional(),
  })
  .strict()

type CreditMemoRequest = z.infer<typeof creditMemoRequestSchema>

const creditMemoResponseSchema = z.object({
  creditMemoId: z.string().uuid(),
  skippedLineIds: z.array(z.string().uuid()),
  grandTotalGrossAmount: z.string(),
  currencyCode: z.string(),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage', 'sales.credit_memos.manage'] },
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

function toCreditMemoRequest(payload: Record<string, unknown>): CreditMemoRequest {
  return creditMemoRequestSchema.parse(payload)
}

function toCommandInput(
  input: CreditMemoRequest,
  context: ActionRouteContext,
): ClaimCreateCreditMemoInput {
  const scopedPayload = withScopedPayload({
    id: input.claimId,
    updatedAt: input.updatedAt,
  }, context.ctx, context.translate)
  return claimCreateCreditMemoSchema.parse(scopedPayload)
}

async function runGuard(
  req: Request,
  context: ActionRouteContext,
  input: CreditMemoRequest,
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
    const requestInput = toCreditMemoRequest(toRecord(await readJsonSafe(req, {})))
    const guarded = await runGuard(req, context, requestInput)
    if (!guarded.ok) {
      return guarded.response
    }
    const guardedInput = guarded.modifiedPayload
      ? toCreditMemoRequest(guarded.modifiedPayload)
      : requestInput
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<ClaimCreateCreditMemoInput, CreditMemoCommandResult>(
      'warranty_claims.claim.create_credit_memo',
      { input: toCommandInput(guardedInput, context), ctx: context.ctx },
    )
    if (!result) throw new CrudHttpError(400, { error: 'warranty_claims.errors.save_failed' })
    await guarded.runAfterSuccess()
    return NextResponse.json({
      creditMemoId: result.creditMemoId,
      skippedLineIds: result.skippedLineIds,
      grandTotalGrossAmount: result.grandTotalGrossAmount,
      currencyCode: result.currencyCode,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'warranty_claims.errors.invalidInput' }, { status: 400 })
    }
    logger.error('warranty_claims.credit-memo.post failed', { err })
    return NextResponse.json({ error: 'warranty_claims.errors.save_failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Create a credit memo from a warranty claim',
  methods: {
    POST: {
      summary: 'Create and link a credit memo from eligible received credit or refund lines',
      description: 'Amounts are prorated from source order-line totals. Version 1 does not prorate order-level adjustments.',
      requestBody: { contentType: 'application/json', schema: creditMemoRequestSchema },
      responses: [
        {
          status: 200,
          description: 'Credit memo created and linked; ineligible or unresolvable claim lines are reported as skipped',
          schema: creditMemoResponseSchema,
        },
        { status: 400, description: 'Invalid request or claim is not eligible for credit-memo creation', schema: errorResponseSchema },
        { status: 401, description: 'Authentication required', schema: errorResponseSchema },
        { status: 403, description: 'Insufficient permissions', schema: errorResponseSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: errorResponseSchema },
      ],
    },
  },
}
