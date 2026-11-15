import type { TenantSetupContext } from '../../modules/setup'
import { validateDeclaredDatabaseBinding } from './declarations'
import { isDatabaseRuntimeEnabled, runWithFreshDatabaseExecutionContext } from './runtime'

export async function runDatabaseTenantSetup<Result, Context extends TenantSetupContext>(fallback: Context, callback: (context: Context) => Promise<Result>): Promise<Result> {
  if (!isDatabaseRuntimeEnabled()) return callback(fallback)
  const execution = { kind: 'tenant', tenantId: fallback.tenantId, source: 'cli', operation: 'tenant-setup' } as const
  const valid = await runWithFreshDatabaseExecutionContext({ kind: 'identity', tenantId: fallback.tenantId, source: 'identity', operation: 'tenant-setup-binding' }, () => validateDeclaredDatabaseBinding({ context: execution, organization: { id: fallback.organizationId } }, { requireValidator: true }))
  if (!valid) throw new Error('[internal] Tenant setup requires a persisted active workspace')
  return runWithFreshDatabaseExecutionContext(execution, async () => {
    const { createRequestContainer } = await import('../di/container')
    const container = await createRequestContainer()
    try { return await callback({ ...fallback, em: container.resolve('em'), container }) } finally { await container.dispose() }
  })
}
