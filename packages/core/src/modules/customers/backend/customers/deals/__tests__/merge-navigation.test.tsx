import { buildDealMergeHref } from '../page'

describe('deal merge navigation', () => {
  it('requires exactly two selected deals', () => {
    expect(buildDealMergeHref([])).toBeNull()
    expect(buildDealMergeHref([{ id: 'deal-1' }])).toBeNull()
    expect(buildDealMergeHref([{ id: 'deal-1' }, { id: 'deal-2' }, { id: 'deal-3' }])).toBeNull()
  })

  it('encodes both selected ids in a stable merge URL', () => {
    expect(buildDealMergeHref([{ id: 'left/id' }, { id: 'right id' }])).toBe(
      '/backend/customers/deals/merge?left=left%2Fid&right=right+id',
    )
  })
})
