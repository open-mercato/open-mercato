import {
  _resetThreadTokenKeyCache,
  applyOutboundThreadingToken,
  buildBodyFooter,
  buildReferencesId,
  extractTokenFromBody,
  extractTokenFromHeaders,
  generateToken,
  getOrCreateThreadToken,
  verifyToken,
} from '../thread-token'

const TEST_SECRET = 'test-secret-do-not-use-in-prod'

describe('thread-token', () => {
  beforeEach(() => {
    process.env.OM_THREAD_TOKEN_SECRET = TEST_SECRET
    delete process.env.KMS_MASTER_KEY
    _resetThreadTokenKeyCache()
  })

  afterEach(() => {
    delete process.env.OM_THREAD_TOKEN_SECRET
    delete process.env.KMS_MASTER_KEY
    _resetThreadTokenKeyCache()
  })

  describe('generateToken / verifyToken', () => {
    it('generates tokens in the `om_<22>_<11>` shape (~37 chars)', () => {
      const token = generateToken()
      expect(token).toMatch(/^om_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{11}$/)
      expect(token.length).toBeGreaterThanOrEqual(35)
      expect(token.length).toBeLessThanOrEqual(40)
    })

    it('generates unique tokens across calls (random component)', () => {
      const tokens = new Set<string>()
      for (let i = 0; i < 50; i += 1) tokens.add(generateToken())
      expect(tokens.size).toBe(50)
    })

    it('verifyToken accepts a freshly generated token', () => {
      const token = generateToken()
      expect(verifyToken(token)).toBe(true)
    })

    it('verifyToken rejects a token tampered in the random portion', () => {
      const token = generateToken()
      // Mutate the random part by flipping one character.
      const replacement = token[5] === 'A' ? 'B' : 'A'
      const tampered = `${token.slice(0, 5)}${replacement}${token.slice(6)}`
      expect(verifyToken(tampered)).toBe(false)
    })

    it('verifyToken rejects a token tampered in the HMAC portion', () => {
      const token = generateToken()
      // Flip the first character of the 11-char HMAC portion. Its 6 bits are
      // all significant (they map to the top of HMAC byte 0), so any different
      // base64url char changes the decoded HMAC. Swapping the trailing char(s)
      // is unreliable: the last char of an 8-byte value carries 2 padding bits
      // the decoder discards, so e.g. `…AA` can decode to the original HMAC.
      const hmacStart = token.length - 11
      const replacement = token[hmacStart] === 'A' ? 'B' : 'A'
      const tampered = `${token.slice(0, hmacStart)}${replacement}${token.slice(hmacStart + 1)}`
      expect(verifyToken(tampered)).toBe(false)
    })

    it('verifyToken rejects malformed tokens (missing prefix, wrong shape)', () => {
      expect(verifyToken('')).toBe(false)
      expect(verifyToken('omtoken')).toBe(false)
      expect(verifyToken('om_too_short')).toBe(false)
      expect(verifyToken('not_an_om_token_at_all')).toBe(false)
      expect(verifyToken('om_AAAABBBB_____CCCCDDDD_EEEEEEEEEEE')).toBe(false)
    })

    it('verifyToken rejects tokens signed with a different key', () => {
      const token = generateToken()
      process.env.OM_THREAD_TOKEN_SECRET = 'a-different-secret'
      _resetThreadTokenKeyCache()
      expect(verifyToken(token)).toBe(false)
    })

    it('falls back to KMS_MASTER_KEY when OM_THREAD_TOKEN_SECRET is unset', () => {
      delete process.env.OM_THREAD_TOKEN_SECRET
      process.env.KMS_MASTER_KEY = 'master-key-fallback'
      _resetThreadTokenKeyCache()
      const token = generateToken()
      expect(verifyToken(token)).toBe(true)
    })
  })

  describe('buildReferencesId / buildBodyFooter', () => {
    it('buildReferencesId returns `<om_TOKEN@open-mercato.invalid>` (RFC 6761 .invalid TLD)', () => {
      const token = generateToken()
      const id = buildReferencesId(token)
      expect(id).toBe(`<${token}@open-mercato.invalid>`)
    })

    it('buildBodyFooter returns HTML hidden span + plain text marker', () => {
      const token = generateToken()
      const footer = buildBodyFooter(token)
      expect(footer.html).toBe(`<span style="display:none">[OM:${token}]</span>`)
      expect(footer.plain).toBe(`\n\n[OM:${token}]`)
    })
  })

  describe('applyOutboundThreadingToken', () => {
    it('appends the synthetic id to a brand-new References header', () => {
      const token = generateToken()
      const result = applyOutboundThreadingToken(
        { headers: {}, bodyHtml: '<p>hi</p>', bodyText: 'hi' },
        token,
      )
      expect(result.headers!.References).toBe(`<${token}@open-mercato.invalid>`)
    })

    it('extends an existing References header without duplicating', () => {
      const token = generateToken()
      const existing = '<existing-msg@example.com>'
      const out1 = applyOutboundThreadingToken({ headers: { References: existing } }, token)
      expect(out1.headers!.References).toBe(`${existing} <${token}@open-mercato.invalid>`)

      const out2 = applyOutboundThreadingToken(out1, token)
      expect(out2.headers!.References).toBe(`${existing} <${token}@open-mercato.invalid>`)
    })

    it('normalises lowercase `references` to canonical `References`', () => {
      const token = generateToken()
      const result = applyOutboundThreadingToken(
        { headers: { references: '<existing@example.com>' } },
        token,
      )
      expect(result.headers!.References).toBe(`<existing@example.com> <${token}@open-mercato.invalid>`)
      expect(result.headers!.references).toBeUndefined()
    })

    it('injects the hidden span before `</body>` when present', () => {
      const token = generateToken()
      const html = '<html><body><p>Hello</p></body></html>'
      const result = applyOutboundThreadingToken(
        { bodyHtml: html, bodyText: '' },
        token,
      )
      expect(result.bodyHtml).toBe(
        `<html><body><p>Hello</p><span style="display:none">[OM:${token}]</span></body></html>`,
      )
    })

    it('appends the hidden span when no `</body>` tag is present', () => {
      const token = generateToken()
      const html = '<p>Hello</p>'
      const result = applyOutboundThreadingToken(
        { bodyHtml: html, bodyText: '' },
        token,
      )
      expect(result.bodyHtml).toBe(`<p>Hello</p><span style="display:none">[OM:${token}]</span>`)
    })

    it('appends the plain-text marker', () => {
      const token = generateToken()
      const result = applyOutboundThreadingToken(
        { bodyText: 'Hello there.' },
        token,
      )
      expect(result.bodyText).toBe(`Hello there.\n\n[OM:${token}]`)
    })

    it('is idempotent on retry (does not double-inject)', () => {
      const token = generateToken()
      const payload = {
        headers: {},
        bodyHtml: '<body><p>hi</p></body>',
        bodyText: 'hi',
      }
      const once = applyOutboundThreadingToken(payload, token)
      const twice = applyOutboundThreadingToken(once, token)
      expect(twice).toEqual(once)
    })

    it('throws when given a malformed token', () => {
      expect(() =>
        applyOutboundThreadingToken({ headers: {} }, 'not-a-real-token'),
      ).toThrow(/invalid token/i)
    })
  })

  describe('extractTokenFromHeaders', () => {
    it('finds a token in a single References string', () => {
      const token = generateToken()
      const refs = `<root@example.com> <${token}@open-mercato.invalid> <parent@example.com>`
      expect(extractTokenFromHeaders(null, refs)).toBe(token)
    })

    it('finds a token in a References array', () => {
      const token = generateToken()
      const refs = ['<root@example.com>', `<${token}@open-mercato.invalid>`]
      expect(extractTokenFromHeaders(null, refs)).toBe(token)
    })

    it('finds a token in In-Reply-To when References is empty', () => {
      const token = generateToken()
      expect(extractTokenFromHeaders(`<${token}@open-mercato.invalid>`, null)).toBe(token)
    })

    it('returns null when no token is present', () => {
      expect(extractTokenFromHeaders(null, null)).toBeNull()
      expect(extractTokenFromHeaders(null, '<not-a-token@example.com>')).toBeNull()
      expect(extractTokenFromHeaders('<not-a-token@example.com>', [])).toBeNull()
    })

    it('returns null when the token format is right but HMAC is wrong (forgery defense)', () => {
      const fake = 'om_AAAAAAAAAAAAAAAAAAAAAA_BBBBBBBBBBB'
      expect(extractTokenFromHeaders(null, `<${fake}@open-mercato.invalid>`)).toBeNull()
    })
  })

  describe('extractTokenFromBody', () => {
    it('finds a token in HTML hidden span', () => {
      const token = generateToken()
      const html = `<html><body><p>hi</p><span style="display:none">[OM:${token}]</span></body></html>`
      expect(extractTokenFromBody(html, null)).toBe(token)
    })

    it('finds a token in plain text trailer', () => {
      const token = generateToken()
      const plain = `Hello there.\n\n[OM:${token}]`
      expect(extractTokenFromBody(null, plain)).toBe(token)
    })

    it('returns null when no token is present', () => {
      expect(extractTokenFromBody('<p>nothing here</p>', null)).toBeNull()
      expect(extractTokenFromBody(null, 'no token in plain text')).toBeNull()
    })

    it('ignores tokens with wrong HMAC even when the format matches', () => {
      const fake = 'om_AAAAAAAAAAAAAAAAAAAAAA_BBBBBBBBBBB'
      expect(extractTokenFromBody(`<span>[OM:${fake}]</span>`, null)).toBeNull()
    })
  })

  describe('getOrCreateThreadToken', () => {
    const args = { tenantId: 't', organizationId: 'o', messageThreadId: 'thread-1' }

    it('returns the existing token without inserting when one already exists', async () => {
      const em: any = {
        findOne: jest.fn(async () => ({ token: 'om_existing', messageThreadId: 'thread-1' })),
        create: jest.fn(),
        persist: jest.fn(),
        flush: jest.fn(),
        fork: jest.fn(),
      }
      const result = await getOrCreateThreadToken(em, args)
      expect(result).toEqual({ token: 'om_existing', created: false })
      expect(em.findOne).toHaveBeenCalledWith(
        expect.any(Function),
        { tenantId: 't', organizationId: 'o', messageThreadId: 'thread-1' },
        undefined,
      )
      expect(em.create).not.toHaveBeenCalled()
      expect(em.fork).not.toHaveBeenCalled()
    })

    it('creates and returns a new token when none exists', async () => {
      const em: any = {
        findOne: jest.fn(async () => null),
        create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
        persist: jest.fn(),
        flush: jest.fn(async () => undefined),
        fork: jest.fn(),
      }
      const result = await getOrCreateThreadToken(em, args)
      expect(result.created).toBe(true)
      expect(verifyToken(result.token)).toBe(true)
      expect(em.persist).toHaveBeenCalled()
    })

    it('re-selects the winner when a concurrent insert loses the unique race', async () => {
      const forkEm = { findOne: jest.fn(async () => ({ token: 'om_winner', messageThreadId: 'thread-1' })) }
      const uniqueErr = Object.assign(
        new Error('duplicate key value violates unique constraint "channel_thread_tokens_thread_uq"'),
        { code: '23505' },
      )
      const em: any = {
        findOne: jest.fn(async () => null),
        create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
        persist: jest.fn(),
        flush: jest.fn(async () => {
          throw uniqueErr
        }),
        fork: jest.fn(() => forkEm),
      }
      const result = await getOrCreateThreadToken(em, args)
      expect(result).toEqual({ token: 'om_winner', created: false })
      expect(em.fork).toHaveBeenCalledTimes(1)
      expect(forkEm.findOne).toHaveBeenCalledWith(
        expect.any(Function),
        { tenantId: 't', organizationId: 'o', messageThreadId: 'thread-1' },
        undefined,
      )
    })

    it('rethrows a non-unique flush error (does not swallow real failures)', async () => {
      const em: any = {
        findOne: jest.fn(async () => null),
        create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
        persist: jest.fn(),
        flush: jest.fn(async () => {
          throw new Error('connection terminated unexpectedly')
        }),
        fork: jest.fn(),
      }
      await expect(getOrCreateThreadToken(em, args)).rejects.toThrow('connection terminated')
      expect(em.fork).not.toHaveBeenCalled()
    })
  })
})
