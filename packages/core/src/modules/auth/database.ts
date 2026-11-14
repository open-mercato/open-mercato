import type { DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  tableClassification: 'identity',
  requestProviders: [{
    matches: (input) => input.requireAuth && !input.requireCustomerAuth,
    resolve: async () => {
      const { resolveAuthFromCookiesDetailed } = await import('@open-mercato/shared/lib/auth/server')
      const resolved = await resolveAuthFromCookiesDetailed()
      if (resolved.status === 'error') throw new Error('[internal] Database request staff identity is unavailable')
      return resolved.auth?.tenantId
        ? { context: { kind: 'tenant', source: 'page', tenantId: resolved.auth.tenantId } }
        : null
    },
  }],
}
