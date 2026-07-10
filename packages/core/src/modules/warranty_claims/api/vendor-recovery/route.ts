import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { vendorRecoveryInputSchema, type VendorRecoveryInput } from '../../data/validators'
import { WARRANTY_CLAIM_RESOURCE_KIND } from '../../commands/shared'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

type ActionRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function resolveActionContext(req: Request): Promise<ActionRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('warranty_claims.errors.organization_required', 'Organization context is required') })
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

function toVendorRecoveryInput(scopedPayload: Record<string, unknown>): VendorRecoveryInput {
  return vendorRecoveryInputSchema.parse({
    claimId: scopedPayload.claimId,
    lineIds: scopedPayload.lineIds,
    vendorName: scopedPayload.vendorName,
    vendorRef: scopedPayload.vendorRef,
  })
}

async function runGuard(
  req: Request,
  context: ActionRouteContext,
  input: VendorRecoveryInput,
): Promise<RouteMutationGuardResult> {
  const userId = context.ctx.auth?.sub
  if (!userId) {
    throw new CrudHttpError(401, { error: context.translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
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
    const payload = toRecord(await readJsonSafe(req, {}))
    const scopedPayload = withScopedPayload(payload, context.ctx, context.translate)
    const input = toVendorRecoveryInput(scopedPayload)
    const guarded = await runGuard(req, context, input)
    if (!guarded.ok) {
      return guarded.response
    }
    const commandInput = guarded.modifiedPayload ? toVendorRecoveryInput(guarded.modifiedPayload) : input

    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<VendorRecoveryInput, { claimId: string }>(
      'warranty_claims.claim.create_vendor_recovery',
      { input: commandInput, ctx: context.ctx },
    )
    const createdClaimId = result?.claimId
    if (typeof createdClaimId !== 'string') {
      throw new CrudHttpError(400, { error: context.translate('warranty_claims.errors.notFound', 'Warranty claim not found.') })
    }

    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true, claimId: createdClaimId })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('warranty_claims.vendor-recovery.post failed', { err })
    return NextResponse.json({ error: translate('warranty_claims.errors.save_failed', 'Failed to save warranty claim') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Create vendor recovery claim',
  methods: {
    POST: {
      summary: 'Create a linked vendor-recovery claim from resolved source lines',
      requestBody: { contentType: 'application/json', schema: vendorRecoveryInputSchema },
      responses: [
        {
          status: 200,
          description: 'Vendor recovery claim created',
          schema: z.object({ ok: z.boolean(), claimId: z.string().uuid() }),
        },
      ],
    },
  },
}
