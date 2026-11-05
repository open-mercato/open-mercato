import { getFcmChannelAdapter, setFcmMessagingFactory, type FcmMessagingFactory } from '../adapter'
import type { SendMessageInput } from '@open-mercato/core/modules/communication_channels/lib/adapter'

const serviceAccountJson = JSON.stringify({
  project_id: 'demo-project',
  client_email: 'svc@demo-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----\n',
})

function buildInput(overrides?: Partial<SendMessageInput>): SendMessageInput {
  return {
    content: {
      text: 'Body text',
      bodyFormat: 'text',
      raw: { title: 'Hello', body: 'Body text', data: { type: 'orders.shipped', notificationId: 'n1' } },
    },
    credentials: { serviceAccountJson },
    scope: { tenantId: 't1', organizationId: 'o1' },
    metadata: { pushToken: 'device-token-abc', platform: 'android' },
    ...overrides,
  }
}

afterEach(() => setFcmMessagingFactory(null))

describe('FcmChannelAdapter', () => {
  it('sends a notification and returns the provider message id', async () => {
    const send = jest.fn().mockResolvedValue('projects/demo/messages/123')
    const factory: FcmMessagingFactory = () => ({ send })
    setFcmMessagingFactory(factory)

    const result = await getFcmChannelAdapter().sendMessage(buildInput())

    expect(result.status).toBe('sent')
    expect(result.externalMessageId).toBe('projects/demo/messages/123')
    expect(send).toHaveBeenCalledTimes(1)
    const message = send.mock.calls[0][0]
    expect(message.token).toBe('device-token-abc')
    expect(message.notification).toEqual({ title: 'Hello', body: 'Body text' })
    expect(message.data).toEqual({ type: 'orders.shipped', notificationId: 'n1' })
  })

  it('sends a data-only content-available message when the envelope is silent', async () => {
    const send = jest.fn().mockResolvedValue('projects/demo/messages/silent')
    setFcmMessagingFactory(() => ({ send }))

    const result = await getFcmChannelAdapter().sendMessage(
      buildInput({
        content: { raw: { title: '', body: '', data: { type: 'sync.data.updated' }, silent: true } },
      }),
    )

    expect(result.status).toBe('sent')
    const message = send.mock.calls[0][0]
    expect(message.notification).toBeUndefined()
    expect(message.data).toEqual({ type: 'sync.data.updated' })
    expect(message.apns.payload.aps['content-available']).toBe(1)
    expect(message.apns.headers['apns-push-type']).toBe('background')
  })

  it('applies push options (sound/badge/image/priority/channel/body) to the native message', async () => {
    const send = jest.fn().mockResolvedValue('projects/demo/messages/opts')
    setFcmMessagingFactory(() => ({ send }))

    await getFcmChannelAdapter().sendMessage(
      buildInput({
        content: {
          raw: {
            title: 'Hello',
            body: 'Body text',
            data: {},
            options: {
              sound: 'chime.caf',
              badge: 3,
              image: 'https://cdn/x.png',
              priority: 'normal',
              channelId: 'orders',
              body: 'override body',
            },
          },
        },
      }),
    )

    const message = send.mock.calls[0][0]
    expect(message.notification).toEqual({ title: 'Hello', body: 'override body', imageUrl: 'https://cdn/x.png' })
    expect(message.android.priority).toBe('normal')
    expect(message.android.notification).toEqual({ sound: 'chime.caf', channelId: 'orders', imageUrl: 'https://cdn/x.png' })
    expect(message.apns.headers['apns-priority']).toBe('5')
    expect(message.apns.payload.aps).toEqual({ sound: 'chime.caf', badge: 3 })
  })

  it('fails fast when the push token is missing', async () => {
    const result = await getFcmChannelAdapter().sendMessage(buildInput({ metadata: { platform: 'android' } }))
    expect(result.status).toBe('failed')
    expect(result.error).toBe('missing_push_token')
  })

  it('rejects invalid credentials without attempting a send', async () => {
    const send = jest.fn()
    setFcmMessagingFactory(() => ({ send }))
    const result = await getFcmChannelAdapter().sendMessage(buildInput({ credentials: {} }))
    expect(result.status).toBe('failed')
    expect(result.error).toBe('invalid_fcm_credentials')
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ])('maps the permanent token error %s to the uniform device_unregistered sentinel', async (code) => {
    const send = jest.fn().mockRejectedValue(
      Object.assign(new Error('Requested entity was not found.'), { code }),
    )
    setFcmMessagingFactory(() => ({ send }))

    const result = await getFcmChannelAdapter().sendMessage(buildInput())

    expect(result.status).toBe('failed')
    expect(result.error).toBe('device_unregistered')
    expect(result.metadata?.unregistered).toBe(true)
  })

  it('treats messaging/invalid-argument as a transient failure, NOT device_unregistered', async () => {
    // invalid-argument fires for any malformed request field, not just a bad token — mapping it to
    // device_unregistered would let a payload bug soft-delete devices tenant-wide.
    const send = jest.fn().mockRejectedValue(
      Object.assign(new Error('Invalid value at data.foo'), { code: 'messaging/invalid-argument' }),
    )
    setFcmMessagingFactory(() => ({ send }))

    const result = await getFcmChannelAdapter().sendMessage(buildInput())

    expect(result.status).toBe('failed')
    expect(result.error).not.toBe('device_unregistered')
    expect(result.metadata?.unregistered).toBeUndefined()
  })

  it('preserves the real error message when the messaging factory throws (transient init faults must not masquerade as bad credentials)', async () => {
    setFcmMessagingFactory(() => {
      throw new Error('failed to initialize firebase-admin app')
    })
    const result = await getFcmChannelAdapter().sendMessage(buildInput())
    expect(result.status).toBe('failed')
    expect(result.error).toBe('failed to initialize firebase-admin app')
  })

  it('validateCredentials accepts a well-formed service account', async () => {
    const result = await getFcmChannelAdapter().validateCredentials({ credentials: { serviceAccountJson } })
    expect(result.ok).toBe(true)
  })

  it('validateCredentials rejects malformed credentials with a populated errors map', async () => {
    const result = await getFcmChannelAdapter().validateCredentials({ credentials: {} })
    expect(result.ok).toBe(false)
    expect(result.errors && Object.keys(result.errors).length).toBeGreaterThan(0)
  })

  it('treats other errors as transient (retryable) failures', async () => {
    const send = jest.fn().mockRejectedValue(
      Object.assign(new Error('temporarily unavailable'), { code: 'messaging/server-unavailable' }),
    )
    setFcmMessagingFactory(() => ({ send }))

    const result = await getFcmChannelAdapter().sendMessage(buildInput())

    expect(result.status).toBe('failed')
    expect(result.error).toBe('temporarily unavailable')
    expect(result.metadata?.unregistered).toBeUndefined()
  })

  it('convertOutbound passes the body through unchanged', async () => {
    const converted = await getFcmChannelAdapter().convertOutbound({ body: 'Hi', bodyFormat: 'text' })
    expect(converted.content).toEqual({ text: 'Hi', bodyFormat: 'text' })
  })
})
