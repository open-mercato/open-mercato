/** @jest-environment node */

const sendAsUserMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: '33333333-3333-4333-8333-333333333333',
    tenantId: '11111111-1111-4111-8111-111111111111',
    orgId: '22222222-2222-4222-8222-222222222222',
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: () => null })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => `translated:${key}` }),
}))

jest.mock('../../../../lib/route-mutation-guard', () => ({
  validateRouteMutationGuard: jest.fn(async () => ({ afterSuccess: jest.fn(async () => undefined) })),
}))

jest.mock('../../../../lib/send-as-user', () => ({
  ...jest.requireActual('../../../../lib/send-as-user'),
  sendAsUser: (...args: unknown[]) => sendAsUserMock(...args),
}))

import { POST } from '../route'

function post(body: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/communication_channels/send-as-user', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userChannelId: '44444444-4444-4444-8444-444444444444',
      subject: 'Hello',
      body: { plain: 'Hi' },
      ...body,
    }),
  }))
}

describe('POST /communication_channels/send-as-user — sendSeparately', () => {
  beforeEach(() => {
    sendAsUserMock.mockReset()
    sendAsUserMock.mockResolvedValue({ ok: true, messageId: 'm-1', threadId: 't-1', channelId: 'c-1', providerKey: 'imap' })
  })

  it('rejects separate sending to several recipients with cc and bcc as 400 with field errors', async () => {
    const response = await post({
      to: ['a@example.com', 'b@example.com'],
      cc: ['c@example.com'],
      bcc: ['d@example.com'],
      sendSeparately: true,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'translated:messages.errors.sendSeparatelyWithCopies',
      fieldErrors: {
        cc: 'translated:messages.errors.sendSeparatelyWithCopies',
        bcc: 'translated:messages.errors.sendSeparatelyWithCopies',
      },
    })
    expect(sendAsUserMock).not.toHaveBeenCalled()
  })

  it('accepts separate sending to several recipients without copies', async () => {
    const response = await post({ to: ['a@example.com', 'b@example.com'], sendSeparately: true })

    expect(response.status).toBe(202)
    expect(sendAsUserMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ to: ['a@example.com', 'b@example.com'], sendSeparately: true }),
    )
  })

  it('accepts cc with separate sending to a single recipient', async () => {
    const response = await post({ to: ['a@example.com'], cc: ['c@example.com'], sendSeparately: true })

    expect(response.status).toBe(202)
  })

  it('keeps 422 for other invalid bodies', async () => {
    const response = await post({ to: [] })

    expect(response.status).toBe(422)
  })
})

describe('POST /communication_channels/send-as-user — existing message', () => {
  beforeEach(() => {
    sendAsUserMock.mockReset()
  })

  function postExisting(body: Record<string, unknown>) {
    return POST(new Request('http://localhost/api/communication_channels/send-as-user', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userChannelId: '44444444-4444-4444-8444-444444444444', ...body }),
    }))
  }

  it('accepts messageId without recipients, subject or body', async () => {
    sendAsUserMock.mockResolvedValue({ ok: true, messageId: '55555555-5555-4555-8555-555555555555', threadId: 't-1', channelId: 'c-1', providerKey: 'imap' })

    const response = await postExisting({ messageId: '55555555-5555-4555-8555-555555555555' })

    expect(response.status).toBe(202)
    expect(sendAsUserMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { userChannelId: '44444444-4444-4444-8444-444444444444', messageId: '55555555-5555-4555-8555-555555555555' },
    )
  })

  it('answers 409 when the message is already linked', async () => {
    sendAsUserMock.mockResolvedValue({ ok: false, status: 409, error: 'Message is already linked to a channel delivery', code: 'already_linked' })

    const response = await postExisting({ messageId: '55555555-5555-4555-8555-555555555555' })

    expect(response.status).toBe(409)
  })
})
