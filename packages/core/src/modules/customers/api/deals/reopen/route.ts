import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { bridgeLegacyGuard, runMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportTelemetryError } from '@open-mercato/shared/lib/telemetry/runtime'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerDeal } from '../../../data/entities'
import { dealReopenSchema, type DealReopenInput } from '../../../data/validators'
import { dealReopenFeatures, dealReopenValues } from '../../../lib/dealReopen'
import { resolveAuthActorId, resolveCustomersRequestContext } from '../../../lib/interactionRequestContext'
import { withOperationMetadata } from '../../../lib/operationMetadata'
import { defaultOkResponseSchema } from '../../openapi'

const logger = createLogger('customers')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.deals.manage', 'sales.reopen'] },
}

export async function POST(request: Request) {
  const { translate } = await resolveTranslations()
  const invalidPayload = (error: z.ZodError) => NextResponse.json({
    error: translate('customers.deals.reopen.invalidRequest', 'Check the reopen request and try again.'),
    details: error.issues,
  }, { status: 400 })

  try {
    const context = await resolveCustomersRequestContext(request)
    const parsed = dealReopenSchema.safeParse(await readJsonSafe(request, null))
    if (!parsed.success) return invalidPayload(parsed.error)

    const { container, auth, em, commandContext } = context
    const organizationIds = context.scope.filterIds ?? context.scope.allowedIds
    const deal = await findOneWithDecryption(em, CustomerDeal, {
      id: parsed.data.id,
      tenantId: auth.tenantId,
      deletedAt: null,
      ...(organizationIds ? { organizationId: { $in: organizationIds } } : {}),
    }, { fields: ['id', 'tenantId', 'organizationId'] }, {
      tenantId: auth.tenantId,
      organizationId: context.selectedOrganizationId,
    })
    if (!deal) {
      return NextResponse.json({
        error: translate('customers.deals.reopen.notFound', 'Deal not found.'),
      }, { status: 404 })
    }

    const scope = { tenantId: deal.tenantId, organizationId: deal.organizationId }
    const userId = resolveAuthActorId(auth)
    const rbac = container.resolve<RbacService>('rbacService')
    if (!await rbac.userHasAllFeatures(userId, dealReopenFeatures, scope)) {
      return NextResponse.json({ error: translate('customers.errors.access_denied', 'Access denied') }, { status: 403 })
    }
    const legacyGuard = bridgeLegacyGuard(container)
    const guards = [...getAllMutationGuardInstances(), ...(legacyGuard ? [legacyGuard] : [])]
    const guardInput = {
      ...scope,
      userId,
      resourceKind: 'customers.deal',
      resourceId: deal.id,
      operation: 'update' as const,
      requestMethod: request.method,
      requestHeaders: request.headers,
    }
    const mutationPayload = { ...parsed.data, ...dealReopenValues }
    const guardResult = await runMutationGuards(
      guards,
      { ...guardInput, mutationPayload },
      { userFeatures: await rbac.getGrantedFeatures(userId, scope) },
    )
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody ?? {
        error: translate('customers.deals.reopen.blocked', 'The reopen request was blocked.'),
      }, { status: guardResult.errorStatus ?? 422 })
    }
    const { status, closureOutcome, lossReasonId, lossNotes, ...effectivePayload } = {
      ...mutationPayload, ...guardResult.modifiedPayload,
    }
    if (
      effectivePayload.id !== deal.id || status !== 'open'
      || closureOutcome !== null || lossReasonId !== null || lossNotes !== null
    ) {
      return NextResponse.json({
        error: translate('customers.deals.reopen.blocked', 'The reopen request was blocked.'),
      }, { status: 422 })
    }
    const effectiveInput = dealReopenSchema.safeParse(effectivePayload)
    if (!effectiveInput.success) return invalidPayload(effectiveInput.error)

    const commandBus = container.resolve<CommandBus>('commandBus')
    const { logEntry } = await commandBus.execute<DealReopenInput, { dealId: string }>('customers.deals.reopen', {
      input: effectiveInput.data,
      ctx: commandContext,
    })
    for (const callback of guardResult.afterSuccessCallbacks) {
      try {
        await callback.guard.afterSuccess?.({ ...guardInput, metadata: callback.metadata ?? null })
      } catch (error) {
        logger.error('Deal reopen guard afterSuccess failed', { error, guardId: callback.guard.id })
        reportTelemetryError(error, { module: 'customers', code: 'customers.deal.reopen.guard_after_success_failed' })
      }
    }
    return withOperationMetadata(NextResponse.json({ ok: true }), logEntry, {
      resourceKind: 'customers.deal',
      resourceId: deal.id,
    })
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    if (error instanceof z.ZodError) return invalidPayload(error)
    const interceptorRejection = getCommandInterceptorHttpRejection(error)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    logger.error('Deal reopen failed', { error })
    reportTelemetryError(error, { module: 'customers', code: 'customers.deal.reopen.failed' })
    return NextResponse.json({
      error: translate('customers.deals.reopen.failed', 'Could not reopen the deal.'),
    }, { status: 500 })
  }
}

const errorResponse = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Reopen a closed deal',
  methods: {
    POST: {
      summary: 'Reopen a closed deal',
      description: 'Moves a closed deal to an open stage in its current pipeline and clears the current closure details.',
      requestBody: { contentType: 'application/json', schema: dealReopenSchema },
      responses: [{ status: 200, description: 'Deal reopened', schema: defaultOkResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request or stage', schema: errorResponse },
        { status: 401, description: 'Unauthorized', schema: errorResponse },
        { status: 403, description: 'Forbidden', schema: errorResponse },
        { status: 404, description: 'Deal not found', schema: errorResponse },
        { status: 409, description: 'Deal is already open or its version changed', schema: errorResponse },
        { status: 422, description: 'A mutation guard blocked the action', schema: errorResponse },
      ],
    },
  },
}
