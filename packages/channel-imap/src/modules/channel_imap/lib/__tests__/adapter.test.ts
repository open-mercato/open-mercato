import {
  setImapClient,
  type ImapClient,
} from '../imap-client'
import {
  setSmtpClient,
  type SmtpClient,
} from '../smtp-client'
import { getImapChannelAdapter } from '../adapter'
import { imapCapabilities } from '../capabilities'

const credentials = {
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapTls: 'tls',
  imapUser: 'alice@example.com',
  imapPassword: 'secret',
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpTls: 'tls',
  smtpUser: 'alice@example.com',
  smtpPassword: 'secret',
  fromAddress: 'alice@example.com',
}

function buildSimpleMime(messageId: string, body: string): Buffer {
  return Buffer.from(
    [
      `Message-ID: <${messageId}>`,
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: Hello',
      'Date: Wed, 21 May 2026 10:00:00 +0000',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n'),
    'utf-8',
  )
}

afterEach(() => {
  setImapClient(null)
  setSmtpClient(null)
})

describe('ImapChannelAdapter wiring', () => {
  it('exposes the right providerKey, channelType, and capabilities', () => {
    const adapter = getImapChannelAdapter()
    expect(adapter.providerKey).toBe('imap')
    expect(adapter.channelType).toBe('email')
    expect(adapter.capabilities).toBe(imapCapabilities)
    expect(adapter.capabilities.realtimePush).toBe(false)
    expect(adapter.capabilities.reactions).toBe(false)
    expect(adapter.capabilities.threading).toBe(true)
  })

  it('exports the required optional methods (validateCredentials, fetchHistory, resolveContact)', () => {
    const adapter = getImapChannelAdapter()
    expect(typeof adapter.validateCredentials).toBe('function')
    expect(typeof adapter.fetchHistory).toBe('function')
    expect(typeof adapter.resolveContact).toBe('function')
    expect(adapter.refreshCredentials).toBeUndefined()
    expect(adapter.sendReaction).toBeUndefined()
    expect(adapter.removeReaction).toBeUndefined()
    expect(adapter.editMessage).toBeUndefined()
    expect(adapter.deleteMessage).toBeUndefined()
  })
})

describe('ImapChannelAdapter.sendMessage', () => {
  it('sends via SMTP and best-effort appends to Sent', async () => {
    const sendCalls: Array<Record<string, unknown>> = []
    const appendCalls: Array<{ raw: Buffer }> = []
    const smtp: SmtpClient = {
      verify: async () => undefined,
      send: async (_options, message) => {
        sendCalls.push(message as unknown as Record<string, unknown>)
        return { messageId: '<outbound@example.com>', raw: Buffer.from('RAW'), response: '250 OK' }
      },
    }
    const imap: ImapClient = {
      connectAndValidate: async () => ({ capabilities: [] }),
      selectInbox: async () => ({}),
      fetchUidRange: async () => [],
      appendSent: async (_options, raw) => {
        appendCalls.push({ raw })
      },
    }
    setSmtpClient(smtp)
    setImapClient(imap)

    const adapter = getImapChannelAdapter()
    const result = await adapter.sendMessage({
      content: { html: '<p>Hi</p>', bodyFormat: 'html' },
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
      metadata: { subject: 'Hi', to: ['bob@example.com'], inReplyTo: '<thread@example.com>' },
    })
    expect(result.status).toBe('sent')
    expect(result.externalMessageId).toBe('<outbound@example.com>')
    expect(sendCalls).toHaveLength(1)
    expect(sendCalls[0].to).toEqual(['bob@example.com'])
    expect(sendCalls[0].subject).toBe('Hi')
    expect(sendCalls[0].inReplyTo).toBe('<thread@example.com>')
    expect(appendCalls).toHaveLength(1)
  })

  it('returns failed when no recipients are provided', async () => {
    setSmtpClient({ verify: async () => undefined, send: async () => ({ messageId: 'x', raw: Buffer.alloc(0) }) })
    setImapClient({ connectAndValidate: async () => ({ capabilities: [] }), selectInbox: async () => ({}), fetchUidRange: async () => [], appendSent: async () => undefined })
    const adapter = getImapChannelAdapter()
    const result = await adapter.sendMessage({
      content: { text: 'hi', bodyFormat: 'text' },
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
      metadata: {},
    })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/at least one recipient/i)
  })

  it('swallows IMAP append failures without failing the send', async () => {
    setSmtpClient({
      verify: async () => undefined,
      send: async () => ({ messageId: '<out@example.com>', raw: Buffer.from('RAW') }),
    })
    setImapClient({
      connectAndValidate: async () => ({ capabilities: [] }),
      selectInbox: async () => ({}),
      fetchUidRange: async () => [],
      appendSent: async () => {
        throw new Error('NO such folder')
      },
    })
    const adapter = getImapChannelAdapter()
    const result = await adapter.sendMessage({
      content: { text: 'hi', bodyFormat: 'text' },
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
      metadata: { to: ['bob@example.com'] },
    })
    expect(result.status).toBe('sent')
  })
})

