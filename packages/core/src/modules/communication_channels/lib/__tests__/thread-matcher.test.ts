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

/**
 * EM mock for the raw-SQL strategies (3 JWZ + 4 subject/participants). Unlike
 * `buildEm`, `execute` is routed by SQL content so the JWZ two-step lookup
 * (message-id → thread-id) and the subject/participants query can return
 * distinct rows. `tokenRow` defaults to null so the token strategies miss and
 * control reaches Strategy 3/4.
 */
function buildSqlEm(
  route: (sql: string, params: unknown[]) => Array<Record<string, unknown>>,
  opts: { tokenRow?: ChannelThreadToken | null; mappingRow?: unknown } = {},
): { em: ThreadMatcherDeps['em']; execute: jest.Mock; findOne: jest.Mock } {
  const findOne = jest.fn(async (entity: unknown) => {
    if (entity === ChannelThreadMapping) {
      return opts.mappingRow !== undefined ? opts.mappingRow : { id: 'mapping-default' }
    }
    return opts.tokenRow ?? null
  })
  const flush = jest.fn(async () => {})
  const execute = jest.fn(async (sql: string, params: unknown[]) => route(sql, params))
  const em = {
    findOne,
    flush,
    getConnection: () => ({ execute }),
  } as unknown as ThreadMatcherDeps['em']
  return { em, execute, findOne }
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
        { tenantId: TENANT, organizationId: ORG, token },
        undefined,
      )
      expect(em.findOne).toHaveBeenCalledWith(
        ChannelThreadMapping,
        {
          tenantId: TENANT,
          organizationId: ORG,
          messageThreadId: 'thread-abc',
          channelId: CHANNEL,
        },
        undefined,
      )
      // The matcher bumps last_seen_at via a scoped raw UPDATE, NOT em.flush —
      // so it never commits the caller's pending unit of work (stays pure).
      expect(em.flush).not.toHaveBeenCalled()
      const execute = (em.getConnection() as unknown as { execute: jest.Mock }).execute
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE channel_thread_tokens'),
        [expect.any(Date), 'token-row-1', TENANT, ORG, ORG],
      )
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

  describe('matchThread — Strategy 3 (JWZ on Message-Id)', () => {
    it('resolves a medium-confidence match from an In-Reply-To message-id', async () => {
      const { em } = buildSqlEm(
        (sql) => {
          if (sql.includes('regexp_replace')) return []
          if (sql.includes('link.message_id')) return [{ message_id: 'platform-msg-1' }]
          if (sql.includes('FROM messages')) return [{ thread_id: 'thread-jwz' }]
          return []
        },
        { tokenRow: null },
      )
      const result = await matchThread(
        buildInput({ inReplyTo: '<orig-outbound@example.com>', references: [] }),
        { em },
      )
      expect(result).toEqual({
        messageThreadId: 'thread-jwz',
        matchedBy: 'jwz-headers',
        confidence: 'medium',
      })
    })

    it('resolves via any References entry, not only In-Reply-To', async () => {
      const seenParams: unknown[][] = []
      const { em } = buildSqlEm(
        (sql, params) => {
          seenParams.push(params)
          if (sql.includes('link.message_id')) return [{ message_id: 'm' }]
          if (sql.includes('FROM messages')) return [{ thread_id: 'thread-from-refs' }]
          return []
        },
        { tokenRow: null },
      )
      const result = await matchThread(
        buildInput({ inReplyTo: null, references: ['<root@example.com>', '<mid@example.com>'] }),
        { em },
      )
      expect(result?.matchedBy).toBe('jwz-headers')
      // The candidate message-ids are passed to the JWZ query as a stripped,
      // angle-bracket-free Postgres text array.
      const jwzParams = seenParams[0]
      expect(jwzParams).toEqual([
        TENANT,
        ORG,
        ORG,
        TENANT,
        ORG,
        ORG,
        CHANNEL,
        expect.any(String),
      ])
      expect(String(jwzParams[7])).toContain('root@example.com')
      expect(String(jwzParams[7])).not.toContain('<')
    })

    it('returns null from JWZ when a matching message-id resolves to a null thread', async () => {
      const { em } = buildSqlEm(
        (sql) => {
          if (sql.includes('regexp_replace')) return []
          if (sql.includes('link.message_id')) return [{ message_id: 'platform-msg-1' }]
          if (sql.includes('FROM messages')) return [{ thread_id: null }]
          return []
        },
        { tokenRow: null },
      )
      const result = await matchThread(buildInput({ inReplyTo: '<orig@example.com>' }), { em })
      expect(result).toBeNull()
    })

    it('does not run JWZ when there are no In-Reply-To/References headers', async () => {
      const { em, execute } = buildSqlEm(() => [], { tokenRow: null })
      await matchThread(buildInput({ inReplyTo: null, references: [], subject: 'Re: Fwd:' }), { em })
      // Empty references → JWZ skipped; 'Re: Fwd:' normalizes to '' → Strategy 4
      // skipped too. No raw SQL should fire.
      expect(execute).not.toHaveBeenCalled()
    })
  })

  describe('matchThread — Strategy 4 (subject + participants)', () => {
    it('resolves a low-confidence match within the lookback window', async () => {
      const { em } = buildSqlEm(
        (sql) => (sql.includes('regexp_replace') ? [{ thread_id: 'thread-subject' }] : []),
        { tokenRow: null },
      )
      const result = await matchThread(
        buildInput({ subject: 'Re: Project kickoff', inReplyTo: null, references: [] }),
        { em },
      )
      expect(result).toEqual({
        messageThreadId: 'thread-subject',
        matchedBy: 'subject-participants',
        confidence: 'low',
      })
    })

    it('falls through from a JWZ miss to subject+participants', async () => {
      const { em } = buildSqlEm(
        (sql) => {
          if (sql.includes('regexp_replace')) return [{ thread_id: 'thread-subject-fallback' }]
          return [] // JWZ message-id query: no hit
        },
        { tokenRow: null },
      )
      const result = await matchThread(
        buildInput({ inReplyTo: '<unknown-origin@example.com>', subject: 'Re: Quote #42' }),
        { em },
      )
      expect(result?.matchedBy).toBe('subject-participants')
      expect(result?.confidence).toBe('low')
    })

    it('passes the lookback cutoff and lowercased participants to the query', async () => {
      let captured: unknown[] = []
      const { em } = buildSqlEm(
        (sql, params) => {
          if (sql.includes('regexp_replace')) {
            captured = params
            return [{ thread_id: 't' }]
          }
          return []
        },
        { tokenRow: null },
      )
      await matchThread(
        buildInput({
          subject: 'Quarterly review',
          inReplyTo: null,
          references: [],
          fromAddress: 'Alice@Example.com',
          toAddresses: ['BOB@example.com'],
          receivedAt: new Date('2026-05-27T10:00:00Z'),
        }),
        { em, now: () => new Date('2026-05-27T10:00:00Z') },
      )
      // [tenantId, orgId, orgId, tenantId, orgId, orgId, channelId, cutoff, normalizedSubject, from[], to[], cc[]]
      const cutoff = captured[7] as Date
      expect(cutoff).toBeInstanceOf(Date)
      // 30-day lookback before the fixed `now`.
      expect(cutoff.toISOString()).toBe('2026-04-27T10:00:00.000Z')
      expect(captured[8]).toBe('quarterly review')
      expect(String(captured[9])).toContain('alice@example.com')
    })

    it('skips subject+participants when the normalized subject is empty', async () => {
      const { em, execute } = buildSqlEm(() => [], { tokenRow: null })
      const result = await matchThread(
        buildInput({ subject: '[EXTERNAL] Re:', inReplyTo: null, references: [] }),
        { em },
      )
      expect(result).toBeNull()
      expect(execute).not.toHaveBeenCalled()
    })
  })
})
