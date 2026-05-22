import { checkoutSchema } from '../data/validators'

describe('checkoutSchema', () => {
  it('defaults allowPromotionCodes to true', () => {
    const parsed = checkoutSchema.parse({
      externalAccountId: 'acct_demo_001',
      subjectEntityType: 'customers:customer_company_profile',
      subjectEntityId: '9d22cd19-546e-4c8a-9718-89c815fc3aaf',
      priceCode: 'starter-monthly-v1',
      successUrl: 'https://app.example/success',
      cancelUrl: 'https://app.example/cancel',
    })

    expect(parsed.allowPromotionCodes).toBe(true)
  })
})
