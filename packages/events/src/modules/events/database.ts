import { databaseJobTenantContext, resolveDeclaredDatabaseJobContext, type DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  jobProviders: [{
    matches: (input) => input.queue === 'events',
    resolve: async (input) => {
      const envelope = input.payload
      if (!envelope || typeof envelope !== 'object' || !('event' in envelope) || typeof envelope.event !== 'string' || !envelope.event.trim() || !('options' in envelope)) {
        throw new Error('[internal] Invalid persisted event envelope')
      }
      const options = envelope.options
      if (!options || typeof options !== 'object') {
        throw new Error('[internal] Persisted event requires its verified options')
      }
      const tenantId = 'tenantId' in options ? options.tenantId : undefined
      if (input.metadata?.tenantId != null && input.metadata.tenantId !== tenantId) {
        throw new Error('[internal] Conflicting persisted event tenant identities')
      }
      if (tenantId == null) {
        const context = await resolveDeclaredDatabaseJobContext({
          queue: `event:${envelope.event}`,
          workerIds: [],
          payload: 'payload' in envelope ? envelope.payload : undefined,
          metadata: input.metadata,
        })
        if (context.kind !== 'maintenance') throw new Error('[internal] Global event requires an explicit maintenance classifier')
        return context
      }
      return databaseJobTenantContext(tenantId, envelope.event)
    },
  }],
}
