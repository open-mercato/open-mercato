import {
  availabilityPolicyCreateSchema,
  availabilityPolicyMergedConstraintsSchema,
  AVAILABILITY_POLICY_VARIANT_REQUIRES_PRODUCT_MESSAGE_KEY,
  AVAILABILITY_POLICY_BACKORDER_REQUIRES_LEAD_TIME_MESSAGE_KEY,
  AVAILABILITY_POLICY_MAX_BELOW_MIN_MESSAGE_KEY,
} from '../validators'

const baseInput = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
}

describe('availabilityPolicyCreateSchema', () => {
  it('accepts a store-level default row (no product, no variant)', () => {
    const result = availabilityPolicyCreateSchema.safeParse(baseInput)
    expect(result.success).toBe(true)
  })

  it('rejects a variantId without a productId', () => {
    const result = availabilityPolicyCreateSchema.safeParse({
      ...baseInput,
      variantId: '33333333-3333-4333-8333-333333333333',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(AVAILABILITY_POLICY_VARIANT_REQUIRES_PRODUCT_MESSAGE_KEY)
    }
  })

  it('accepts a variantId with a productId', () => {
    const result = availabilityPolicyCreateSchema.safeParse({
      ...baseInput,
      productId: '44444444-4444-4444-8444-444444444444',
      variantId: '33333333-3333-4333-8333-333333333333',
    })
    expect(result.success).toBe(true)
  })

  it('rejects allowBackorder without backorderLeadTimeDays', () => {
    const result = availabilityPolicyCreateSchema.safeParse({ ...baseInput, allowBackorder: true })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(AVAILABILITY_POLICY_BACKORDER_REQUIRES_LEAD_TIME_MESSAGE_KEY)
    }
  })

  it('accepts allowBackorder with backorderLeadTimeDays', () => {
    const result = availabilityPolicyCreateSchema.safeParse({
      ...baseInput,
      allowBackorder: true,
      backorderLeadTimeDays: 5,
    })
    expect(result.success).toBe(true)
  })

  it('rejects maxOrderQuantity below minOrderQuantity', () => {
    const result = availabilityPolicyCreateSchema.safeParse({
      ...baseInput,
      minOrderQuantity: 10,
      maxOrderQuantity: 5,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(AVAILABILITY_POLICY_MAX_BELOW_MIN_MESSAGE_KEY)
    }
  })

  it('rejects negative quantities', () => {
    const result = availabilityPolicyCreateSchema.safeParse({ ...baseInput, minOrderQuantity: -1 })
    expect(result.success).toBe(false)
  })
})

describe('availabilityPolicyMergedConstraintsSchema', () => {
  it('re-validates the same constraints against a merged record', () => {
    const result = availabilityPolicyMergedConstraintsSchema.safeParse({ variantId: '33333333-3333-4333-8333-333333333333' })
    expect(result.success).toBe(false)
  })

  it('passes when the merged record satisfies every constraint', () => {
    const result = availabilityPolicyMergedConstraintsSchema.safeParse({
      productId: '44444444-4444-4444-8444-444444444444',
      variantId: '33333333-3333-4333-8333-333333333333',
      allowBackorder: true,
      backorderLeadTimeDays: 3,
      minOrderQuantity: 1,
      maxOrderQuantity: 10,
    })
    expect(result.success).toBe(true)
  })
})
