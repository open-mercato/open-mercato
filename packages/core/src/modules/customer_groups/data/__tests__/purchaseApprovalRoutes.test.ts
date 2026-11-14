import {
  customerPurchaseApprovalDecideRequestSchema,
  customerPurchaseApprovalListQuerySchema,
  customerPurchaseApprovalPortalListQuerySchema,
} from '../validators'

describe('customerPurchaseApprovalDecideRequestSchema (Step 2.6, §9/§9.2)', () => {
  it('accepts a bare decision with no note', () => {
    expect(customerPurchaseApprovalDecideRequestSchema.safeParse({ decision: 'approved' }).success).toBe(true)
    expect(customerPurchaseApprovalDecideRequestSchema.safeParse({ decision: 'rejected' }).success).toBe(true)
  })

  it('accepts a decision with a note', () => {
    const result = customerPurchaseApprovalDecideRequestSchema.safeParse({ decision: 'rejected', note: 'Exceeds normal pattern' })
    expect(result.success).toBe(true)
  })

  it('rejects a decision outside approved | rejected', () => {
    expect(customerPurchaseApprovalDecideRequestSchema.safeParse({ decision: 'pending' }).success).toBe(false)
  })

  it('rejects an empty note (use the omitted-field path instead)', () => {
    expect(customerPurchaseApprovalDecideRequestSchema.safeParse({ decision: 'approved', note: '' }).success).toBe(false)
  })

  it('is strict: the actor must never be smuggled through the body', () => {
    expect(
      customerPurchaseApprovalDecideRequestSchema.safeParse({
        decision: 'approved',
        actorId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false)
    expect(
      customerPurchaseApprovalDecideRequestSchema.safeParse({
        decision: 'approved',
        organizationId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false)
  })
})

describe('customerPurchaseApprovalListQuerySchema (staff list, §9)', () => {
  it('defaults page/pageSize and accepts every filter', () => {
    const result = customerPurchaseApprovalListQuerySchema.safeParse({
      status: 'pending',
      customerId: '11111111-1111-4111-8111-111111111111',
      subjectType: 'cart',
      ids: 'a,b,c',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(1)
      expect(result.data.pageSize).toBe(20)
    }
  })

  it('caps pageSize at 100', () => {
    expect(customerPurchaseApprovalListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false)
    expect(customerPurchaseApprovalListQuerySchema.safeParse({ pageSize: 100 }).success).toBe(true)
  })

  it('rejects a status outside the lifecycle enum', () => {
    expect(customerPurchaseApprovalListQuerySchema.safeParse({ status: 'cancelled' }).success).toBe(false)
  })
})

describe('customerPurchaseApprovalPortalListQuerySchema (portal list, §9 portal table)', () => {
  it('has no filters beyond pagination', () => {
    const result = customerPurchaseApprovalPortalListQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ page: 1, pageSize: 20 })
    }
  })

  it('caps pageSize at 100', () => {
    expect(customerPurchaseApprovalPortalListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false)
  })
})
