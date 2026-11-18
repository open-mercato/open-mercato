import type { EntityManager } from '@mikro-orm/postgresql'
import type { ApiInterceptor, InterceptorContext, InterceptorRequest } from '@open-mercato/shared/lib/crud/api-interceptor'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { E } from '#generated/entities.ids.generated'
import { decodeProductUseIntent, PRODUCT_USE_INTENT_HEADER, type ProductUseIntent } from '../lib/productUseIntent'
import { canManageAllBuildings } from '../lib/buildingAccess'
import { loadProductOrganizations, type Scope } from '../lib/productUse'
import {
  assertProductUseChangeAllowed,
  loadProductUseRecord,
  PRODUCT_USE_RESOURCE_KIND,
  productUseForbiddenError,
  toProductUseState,
} from '../commands/product-use'

const logger = createLogger('property_management')

export const PRODUCT_USE_SYNC_INTERCEPTOR_TIMEOUT_MS = 10000
export const PRODUCT_USE_SYNC_DEADLINE_MS = 8000

export type ProductUseSyncError = { status: number; error: string }

type SyncOutcome<T = unknown> = { kind: 'done'; value: T } | { kind: 'failed'; error: unknown } | { kind: 'timeout' }

type SyncFailure = { kind: 'failed'; error: unknown } | { kind: 'timeout' }

type SyncResult = { kind: 'denied' } | { kind: 'synced'; scope: Scope }

type GuardOperation = 'create' | 'update' | 'delete'

type GuardCallback = { guard: MutationGuard; metadata: Record<string, unknown> | null }

type GuardedWrite = { resourceId: string | null; operation: GuardOperation; callbacks: GuardCallback[] }

type SyncMetadata = { productUseIntent?: ProductUseIntent; productUseDenied?: boolean; productUseGuards?: GuardedWrite }

