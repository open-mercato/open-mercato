import {
  getExpoChannelAdapter,
  setExpoClientFactory,
  type ExpoClientLike,
  type ExpoPushReceipt,
  type ExpoPushTicket,
} from '../adapter'
import type { SendMessageInput } from '@open-mercato/core/modules/communication_channels/lib/adapter'

function buildInput(overrides?: Partial<SendMessageInput>): SendMessageInput {
  return {
    content: {
      text: 'Body text',
      bodyFormat: 'text',
      raw: { title: 'Hello', body: 'Body text', data: { type: 'orders.shipped', notificationId: 'n1' } },
    },
    credentials: {},
    scope: { tenantId: 't1', organizationId: 'o1' },
    metadata: { pushToken: 'ExponentPushToken[abc]', platform: 'ios' },
    ...overrides,
  }
}

function buildClient(ticket: ExpoPushTicket, validToken = true): { client: ExpoClientLike; send: jest.Mock } {
  const send = jest.fn(async () => [ticket])
  const client: ExpoClientLike = { isExpoPushToken: () => validToken, send, getReceipts: async () => ({}) }
  return { client, send }
}

function buildReceiptClient(receipts: Record<string, ExpoPushReceipt>): {
  client: ExpoClientLike
  getReceipts: jest.Mock
} {
  const getReceipts = jest.fn(async (ticketIds: string[]) => {
    const out: Record<string, ExpoPushReceipt> = {}
    for (const id of ticketIds) if (receipts[id]) out[id] = receipts[id]
    return out
  })
  const client: ExpoClientLike = { isExpoPushToken: () => true, send: jest.fn(async () => []), getReceipts }
  return { client, getReceipts }
}

afterEach(() => setExpoClientFactory(null))

