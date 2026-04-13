import { onboardingStartSchema, onboardingVerifySchema } from '../modules/onboarding/data/validators'

function makeValidStartPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: 'user@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    organizationName: 'Acme Corp',
    password: 'Secret1!',
    confirmPassword: 'Secret1!',
    termsAccepted: true as const,
    ...overrides,
  }
}

describe('onboardingStartSchema', () => {
  it('accepts a valid onboarding payload', () => {
    const result = onboardingStartSchema.safeParse(makeValidStartPayload())
    expect(result.success).toBe(true)
  })

  it('defaults marketingConsent to false when omitted', () => {
    const result = onboardingStartSchema.safeParse(makeValidStartPayload())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.marketingConsent).toBe(false)
    }
  })

  it('rejects an invalid email', () => {
    const result = onboardingStartSchema.safeParse(makeValidStartPayload({ email: 'not-an-email' }))
    expect(result.success).toBe(false)
  })

  it('rejects mismatching passwords', () => {
    const result = onboardingStartSchema.safeParse(
      makeValidStartPayload({ password: 'Secret1!', confirmPassword: 'Different1!' }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects when termsAccepted is false', () => {
    const result = onboardingStartSchema.safeParse(makeValidStartPayload({ termsAccepted: false }))
    expect(result.success).toBe(false)
  })
})

describe('onboardingVerifySchema', () => {
  it('accepts a valid token of 32+ characters', () => {
    const token = 'a'.repeat(64)
    const result = onboardingVerifySchema.safeParse({ token })
    expect(result.success).toBe(true)
  })

  it('rejects a token shorter than 32 characters', () => {
    const token = 'c'.repeat(31)
    const result = onboardingVerifySchema.safeParse({ token })
    expect(result.success).toBe(false)
  })

  it('rejects a missing token', () => {
    const result = onboardingVerifySchema.safeParse({})
    expect(result.success).toBe(false)
  })
})
