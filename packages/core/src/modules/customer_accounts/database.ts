import { databaseJobTenantContext, validateDeclaredDatabaseBinding, type DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { isDatabaseRuntimeEnabled, runWithFreshDatabaseExecutionContext, runWithDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  tableClassification: 'identity',
  jobProviders: [{
    matches: ({ queue, workerIds }) => workerIds.length === 1 && (
      (queue === 'domain-verification' && workerIds[0] === 'customer_accounts:domain-verification')
      || (queue === 'domain-tls-retry' && workerIds[0] === 'customer_accounts:domain-tls-retry')
      || (queue === 'customer-accounts-cleanup-sessions' && workerIds[0] === 'customer_accounts:cleanup-expired-sessions')
      || (queue === 'customer-accounts-cleanup-tokens' && workerIds[0] === 'customer_accounts:cleanup-expired-tokens')
    ),
    resolve: async ({ queue }) => ({ kind: 'maintenance', tenantId: null, source: 'maintenance', operation: queue }),
  }],
  requestProviders: [{
    matches: (input) => input.requireCustomerAuth,
    resolve: async (input) => {
      const resolved = input.request
        ? await (await import('./lib/customerAuth')).resolveCustomerAuthFromRequestDetailed(input.request)
        : await (await import('./lib/customerAuthServer')).resolveCustomerAuthFromCookiesDetailed()
      if (resolved.status === 'error') throw new Error('[internal] Database request customer identity is unavailable')
      const auth = resolved.auth
      if (!auth) return null
      return runWithDatabaseExecutionContext({ kind: 'identity', source: 'identity', tenantId: auth.tenantId, operation: 'portal-binding' }, async () => {
        const hostname = input.headers.get('host')
        if (hostname) {
          const [{ platformDomains }, { tryNormalizeHostname }] = await Promise.all([import('./lib/platformDomains'), import('./lib/hostname')])
          const platformHost = hostname.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
          if (!platformDomains().includes(platformHost)) {
            const normalized = tryNormalizeHostname(hostname)
            if (!normalized) return null
            const [{ createRequestContainer }, { findOneWithDecryption }, { DomainMapping }] = await Promise.all([
              import('@open-mercato/shared/lib/di/container'), import('@open-mercato/shared/lib/encryption/find'), import('./data/entities'),
            ])
            const container = await createRequestContainer()
            try {
              const em = container.resolve<import('@mikro-orm/postgresql').EntityManager>('em')
              if (!await findOneWithDecryption(em, DomainMapping, {
                hostname: normalized, status: 'active', tenantId: auth.tenantId, organizationId: auth.orgId,
              })) return null
            } finally {
              await container.dispose()
            }
          }
        }
        const slug = input.pathname.match(/^\/([^/]+)\/portal(?:\/|$)/)?.[1]
        return { context: { kind: 'tenant', source: 'portal', tenantId: auth.tenantId }, organization: { id: auth.orgId, ...(slug ? { slug } : {}) } }
      })
    },
  }],
}

export async function runCustomerMaintenanceTenant<Result>(
  scope: { tenantId: string; organizationId?: string | null },
  fallback: { resolve: <T = unknown>(name: string) => T },
  callback: (container: { resolve: <T = unknown>(name: string) => T }) => Promise<Result>,
): Promise<Result> {
  if (!isDatabaseRuntimeEnabled()) return callback(fallback)
  const context = databaseJobTenantContext(scope.tenantId, 'customer-domain-tenant')
  const valid = await runWithFreshDatabaseExecutionContext({ kind: 'identity', tenantId: context.tenantId, source: 'identity', operation: 'customer-domain-binding' }, () => validateDeclaredDatabaseBinding({ context, ...(scope.organizationId ? { organization: { id: scope.organizationId } } : {}) }, { requireValidator: true }))
  if (!valid) throw new Error('[internal] Domain maintenance requires a persisted active workspace')
  return runWithFreshDatabaseExecutionContext(context, async () => {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    try { return await callback(container) } finally { await container.dispose() }
  })
}
