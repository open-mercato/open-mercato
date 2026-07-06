import type { AwilixContainer } from 'awilix'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'

type GuardAfterCallback = {
  guard: MutationGuard
  metadata: Record<string, unknown> | null
}

export function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

export async function runStaffMutationGuards(
  container: AwilixContainer,
  input: MutationGuardInput,
  userFeatures: string[],
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  modifiedPayload?: Record<string, unknown>
  afterSuccessCallbacks: GuardAfterCallback[]
}> {
  const legacyGuard = bridgeLegacyGuard(container)
  if (!legacyGuard) {
    return { ok: true, afterSuccessCallbacks: [] }
  }

  return runMutationGuards([legacyGuard], input, { userFeatures })
}

export async function runStaffMutationGuardAfterSuccess(
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
    await callback.guard.afterSuccess({
      ...input,
      metadata: callback.metadata ?? null,
    })
  }
}
