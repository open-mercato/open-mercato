import { z } from 'zod'
import { databaseJobTenantContext, type DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveQueryIndexSourceMetadata, resolveQueryIndexReindexScope } from './lib/subscriber-scope'
import { isTenantGlobalEntityType } from './lib/tenant-global'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  jobProviders: [{
    matches: (input) => input.queue === 'event:query_index.reindex',
    resolve: async (input) => {
      const payload = input.payload
      if (!payload || typeof payload !== 'object' || !('entityType' in payload) || typeof payload.entityType !== 'string') {
        throw new Error('[internal] Reindex requires a registered entity type')
      }
      const tenantId = 'tenantId' in payload ? payload.tenantId : undefined
      if (input.metadata?.tenantId != null && input.metadata.tenantId !== tenantId) {
        throw new Error('[internal] Conflicting reindex tenant identities')
      }
      const tenantContext = tenantId != null ? databaseJobTenantContext(tenantId, input.queue) : null
      if ('organizationId' in payload && payload.organizationId != null) z.string().uuid().parse(payload.organizationId)
      const entityType = payload.entityType
      resolveQueryIndexReindexScope({ tenantId: tenantContext?.tenantId ?? (tenantId === null ? null : undefined), organizationId: undefined, allowAllTenants: 'allowAllTenants' in payload && payload.allowAllTenants === true })
      return runWithFreshDatabaseExecutionContext({ kind: 'identity', tenantId: null, source: 'identity', operation: 'query-index-classification' }, async () => {
        const container = await createRequestContainer()
        try {
          const source = resolveQueryIndexSourceMetadata(container.resolve('em'), entityType)
          if (tenantContext) return tenantContext
          if (!source.tenantColumn && (source.organizationColumn || !isTenantGlobalEntityType(entityType))) {
            throw new Error('[internal] Reindex target has no declared global or tenant scope')
          }
          return { kind: 'maintenance', tenantId: null, source: 'maintenance', operation: 'query_index.reindex' } as const
        } finally {
          await container.dispose()
        }
      })
    },
  }],
}