async function settleWithin<T>(task: Promise<T>, deadlineMs: number): Promise<SyncOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const deadline = new Promise<SyncOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), deadlineMs)
  })
  const settled = task.then<SyncOutcome<T>, SyncOutcome<T>>(
    (value) => ({ kind: 'done', value }),
    (error: unknown) => ({ kind: 'failed', error }),
  )
  try {
    return await Promise.race([settled, deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function reportSyncFailure(err: unknown, productId: string): void {
  logger.error('Product use sync failed after the catalog product was saved', { err, productId })
  getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.product_use_sync_failed' })
}

function reportLateGuardFailure(err: unknown, productId: string): void {
  logger.error('Product use mutation guard afterSuccess failed after a late product use sync', { err, productId })
  getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.product_use_guard_after_failed' })
}

async function describeSyncFailure(outcome: SyncFailure): Promise<ProductUseSyncError> {
  const { translate } = await resolveTranslations()
  if (outcome.kind === 'timeout') {
    return {
      status: 504,
      error: translate('property_management.errors.productUseSyncPending', 'The product was saved, but its property use is still being updated. Reload the product to check it.'),
    }
  }
  const fallback = translate('property_management.errors.productUseSyncFailed', 'The product was saved, but its property use could not be updated. Open the product and set it again.')
  if (isCrudHttpError(outcome.error)) {
    const message = typeof outcome.error.body?.error === 'string' ? outcome.error.body.error : null
    return { status: outcome.error.status, error: message ? translate(message, message) : fallback }
  }
  return { status: 500, error: fallback }
}

function recordIdOf(body: Record<string, unknown> | undefined): string | null {
  const id = body?.id
  return typeof id === 'string' && id.trim().length ? id : null
}

function nextState(intent: ProductUseIntent) {
  return intent.use && intent.billingUnit ? { use: intent.use, billingUnit: intent.billingUnit } : null
}

function authOf(context: InterceptorContext): NonNullable<AuthContext> {
  return { sub: context.userId, userId: context.userId, tenantId: context.tenantId, orgId: context.organizationId }
}

function guardOperation(exists: boolean, intent: ProductUseIntent): GuardOperation {
  if (!exists) return 'create'
  return nextState(intent) ? 'update' : 'delete'
}

function requestScope(context: InterceptorContext): Scope {
  return { tenantId: context.tenantId, organizationId: context.organizationId }
}

export async function resolveProductScope(context: InterceptorContext, productId: string | null): Promise<Scope | null> {
  const fallback = requestScope(context)
  if (!productId) return fallback
  const em = (context.em as EntityManager).fork()
  const organizationId = (await loadProductOrganizations(em, context.tenantId, [productId])).get(productId)
  if (!organizationId || organizationId === context.organizationId) return fallback
  const organizations = await resolveOrganizationScopeForRequest({
    container: context.container,
    auth: authOf(context),
    selectedId: context.organizationId,
    tenantId: context.tenantId,
  })
  const allowed = organizations.filterIds ?? organizations.allowedIds
  if (allowed !== null && !allowed.includes(organizationId)) return null
  return { tenantId: context.tenantId, organizationId }
}

const RECORD_LOCK_HEADER_PREFIX = 'x-om-record-lock-'

export function productUseGuardHeaders(request: InterceptorRequest): Headers {
  const headers = new Headers(request.headers)
  const parentRecordHeaders = Array.from(headers.keys()).filter(
    (name) => name === OPTIMISTIC_LOCK_HEADER_NAME || name.startsWith(RECORD_LOCK_HEADER_PREFIX),
  )
  for (const name of parentRecordHeaders) headers.delete(name)
  return headers
}

async function runProductUseGuards(
  request: InterceptorRequest,
  context: InterceptorContext,
  scope: Scope,
  write: Omit<GuardedWrite, 'callbacks'>,
  intent: ProductUseIntent,
): Promise<{ ok: true; callbacks: GuardCallback[] } | { ok: false; status: number; message: string | undefined }> {
  const guards: MutationGuard[] = [...getAllMutationGuardInstances()]
  const legacy = bridgeLegacyGuard(context.container)
  if (legacy) guards.push(legacy)
  if (!guards.length) return { ok: true, callbacks: [] }
  const result = await runMutationGuards(guards, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: context.userId,
    resourceKind: PRODUCT_USE_RESOURCE_KIND,
    resourceId: write.resourceId,
    operation: write.operation,
    requestMethod: request.method,
    requestHeaders: productUseGuardHeaders(request),
    mutationPayload: { use: intent.use, billingUnit: intent.billingUnit },
  }, { userFeatures: context.userFeatures ?? [] })
  if (result.ok) return { ok: true, callbacks: result.afterSuccessCallbacks }
  const message = typeof result.errorBody?.error === 'string' ? result.errorBody.error : undefined
  return { ok: false, status: result.errorStatus ?? 422, message }
}

async function runGuardCallbacks(
  request: InterceptorRequest,
  context: InterceptorContext,
  scope: Scope,
  write: GuardedWrite,
  productId: string,
): Promise<void> {
  for (const callback of write.callbacks) {
    if (!callback.guard.afterSuccess) continue
    try {
      await callback.guard.afterSuccess({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: context.userId,
        resourceKind: PRODUCT_USE_RESOURCE_KIND,
        resourceId: write.resourceId ?? productId,
        operation: write.operation,
        requestMethod: request.method,
        requestHeaders: productUseGuardHeaders(request),
        metadata: callback.metadata,
      })
    } catch (err) {
      logger.error('Product use mutation guard afterSuccess failed', { err, guardId: callback.guard.id, productId })
      getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.product_use_guard_after_failed' })
    }
  }
}

async function syncProductUse(
  context: InterceptorContext,
  metadata: SyncMetadata | undefined,
  intent: ProductUseIntent,
  productId: string,
): Promise<SyncResult> {
  const scope = metadata?.productUseDenied ? null : await resolveProductScope(context, productId)
  if (!scope) return { kind: 'denied' }
  const ctx: CommandRuntimeContext = {
    container: context.container,
    auth: authOf(context),
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
  const commandBus = context.container.resolve('commandBus') as CommandBus
  await commandBus.execute('property_management.product_use.set', {
    input: {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      catalogProductId: productId,
      use: intent.use,
      billingUnit: intent.billingUnit,
    },
    ctx,
  })
  return { kind: 'synced', scope }
}

async function describeDenied(): Promise<ProductUseSyncError> {
  const denied = await productUseForbiddenError()
  const message = typeof denied.body?.error === 'string' ? denied.body.error : ''
  return { status: denied.status, error: message }
}

function productUseErrorMerge(error: ProductUseSyncError) {
  return { merge: { _property_management: { productUseError: error } } }
}

export const interceptors: ApiInterceptor[] = [
  {
    id: 'property_management.catalog-products.product-use-sync',
    targetRoute: 'catalog/products',
    methods: ['POST', 'PUT'],
    features: ['property_management.manage'],
    priority: 110,
    timeoutMs: PRODUCT_USE_SYNC_INTERCEPTOR_TIMEOUT_MS,
    async before(request, context) {
      const intent = decodeProductUseIntent(request.headers[PRODUCT_USE_INTENT_HEADER])
      if (!intent || intent.sourceEntityId !== E.catalog.catalog_product) return { ok: true }
      const productId = request.method === 'PUT' ? recordIdOf(request.body) : null
      const scope = await resolveProductScope(context, productId)
      const allowed = scope ? await canManageAllBuildings({ container: context.container, auth: authOf(context), ...scope }) : false
      if (!scope || !allowed) return { ok: true, metadata: { productUseIntent: intent, productUseDenied: true } satisfies SyncMetadata }
      let write: Omit<GuardedWrite, 'callbacks'> = { resourceId: null, operation: 'create' }
      if (productId) {
        const em = (context.em as EntityManager).fork()
        try {
          const record = await loadProductUseRecord(em, scope, productId)
          await assertProductUseChangeAllowed(em, scope, productId, toProductUseState(record), nextState(intent))
          write = { resourceId: record?.id ?? null, operation: guardOperation(Boolean(record), intent) }
        } catch (err) {
          if (isCrudHttpError(err)) {
            const message = typeof err.body?.error === 'string' ? err.body.error : undefined
            return { ok: false, statusCode: err.status, message }
          }
          throw err
        }
      }
      const guarded = await runProductUseGuards(request, context, scope, write, intent)
      if (!guarded.ok) return { ok: false, statusCode: guarded.status, message: guarded.message }
      return { ok: true, metadata: { productUseIntent: intent, productUseGuards: { ...write, callbacks: guarded.callbacks } } satisfies SyncMetadata }
    },
    async after(request, response, context) {
      if (response.statusCode >= 400) return {}
      const metadata = context.metadata as SyncMetadata | undefined
      const intent = metadata?.productUseIntent
      if (!intent) return {}
      const productId = recordIdOf(response.body) ?? recordIdOf(request.body)
      if (!productId) return {}
      try {
        const task = Promise.resolve().then(() => syncProductUse(context, metadata, intent, productId))
        const outcome = await settleWithin(task, PRODUCT_USE_SYNC_DEADLINE_MS)
        const guards = metadata?.productUseGuards
        if (outcome.kind === 'done') {
          if (outcome.value.kind === 'denied') return productUseErrorMerge(await describeDenied())
          if (guards) await runGuardCallbacks(request, context, outcome.value.scope, guards, productId)
          return {}
        }
        if (outcome.kind === 'failed') reportSyncFailure(outcome.error, productId)
        else {
          task.then(
            (value) => (guards && value.kind === 'synced' ? runGuardCallbacks(request, context, value.scope, guards, productId) : undefined),
            (err: unknown) => reportSyncFailure(err, productId),
          ).catch((err: unknown) => reportLateGuardFailure(err, productId))
        }
        return productUseErrorMerge(await describeSyncFailure(outcome))
      } catch (err) {
        reportSyncFailure(err, productId)
        return productUseErrorMerge(await describeSyncFailure({ kind: 'failed', error: err }))
      }
    },
  },
]

export default interceptors
