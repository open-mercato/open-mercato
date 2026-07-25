jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

import { metadata, openApi } from '../modules/onboarding/api/post/onboarding'

describe('onboarding submission rate limiting', () => {
  it('declares an IP rate limit so the API dispatcher throttles unauthenticated submissions', () => {
    expect(metadata.POST.requireAuth).toBe(false)
    expect(metadata.POST.rateLimit).toEqual({
      points: 10,
      duration: 60,
      blockDuration: 60,
      keyPrefix: 'onboarding',
    })
  })

  it('documents the 429 response in the OpenAPI doc', () => {
    const errors = openApi.methods?.POST?.errors ?? []
    expect(errors.some((entry) => entry.status === 429)).toBe(true)
  })
})
