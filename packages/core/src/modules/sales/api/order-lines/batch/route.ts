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
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { orderLineBulkUpsertSchema } from '../../../data/validators'
import { withScopedPayload } from '../../utils'

const logger = createLogger('sales')

function reportBatchRouteError(
  error: unknown,
  code: 'sales.order_lines_batch_failed' | 'sales.order_lines_guard_after_success_failed',
  attributes?: Record<string, string | number | boolean | undefined>,
): void {
  try {
    getTelemetryRuntime()?.reportError(
      error,
      attributes ? { module: 'sales', code, attributes } : { module: 'sales', code },
    )
  } catch (reportingError) {
    logger.warn('Failed to report batch order-line error', { code, reportingError })
  }
}

/**
 * The bulk schema tags its own refusals with a translation key in `params`
 * because it runs outside a request and cannot translate. Resolve those here,
 * leaving zod's own built-in issues as they are.
 */
function localizeIssues(
  issues: z.ZodError['issues'],
  translate: (key: string, fallback?: string) => string,
): z.ZodError['issues'] {
  return issues.map((issue) => {
    const key = (issue as { params?: { omKey?: unknown } }).params?.omKey
    if (typeof key !== 'string') return issue
    return { ...issue, message: translate(key, issue.message) }
  })
}

const COMMAND_ID = 'sales.orders.lines.upsert_many'
const RESOURCE_KIND = 'sales.order'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sales.orders.manage'] },
}

type BulkUpsertResult = { orderId: string; lineIds: string[] }

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    scope: { tenantId?: string | null; organizationId?: string | null },
  ) => Promise<string[] | undefined>
}

/**
 * The features a guard's `features` gate is checked against. Read from RBAC
 * rather than off the token's `features` claim: a guard that only runs for
 * holders of a feature must not be skippable by a caller who can shape their
 * own claim.
 */
async function resolveGrantedFeatures(ctx: CommandRuntimeContext): Promise<string[]> {
  if (!ctx.auth?.sub) return []
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacServiceLike | undefined
    const features = await rbac?.getGrantedFeatures?.(ctx.auth.sub, {
      tenantId: ctx.auth.tenantId,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth.orgId,
    })
    return features ?? []
  } catch {
    // rbacService not registered — guards without a feature gate still run.
    return []
  }
}

/**
 * Every guard the shared CRUD factory would run for this mutation: the ones
 * modules register through `registerMutationGuards`, plus the legacy DI guard
 * bridged on top. Consulting only the legacy bridge let a registered policy
 * that denies an ordinary order write be bypassed through this route.
 */
async function runGuards(
  ctx: CommandRuntimeContext,
  input: MutationGuardInput,
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  modifiedPayload?: Record<string, unknown>
  afterSuccessCallbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>
}> {
  const guards = [...getAllMutationGuardInstances()]
  const legacyGuard = bridgeLegacyGuard(ctx.container)
  if (legacyGuard) guards.push(legacyGuard)
  if (!guards.length || !ctx.auth?.tenantId) {
    return { ok: true, afterSuccessCallbacks: [] }
  }

  return runMutationGuards(guards, input, {
    userFeatures: await resolveGrantedFeatures(ctx),
  })
}

/**
 * These run after the batch has committed and after the success response —
 * including its undo metadata — has been built. A throwing callback must not
 * turn a committed write into a reported failure: the caller would retry, and
 * entries without an id would append a second time. Each one is isolated and
 * logged, exactly as the shared CRUD factory does.
 */
async function runGuardAfterSuccessCallbacks(
  callbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>,
  input: Omit<MutationGuardAfterInput, 'metadata'>,
): Promise<void> {
  for (const callback of callbacks) {
    if (!callback.guard.afterSuccess) continue
    try {
      await callback.guard.afterSuccess({
        ...input,
        metadata: callback.metadata ?? null,
      })
    } catch (err) {
      logger.error('Mutation guard afterSuccess failed', { guardId: callback.guard.id, err })
      reportBatchRouteError(err, 'sales.order_lines_guard_after_success_failed', {
        guardId: callback.guard.id,
      })
    }
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
  const organizationId = scope ? scope.selectedId : auth.orgId ?? null
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
    const payload = await readJsonSafe(req, {})
    const scoped = withScopedPayload(payload ?? {}, ctx, translate)
    let input = orderLineBulkUpsertSchema.parse(scoped)

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
    const guardResult = await runGuards(ctx, {
      ...guardScope,
      mutationPayload: input as Record<string, unknown>,
    })
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: translate('sales.documents.errors.guard_blocked', 'Operation blocked by guard') },
        { status: guardResult.errorStatus ?? 422 },
      )
    }
    if (guardResult.modifiedPayload) {
      input = orderLineBulkUpsertSchema.parse({ ...input, ...guardResult.modifiedPayload })
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
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        {
          error: translate('sales.documents.items.bulk.errorInvalidInput', 'Invalid input'),
          details: localizeIssues(err.issues, translate),
        },
        { status: 400 },
      )
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('sales.orders.lines.upsert_many failed', { err })
    reportBatchRouteError(err, 'sales.order_lines_batch_failed')
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
