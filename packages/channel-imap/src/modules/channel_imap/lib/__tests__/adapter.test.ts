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
  // Spec B § Bounded, cursor-driven IMAP inbound.
  //
  // The "30-min wall-clock window" approach was replaced with zero-history
  // bootstrap + incremental UID FETCH. UIDVALIDITY mismatch now triggers a
  // bootstrap (zero messages, cursor persisted) rather than a 1:* full
  // resync — that path uses the explicit `/import-history` endpoint.

  it('bootstrap: no prior cursor → persists UIDVALIDITY + UIDNEXT, fetches zero messages', async () => {
    const fetchCalls: string[] = []
    const imap: ImapClient = {
      connectAndValidate: async () => ({ capabilities: [] }),
      selectInbox: async () => ({ uidValidity: 1, uidNext: 60 }),
      fetchUidRange: async (_options, range) => {
        fetchCalls.push(range)
        return []
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
    } as Parameters<NonNullable<ReturnType<typeof getImapChannelAdapter>['fetchHistory']>>[0])
    expect(fetchCalls).toEqual([]) // ZERO fetches on bootstrap — by design
    expect(page.messages).toHaveLength(0)
    expect(page.hasMore).toBe(false)
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.uidValidity).toBe(1)
    expect(decoded.uidNext).toBe(60)
  })

  it('UIDVALIDITY mismatch: discards cursor and re-bootstraps (no full resync)', async () => {
    const fetchCalls: string[] = []
    const imap: ImapClient = {
      connectAndValidate: async () => ({ capabilities: [] }),
      selectInbox: async () => ({ uidValidity: 999, uidNext: 50 }),
      fetchUidRange: async (_options, range) => {
        fetchCalls.push(range)
        return []
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
    // UIDVALIDITY mismatch triggers bootstrap — no fetch.
    expect(fetchCalls).toEqual([])
    expect(page.messages).toHaveLength(0)
    expect(page.hasMore).toBe(false)
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
    expect(page.hasMore).toBe(false)
    // Regression (inbound-skip bug): on drain, the cursor must anchor to the
    // highest FETCHED uid + 1 (55 + 1 = 56), NOT the server's UIDNEXT (60).
    // Jumping to serverUidNext steps over INBOX messages that sit at a UID
    // below it (Gmail UID gaps from labels/threads), permanently dropping them.
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.uidNext).toBe(56)
  })

  it('signals hasMore=true when more UIDs remain than HARD_CAP', async () => {
    // Force HARD_CAP to a small value via env override so the test is bounded.
    const originalCap = process.env.OM_CHANNEL_IMAP_HARD_CAP_PER_POLL
    process.env.OM_CHANNEL_IMAP_HARD_CAP_PER_POLL = '2'
    try {
      const fetchCalls: string[] = []
      const imap: ImapClient = {
        connectAndValidate: async () => ({ capabilities: [] }),
        selectInbox: async () => ({ uidValidity: 1, uidNext: 100 }),
        fetchUidRange: async (_options, range) => {
          fetchCalls.push(range)
          // Return 3 messages (HARD_CAP+1) so the probe detects "more remain".
          return [
            { uid: 50, rawBody: buildSimpleMime('a@x', 'A'), internalDate: new Date() },
            { uid: 51, rawBody: buildSimpleMime('b@x', 'B'), internalDate: new Date() },
            { uid: 52, rawBody: buildSimpleMime('c@x', 'C'), internalDate: new Date() },
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
      expect(page.messages).toHaveLength(2) // capped at HARD_CAP
      expect(page.hasMore).toBe(true)
      const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
      // Cursor advances PAST the last fetched UID (so next poll picks up
      // from highest+1), not all the way to server uidNext.
      expect(decoded.uidNext).toBe(52)
    } finally {
      if (originalCap === undefined) delete process.env.OM_CHANNEL_IMAP_HARD_CAP_PER_POLL
      else process.env.OM_CHANNEL_IMAP_HARD_CAP_PER_POLL = originalCap
    }
  })
})

describe('ImapChannelAdapter.importHistory', () => {
  // Spec B § Phase B6 — operator-triggered backlog import. Distinct from
  // fetchHistory's zero-history bootstrap: this reaches backward in time and
  // pulls messages matching SEARCH SINCE + optional FROM list.

  function makeImap(args: {
    onSearch: (criteria: { fromAddresses?: string[]; sinceDate?: Date }) => number[]
    onFetch: (range: string) => Array<{ uid: number; rawBody: Buffer; internalDate?: Date }>
  }): ImapClient {
    return {
      connectAndValidate: async () => ({ capabilities: [] }),
      selectInbox: async () => ({ uidValidity: 1, uidNext: 100 }),
      fetchUidRange: async (_options, range) => args.onFetch(range),
      searchUidsByFromAndSince: async (_options, criteria) => args.onSearch(criteria),
      appendSent: async () => undefined,
    } as ImapClient
  }

  it('queries SEARCH SINCE only when no contactEmails provided, then fetches the page', async () => {
    const searchCalls: Array<{ fromAddresses?: string[]; sinceDate?: Date }> = []
    const fetchCalls: string[] = []
    setImapClient(makeImap({
      onSearch: (c) => {
        searchCalls.push(c)
        return [101, 102, 103]
      },
      onFetch: (range) => {
        fetchCalls.push(range)
        return [
          { uid: 103, rawBody: buildSimpleMime('a@x', 'A') },
          { uid: 102, rawBody: buildSimpleMime('b@x', 'B') },
          { uid: 101, rawBody: buildSimpleMime('c@x', 'C') },
        ]
      },
    }))
    const adapter = getImapChannelAdapter()
    const page = await adapter.importHistory!({
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
      sinceDays: 14,
    })
    expect(searchCalls).toHaveLength(1)
    expect(searchCalls[0].fromAddresses).toBeUndefined()
    expect(searchCalls[0].sinceDate).toBeInstanceOf(Date)
    expect(fetchCalls[0]).toBe('103,102,101') // newest UIDs first
    expect(page.messages).toHaveLength(3)
    expect(page.hasMore).toBe(false)
    expect(page.totalCandidates).toBe(3)
    expect(page.nextCursor).toBeUndefined()
  })

  it('chunks contactEmails to ≤30 per SEARCH and unions results', async () => {
    const searchCalls: Array<{ fromAddresses?: string[]; sinceDate?: Date }> = []
    setImapClient(makeImap({
      onSearch: (c) => {
        searchCalls.push(c)
        return (c.fromAddresses ?? []).map((_addr, i) => 1000 + searchCalls.length * 100 + i)
      },
      onFetch: () => [],
    }))
    const senders = Array.from({ length: 65 }, (_v, i) => `s${i}@example.com`)
    const adapter = getImapChannelAdapter()
    const page = await adapter.importHistory!({
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
      sinceDays: 30,
      contactEmails: senders,
    })
    expect(searchCalls).toHaveLength(3) // ceil(65/30) = 3 chunks
    expect(searchCalls.every((c) => (c.fromAddresses ?? []).length <= 30)).toBe(true)
    // Union of UIDs returned across chunks: 30 + 30 + 5 = 65
    expect(page.totalCandidates).toBe(65)
  })

  it('paginates: PAGE_SIZE-bounded batches with cursor resumption', async () => {
    const originalCap = process.env.OM_CHANNEL_IMAP_HARD_CAP_PER_POLL
    process.env.OM_CHANNEL_IMAP_HARD_CAP_PER_POLL = '2'
    try {
      const fetchCalls: string[] = []
      setImapClient(makeImap({
        onSearch: () => [10, 20, 30, 40, 50],
        onFetch: (range) => {
          fetchCalls.push(range)
          return range.split(',').map((u) => ({ uid: Number(u), rawBody: buildSimpleMime(`m${u}@x`, 'X') }))
        },
      }))
      const adapter = getImapChannelAdapter()
      const page1 = await adapter.importHistory!({
        credentials,
        scope: { tenantId: 't', organizationId: 'o' },
        sinceDays: 30,
      })
      expect(page1.messages).toHaveLength(2)
      expect(page1.hasMore).toBe(true)
      expect(page1.nextCursor).toBeTruthy()
      expect(fetchCalls[0]).toBe('50,40') // newest first, capped at 2

      const page2 = await adapter.importHistory!({
        credentials,
        scope: { tenantId: 't', organizationId: 'o' },
        sinceDays: 30,
        cursor: page1.nextCursor,
      })
      expect(page2.messages).toHaveLength(2)
      expect(page2.hasMore).toBe(true)
      expect(fetchCalls[1]).toBe('30,20')

      const page3 = await adapter.importHistory!({
        credentials,
        scope: { tenantId: 't', organizationId: 'o' },
        sinceDays: 30,
        cursor: page2.nextCursor,
      })
      expect(page3.messages).toHaveLength(1)
      expect(page3.hasMore).toBe(false)
      expect(fetchCalls[2]).toBe('10')
    } finally {
      if (originalCap === undefined) delete process.env.OM_CHANNEL_IMAP_HARD_CAP_PER_POLL
      else process.env.OM_CHANNEL_IMAP_HARD_CAP_PER_POLL = originalCap
    }
  })

  it('respects maxMessages cap', async () => {
    setImapClient(makeImap({
      onSearch: () => Array.from({ length: 50 }, (_v, i) => i + 1),
      onFetch: () => [],
    }))
    const adapter = getImapChannelAdapter()
    const page = await adapter.importHistory!({
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
      sinceDays: 30,
      maxMessages: 10,
    })
    expect(page.totalCandidates).toBe(10)
  })

  it('clamps sinceDays to [1, 365]', async () => {
    const sinceDates: Date[] = []
    setImapClient(makeImap({
      onSearch: (c) => {
        if (c.sinceDate) sinceDates.push(c.sinceDate)
        return []
      },
      onFetch: () => [],
    }))
    const adapter = getImapChannelAdapter()
    await adapter.importHistory!({
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
      sinceDays: 9999,
    })
    await adapter.importHistory!({
      credentials,
      scope: { tenantId: 't', organizationId: 'o' },
      sinceDays: 0,
    })
    expect(sinceDates).toHaveLength(2)
    const now = Date.now()
    const ms365 = 365 * 24 * 60 * 60 * 1000
    const ms1 = 1 * 24 * 60 * 60 * 1000
    expect(now - sinceDates[0].getTime()).toBeGreaterThan(ms365 - 5000)
    expect(now - sinceDates[0].getTime()).toBeLessThan(ms365 + 5000)
    expect(now - sinceDates[1].getTime()).toBeGreaterThan(ms1 - 5000)
    expect(now - sinceDates[1].getTime()).toBeLessThan(ms1 + 5000)
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
