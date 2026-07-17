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
import { claimCreateSalesReturnSchema, type ClaimCreateSalesReturnInput } from '../../data/validators'
import { WARRANTY_CLAIM_RESOURCE_KIND } from '../../commands/shared'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

type ActionRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

type SalesReturnCommandResult = {
  claimId: string
  salesReturnId: string
  salesReturnUpdatedAt: string | null
  skippedLineIds: string[]
}

const uuid = z.string().uuid()
const optimisticLockTokenSchema = z.string().datetime().nullable().optional()

const salesReturnRequestSchema = z
  .object({
    claimId: uuid,
    updatedAt: optimisticLockTokenSchema,
  })
  .strict()

type SalesReturnRequest = z.infer<typeof salesReturnRequestSchema>

const salesReturnResponseSchema = z.object({
  salesReturnId: z.string(),
  skippedLineIds: z.array(z.string()),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage', 'sales.returns.create'] },
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

function toSalesReturnRequest(payload: Record<string, unknown>): SalesReturnRequest {
  return salesReturnRequestSchema.parse({
    claimId: payload.claimId ?? payload.id,
    updatedAt: payload.updatedAt,
  })
}

function toCommandInput(input: SalesReturnRequest, context: ActionRouteContext): ClaimCreateSalesReturnInput {
  const scopedPayload = withScopedPayload({
    id: input.claimId,
    updatedAt: input.updatedAt,
  }, context.ctx, context.translate)
  return claimCreateSalesReturnSchema.parse(scopedPayload)
}

async function runGuard(
  req: Request,
  context: ActionRouteContext,
  input: SalesReturnRequest,
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
    const requestInput = toSalesReturnRequest(toRecord(await readJsonSafe(req, {})))
    const guarded = await runGuard(req, context, requestInput)
    if (!guarded.ok) {
      return guarded.response
    }
    const guardedInput = guarded.modifiedPayload ? toSalesReturnRequest(guarded.modifiedPayload) : requestInput
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<ClaimCreateSalesReturnInput, SalesReturnCommandResult>(
      'warranty_claims.claim.create_sales_return',
      { input: toCommandInput(guardedInput, context), ctx: context.ctx },
    )
    if (!result) throw new CrudHttpError(400, { error: 'warranty_claims.errors.save_failed' })
    await guarded.runAfterSuccess()
    return NextResponse.json({ salesReturnId: result.salesReturnId, skippedLineIds: result.skippedLineIds })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'warranty_claims.errors.invalidInput' }, { status: 400 })
    }
    logger.error('warranty_claims.sales-return.post failed', { err })
    return NextResponse.json({ error: 'warranty_claims.errors.save_failed' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Create a sales return from an approved warranty claim',
  methods: {
    POST: {
      summary: 'Create a sales return document from the claim\'s eligible lines and link it to the claim',
      requestBody: { contentType: 'application/json', schema: salesReturnRequestSchema },
      responses: [
        {
          status: 200,
          description: 'Sales return created and linked; lines without an order-line reference are reported as skipped',
          schema: salesReturnResponseSchema,
        },
      ],
    },
  },
}
