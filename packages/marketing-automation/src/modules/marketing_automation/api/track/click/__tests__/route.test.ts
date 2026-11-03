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

function clickToken(target: string): string {
  return signTrackingToken({ tenantId, organizationId, campaignId, runId, stepId, purpose: 'click', target }, secret)
}

function urlWithToken(token: string | null): string {
  const url = new URL('http://localhost/api/marketing_automation/track/click')
  if (token) url.searchParams.set(TRACKING_TOKEN_PARAM, token)
  return url.toString()
}

describe('marketing_automation click redirect route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('records the click and redirects to the signed destination', async () => {
    const response = await GET(new Request(urlWithToken(clickToken('https://shop.example/sale'))))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://shop.example/sale')
    expect(recordTrackingEventMock).toHaveBeenCalledTimes(1)
    expect(recordTrackingEventMock.mock.calls[0][2]).toMatchObject({ type: 'clicked', linkUrl: 'https://shop.example/sale' })
  })

  it('answers 404 rather than redirecting on an unsigned or malformed token', async () => {
    const response = await GET(new Request(urlWithToken('not-a-real-token')))

    expect(response.status).toBe(404)
    expect(recordTrackingEventMock).not.toHaveBeenCalled()
  })

  it('refuses to redirect to a target that was signed but is not http(s) (open-redirect guard)', async () => {
    const response = await GET(new Request(urlWithToken(clickToken('javascript:alert(1)'))))

    expect(response.status).toBe(404)
    expect(recordTrackingEventMock).not.toHaveBeenCalled()
  })
})
