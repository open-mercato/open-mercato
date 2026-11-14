import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { validateDeclaredDatabaseBinding } from '@open-mercato/shared/lib/db/declarations'
import { runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import type { OnboardingRequest } from '../data/entities'

export function runOnboardingIdentity<Result>(callback: () => Result): Result {
  return runWithFreshDatabaseExecutionContext({ kind: 'identity', tenantId: null, source: 'identity', operation: 'onboarding' }, callback)
}

export async function hasPersistedWorkspace(_em: EntityManager, request: OnboardingRequest): Promise<boolean> {
  if (request.deletedAt || !request.tenantId || !request.organizationId) return false
  const tenantId = request.tenantId
  const organizationId = request.organizationId
  return runWithFreshDatabaseExecutionContext({ kind: 'identity', tenantId, source: 'identity', operation: 'onboarding-binding' }, () =>
    validateDeclaredDatabaseBinding({
      context: { kind: 'tenant', tenantId, source: 'public-token', operation: 'onboarding-binding' },
      organization: { id: organizationId },
    }, { requireValidator: true }))
}

export function runOnboardingTenant<Result>(tenantId: string, callback: (container: Awaited<ReturnType<typeof createRequestContainer>>) => Promise<Result>): Promise<Result> {
  return runWithFreshDatabaseExecutionContext({ kind: 'tenant', tenantId, source: 'public-token', operation: 'onboarding-continuation' }, async () => {
    const container = await createRequestContainer()
    try {
      return await callback(container)
    } finally {
      await container.dispose()
    }
  })
}

export async function withOnboardingTimeout<Result>(label: string, timeoutMs: number, run: () => Promise<Result>): Promise<Result> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}
