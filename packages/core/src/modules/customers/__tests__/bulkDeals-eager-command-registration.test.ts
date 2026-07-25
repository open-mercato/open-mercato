import { commandRegistry } from '@open-mercato/shared/lib/commands'

// Reproduces the standalone-harness failure mode: a queue worker dispatches
// `customers.deals.update` without any lazy-loader bootstrap having run. The eager
// side-effect import in bulkDeals.ts must have registered the handler synchronously
// into the shared command registry the worker's bus reads.
describe('bulkDeals eager command registration', () => {
  it('registers customers.deals.* handlers when the bulk lib is imported (no lazy bootstrap)', async () => {
    // Sanity: registry has no deals handler before importing the bulk lib.
    expect(commandRegistry.get('customers.deals.update')).toBeNull()

    // Importing the bulk lib should eagerly register the deal commands.
    await import('../lib/bulkDeals')

    expect(commandRegistry.get('customers.deals.update')).not.toBeNull()
    expect(commandRegistry.get('customers.deals.create')).not.toBeNull()
    expect(commandRegistry.get('customers.deals.delete')).not.toBeNull()
  })
})
