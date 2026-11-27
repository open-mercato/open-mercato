import type { EntityManager } from '@mikro-orm/postgresql'
import { databaseJobTenantContext, validateDeclaredDatabaseBinding, type DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { isDatabaseRuntimeEnabled, runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { runWithRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  jobProviders: [{
    matches: ({ queue, workerIds }) => (
      queue === 'ai-pending-action-cleanup' && workerIds.length === 1 && workerIds[0] === 'ai_assistant:cleanup-expired-pending-actions'
    ) || (
      queue === 'ai-token-usage-prune' && workerIds.length === 1 && workerIds[0] === 'ai_assistant:token-usage-prune'
    ),
    resolve: async ({ queue }) => ({ kind: 'maintenance', tenantId: null, source: 'maintenance', operation: queue }),
  }],
}

export async function runAiMaintenanceTenant<Result>(
  scope: { tenantId: string; organizationId?: string | null },
  fallback: EntityManager,
  callback: (em: EntityManager, container?: { resolve: (name: string) => unknown }) => Promise<Result>,
): Promise<Result> {
  if (!isDatabaseRuntimeEnabled()) return callback(fallback)
  const context = databaseJobTenantContext(scope.tenantId, 'ai-maintenance-tenant')
  const valid = await runWithFreshDatabaseExecutionContext({ kind: 'identity', tenantId: context.tenantId, source: 'identity', operation: 'ai-maintenance-binding' }, () => validateDeclaredDatabaseBinding({ context, ...(scope.organizationId ? { organization: { id: scope.organizationId } } : {}) }, { requireValidator: true }))
  if (!valid) throw new Error('[internal] AI maintenance requires a persisted active workspace')
  return runWithFreshDatabaseExecutionContext(context, async () => {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    try {
      return await runWithRequestScopeContainer(container, () => callback(container.resolve<EntityManager>('em'), container))
    } finally {
      await container.dispose()
    }
  })
}
