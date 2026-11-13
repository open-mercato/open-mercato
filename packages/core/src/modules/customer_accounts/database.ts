import type { DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { runWithDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  tableClassification: 'identity',
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
            const em = container.resolve<import('@mikro-orm/postgresql').EntityManager>('em')
            if (!await findOneWithDecryption(em, DomainMapping, {
              hostname: normalized, status: 'active', tenantId: auth.tenantId, organizationId: auth.orgId,
            })) return null
          }
        }
        const slug = input.pathname.match(/^\/([^/]+)\/portal(?:\/|$)/)?.[1]
        return { context: { kind: 'tenant', source: 'portal', tenantId: auth.tenantId }, organization: { id: auth.orgId, ...(slug ? { slug } : {}) } }
      })
    },
  }],
}
