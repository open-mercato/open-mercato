/** @jest-environment node */

const mockVerify = jest.fn()

jest.mock('../../../../../lib/gmail-pubsub-jwt', () => ({
  decodeGmailPubSubBody: jest.fn(),
  getGmailPubSubVerifier: jest.fn(() => ({ verify: mockVerify })),
  GmailPubSubJwtError: class GmailPubSubJwtError extends Error {},
}))

import { POST } from '../route'

describe('POST /api/communication_channels/webhooks/gmail', () => {
  const originalAudience = process.env.OM_GMAIL_PUBSUB_AUDIENCE
  const originalEmail = process.env.OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OM_GMAIL_PUBSUB_AUDIENCE = 'https://app.example/api/communication_channels/webhooks/gmail'
    process.env.OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL = 'gmail-push@example.iam.gserviceaccount.com'
  })

  afterAll(() => {
    if (originalAudience === undefined) delete process.env.OM_GMAIL_PUBSUB_AUDIENCE
    else process.env.OM_GMAIL_PUBSUB_AUDIENCE = originalAudience
    if (originalEmail === undefined) delete process.env.OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL
    else process.env.OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL = originalEmail
  })

  it('rejects an oversized declared body before JWT verification', async () => {
    const request = new Request('http://localhost/api/communication_channels/webhooks/gmail', {
      method: 'POST',
      headers: { 'content-length': String(1024 * 1024 + 1) },
      body: '{}',
    })

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(mockVerify).not.toHaveBeenCalled()
  })
})
