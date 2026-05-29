import {
  _resetThreadTokenKeyCache,
  generateToken,
} from '../thread-token'
import {
  matchThread,
  normalizeSubject,
  type ThreadMatchInput,
  type ThreadMatcherDeps,
} from '../thread-matcher'
import { ChannelThreadMapping, ChannelThreadToken } from '../../data/entities'

const TEST_SECRET = 'test-secret-do-not-use-in-prod'

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const CHANNEL = '33333333-3333-3333-3333-333333333333'

function buildInput(overrides: Partial<ThreadMatchInput> = {}): ThreadMatchInput {
  return {
    channelId: CHANNEL,
    tenantId: TENANT,
    organizationId: ORG,
    messageId: 'new-inbound@example.com',
    inReplyTo: null,
    references: [],
    subject: 'Hello there',
    fromAddress: 'alice@example.com',
    toAddresses: ['bob@example.com'],
    ccAddresses: [],
    bodyPlain: null,
    bodyHtml: null,
    receivedAt: new Date('2026-05-27T10:00:00Z'),
    ...overrides,
  }
}

function buildEm(opts: {
  tokenRow?: ChannelThreadToken | null
  /**
   * ChannelThreadMapping row returned when the matcher verifies that a resolved
   * token's thread belongs to the receiving channel. Defaults to a present
   * mapping so token strategies resolve; pass `null` to simulate a token whose
   * thread lives on a DIFFERENT channel (must NOT match).
   */
  mappingRow?: unknown
  knexRows?: Array<Record<string, unknown>>
} = {}): { em: jest.Mocked<ThreadMatcherDeps['em']>; flushed: number } {
  let flushed = 0
  const findOne = jest.fn(async (entity: unknown) => {
    if (entity === ChannelThreadMapping) {
      return opts.mappingRow !== undefined ? opts.mappingRow : { id: 'mapping-default' }
    }
    return opts.tokenRow ?? null
  })
  const flush = jest.fn(async () => {
    flushed += 1
  })
  // Strategy 3/4 use `em.getConnection().execute(...)` raw SQL (MikroORM v7
  // dropped the Knex builder). For most token-strategy tests the raw query
  // never fires, so returning an empty array by default is enough; tests
  // that need a JWZ/subject-participants match pass rows via `knexRows`
  // (legacy name kept for compatibility) and the mock returns them on each
  // call.
  const execute = jest.fn(async () => opts.knexRows ?? [])
  const getConnection = jest.fn(() => ({ execute }))
  const em = {
    findOne,
    flush,
    getConnection,
  } as unknown as jest.Mocked<ThreadMatcherDeps['em']>
  return { em, flushed }
}

