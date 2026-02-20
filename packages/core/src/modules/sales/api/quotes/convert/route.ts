import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
  type CrudMutationGuardValidationResult,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { withScopedPayload } from '../../utils'

const convertSchema = z.object({
  quoteId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  orderNumber: z.string().trim().max(191).optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sales.quotes.manage', 'sales.orders.manage'] },
}

type RequestContext = {
  ctx: CommandRuntimeContext
}

function buildMutationGuardErrorResponse(validation: CrudMutationGuardValidationResult): NextResponse | null {
  if (validation.ok) return null
  return NextResponse.json(validation.body, { status: validation.status })
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('sales.documents.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('sales.documents.errors.organization_required', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return { ctx }
}

export async function POST(req: Request) {
  try {
    const { ctx } = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(payload ?? {}, ctx, translate)
    const input = convertSchema.parse(scoped)
    const mutationGuardValidation = await validateCrudMutationGuard(ctx.container, {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      userId: ctx.auth?.sub ?? '',
      resourceKind: 'sales.quote',
      resourceId: input.quoteId,
      method: 'PUT',
      requestHeaders: req.headers,
    })
    if (mutationGuardValidation) {
      const lockErrorResponse = buildMutationGuardErrorResponse(mutationGuardValidation)
      if (lockErrorResponse) return lockErrorResponse
    }
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<
      { quoteId: string; orderId?: string; orderNumber?: string },
      { orderId: string }
    >('sales.quotes.convert_to_order', { input, ctx })

    const orderId = result?.orderId ?? input.orderId ?? input.quoteId
    const jsonResponse = NextResponse.json({ orderId })

    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      jsonResponse.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'sales.order',
          resourceId: logEntry.resourceId ?? orderId,
          executedAt: logEntry.createdAt instanceof Date
            ? logEntry.createdAt.toISOString()
            : typeof logEntry.createdAt === 'string'
              ? logEntry.createdAt
              : new Date().toISOString(),
        })
      )
    }

    if (mutationGuardValidation?.ok && mutationGuardValidation.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId: ctx.auth?.tenantId ?? '',
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
        userId: ctx.auth?.sub ?? '',
        resourceKind: 'sales.quote',
        resourceId: input.quoteId,
        method: 'PUT',
        requestHeaders: req.headers,
        metadata: mutationGuardValidation.metadata ?? null,
      })
    }

    return jsonResponse
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.quotes.convert failed', err)
    return NextResponse.json(
      { error: translate('sales.documents.detail.convertError', 'Failed to convert quote.') },
      { status: 400 }
    )
  }
}

const convertResponseSchema = z.object({
  orderId: z.string().uuid(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Convert quote to order',
  methods: {
    POST: {
      summary: 'Convert quote',
      description: 'Creates a sales order from a quote and removes the original quote record.',
      requestBody: {
        contentType: 'application/json',
        schema: convertSchema,
      },
      responses: [
        { status: 200, description: 'Conversion succeeded', schema: convertResponseSchema },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Conflict detected', schema: z.object({ error: z.string(), code: z.string().optional() }) },
        { status: 423, description: 'Record locked', schema: z.object({ error: z.string(), code: z.string().optional() }) },
      ],
    },
  },
}
