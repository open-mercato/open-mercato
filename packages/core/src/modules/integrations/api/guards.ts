import type { AwilixContainer } from 'awilix'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('integrations')

type GuardAfterCallback = {
  guard: MutationGuard
  metadata: Record<string, unknown> | null
}

/** @deprecated Mutation guard grants are resolved from RBAC by `runIntegrationMutationGuards`. */
export function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

export async function runIntegrationMutationGuards(
  container: AwilixContainer,
  input: MutationGuardInput,
  extraFeatures: string[] = [],
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  modifiedPayload?: Record<string, unknown>
  afterSuccessCallbacks: GuardAfterCallback[]
}> {
  const allGuards: MutationGuard[] = [...getAllMutationGuardInstances()]
  const legacyGuard = bridgeLegacyGuard(container)
  if (legacyGuard) allGuards.push(legacyGuard)
  if (!allGuards.length) {
    return { ok: true, afterSuccessCallbacks: [] }
  }

  let grantedFeatures: string[] = []
  try {
    const rbacService = container.resolve('rbacService') as {
      getGrantedFeatures?: (
        userId: string,
        scope: { tenantId: string | null; organizationId: string | null },
      ) => Promise<string[]>
    } | undefined
    grantedFeatures = await rbacService?.getGrantedFeatures?.(input.userId, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }) ?? []
  } catch (err) {
    logger.error('Failed to resolve mutation guard feature grants', { err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'integrations',
      code: 'integrations.mutation_guard_feature_resolution_failed',
    })
  }

  const userFeatures = Array.from(new Set([...grantedFeatures, ...extraFeatures]))
  return runMutationGuards(allGuards, input, { userFeatures })
}

export async function runIntegrationMutationGuardAfterSuccess(
  callbacks: GuardAfterCallback[],
  input: {
    tenantId: string
    organizationId: string | null
    userId: string
    resourceKind: string
    resourceId: string
    operation: 'create' | 'update' | 'delete'
    requestMethod: string
    requestHeaders: Headers
  },
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
      getTelemetryRuntime()?.reportError(err, {
        module: 'integrations',
        code: 'integrations.mutation_guard_after_success_failed',
        attributes: { guardId: callback.guard.id },
      })
    }
  }
}
