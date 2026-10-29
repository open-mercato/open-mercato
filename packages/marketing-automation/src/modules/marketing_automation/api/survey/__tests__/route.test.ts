/** @jest-environment node */

process.env.OM_MARKETING_TRACKING_SECRET = 'route-test-secret-not-a-published-placeholder'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const campaignId = '66666666-6666-4666-8666-666666666666'
const runId = '77777777-7777-4777-8777-777777777777'
const stepId = '88888888-8888-4888-8888-888888888888'

const recordSurveyAnswerMock = jest.fn()

const container = { resolve: jest.fn(() => undefined) }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars ? Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), fallback) : fallback,
  })),
}))

jest.mock('../../../lib/survey.js', () => {
  const actual = jest.requireActual('../../../lib/survey.js')
  return { ...actual, recordSurveyAnswer: (...a: unknown[]) => recordSurveyAnswerMock(...a) }
})

import { signTrackingToken } from '../../../lib/tracking/token'
import { TRACKING_TOKEN_PARAM } from '../../../lib/tracking/urls'
import { GET, POST } from '../route'

const secret = process.env.OM_MARKETING_TRACKING_SECRET!

function surveyToken(score: number): string {
  return signTrackingToken(
    { tenantId, organizationId, campaignId, runId, stepId, purpose: 'survey', target: String(score) },
    secret,
  )
}

function urlWithToken(token: string | null): string {
  const url = new URL('http://localhost/api/marketing_automation/survey')
  if (token) url.searchParams.set(TRACKING_TOKEN_PARAM, token)
  return url.toString()
}

describe('marketing_automation survey answer route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    recordSurveyAnswerMock.mockResolvedValue('recorded')
  })

  it('GET shows the score carried in the token and records nothing', async () => {
    const response = await GET(new Request(urlWithToken(surveyToken(9))))

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('9')
    expect(recordSurveyAnswerMock).not.toHaveBeenCalled()
  })

  it('GET answers 400 on a missing or unusable token', async () => {
    const response = await GET(new Request(urlWithToken(null)))
    expect(response.status).toBe(400)
  })

  it('POST records the score and the comment for a valid token', async () => {
    const response = await POST(
      new Request(urlWithToken(surveyToken(7)), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'Great, thanks' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(recordSurveyAnswerMock).toHaveBeenCalledTimes(1)
    expect(recordSurveyAnswerMock.mock.calls[0][1]).toMatchObject({ score: 7, comment: 'Great, thanks', runId, stepId })
  })

  /**
   * The regression test for the ordering bug: POST used to parse the body before verifying the
   * token, so an unauthenticated caller could make the route do the work of reading and parsing a
   * body it was about to discard. The token check must happen FIRST — proven here by a request
   * whose body-reading methods throw if they are ever called.
   */
  it('POST checks the token before it ever reads the body', async () => {
    const unreadableBody = {
      url: urlWithToken('not-a-real-token'),
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: jest.fn(() => {
        throw new Error('body must not be read before the token is verified')
      }),
      formData: jest.fn(() => {
        throw new Error('body must not be read before the token is verified')
      }),
    } as unknown as Request

    const response = await POST(unreadableBody)

    expect(response.status).toBe(400)
    expect((unreadableBody as { json: jest.Mock }).json).not.toHaveBeenCalled()
    expect((unreadableBody as { formData: jest.Mock }).formData).not.toHaveBeenCalled()
    expect(recordSurveyAnswerMock).not.toHaveBeenCalled()
  })
})
