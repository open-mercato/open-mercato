/** @jest-environment node */

process.env.OM_MARKETING_TRACKING_SECRET = 'route-test-secret-not-a-published-placeholder'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const campaignId = '66666666-6666-4666-8666-666666666666'
const runId = '77777777-7777-4777-8777-777777777777'
const stepId = '88888888-8888-4888-8888-888888888888'

const recordTrackingEventMock = jest.fn()
const container = { resolve: jest.fn(() => undefined) }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('../../../../lib/tracking/record.js', () => ({
  recordTrackingEvent: (...a: unknown[]) => recordTrackingEventMock(...a),
}))

import { signTrackingToken } from '../../../../lib/tracking/token'
import { TRACKING_TOKEN_PARAM } from '../../../../lib/tracking/urls'
import { GET } from '../route'

const secret = process.env.OM_MARKETING_TRACKING_SECRET!

function openToken(): string {
  return signTrackingToken({ tenantId, organizationId, campaignId, runId, stepId, purpose: 'open' }, secret)
}

function urlWithToken(token: string | null): string {
  const url = new URL('http://localhost/api/marketing_automation/track/open')
  if (token) url.searchParams.set(TRACKING_TOKEN_PARAM, token)
  return url.toString()
}

describe('marketing_automation open pixel route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('records the open and always answers with the pixel', async () => {
    const response = await GET(new Request(urlWithToken(openToken())))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/gif')
    expect(recordTrackingEventMock).toHaveBeenCalledTimes(1)
    expect(recordTrackingEventMock.mock.calls[0][2]).toMatchObject({ type: 'opened' })
  })

  it('still answers with the pixel on a missing or invalid token, and records nothing', async () => {
    const response = await GET(new Request(urlWithToken(null)))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/gif')
    expect(recordTrackingEventMock).not.toHaveBeenCalled()
  })
})
