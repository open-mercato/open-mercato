import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import type { OnboardingRequest } from '../data/entities'

export function runOnboardingIdentity<Result>(callback: () => Result): Result {
  return runWithFreshDatabaseExecutionContext({ kind: 'identity', tenantId: null, source: 'identity', operation: 'onboarding' }, callback)
}

export async function hasPersistedWorkspace(em: EntityManager, request: OnboardingRequest): Promise<boolean> {
  if (request.deletedAt || !request.tenantId || !request.organizationId) return false
  const tenant = await findOneWithDecryption<{ id: string; isActive: boolean; deletedAt: Date | null }>(em, 'Tenant', { id: request.tenantId, isActive: true, deletedAt: null })
  if (!tenant) return false
  const organization = await findOneWithDecryption<{ id: string; tenant: string; isActive: boolean; deletedAt: Date | null }>(em, 'Organization', {
    id: request.organizationId, tenant: request.tenantId, isActive: true, deletedAt: null,
  })
  return Boolean(organization)
}

export function runOnboardingTenant<Result>(tenantId: string, callback: (container: Awaited<ReturnType<typeof createRequestContainer>>) => Promise<Result>): Promise<Result> {
  return runWithFreshDatabaseExecutionContext({ kind: 'tenant', tenantId, source: 'public-token', operation: 'onboarding-continuation' }, async () => {
    const container = await createRequestContainer()
    return callback(container)
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
