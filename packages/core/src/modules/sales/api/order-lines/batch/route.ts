import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardAfterInput,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { orderLineBulkUpsertSchema } from '../../../data/validators'
import { withScopedPayload } from '../../utils'

const logger = createLogger('sales')

const COMMAND_ID = 'sales.orders.lines.upsert_many'
const RESOURCE_KIND = 'sales.order'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sales.orders.manage'] },
}

type BulkUpsertResult = { orderId: string; lineIds: string[] }

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

async function runGuards(
  ctx: CommandRuntimeContext,
  input: MutationGuardInput,
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  afterSuccessCallbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>
}> {
  const legacyGuard = bridgeLegacyGuard(ctx.container)
  if (!legacyGuard) {
    return { ok: true, afterSuccessCallbacks: [] }
  }

  return runMutationGuards([legacyGuard], input, {
    userFeatures: resolveUserFeatures(ctx.auth),
  })
}

async function runGuardAfterSuccessCallbacks(
  callbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>,
  input: Omit<MutationGuardAfterInput, 'metadata'>,
): Promise<void> {
  for (const callback of callbacks) {
    if (!callback.guard.afterSuccess) continue
    await callback.guard.afterSuccess({
      ...input,
      metadata: callback.metadata ?? null,
    })
  }
}

async function resolveRequestContext(req: Request): Promise<CommandRuntimeContext> {
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

  return {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = await req.json().catch(() => ({}))
    const input = orderLineBulkUpsertSchema.parse(withScopedPayload(payload ?? {}, ctx, translate))

    const guardScope = {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      userId: ctx.auth?.sub ?? '',
      resourceKind: RESOURCE_KIND,
      resourceId: input.orderId,
      operation: 'update' as const,
      requestMethod: req.method,
      requestHeaders: req.headers,
    } satisfies Omit<MutationGuardAfterInput, 'metadata'>
    const guardResult = await runGuards(ctx, guardScope)
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: 'Operation blocked by guard' },
        { status: guardResult.errorStatus ?? 422 },
      )
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<
      { body: z.infer<typeof orderLineBulkUpsertSchema> },
      BulkUpsertResult
    >(COMMAND_ID, { input: { body: input }, ctx })

    const orderId = result?.orderId ?? input.orderId
    const jsonResponse = NextResponse.json({ orderId, lineIds: result?.lineIds ?? [] })

    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      jsonResponse.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? RESOURCE_KIND,
          resourceId: logEntry.resourceId ?? orderId,
          executedAt: logEntry.createdAt instanceof Date
            ? logEntry.createdAt.toISOString()
            : typeof logEntry.createdAt === 'string'
              ? logEntry.createdAt
              : new Date().toISOString(),
        })
      )
    }

    if (guardResult.afterSuccessCallbacks.length) {
      await runGuardAfterSuccessCallbacks(guardResult.afterSuccessCallbacks, guardScope)
    }

    return jsonResponse
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('sales.orders.lines.upsert_many failed', { err })
    return NextResponse.json(
      { error: translate('sales.documents.items.errorSaveBatch', 'Failed to save order lines.') },
      { status: 400 }
    )
  }
}

const bulkUpsertResponseSchema = z.object({
  orderId: z.string().uuid(),
  lineIds: z.array(z.string().uuid()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Bulk upsert order lines',
  methods: {
    POST: {
      summary: 'Upsert and delete order lines in one pass',
      description:
        'Writes a whole order line set in one aggregate load: entries carrying an id update that line, '
        + 'entries without one are appended, and deleteIds removes lines. The batch is all-or-nothing — '
        + 'any refused entry aborts it — and the order is renumbered 1..n, its totals recalculated and '
        + 'one undoable audit entry recorded.',
      requestBody: {
        contentType: 'application/json',
        schema: orderLineBulkUpsertSchema,
      },
      responses: [
        { status: 200, description: 'Batch applied', schema: bulkUpsertResponseSchema },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string(), details: z.array(z.unknown()).optional() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Order or line not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Conflict detected', schema: z.object({ error: z.string(), code: z.string().optional() }) },
        { status: 423, description: 'Record locked', schema: z.object({ error: z.string(), code: z.string().optional() }) },
      ],
    },
  },
}
