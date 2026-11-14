import { buildPortalApprovalListWhere, isApprovalVisibleToPortalPrincipal, type PortalApprovalPrincipal } from '../portalApprovalAccess'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const COMPANY_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_COMPANY_ID = '99999999-9999-4999-8999-999999999999'
const BUYER_USER_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_BUYER_USER_ID = '55555555-5555-4555-8555-555555555555'

function principal(overrides: Partial<PortalApprovalPrincipal> = {}): PortalApprovalPrincipal {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    customerEntityId: COMPANY_ID,
    customerUserId: BUYER_USER_ID,
    canDecide: false,
    ...overrides,
  }
}

describe('isApprovalVisibleToPortalPrincipal (G5/§9.2)', () => {
  it('refuses an approval belonging to another company regardless of role', () => {
    const otherCompanyApproval = {
      customerId: OTHER_COMPANY_ID,
      requestedBy: { actorType: 'customer_user' as const, actorId: BUYER_USER_ID },
    }
    expect(isApprovalVisibleToPortalPrincipal(principal(), otherCompanyApproval)).toBe(false)
    expect(isApprovalVisibleToPortalPrincipal(principal({ canDecide: true }), otherCompanyApproval)).toBe(false)
  })

  it('a decide-holder sees every request for their own company, not just their own', () => {
    const someoneElsesRequest = {
      customerId: COMPANY_ID,
      requestedBy: { actorType: 'customer_user' as const, actorId: OTHER_BUYER_USER_ID },
    }
    expect(isApprovalVisibleToPortalPrincipal(principal({ canDecide: true }), someoneElsesRequest)).toBe(true)
  })

  it('a non-decider sees only their own requests within their own company', () => {
    const ownRequest = {
      customerId: COMPANY_ID,
      requestedBy: { actorType: 'customer_user' as const, actorId: BUYER_USER_ID },
    }
    const someoneElsesRequest = {
      customerId: COMPANY_ID,
      requestedBy: { actorType: 'customer_user' as const, actorId: OTHER_BUYER_USER_ID },
    }
    expect(isApprovalVisibleToPortalPrincipal(principal(), ownRequest)).toBe(true)
    expect(isApprovalVisibleToPortalPrincipal(principal(), someoneElsesRequest)).toBe(false)
  })

  it('a non-decider never sees a staff-authored request for their own company', () => {
    const staffAuthored = {
      customerId: COMPANY_ID,
      requestedBy: { actorType: 'staff_user' as const, actorId: '66666666-6666-4666-8666-666666666666' },
    }
    expect(isApprovalVisibleToPortalPrincipal(principal(), staffAuthored)).toBe(false)
    expect(isApprovalVisibleToPortalPrincipal(principal({ canDecide: true }), staffAuthored)).toBe(true)
  })
})

describe('buildPortalApprovalListWhere (G5/§9 portal table)', () => {
  it('always scopes to tenant, organization and the caller\'s own company', () => {
    const where = buildPortalApprovalListWhere(principal())
    expect(where).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID, customerId: COMPANY_ID })
  })

  it('narrows to the caller\'s own requests when they cannot decide', () => {
    const where = buildPortalApprovalListWhere(principal())
    expect(where).toMatchObject({ requestedByActorType: 'customer_user', requestedByActorId: BUYER_USER_ID })
  })

  it('does not narrow by requester for a decide-holder', () => {
    const where = buildPortalApprovalListWhere(principal({ canDecide: true }))
    expect(where.requestedByActorType).toBeUndefined()
    expect(where.requestedByActorId).toBeUndefined()
  })
})
