jest.mock('../markdownEmailBody', () => ({
  renderMarkdownEmailBody: jest.fn(async (body: string) => `<rendered>${body}</rendered>`),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

import { renderMarkdownEmailBody } from '../markdownEmailBody'
import {
  buildSenderBody,
  COMPOSE_SENDER_FIELD,
  delegateComposeToSender,
  requiresSenderDelegation,
} from '../composeSenderDelegation'

const CHANNEL_ID = '22222222-2222-2222-2222-222222222222'

const actor = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  auth: { sub: 'user-1' },
}

const publicCompose = {
  senderChannelId: CHANNEL_ID,
  visibility: 'public',
  externalEmail: 'client@example.com',
  subject: 'Quote',
  body: 'Here it is',
  isDraft: false,
}

function containerWith(sendAsUser: unknown) {
  return {
    resolve: <T>(name: string): T => {
      if (name === 'communicationChannelsSendAsUser') return sendAsUser as T
      throw new Error(`[internal] unexpected resolve: ${name}`)
    },
  }
}

const emptyContainer = {
  resolve: <T>(): T => {
    throw new Error('[internal] communication_channels is not registered')
  },
}

describe('buildSenderBody', () => {
  beforeEach(() => {
    ;(renderMarkdownEmailBody as jest.Mock).mockClear()
  })

  it('leaves a text body as plain text only', async () => {
    await expect(buildSenderBody('Plain words', 'text')).resolves.toEqual({
      plain: 'Plain words',
      bodyFormat: 'text',
    })
    expect(renderMarkdownEmailBody).not.toHaveBeenCalled()
  })

  it('keeps the markdown source as the plain alternative beside rendered html, tagged as markdown', async () => {
    const body = await buildSenderBody('# Heading', 'markdown')

    expect(renderMarkdownEmailBody).toHaveBeenCalledWith('# Heading')
    expect(body.plain).toBe('# Heading')
    expect(body.html).toBe('<rendered># Heading</rendered>')
    expect(body.bodyFormat).toBe('markdown')
  })

  it('does not render an empty markdown body', async () => {
    await expect(buildSenderBody('   ', 'markdown')).resolves.toEqual({
      plain: '   ',
      bodyFormat: 'markdown',
    })
    expect(renderMarkdownEmailBody).not.toHaveBeenCalled()
  })
})

describe('requiresSenderDelegation', () => {
  it('is false without a chosen sender', () => {
    expect(requiresSenderDelegation({ visibility: 'public' })).toBe(false)
  })

  it('is false for a draft, which is never delivered', () => {
    expect(requiresSenderDelegation({ senderChannelId: CHANNEL_ID, isDraft: true })).toBe(false)
  })

  it('is true for a real send through a chosen mailbox', () => {
    expect(requiresSenderDelegation({ senderChannelId: CHANNEL_ID, isDraft: false })).toBe(true)
  })
})

describe('delegateComposeToSender', () => {
  it('forwards the compose to the send-as-user facade', async () => {
    const sendAsUser = jest.fn().mockResolvedValue({
      ok: true,
      messageId: 'message-1',
      threadId: 'thread-1',
      channelId: CHANNEL_ID,
      providerKey: 'imap',
    })

    const result = await delegateComposeToSender(containerWith(sendAsUser), actor, publicCompose)

    expect(result).toEqual({ ok: true, messageId: 'message-1', threadId: 'thread-1' })
    expect(sendAsUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }),
      expect.objectContaining({
        userChannelId: CHANNEL_ID,
        to: ['client@example.com'],
        subject: 'Quote',
        body: { plain: 'Here it is', bodyFormat: 'text' },
      }),
    )
  })

  it('renders a markdown body to html so the client is not sent raw markup', async () => {
    const sendAsUser = jest.fn().mockResolvedValue({
      ok: true,
      messageId: 'message-1',
      threadId: 'thread-1',
      channelId: CHANNEL_ID,
      providerKey: 'imap',
    })

    await delegateComposeToSender(containerWith(sendAsUser), actor, {
      ...publicCompose,
      body: '**bold** and a [link](https://example.com)',
      bodyFormat: 'markdown',
    })

    const sentBody = sendAsUser.mock.calls[0][2].body as {
      plain?: string
      html?: string
      bodyFormat?: string
    }
    expect(sentBody.plain).toBe('**bold** and a [link](https://example.com)')
    expect(sentBody.html).toBe('<rendered>**bold** and a [link](https://example.com)</rendered>')
    expect(sentBody.bodyFormat).toBe('markdown')
  })

  it('surfaces the facade 422 field errors on the composer sender field', async () => {
    const sendAsUser = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      error: 'This channel needs reconnection before it can send messages.',
      fieldErrors: { channelId: 'This channel needs reconnection before it can send messages.' },
    })

    const result = await delegateComposeToSender(containerWith(sendAsUser), actor, publicCompose)

    expect(result).toEqual({
      ok: false,
      status: 422,
      error: 'This channel needs reconnection before it can send messages.',
      fieldErrors: {
        [COMPOSE_SENDER_FIELD]: 'This channel needs reconnection before it can send messages.',
      },
    })
  })

  it('surfaces a facade 409 that carries no field errors', async () => {
    const sendAsUser = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      error: "Channel is in status 'connecting' (not connected)",
    })

    const result = await delegateComposeToSender(containerWith(sendAsUser), actor, publicCompose)

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({
      status: 409,
      fieldErrors: { [COMPOSE_SENDER_FIELD]: "Channel is in status 'connecting' (not connected)" },
    })
  })

  it('refuses an internal-visibility compose', async () => {
    const sendAsUser = jest.fn()

    const result = await delegateComposeToSender(containerWith(sendAsUser), actor, {
      ...publicCompose,
      visibility: 'internal',
      externalEmail: undefined,
    })

    expect(result).toMatchObject({ ok: false, status: 422 })
    expect(sendAsUser).not.toHaveBeenCalled()
  })

  it('refuses a payload the facade cannot carry instead of dropping it', async () => {
    const sendAsUser = jest.fn()

    const withAttachments = await delegateComposeToSender(containerWith(sendAsUser), actor, {
      ...publicCompose,
      attachmentIds: ['33333333-3333-3333-3333-333333333333'],
    })
    const withObjects = await delegateComposeToSender(containerWith(sendAsUser), actor, {
      ...publicCompose,
      objects: [{ entityModule: 'sales', entityType: 'order', entityId: 'order-1' }],
    })

    expect(withAttachments).toMatchObject({ ok: false, status: 422 })
    expect(withObjects).toMatchObject({ ok: false, status: 422 })
    expect(sendAsUser).not.toHaveBeenCalled()
  })

  it('degrades to a field error when communication_channels is absent', async () => {
    const result = await delegateComposeToSender(emptyContainer, actor, publicCompose)

    expect(result).toMatchObject({
      ok: false,
      status: 422,
      fieldErrors: { [COMPOSE_SENDER_FIELD]: 'Sending from your own mailbox is not available.' },
    })
  })
})
