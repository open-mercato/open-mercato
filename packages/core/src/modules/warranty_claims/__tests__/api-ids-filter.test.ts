import { applyIdsFilter } from '../lib/apiIdsFilter'

describe('applyIdsFilter', () => {
  it('narrows list requests to every requested id', () => {
    const filters: Record<string, unknown> = {}

    applyIdsFilter(filters, { ids: ['claim-1', 'claim-2'] })

    expect(filters).toEqual({ id: { $in: ['claim-1', 'claim-2'] } })
  })

  it('prefers the explicit single-record id when both forms are present', () => {
    const filters: Record<string, unknown> = {}

    applyIdsFilter(filters, { id: 'claim-1', ids: ['claim-2'] })

    expect(filters).toEqual({ id: { $eq: 'claim-1' } })
  })
})
