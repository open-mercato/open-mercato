import { databaseJobTenantContext, type DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  jobProviders: [{
    matches: (input) => input.queue === 'events',
    resolve: async (input) => {
      const envelope = input.payload
      if (!envelope || typeof envelope !== 'object' || !('event' in envelope) || typeof envelope.event !== 'string' || !envelope.event.trim() || !('options' in envelope)) {
        throw new Error('[internal] Invalid persisted event envelope')
      }
      const options = envelope.options
      if (!options || typeof options !== 'object' || !('tenantId' in options)) {
        throw new Error('[internal] Persisted event requires its verified tenant options')
      }
      if (input.metadata?.tenantId != null && input.metadata.tenantId !== options.tenantId) {
        throw new Error('[internal] Conflicting persisted event tenant identities')
      }
      return databaseJobTenantContext(options.tenantId, envelope.event)
    },
  }],
}
