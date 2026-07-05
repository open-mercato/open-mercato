import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WarrantyClaim, WarrantyClaimLine } from '../../data/entities'
import { claimSetReturnLabelSchema, type ClaimSetReturnLabelInput } from '../../data/validators'
import type { WarrantyReturnLabelProvider } from '../../services/returnLabelProvider'
import {
  WARRANTY_CLAIM_RESOURCE_KIND,
  enforceWarrantyClaimOptimisticLock,
  requireScopedClaim,
} from '../../commands/shared'

type ActionRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

type ReturnLabelCreatedResponse = {
  status: 'created'
  labelUrl: string | null
  trackingNumber: string | null
  carrier: string | null
}
type ReturnLabelCommandResult = Omit<ReturnLabelCreatedResponse, 'status'> & { claimId: string }

const uuid = z.string().uuid()
const returnLabelText = (max: number) => z.string().trim().min(1).max(max).optional()
const optimisticLockTokenSchema = z.string().datetime().nullable().optional()

const returnLabelRequestSchema = z
  .object({
    claimId: uuid,
    manual: z.boolean().optional(),
    labelUrl: returnLabelText(2048),
    trackingNumber: returnLabelText(191),
    carrier: returnLabelText(120),
    updatedAt: optimisticLockTokenSchema,
  })
  .strict()

type ReturnLabelRequest = z.infer<typeof returnLabelRequestSchema>

const returnLabelResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('created'),
    labelUrl: z.string().nullable(),
    trackingNumber: z.string().nullable(),
    carrier: z.string().nullable(),
  }),
  z.object({ status: z.literal('notConfigured') }),
])

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
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

function toReturnLabelRequest(payload: Record<string, unknown>): ReturnLabelRequest {
  return returnLabelRequestSchema.parse({
    claimId: payload.claimId ?? payload.id,
    manual: payload.manual,
    labelUrl: payload.labelUrl,
    trackingNumber: payload.trackingNumber,
    carrier: payload.carrier,
    updatedAt: payload.updatedAt,
  })
}

function isManualRequest(input: ReturnLabelRequest): boolean {
  return input.manual === true
    || input.labelUrl !== undefined
    || input.trackingNumber !== undefined
    || input.carrier !== undefined
}

function toSetReturnLabelInput(
  input: ReturnLabelRequest,
  context: ActionRouteContext,
): ClaimSetReturnLabelInput {
  const scopedPayload = withScopedPayload({
    id: input.claimId,
    labelUrl: input.labelUrl,
    trackingNumber: input.trackingNumber,
    carrier: input.carrier,
    updatedAt: input.updatedAt,
  }, context.ctx, context.translate)
  return claimSetReturnLabelSchema.parse(scopedPayload)
}

async function runGuard(
  req: Request,
  context: ActionRouteContext,
  input: ReturnLabelRequest,
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

async function loadClaimAndLines(
  context: ActionRouteContext,
  claimId: string,
): Promise<{ claim: WarrantyClaim; lines: WarrantyClaimLine[] }> {
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const em = (context.ctx.container.resolve('em') as EntityManager).fork()
  const claim = await requireScopedClaim(em, claimId, scope)
  const lines = await findWithDecryption(
    em,
    WarrantyClaimLine,
    { claim: claim.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
  return { claim, lines }
}

function assertGeneratableStatus(claim: WarrantyClaim): void {
  if (claim.status !== 'approved' && claim.status !== 'awaiting_return') {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.returnLabelInvalidStatus' })
  }
}

async function executeSetReturnLabel(
  commandBus: CommandBus,
  input: ClaimSetReturnLabelInput,
  ctx: CommandRuntimeContext,
): Promise<ReturnLabelCreatedResponse> {
  const { result } = await commandBus.execute<ClaimSetReturnLabelInput, ReturnLabelCommandResult>(
    'warranty_claims.claim.set_return_label',
    { input, ctx },
  )
  if (!result) throw new CrudHttpError(400, { error: 'warranty_claims.errors.save_failed' })
  return {
    status: 'created',
    labelUrl: result.labelUrl,
    trackingNumber: result.trackingNumber,
    carrier: result.carrier,
  }
}

export async function POST(req: Request) {
  try {
    const context = await resolveActionContext(req)
    const requestInput = toReturnLabelRequest(toRecord(await readJsonSafe(req, {})))
    const guarded = await runGuard(req, context, requestInput)
    if (!guarded.ok) {
      return guarded.response
    }
    const guardedInput = guarded.modifiedPayload ? toReturnLabelRequest(guarded.modifiedPayload) : requestInput
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus

    if (isManualRequest(guardedInput)) {
      const response = await executeSetReturnLabel(
        commandBus,
        toSetReturnLabelInput(guardedInput, context),
        context.ctx,
      )
      await guarded.runAfterSuccess()
      return NextResponse.json(response)
    }

    const { claim, lines } = await loadClaimAndLines(context, guardedInput.claimId)
    assertGeneratableStatus(claim)
    await enforceWarrantyClaimOptimisticLock(
      context.ctx,
      claim,
      WARRANTY_CLAIM_RESOURCE_KIND,
      guardedInput.updatedAt ?? undefined,
    )

    const provider = context.ctx.container.resolve<WarrantyReturnLabelProvider>('warrantyReturnLabelProvider')
    const result = await provider.createReturnLabel(
      { claim, lines },
      { tenantId: context.tenantId, organizationId: context.organizationId },
      context.ctx.container,
    )

    if (result.status === 'notConfigured') {
      return NextResponse.json({ status: 'notConfigured' })
    }

    const response = await executeSetReturnLabel(
      commandBus,
      toSetReturnLabelInput({
        ...guardedInput,
        labelUrl: result.labelUrl,
        trackingNumber: result.trackingNumber,
        carrier: result.carrier,
      }, context),
      context.ctx,
    )
    await guarded.runAfterSuccess()
    return NextResponse.json(response)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'warranty_claims.errors.invalidInput' }, { status: 400 })
    }
    console.error('warranty_claims.return-label.post failed', err)
    return NextResponse.json({ error: 'warranty_claims.errors.save_failed' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Create or record a return label for a warranty claim',
  methods: {
    POST: {
      summary: 'Generate a carrier return label or record manual label details',
      requestBody: { contentType: 'application/json', schema: returnLabelRequestSchema },
      responses: [
        {
          status: 200,
          description: 'Return label created or provider not configured',
          schema: returnLabelResponseSchema,
        },
      ],
    },
  },
}
