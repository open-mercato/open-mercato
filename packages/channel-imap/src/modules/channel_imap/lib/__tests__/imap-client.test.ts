import { getImapClient, setImapClient, type ImapConnectionOptions } from '../imap-client'

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

jest.mock('imapflow', () => {
  class FakeImapFlow {
    on() {}
    async connect() {}
    async logout() {}
    async getMailboxLock() {
      return { release() {} }
    }
    fetch(range: string, query: unknown, options?: unknown) {
      return mockFetch(range, query, options)
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
