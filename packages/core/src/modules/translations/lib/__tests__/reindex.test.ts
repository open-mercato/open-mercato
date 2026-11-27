import { randomUUID } from 'node:crypto'
import reindexOnUpdate from '../../subscribers/reindex'
import reindexOnDelete from '../../subscribers/reindex-on-delete'

describe.each([reindexOnUpdate, reindexOnDelete])('translation reindex subscriber', (handle) => {
  it('skips the compound identity used for custom-field label translations', async () => {
    const resolve = jest.fn()

    await handle({ entityType: 'entities:custom_field_def', entityId: 'user:example:status' }, { resolve })

    expect(resolve).not.toHaveBeenCalled()
  })

  it('emits scoped reindex events for persisted records', async () => {
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const resolve = jest.fn().mockReturnValue({ emitEvent })
    const entityType = 'dictionaries:dictionary_entry'
    const entityId = randomUUID()
    const tenantId = randomUUID()
    const organizationId = randomUUID()

    await handle({ entityType, entityId, tenantId, organizationId }, { resolve })

    expect(emitEvent).toHaveBeenCalledWith('query_index.upsert_one', {
      entityType,
      recordId: entityId,
      tenantId,
      organizationId,
    })
  })
})
