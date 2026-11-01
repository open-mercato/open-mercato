import { CustomerPurchaseApproval } from '../entities'
import {
  customerPurchaseApprovalActorTypeSchema,
  customerPurchaseApprovalSlotDecisionSchema,
  customerPurchaseApprovalStatusSchema,
  customerPurchaseApprovalSubjectTypeSchema,
  customerPurchaseApprovalWithdrawnReasonSchema,
} from '../validators'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const COMPANY_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_USER_ID = '44444444-4444-4444-8444-444444444444'
const STAFF_USER_ID = '55555555-5555-4555-8555-555555555555'
const CART_ID = '66666666-6666-4666-8666-666666666666'

describe('CustomerPurchaseApproval entity/validator round-trip (§5.6, D-R5-1/D-R5-3/D-R5-23)', () => {
  it('builds a pending "both" policy approval with both slots unresolved', () => {
    const approval = new CustomerPurchaseApproval()
    approval.organizationId = ORG_ID
    approval.tenantId = TENANT_ID
    approval.customerId = COMPANY_ID
    approval.requestedByActorType = customerPurchaseApprovalActorTypeSchema.parse('customer_user')
    approval.requestedByActorId = CUSTOMER_USER_ID
    approval.subjectType = customerPurchaseApprovalSubjectTypeSchema.parse('cart')
    approval.subjectId = CART_ID
    approval.amountGross = '1250.00'
    approval.currencyCode = 'USD'
    approval.approvalPolicy = 'both'
    approval.status = customerPurchaseApprovalStatusSchema.parse('pending')
    approval.buyerDecision = customerPurchaseApprovalSlotDecisionSchema.parse('pending')
    approval.merchantDecision = customerPurchaseApprovalSlotDecisionSchema.parse('pending')
    approval.expiresAt = new Date('2026-11-09T00:00:00Z')

    expect(approval.status).toBe('pending')
    expect(approval.buyerDecision).toBe('pending')
    expect(approval.merchantDecision).toBe('pending')
    expect(approval.buyerDecidedByActorType).toBeUndefined()
    expect(approval.merchantDecidedByActorType).toBeUndefined()
    expect(approval.withdrawnReason).toBeUndefined()
  })

  it('round-trips a "buyer" policy approval approved by its buyer slot, merchant slot not_required', () => {
    const approval = new CustomerPurchaseApproval()
    approval.organizationId = ORG_ID
    approval.tenantId = TENANT_ID
    approval.customerId = COMPANY_ID
    approval.requestedByActorType = 'customer_user'
    approval.requestedByActorId = CUSTOMER_USER_ID
    approval.subjectType = 'cart'
    approval.subjectId = CART_ID
    approval.amountGross = '500.00'
    approval.currencyCode = 'EUR'
    approval.approvalPolicy = 'buyer'
    approval.status = 'approved'
    approval.buyerDecision = customerPurchaseApprovalSlotDecisionSchema.parse('approved')
    approval.buyerDecidedByActorType = customerPurchaseApprovalActorTypeSchema.parse('customer_user')
    approval.buyerDecidedByActorId = CUSTOMER_USER_ID
    approval.buyerDecidedAt = new Date('2026-10-27T00:00:00Z')
    approval.merchantDecision = customerPurchaseApprovalSlotDecisionSchema.parse('not_required')
    approval.decidedAt = new Date('2026-10-27T00:00:00Z')
    approval.expiresAt = new Date('2026-11-10T00:00:00Z')

    expect(approval.buyerDecision).toBe('approved')
    expect(approval.merchantDecision).toBe('not_required')
    expect(approval.merchantDecidedByActorType).toBeUndefined()
  })

  it('round-trips a merchant decider on a "merchant" policy approval', () => {
    const approval = new CustomerPurchaseApproval()
    approval.organizationId = ORG_ID
    approval.tenantId = TENANT_ID
    approval.customerId = COMPANY_ID
    approval.requestedByActorType = 'customer_user'
    approval.requestedByActorId = CUSTOMER_USER_ID
    approval.subjectType = 'cart'
    approval.subjectId = CART_ID
    approval.amountGross = '900.00'
    approval.currencyCode = 'USD'
    approval.approvalPolicy = 'merchant'
    approval.status = 'rejected'
    approval.buyerDecision = 'not_required'
    approval.merchantDecision = customerPurchaseApprovalSlotDecisionSchema.parse('rejected')
    approval.merchantDecidedByActorType = customerPurchaseApprovalActorTypeSchema.parse('staff_user')
    approval.merchantDecidedByActorId = STAFF_USER_ID
    approval.merchantDecidedAt = new Date('2026-10-27T00:00:00Z')
    approval.merchantDecisionNote = 'Exceeds the buyer’s normal order pattern'
    approval.decidedAt = new Date('2026-10-27T00:00:00Z')
    approval.expiresAt = new Date('2026-11-10T00:00:00Z')

    expect(approval.merchantDecidedByActorType).toBe('staff_user')
    expect(approval.status).toBe('rejected')
  })

  it('round-trips a withdrawn request with a system withdrawal reason', () => {
    const approval = new CustomerPurchaseApproval()
    approval.organizationId = ORG_ID
    approval.tenantId = TENANT_ID
    approval.customerId = COMPANY_ID
    approval.requestedByActorType = 'customer_user'
    approval.requestedByActorId = CUSTOMER_USER_ID
    approval.subjectType = 'cart'
    approval.subjectId = CART_ID
    approval.amountGross = '300.00'
    approval.currencyCode = 'USD'
    approval.approvalPolicy = 'both'
    approval.status = customerPurchaseApprovalStatusSchema.parse('withdrawn')
    approval.buyerDecision = 'pending'
    approval.merchantDecision = 'pending'
    approval.withdrawnReason = customerPurchaseApprovalWithdrawnReasonSchema.parse('cart_merged')
    approval.decidedAt = new Date('2026-10-27T00:00:00Z')
    approval.expiresAt = new Date('2026-11-10T00:00:00Z')

    expect(approval.status).toBe('withdrawn')
    expect(approval.withdrawnReason).toBe('cart_merged')
  })

  it('rejects a subject_type outside cart | quote', () => {
    expect(customerPurchaseApprovalSubjectTypeSchema.safeParse('checkout_session').success).toBe(false)
    expect(customerPurchaseApprovalSubjectTypeSchema.safeParse('cart').success).toBe(true)
    expect(customerPurchaseApprovalSubjectTypeSchema.safeParse('quote').success).toBe(true)
  })

  it('rejects a status outside the five-member lifecycle enum', () => {
    for (const status of ['pending', 'approved', 'rejected', 'expired', 'withdrawn']) {
      expect(customerPurchaseApprovalStatusSchema.safeParse(status).success).toBe(true)
    }
    expect(customerPurchaseApprovalStatusSchema.safeParse('cancelled').success).toBe(false)
  })

  it('rejects a slot decision outside pending | approved | rejected | not_required', () => {
    expect(customerPurchaseApprovalSlotDecisionSchema.safeParse('not_required').success).toBe(true)
    expect(customerPurchaseApprovalSlotDecisionSchema.safeParse('withdrawn').success).toBe(false)
  })

  it('rejects a requested-by actor type outside customer_user | staff_user', () => {
    expect(customerPurchaseApprovalActorTypeSchema.safeParse('system').success).toBe(false)
  })

  it('rejects a withdrawn_reason outside the four-member enum', () => {
    for (const reason of ['requester', 'cart_merged', 'cart_expired', 'cart_purged']) {
      expect(customerPurchaseApprovalWithdrawnReasonSchema.safeParse(reason).success).toBe(true)
    }
    expect(customerPurchaseApprovalWithdrawnReasonSchema.safeParse('cart_abandoned').success).toBe(false)
  })
})
