import { OnboardingRequest } from '../modules/onboarding/data/entities'

describe('OnboardingRequest entity', () => {
  it('can be instantiated', () => {
    const request = new OnboardingRequest()
    expect(request).toBeInstanceOf(OnboardingRequest)
  })

  it('defaults status to pending', () => {
    const request = new OnboardingRequest()
    expect(request.status).toBe('pending')
  })

  it('defaults termsAccepted to false', () => {
    const request = new OnboardingRequest()
    expect(request.termsAccepted).toBe(false)
  })

  it('defaults marketingConsent to false', () => {
    const request = new OnboardingRequest()
    expect(request.marketingConsent).toBe(false)
  })

  it('defaults createdAt to a Date instance', () => {
    const before = Date.now()
    const request = new OnboardingRequest()
    const after = Date.now()
    expect(request.createdAt).toBeInstanceOf(Date)
    expect(request.createdAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(request.createdAt.getTime()).toBeLessThanOrEqual(after)
  })

  it('has nullable fields set to undefined by default', () => {
    const request = new OnboardingRequest()
    expect(request.completedAt).toBeUndefined()
    expect(request.tenantId).toBeUndefined()
    expect(request.organizationId).toBeUndefined()
    expect(request.userId).toBeUndefined()
    expect(request.processingStartedAt).toBeUndefined()
    expect(request.deletedAt).toBeUndefined()
    expect(request.lastEmailSentAt).toBeUndefined()
    expect(request.preparationCompletedAt).toBeUndefined()
    expect(request.readyEmailSentAt).toBeUndefined()
  })

  it('allows setting and reading all properties', () => {
    const request = new OnboardingRequest()
    const now = new Date()
    request.email = 'test@example.com'
    request.tokenHash = 'abc123'
    request.status = 'completed'
    request.firstName = 'Alice'
    request.lastName = 'Smith'
    request.organizationName = 'TestOrg'
    request.locale = 'de'
    request.termsAccepted = true
    request.marketingConsent = true
    request.passwordHash = 'hashed'
    request.expiresAt = now
    request.completedAt = now
    request.tenantId = 'tid'
    request.organizationId = 'oid'
    request.userId = 'uid'
    request.processingStartedAt = now
    request.lastEmailSentAt = now
    request.preparationCompletedAt = now
    request.readyEmailSentAt = now
    request.deletedAt = now
    expect(request.email).toBe('test@example.com')
    expect(request.status).toBe('completed')
    expect(request.firstName).toBe('Alice')
    expect(request.completedAt).toBe(now)
  })

  it('allows setting passwordHash to null for security cleanup', () => {
    const request = new OnboardingRequest()
    request.passwordHash = 'secret'
    expect(request.passwordHash).toBe('secret')
    request.passwordHash = null
    expect(request.passwordHash).toBeNull()
  })

  it('supports all valid OnboardingStatus values', () => {
    const request = new OnboardingRequest()
    const statuses = ['pending', 'processing', 'completed', 'expired'] as const
    for (const status of statuses) {
      request.status = status
      expect(request.status).toBe(status)
    }
  })
})