describe('ImapChannelAdapter.fetchHistory', () => {
  it('does a full re-sync when UIDVALIDITY changes', async () => {
    const fetchCalls: string[] = []
    const imap: ImapClient = {
      connectAndValidate: async () => ({ capabilities: [] }),
      selectInbox: async () => ({ uidValidity: 999, uidNext: 50 }),
      fetchUidRange: async (_options, range) => {
        fetchCalls.push(range)
        return [
          { uid: 10, rawBody: buildSimpleMime('a@x', 'A'), internalDate: new Date('2026-05-01T00:00:00Z') },
          { uid: 20, rawBody: buildSimpleMime('b@x', 'B'), internalDate: new Date('2026-05-02T00:00:00Z') },
        ]
      },
      appendSent: async () => undefined,
    }
    setImapClient(imap)
    setSmtpClient({ verify: async () => undefined, send: async () => ({ messageId: 'x', raw: Buffer.alloc(0) }) })
    const adapter = getImapChannelAdapter()
    const page = await adapter.fetchHistory!({
      conversationId: 'INBOX',
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: { uidValidity: 1, uidNext: 40 } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getImapChannelAdapter>['fetchHistory']>>[0])
    expect(fetchCalls).toEqual(['1:*'])
    expect(page.messages).toHaveLength(2)
    expect(page.hasMore).toBe(false)
    expect(typeof page.nextCursor).toBe('string')
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.uidValidity).toBe(999)
    expect(decoded.uidNext).toBe(50)
  })

  it('fetches incremental UID range from the stored cursor', async () => {
    const fetchCalls: string[] = []
    const imap: ImapClient = {
      connectAndValidate: async () => ({ capabilities: [] }),
      selectInbox: async () => ({ uidValidity: 1, uidNext: 60 }),
      fetchUidRange: async (_options, range) => {
        fetchCalls.push(range)
        return [
          { uid: 55, rawBody: buildSimpleMime('c@x', 'C'), internalDate: new Date('2026-05-03T00:00:00Z') },
        ]
      },
      appendSent: async () => undefined,
    }
    setImapClient(imap)
    setSmtpClient({ verify: async () => undefined, send: async () => ({ messageId: 'x', raw: Buffer.alloc(0) }) })
    const adapter = getImapChannelAdapter()
    const page = await adapter.fetchHistory!({
      conversationId: 'INBOX',
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: { uidValidity: 1, uidNext: 50 } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getImapChannelAdapter>['fetchHistory']>>[0])
    expect(fetchCalls).toEqual(['50:*'])
    expect(page.messages).toHaveLength(1)
  })
})

describe('ImapChannelAdapter.verifyWebhook + getStatus', () => {
  it('verifyWebhook returns a non-message event since IMAP has no webhook', async () => {
    const adapter = getImapChannelAdapter()
    const event = await adapter.verifyWebhook({
      rawBody: '',
      headers: {},
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(event.eventType).toBe('other')
  })

  it('getStatus returns sent as best-effort placeholder', async () => {
    const adapter = getImapChannelAdapter()
    const status = await adapter.getStatus({
      externalMessageId: 'x',
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(status.status).toBe('sent')
  })
})

describe('ImapChannelAdapter.resolveContact', () => {
  it('returns an email-only hint for email-shaped identifiers', async () => {
    const adapter = getImapChannelAdapter()
    const hint = await adapter.resolveContact!({
      senderIdentifier: 'alice@example.com',
      senderDisplayName: 'Alice',
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(hint).toEqual({ email: 'alice@example.com', displayName: 'Alice' })
  })

  it('returns null when sender is not email-shaped', async () => {
    const adapter = getImapChannelAdapter()
    const hint = await adapter.resolveContact!({
      senderIdentifier: 'no-at-sign',
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(hint).toBeNull()
  })
})
