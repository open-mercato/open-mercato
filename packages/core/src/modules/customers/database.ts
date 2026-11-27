import { z } from 'zod'
import { databaseJobTenantContext, validateDeclaredDatabaseBinding, type DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  jobProviders: [{
    matches: (input) => ['customers-deals-bulk-update-stage', 'customers-deals-bulk-update-owner'].includes(input.queue),
    resolve: async (input) => {
      const payload = z.object({
        tenantId: z.string().uuid().nullish(),
        organizationId: z.string().uuid().nullish(),
        scope: z.object({ tenantId: z.string().uuid().nullish(), organizationId: z.string().uuid().nullish() }).optional(),
      }).parse(input.payload)
      const tenantIds = [payload.scope?.tenantId, payload.tenantId, input.metadata?.tenantId]
        .filter((value) => value != null).map((value) => z.string().uuid().parse(value).toLowerCase())
      if (new Set(tenantIds).size !== 1) throw new Error('[internal] Missing or conflicting worker tenant identities')
      const organizationIds = [payload.scope?.organizationId, payload.organizationId]
        .filter((value): value is string => value != null).map((value) => value.toLowerCase())
      if (new Set(organizationIds).size > 1) throw new Error('[internal] Conflicting worker organization identities')
      const context = databaseJobTenantContext(tenantIds[0], input.queue)
      const valid = await runWithFreshDatabaseExecutionContext(
        { kind: 'identity', tenantId: context.tenantId, source: 'identity', operation: input.queue },
        () => validateDeclaredDatabaseBinding({ context, ...(organizationIds[0] ? { organization: { id: organizationIds[0] } } : {}) }, { requireValidator: true }),
      )
      if (!valid) throw new Error('[internal] Worker requires a persisted active tenant binding')
      return context
    },
  }],
  tables: [{ table: 'customer_entities', classification: 'enforced', reason: 'Initial reviewed customer CRUD canary.' }],
}
