import { GET as getOnboardingStatus } from '../modules/onboarding/api/get/onboarding/status'
import { GET as verifyOnboardingRequest } from '../modules/onboarding/api/get/onboarding/verify'

jest.mock('@open-mercato/onboarding/modules/onboarding/lib/consentClientIp', () => ({
  resolveConsentClientIp: jest.fn(),
}))

const originalSelfServiceOnboardingEnabled = process.env.SELF_SERVICE_ONBOARDING_ENABLED

describe('self-service onboarding route gate', () => {
  beforeEach(() => {
    process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'false'
  })

  afterAll(() => {
    if (originalSelfServiceOnboardingEnabled === undefined) {
      delete process.env.SELF_SERVICE_ONBOARDING_ENABLED
    } else {
      process.env.SELF_SERVICE_ONBOARDING_ENABLED = originalSelfServiceOnboardingEnabled
    }
  })

  it.each([
    ['verify', verifyOnboardingRequest, 'https://app.example.com/api/onboarding/onboarding/verify'],
    ['status', getOnboardingStatus, 'https://app.example.com/api/onboarding/onboarding/status'],
  ])('returns 404 from the %s route when self-service onboarding is disabled', async (_name, handler, url) => {
    const response = await handler(new Request(url))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Self-service onboarding is disabled.',
    })
  })
})
