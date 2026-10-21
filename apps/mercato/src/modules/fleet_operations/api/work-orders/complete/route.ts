import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { completeWorkOrderSchema } from '../../../data/validators'
import { WORK_ORDER_COMPLETE_COMMAND_ID } from '../../../commands/operations'

const logger = createLogger('fleet_operations')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['fleet.write'] },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('fleet_operations.errors.unauthorized', 'Unauthorized') })
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    const tenantId = auth.tenantId ?? null
    if (!organizationId || !tenantId) {
      throw new CrudHttpError(400, {
        error: translate('fleet_operations.errors.contextRequired', 'Organization and tenant context required'),
      })
    }
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? [organizationId],
      request: req,
    }
    const body = await req.json().catch(() => ({}))
    const input = completeWorkOrderSchema.parse({
      ...body,
      organizationId,
      tenantId,
    })
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId,
      organizationId,
      userId: auth.sub,
      resourceKind: 'fleet_operations:fleet_work_order',
      resourceId: input.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute(WORK_ORDER_COMPLETE_COMMAND_ID, { input, ctx })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId,
        organizationId,
        userId: auth.sub,
        resourceKind: 'fleet_operations:fleet_work_order',
        resourceId: input.id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    return NextResponse.json({ ok: true, ...(result as Record<string, unknown>) })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    logger.error('fleet_operations.work_orders.complete failed', { err })
    return NextResponse.json({ error: 'Failed to complete the work order' }, { status: 400 })
  }
}

export const openApi = {
  tag: 'Fleet operations',
  summary: 'Complete a work order',
  methods: {
    POST: {
      summary: 'Close a work order, recompute parts/labor totals and roll the maintenance schedule',
      requestBody: { contentType: 'application/json', schema: completeWorkOrderSchema },
      responses: [{
        status: 200,
        description: 'Completed',
        schema: z.object({
          ok: z.boolean(),
          workOrderId: z.string().uuid(),
          totalCost: z.string(),
        }),
      }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Work order not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Optimistic lock conflict', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
