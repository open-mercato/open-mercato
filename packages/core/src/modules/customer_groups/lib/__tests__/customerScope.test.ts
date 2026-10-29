import { organizationIdsFromScope } from '../customerScope'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'

describe('organizationIdsFromScope', () => {
  it('falls back to the account organization when no scope was resolved', () => {
    expect(organizationIdsFromScope(null, ORG_A)).toEqual([ORG_A])
    expect(organizationIdsFromScope(null, null)).toBeNull()
  })

  it('is unrestricted for an all-organizations caller', () => {
    expect(
      organizationIdsFromScope({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID }, null),
    ).toBeNull()
  })

  it('uses the scope filter ids, de-duplicated', () => {
    expect(
      organizationIdsFromScope(
        { selectedId: ORG_A, filterIds: [ORG_A, ORG_B, ORG_A], allowedIds: [ORG_A, ORG_B], tenantId: TENANT_ID },
        ORG_A,
      ),
    ).toEqual([ORG_A, ORG_B])
  })

  it('sees no organization when the filter is empty and the fallback is not allowed', () => {
    expect(
      organizationIdsFromScope({ selectedId: null, filterIds: [], allowedIds: [ORG_B], tenantId: TENANT_ID }, ORG_A),
    ).toEqual([])
    expect(
      organizationIdsFromScope({ selectedId: null, filterIds: [], allowedIds: [ORG_B], tenantId: TENANT_ID }, null),
    ).toEqual([])
  })

  it('keeps an allowed fallback organization when the filter is empty', () => {
    expect(
      organizationIdsFromScope({ selectedId: null, filterIds: [], allowedIds: [ORG_A], tenantId: TENANT_ID }, ORG_A),
    ).toEqual([ORG_A])
  })
})