describe('ExpoChannelAdapter', () => {
  it('sends a push and returns the ticket id', async () => {
    const { client, send } = buildClient({ status: 'ok', id: 'ticket-1' })
    setExpoClientFactory(() => client)

    const result = await getExpoChannelAdapter().sendMessage(buildInput())

    expect(result.status).toBe('sent')
    expect(result.externalMessageId).toBe('ticket-1')
    const messages = send.mock.calls[0][0]
    expect(messages[0]).toMatchObject({
      to: 'ExponentPushToken[abc]',
      title: 'Hello',
      body: 'Body text',
      sound: 'default',
    })
    expect(messages[0].data).toEqual({ type: 'orders.shipped', notificationId: 'n1' })
  })

  it('sends a data-only content-available message when silent', async () => {
    const { client, send } = buildClient({ status: 'ok', id: 'ticket-silent' })
    setExpoClientFactory(() => client)

    const result = await getExpoChannelAdapter().sendMessage(
      buildInput({
        content: { raw: { title: '', body: '', data: { type: 'sync.data.updated' }, silent: true } },
      }),
    )

    expect(result.status).toBe('sent')
    const message = send.mock.calls[0][0][0]
    expect(message).toEqual({ to: 'ExponentPushToken[abc]', data: { type: 'sync.data.updated' }, _contentAvailable: true })
    expect(message.title).toBeUndefined()
    expect(message.body).toBeUndefined()
  })

  it('applies push options (sound/badge/priority/channel/image/body)', async () => {
    const { client, send } = buildClient({ status: 'ok', id: 'ticket-opts' })
    setExpoClientFactory(() => client)

    await getExpoChannelAdapter().sendMessage(
      buildInput({
        content: {
          raw: {
            title: 'Hello',
            body: 'Body text',
            data: {},
            options: {
              sound: 'chime.caf',
              badge: 5,
              priority: 'high',
              channelId: 'orders',
              image: 'https://cdn/x.png',
              body: 'override body',
            },
          },
        },
      }),
    )

    expect(send.mock.calls[0][0][0]).toMatchObject({
      to: 'ExponentPushToken[abc]',
      title: 'Hello',
      body: 'override body',
      sound: 'chime.caf',
      badge: 5,
      priority: 'high',
      channelId: 'orders',
      richContent: { image: 'https://cdn/x.png' },
    })
  })

  it('fails fast when the push token is missing', async () => {
    const result = await getExpoChannelAdapter().sendMessage(buildInput({ metadata: { platform: 'ios' } }))
    expect(result.status).toBe('failed')
    expect(result.error).toBe('missing_push_token')
  })

  it('maps a malformed Expo token to the device_unregistered sentinel', async () => {
    const { client, send } = buildClient({ status: 'ok' }, false)
    setExpoClientFactory(() => client)

    const result = await getExpoChannelAdapter().sendMessage(buildInput())

    expect(result.status).toBe('failed')
    expect(result.error).toBe('device_unregistered')
    expect(result.metadata?.unregistered).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  it('maps a DeviceNotRegistered ticket to the device_unregistered sentinel', async () => {
    const { client } = buildClient({ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } })
    setExpoClientFactory(() => client)

    const result = await getExpoChannelAdapter().sendMessage(buildInput())

    expect(result.status).toBe('failed')
    expect(result.error).toBe('device_unregistered')
    expect(result.metadata?.unregistered).toBe(true)
  })

  it('treats other ticket errors as transient failures', async () => {
    const { client } = buildClient({ status: 'error', message: 'MessageRateExceeded', details: { error: 'MessageRateExceeded' } })
    setExpoClientFactory(() => client)

    const result = await getExpoChannelAdapter().sendMessage(buildInput())

    expect(result.status).toBe('failed')
    expect(result.error).toBe('MessageRateExceeded')
    expect(result.metadata?.unregistered).toBeUndefined()
  })
})

describe('ExpoChannelAdapter.checkReceipts', () => {
  it('flags a DeviceNotRegistered receipt as unregistered (the async "app uninstalled" case)', async () => {
    const { client, getReceipts } = buildReceiptClient({
      'ticket-dead': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    })
    setExpoClientFactory(() => client)

    const outcomes = await getExpoChannelAdapter().checkReceipts(['ticket-dead'], {})

    expect(getReceipts).toHaveBeenCalledWith(['ticket-dead'])
    expect(outcomes).toEqual([{ ticketId: 'ticket-dead', unregistered: true }])
  })

  it('resolves an ok receipt without killing the token', async () => {
    const { client } = buildReceiptClient({ 'ticket-ok': { status: 'ok' } })
    setExpoClientFactory(() => client)

    const outcomes = await getExpoChannelAdapter().checkReceipts(['ticket-ok'], {})

    expect(outcomes).toEqual([{ ticketId: 'ticket-ok', unregistered: false }])
  })

  it('treats MessageRateExceeded as transient (receipt resolved, token kept)', async () => {
    const { client } = buildReceiptClient({
      'ticket-rate': { status: 'error', details: { error: 'MessageRateExceeded' } },
    })
    setExpoClientFactory(() => client)

    const outcomes = await getExpoChannelAdapter().checkReceipts(['ticket-rate'], {})

    expect(outcomes).toEqual([{ ticketId: 'ticket-rate', unregistered: false }])
  })

  it('omits tickets whose receipt is not ready yet (re-checked on a later sweep)', async () => {
    const { client } = buildReceiptClient({
      'ticket-ready': { status: 'ok' },
    })
    setExpoClientFactory(() => client)

    const outcomes = await getExpoChannelAdapter().checkReceipts(['ticket-ready', 'ticket-pending'], {})

    expect(outcomes).toEqual([{ ticketId: 'ticket-ready', unregistered: false }])
  })

  it('short-circuits with no network call when there are no usable ticket ids', async () => {
    const { client, getReceipts } = buildReceiptClient({})
    setExpoClientFactory(() => client)

    const outcomes = await getExpoChannelAdapter().checkReceipts(['', ''], {})

    expect(outcomes).toEqual([])
    expect(getReceipts).not.toHaveBeenCalled()
  })
})
