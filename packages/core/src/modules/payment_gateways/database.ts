import { databaseJobTenantContext, validateDeclaredDatabaseBinding, type DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { isDatabaseRuntimeEnabled, runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  jobProviders: [{
    matches: ({ queue, workerIds }) => queue === 'payment-gateways-status-poller' && workerIds.length === 1 && workerIds[0] === 'payment-gateways:status-poller',
    resolve: async () => ({ kind: 'maintenance', tenantId: null, source: 'maintenance', operation: 'payment-status-discovery' }),
  }],
}

export async function runPaymentMaintenanceTenant<Result>(
  scope: { tenantId: string; organizationId?: string | null },
  fallback: { resolve: <T = unknown>(name: string) => T },
  callback: (container: { resolve: <T = unknown>(name: string) => T }) => Promise<Result>,
): Promise<Result> {
  if (!isDatabaseRuntimeEnabled()) return callback(fallback)
  const context = databaseJobTenantContext(scope.tenantId, 'payment-status-tenant')
  const valid = await runWithFreshDatabaseExecutionContext({ kind: 'identity', tenantId: context.tenantId, source: 'identity', operation: 'payment-status-binding' }, () => validateDeclaredDatabaseBinding({ context, ...(scope.organizationId ? { organization: { id: scope.organizationId } } : {}) }, { requireValidator: true }))
  if (!valid) throw new Error('[internal] Payment maintenance requires a persisted active workspace')
  return runWithFreshDatabaseExecutionContext(context, async () => {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    try { return await callback(container) } finally { await container.dispose() }
  })
}
