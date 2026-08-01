import handle from '../search-reindex-proposal-created'

const emitEvent = jest.fn(async () => undefined)
const context = { resolve: jest.fn(() => ({ emitEvent })) }

describe('inbox proposal search reindex subscriber', () => {
  beforeEach(() => jest.clearAllMocks())

  it('bridges proposal creation to the query index', async () => {
    await handle({ proposalId: 'proposal-1', tenantId: 'tenant-1', organizationId: 'org-1' }, context)

    expect(emitEvent).toHaveBeenCalledWith('query_index.upsert_one', {
      entityType: 'inbox_ops:inbox_proposal',
      recordId: 'proposal-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      crudAction: 'created',
      coverageBaseDelta: 1,
    }, { tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('skips incomplete payloads and unavailable event buses', async () => {
    await handle({ proposalId: 'proposal-1' }, context)
    await handle({ proposalId: 'proposal-1', tenantId: 'tenant-1' }, {
      resolve: () => { throw new Error('unavailable') },
    })
    expect(emitEvent).not.toHaveBeenCalled()
  })
})
