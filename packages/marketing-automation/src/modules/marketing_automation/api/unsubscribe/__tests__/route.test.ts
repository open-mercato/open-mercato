/** @jest-environment node */

process.env.OM_MARKETING_TRACKING_SECRET = 'route-test-secret-not-a-published-placeholder'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const campaignId = '66666666-6666-4666-8666-666666666666'
const runId = '77777777-7777-4777-8777-777777777777'
const stepId = '88888888-8888-4888-8888-888888888888'
const subjectEntityId = '99999999-9999-4999-8999-999999999999'

const findOneMock = jest.fn()
const recordConsentMock = jest.fn()
const container = { resolve: jest.fn((name: string) => (name === 'em' ? { findOne: findOneMock } : undefined)) }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ locale: 'en', t: (_key: string, fallback: string) => fallback })),
}))

jest.mock('../../../lib/consent.js', () => ({ recordConsent: (...a: unknown[]) => recordConsentMock(...a) }))
jest.mock('../../../data/entities.js', () => ({ MarketingCampaignRun: class {} }))

import { signTrackingToken } from '../../../lib/tracking/token'
import { TRACKING_TOKEN_PARAM } from '../../../lib/tracking/urls'
import { GET, POST } from '../route'

const secret = process.env.OM_MARKETING_TRACKING_SECRET!

function unsubscribeToken(): string {
  return signTrackingToken({ tenantId, organizationId, campaignId, runId, stepId, purpose: 'unsubscribe' }, secret)
}

function urlWithToken(token: string | null): string {
  const url = new URL('http://localhost/api/marketing_automation/unsubscribe')
  if (token) url.searchParams.set(TRACKING_TOKEN_PARAM, token)
  return url.toString()
}

describe('marketing_automation one-click unsubscribe route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findOneMock.mockResolvedValue({ subjectEntityId })
  })

  it('GET asks for confirmation and changes nothing', async () => {
    const response = await GET(new Request(urlWithToken(unsubscribeToken())))

    expect(response.status).toBe(200)
    expect(recordConsentMock).not.toHaveBeenCalled()
  })

  it('GET answers 400 on an unusable token', async () => {
    const response = await GET(new Request(urlWithToken(null)))
    expect(response.status).toBe(400)
  })

  it('POST records the opt-out for the subject behind the run, never from the request', async () => {
    const response = await POST(new Request(urlWithToken(unsubscribeToken()), { method: 'POST' }))

    expect(response.status).toBe(200)
    expect(recordConsentMock).toHaveBeenCalledTimes(1)
    expect(recordConsentMock.mock.calls[0][1]).toMatchObject({ subjectEntityId, state: 'unsubscribed', source: 'customer' })
  })

  it('POST answers 404 when the run behind the token is gone, and records nothing', async () => {
    findOneMock.mockResolvedValue(null)

    const response = await POST(new Request(urlWithToken(unsubscribeToken()), { method: 'POST' }))

    expect(response.status).toBe(404)
    expect(recordConsentMock).not.toHaveBeenCalled()
  })
})
