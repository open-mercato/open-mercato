import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import {
  bridgeLegacyGuard,
  runMutationGuards,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import type { AwilixContainer } from 'awilix'

export type BulkCreateGuardDecision =
  | { ok: true }
  | { ok: false; body: Record<string, unknown>; status: number }

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

/**
 * Runs the registered mutation guards for a bulk-create request before the batch is enqueued,
 * so a guard that would block a single `create` blocks the batch version of the same write.
 *
 * The guarded unit is the batch envelope, not the individual rows: the rows are created later,
 * by a queue worker, from a context that has no request headers and no resource ids to offer a
 * guard. For the same reason `afterSuccess` callbacks are not invoked here — there is no created
 * record to report at enqueue time, and the request is gone by the time there is one. A guard
 * that needs per-record post-processing has to subscribe to `catalog.product.created` /
 * `catalog.category.created` instead.
 */
export async function runBulkCreateMutationGuards(params: {
  container: AwilixContainer
  auth: unknown
  request: Request
  tenantId: string
  organizationId: string
  userId: string
  resourceKind: string
  itemCount: number
}): Promise<BulkCreateGuardDecision> {
  const legacyGuard = bridgeLegacyGuard(params.container)
  const guards = [...getAllMutationGuardInstances(), ...(legacyGuard ? [legacyGuard] : [])]
  const result = await runMutationGuards(
    guards,
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      userId: params.userId,
      resourceKind: params.resourceKind,
      resourceId: null,
      operation: 'create',
      requestMethod: params.request.method,
      requestHeaders: params.request.headers,
      mutationPayload: { bulk: true, itemCount: params.itemCount },
    },
    { userFeatures: resolveUserFeatures(params.auth) },
  )
  if (result.ok) return { ok: true }
  return {
    ok: false,
    body: result.errorBody ?? { error: '[internal] Bulk create blocked by a mutation guard.' },
    status: result.errorStatus ?? 422,
  }
}
