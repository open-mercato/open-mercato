import {
  credentialsToConnection,
  getImapClient,
  pickSentMailbox,
  setImapClient,
  type ImapConnectionOptions,
} from '../imap-client'

const mockFetch = jest.fn((_range: string, _query: unknown, _options?: unknown) =>
  (async function* () {
    yield {
      uid: 150,
      source: Buffer.from('raw mime'),
      internalDate: new Date('2026-01-01T00:00:00Z'),
      flags: ['\\Seen'],
    }
  })(),
)

let lastImapFlowOptions: Record<string, unknown> | undefined
let fakeMailboxes: Array<{ path?: string; specialUse?: string }> = []
const appendSpy = jest.fn(async (_mailbox: string, _message: Buffer, _flags?: string[]) => undefined)

// Connect-time SSRF pinning resolves the host via node:dns. Stub it to a fixed
// public IP so these tests stay offline and deterministic.
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(async (_host: string) => [{ address: '93.184.216.34', family: 4 }]),
}))

jest.mock('imapflow', () => {
  class FakeImapFlow {
    secureConnection = true
    constructor(options: Record<string, unknown>) {
      lastImapFlowOptions = options
    }
    on() {}
    async connect() {}
    async logout() {}
    async getMailboxLock() {
      return { release() {} }
    }
    fetch(range: string, query: unknown, options?: unknown) {
      return mockFetch(range, query, options)
    }
    async list() {
      return fakeMailboxes
    }
    async append(mailbox: string, message: Buffer, flags?: string[]) {
      return appendSpy(mailbox, message, flags)
    }
  }
  return { ImapFlow: FakeImapFlow }
})

const connection: ImapConnectionOptions = {
  host: 'imap.example.com',
  port: 993,
  user: 'user@example.com',
  pass: 'secret',
  transport: 'tls',
}

describe('ImapflowClient.fetchUidRange — UID range mode', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    // Force getImapClient() to construct the real ImapflowClient over the mocked imapflow.
    setImapClient(null)
  })
  afterAll(() => setImapClient(null))

  it('passes { uid: true } as FetchOptions so the range is read as UIDs, not sequence numbers', async () => {
    const client = getImapClient()
    const result = await client.fetchUidRange(connection, '61978:*', {})

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [range, query, options] = mockFetch.mock.calls[0]
    expect(range).toBe('61978:*')
    expect(query).toMatchObject({ source: true })
    // Regression guard for the silent inbound-drop bug: a sequence-number range
    // "n:*" collapses to the single newest message, so each poll fetched only the
    // latest mail and skipped everything else. The third arg MUST request UID-mode.
    expect(options).toEqual({ uid: true })

    expect(result).toHaveLength(1)
    expect(result[0].uid).toBe(150)
  })
})

describe('pickSentMailbox — server Sent-folder discovery', () => {
  it('returns the \\Sent special-use mailbox path', () => {
    expect(
      pickSentMailbox([{ path: 'INBOX' }, { path: '[Gmail]/Sent Mail', specialUse: '\\Sent' }]),
    ).toBe('[Gmail]/Sent Mail')
  })

  it('returns a localized special-use path (not the English "Sent")', () => {
    expect(pickSentMailbox([{ path: 'Wysłane', specialUse: '\\Sent' }])).toBe('Wysłane')
  })

  it('falls back to "Sent" when no \\Sent mailbox exists', () => {
    expect(pickSentMailbox([{ path: 'INBOX' }, { path: 'Drafts', specialUse: '\\Drafts' }])).toBe(
      'Sent',
    )
  })

  it('falls back to "Sent" for an empty or nullish listing', () => {
    expect(pickSentMailbox([])).toBe('Sent')
    expect(pickSentMailbox(null)).toBe('Sent')
    expect(pickSentMailbox(undefined)).toBe('Sent')
  })
})

describe('ImapflowClient.appendSent — targets the discovered Sent folder', () => {
  beforeEach(() => {
    setImapClient(null)
    appendSpy.mockClear()
  })
  afterAll(() => setImapClient(null))

  it('appends to the server-advertised \\Sent folder, not a hardcoded "Sent"', async () => {
    fakeMailboxes = [{ path: 'INBOX' }, { path: '[Gmail]/Sent Mail', specialUse: '\\Sent' }]
    await getImapClient().appendSent(connection, Buffer.from('raw mime'))
    expect(appendSpy).toHaveBeenCalledWith('[Gmail]/Sent Mail', expect.any(Buffer), ['\\Seen'])
  })

  it('falls back to "Sent" when the server exposes no \\Sent special-use mailbox', async () => {
    fakeMailboxes = [{ path: 'INBOX' }]
    await getImapClient().appendSent(connection, Buffer.from('raw mime'))
    expect(appendSpy).toHaveBeenCalledWith('Sent', expect.any(Buffer), ['\\Seen'])
  })
})

describe('ImapflowClient.openConnection — SSRF host pinning', () => {
  beforeEach(() => {
    setImapClient(null)
    lastImapFlowOptions = undefined
    fakeMailboxes = []
  })
  afterAll(() => setImapClient(null))

  it('connects to the resolved IP while keeping the hostname as the TLS servername', async () => {
    await getImapClient().selectInbox(connection)
    expect(lastImapFlowOptions?.host).toBe('93.184.216.34')
    expect(lastImapFlowOptions?.tls).toMatchObject({
      rejectUnauthorized: true,
      servername: 'imap.example.com',
    })
  })
})

describe('credentialsToConnection — socket timeout override', () => {
  const baseCredentials = {
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapTls: 'tls',
    imapUser: 'alice@example.com',
    imapPassword: 'secret',
  } as unknown as Parameters<typeof credentialsToConnection>[0]

  afterEach(() => {
    delete process.env.OM_CHANNEL_IMAP_SOCKET_TIMEOUT_MS
  })

  it('omits timeoutMs (client falls back to its 60s default) when the env var is unset', () => {
    delete process.env.OM_CHANNEL_IMAP_SOCKET_TIMEOUT_MS
    expect(credentialsToConnection(baseCredentials).timeoutMs).toBeUndefined()
  })

  it('reads a positive OM_CHANNEL_IMAP_SOCKET_TIMEOUT_MS override', () => {
    process.env.OM_CHANNEL_IMAP_SOCKET_TIMEOUT_MS = '90000'
    expect(credentialsToConnection(baseCredentials).timeoutMs).toBe(90000)
  })

  it('ignores a non-numeric or non-positive override', () => {
    process.env.OM_CHANNEL_IMAP_SOCKET_TIMEOUT_MS = 'abc'
    expect(credentialsToConnection(baseCredentials).timeoutMs).toBeUndefined()
    process.env.OM_CHANNEL_IMAP_SOCKET_TIMEOUT_MS = '0'
    expect(credentialsToConnection(baseCredentials).timeoutMs).toBeUndefined()
  })
})
