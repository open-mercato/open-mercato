import { databaseJobTenantContext, validateDeclaredDatabaseBinding } from '@open-mercato/shared/lib/db/declarations'
import { runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'

export async function runQueryIndexTenantContinuation<Result>(
  tenantId: unknown,
  organizationId: string | null | undefined,
  callback: (container: AppContainer, tenantId: string) => Promise<Result>,
): Promise<Result> {
  const context = databaseJobTenantContext(tenantId, 'query_index.reindex')
  if (context.kind !== 'tenant') throw new Error('[internal] Reindex continuation requires a tenant context')
  const valid = await runWithFreshDatabaseExecutionContext(
    { kind: 'identity', tenantId: context.tenantId, source: 'identity', operation: 'query-index-binding' },
    () => validateDeclaredDatabaseBinding({ context, ...(organizationId ? { organization: { id: organizationId } } : {}) }, { requireValidator: true }),
  )
  if (!valid) throw new Error('[internal] Reindex requires a persisted active tenant binding')
  return runWithFreshDatabaseExecutionContext(context, async () => {
    const container = await createRequestContainer()
    try {
      return await callback(container, context.tenantId)
    } finally {
      await container.dispose()
    }
  })
}
