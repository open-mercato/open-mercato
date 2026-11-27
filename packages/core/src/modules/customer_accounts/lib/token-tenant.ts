import { isDatabaseRuntimeEnabled, runWithDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import { bindRequestScopeContainer, runInOwnedRequestScope, runWithRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'
import type { CustomerTokenPurpose, CustomerTokenService } from '../services/customerTokenService'

async function withTokenContainer<Result>(run: (container: AppContainer) => Promise<Result>): Promise<Result> {
  const { result } = await runInOwnedRequestScope(async () => {
    const container = await createRequestContainer()
    bindRequestScopeContainer(container)
    return { result: await runWithRequestScopeContainer(container, () => run(container)) }
  })
  return result
}

export async function runWithCustomerTokenTenant(
  token: string,
  purpose: CustomerTokenPurpose,
  operation: string,
  run: (container: AppContainer, tenantId?: string) => Promise<Response | null>,
): Promise<Response | null> {
  const execute = (tenantId?: string) => withTokenContainer((container) => run(container, tenantId))
  if (!isDatabaseRuntimeEnabled()) return execute()

  const tenantId = await runWithDatabaseExecutionContext(
    { kind: 'identity', tenantId: null, source: 'identity', operation: `${operation}-identity` },
    () => withTokenContainer((container) =>
      container.resolve<CustomerTokenService>('customerTokenService').findActiveTokenTenant(token, purpose),
    ),
  )
  if (!tenantId) return null

  return runWithDatabaseExecutionContext(
    { kind: 'tenant', tenantId, source: 'public-token', operation },
    () => execute(tenantId),
  )
}