describe('thread-matcher', () => {
  beforeEach(() => {
    process.env.OM_THREAD_TOKEN_SECRET = TEST_SECRET
    _resetThreadTokenKeyCache()
  })

  afterEach(() => {
    delete process.env.OM_THREAD_TOKEN_SECRET
    _resetThreadTokenKeyCache()
  })

  describe('normalizeSubject', () => {
    it('strips Re:/Fwd:/Aw:/Tr:/WG:/SV: prefixes (case-insensitive)', () => {
      expect(normalizeSubject('Re: Hello')).toBe('hello')
      expect(normalizeSubject('RE: HELLO')).toBe('hello')
      expect(normalizeSubject('Fwd: question')).toBe('question')
      expect(normalizeSubject('Aw: Frage')).toBe('frage')
      expect(normalizeSubject('WG: Frage')).toBe('frage')
      expect(normalizeSubject('Tr: Question')).toBe('question')
    })

    it('strips bracketed tags like [EXTERNAL] and [Encrypted]', () => {
      expect(normalizeSubject('[EXTERNAL] Hello')).toBe('hello')
      expect(normalizeSubject('[Encrypted] [EXTERNAL] Hello')).toBe('hello')
    })

    it('iterates until no more prefixes match (handles Re: Fwd: [EXT] Re: …)', () => {
      expect(normalizeSubject('Re: Fwd: [EXTERNAL] Re: Hello world')).toBe('hello world')
    })

    it('lowercases the result', () => {
      expect(normalizeSubject('Hello World')).toBe('hello world')
    })

    it('returns empty string for null/undefined/empty', () => {
      expect(normalizeSubject(null)).toBe('')
      expect(normalizeSubject(undefined)).toBe('')
      expect(normalizeSubject('')).toBe('')
      expect(normalizeSubject('   ')).toBe('')
    })
  })

  describe('matchThread — Strategy 1 (token in headers)', () => {
    it('returns high-confidence match when References carries a valid token', async () => {
      const token = generateToken()
      const tokenRow = {
        id: 'token-row-1',
        tenantId: TENANT,
        organizationId: ORG,
        messageThreadId: 'thread-abc',
        token,
        createdAt: new Date(),
        lastSeenAt: null,
      } as unknown as ChannelThreadToken
      const { em } = buildEm({ tokenRow })
      const result = await matchThread(
        buildInput({
          references: [`<${token}@open-mercato.invalid>`],
        }),
        { em },
      )
      expect(result).toEqual({
        messageThreadId: 'thread-abc',
        matchedBy: 'token-references',
        confidence: 'high',
      })
      // The matcher routes through `findOneWithDecryption`, which forwards
      // the `options` arg to `em.findOne` even when undefined — so the
      // assertion accepts the 3-arg call shape.
      expect(em.findOne).toHaveBeenCalledWith(
        ChannelThreadToken,
        { tenantId: TENANT, token },
        undefined,
      )
      // The matcher updates lastSeenAt and flushes.
      expect(em.flush).toHaveBeenCalled()
      expect(tokenRow.lastSeenAt).toBeInstanceOf(Date)
    })

    it('also recognizes a token in In-Reply-To', async () => {
      const token = generateToken()
      const tokenRow = {
        messageThreadId: 'thread-from-inreplyto',
        tenantId: TENANT,
        token,
        lastSeenAt: null,
      } as unknown as ChannelThreadToken
      const { em } = buildEm({ tokenRow })
      const result = await matchThread(
        buildInput({ inReplyTo: `<${token}@open-mercato.invalid>` }),
        { em },
      )
      expect(result?.matchedBy).toBe('token-references')
      expect(result?.messageThreadId).toBe('thread-from-inreplyto')
    })

    it('skips Strategy 1 when token is structurally valid but not in DB (falls through)', async () => {
      const token = generateToken()
      const { em } = buildEm({ tokenRow: null })
      const result = await matchThread(
        buildInput({ references: [`<${token}@open-mercato.invalid>`] }),
        { em },
      )
      // Strategy 1 returned null (no DB row); Strategy 3/4 also null due to
      // no headers/subject overlap. So overall null.
      expect(result).toBeNull()
    })

    it('drops forged tokens that fail HMAC verification before any DB lookup', async () => {
      const { em } = buildEm({ tokenRow: null })
      const fake = 'om_AAAAAAAAAAAAAAAAAAAAAA_BBBBBBBBBBB'
      await matchThread(
        buildInput({ references: [`<${fake}@open-mercato.invalid>`] }),
        { em },
      )
      // Verified-fail -> never reached em.findOne for the token table.
      const findOneCalls = (em.findOne as unknown as jest.Mock).mock.calls
      // Strategy 1 short-circuits, Strategy 2 also doesn't fire (no body),
      // Strategy 3/4 use raw SQL via em.getConnection().execute() (not
      // em.findOne). So zero findOne calls.
      expect(findOneCalls).toHaveLength(0)
    })
  })

  describe('matchThread — Strategy 2 (token in body)', () => {
    it('returns high-confidence match when the hidden HTML span carries a valid token', async () => {
      const token = generateToken()
      const tokenRow = {
        messageThreadId: 'thread-from-html-body',
        tenantId: TENANT,
        token,
        lastSeenAt: null,
      } as unknown as ChannelThreadToken
      const { em } = buildEm({ tokenRow })
      const result = await matchThread(
        buildInput({
          bodyHtml: `<html><body><p>hi</p><span style="display:none">[OM:${token}]</span></body></html>`,
        }),
        { em },
      )
      expect(result?.matchedBy).toBe('token-body')
      expect(result?.confidence).toBe('high')
      expect(result?.messageThreadId).toBe('thread-from-html-body')
    })

    it('also recognizes a token in plain-text trailer', async () => {
      const token = generateToken()
      const tokenRow = {
        messageThreadId: 'thread-from-plain-body',
        tenantId: TENANT,
        token,
        lastSeenAt: null,
      } as unknown as ChannelThreadToken
      const { em } = buildEm({ tokenRow })
      const result = await matchThread(
        buildInput({ bodyPlain: `Hello there.\n\n[OM:${token}]` }),
        { em },
      )
      expect(result?.matchedBy).toBe('token-body')
    })
  })

  describe('matchThread — strategy priority + null fallback', () => {
    it('returns null when no strategy matches', async () => {
      const { em } = buildEm({ tokenRow: null })
      const result = await matchThread(buildInput(), { em })
      expect(result).toBeNull()
    })

    it('header token wins over body token (strategy priority order)', async () => {
      const headerToken = generateToken()
      const bodyToken = generateToken()
      // Both tokens valid; em.findOne should be called with the header
      // token first and return a match — body strategy never fires.
      const headerRow = {
        messageThreadId: 'thread-from-header',
        tenantId: TENANT,
        token: headerToken,
        lastSeenAt: null,
      } as unknown as ChannelThreadToken
      // Returns the header row for the token lookup AND a truthy mapping for the
      // channel-scope verification, so strategy 1 resolves.
      const findOne = jest.fn(async () => headerRow)
      const flush = jest.fn(async () => {})
      const em = {
        findOne,
        flush,
        getConnection: () => ({ execute: jest.fn(async () => []) }),
      } as unknown as ThreadMatcherDeps['em']
      const result = await matchThread(
        buildInput({
          references: [`<${headerToken}@open-mercato.invalid>`],
          bodyPlain: `\n\n[OM:${bodyToken}]`,
        }),
        { em },
      )
      expect(result?.matchedBy).toBe('token-references')
      expect(result?.messageThreadId).toBe('thread-from-header')
      // Two calls: the token lookup + the channel-scope (ChannelThreadMapping)
      // verification. Strategy 2 (body token) never fired.
      expect(findOne).toHaveBeenCalledTimes(2)
    })
  })

  describe('matchThread — token channel scoping (M5)', () => {
    it('does NOT match a token whose thread belongs to a different channel', async () => {
      const token = generateToken()
      const tokenRow = {
        id: 'token-row-x',
        tenantId: TENANT,
        organizationId: ORG,
        messageThreadId: 'thread-on-other-channel',
        token,
        createdAt: new Date(),
        lastSeenAt: null,
      } as unknown as ChannelThreadToken
      // Token resolves, but there is NO ChannelThreadMapping linking that thread
      // to the receiving channel → the matcher must skip it (an inbound reply
      // landing in a different mailbox must not graft onto another channel's
      // thread).
      const { em } = buildEm({ tokenRow, mappingRow: null })
      const result = await matchThread(
        buildInput({ references: [`<${token}@open-mercato.invalid>`] }),
        { em },
      )
      expect(result).toBeNull()
    })

    it('matches a token whose thread is mapped to the receiving channel', async () => {
      const token = generateToken()
      const tokenRow = {
        messageThreadId: 'thread-on-this-channel',
        tenantId: TENANT,
        token,
        lastSeenAt: null,
      } as unknown as ChannelThreadToken
      const { em } = buildEm({
        tokenRow,
        mappingRow: { id: 'mapping-1', messageThreadId: 'thread-on-this-channel', channelId: CHANNEL },
      })
      const result = await matchThread(
        buildInput({ references: [`<${token}@open-mercato.invalid>`] }),
        { em },
      )
      expect(result?.matchedBy).toBe('token-references')
      expect(result?.messageThreadId).toBe('thread-on-this-channel')
    })
  })
})
