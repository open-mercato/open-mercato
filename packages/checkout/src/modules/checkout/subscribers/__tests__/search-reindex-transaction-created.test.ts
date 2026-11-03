import handle from '../search-reindex-transaction-created'

const emitEvent = jest.fn(async () => undefined)
const context = { resolve: jest.fn(() => ({ emitEvent })) }

describe('checkout transaction search reindex subscriber', () => {
  beforeEach(() => jest.clearAllMocks())

  it('bridges transaction creation to the query index', async () => {
    await handle({ transactionId: 'transaction-1', tenantId: 'tenant-1', organizationId: 'org-1' }, context)

    expect(emitEvent).toHaveBeenCalledWith('query_index.upsert_one', {
      entityType: 'checkout:checkout_transaction',
      recordId: 'transaction-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      crudAction: 'created',
      coverageBaseDelta: 1,
    }, { tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('skips incomplete payloads and unavailable event buses', async () => {
    await handle({ transactionId: 'transaction-1' }, context)
    await handle({ transactionId: 'transaction-1', tenantId: 'tenant-1' }, {
      resolve: () => { throw new Error('unavailable') },
    })
    expect(emitEvent).not.toHaveBeenCalled()
  })
})
