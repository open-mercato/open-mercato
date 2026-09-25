const mockLoggerWarn = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({ warn: mockLoggerWarn }),
  }),
}))

import {
  COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME,
  COMMUNICATION_CHANNELS_OAUTH_STATE_TTL_MS,
  consumeOAuthStateOnce,
  createOAuthState,
  emitOAuthStateMemoryCacheStartupWarningIfNeeded,
  resetOAuthStateMemoryCacheStartupWarningForTests,
  decryptOAuthState,
  DEFAULT_OAUTH_RETURN_URL,
  encryptOAuthState,
  isSafeOAuthReturnUrl,
  normalizeOAuthReturnUrl,
  oauthStateConsumedCacheKey,
  OAuthStateError,
  verifyOAuthState,
  type OAuthStateConsumeStore,
} from '../oauth-state'

const SECRET = 'test-secret-for-oauth-state-cookie-' + Math.random().toString(36).slice(2)

beforeAll(() => {
  process.env.OM_HUB_OAUTH_STATE_KEY = SECRET
})

afterAll(() => {
  delete process.env.OM_HUB_OAUTH_STATE_KEY
})

describe('oauth-state — constants', () => {
  it('exports a stable cookie name', () => {
    expect(COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME).toBe('om_cc_oauth_state')
  })

  it('exposes a 5-minute TTL', () => {
    expect(COMMUNICATION_CHANNELS_OAUTH_STATE_TTL_MS).toBe(5 * 60 * 1000)
  })
})

describe('encryptOAuthState + decryptOAuthState', () => {
  const baseInput = {
    state: 's',
    nonce: 'n',
    userId: 'u1',
    tenantId: 't1',
    organizationId: 'o1',
    providerKey: 'gmail',
    returnUrl: '/x',
    expiresAt: Date.now() + 60_000,
  }

  it('round-trips a payload', () => {
    const cookie = encryptOAuthState(baseInput)
    const out = decryptOAuthState(cookie)
    expect(out?.state).toBe('s')
    expect(out?.nonce).toBe('n')
    expect(out?.userId).toBe('u1')
    expect(out?.tenantId).toBe('t1')
    expect(out?.providerKey).toBe('gmail')
  })

  it('returns null when given a malformed cookie', () => {
    expect(decryptOAuthState('totally-bogus')).toBeNull()
  })

  it('returns null when the GCM tag is tampered', () => {
    const cookie = encryptOAuthState(baseInput)
    // Flip a bit in the middle of the cookie.
    const tampered = cookie.slice(0, cookie.length - 4) + 'AAAA'
    expect(decryptOAuthState(tampered)).toBeNull()
  })
})

describe('verifyOAuthState', () => {
  const now = Date.now()
  function makePayload(overrides: Partial<Parameters<typeof encryptOAuthState>[0]> = {}) {
    return encryptOAuthState({
      state: 's',
      nonce: 'n',
      userId: 'u1',
      tenantId: 't1',
      organizationId: 'o1',
      providerKey: 'gmail',
      returnUrl: '/x',
      expiresAt: now + 60_000,
      ...overrides,
    })
  }

  it('returns the payload on success', () => {
    const cookie = makePayload()
    const payload = verifyOAuthState({
      cookie,
      expectedUserId: 'u1',
      expectedProviderKey: 'gmail',
      expectedState: 's',
      now,
    })
    expect(payload.userId).toBe('u1')
  })

  it('throws OAuthStateError(invalid_cookie) when cookie missing', () => {
    expect(() =>
      verifyOAuthState({ cookie: null, expectedUserId: 'u1', now }),
    ).toThrow(OAuthStateError)
  })

  it('throws OAuthStateError(expired) when past TTL', () => {
    const cookie = makePayload({ expiresAt: now - 1 })
    try {
      verifyOAuthState({ cookie, expectedUserId: 'u1', now })
      fail('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthStateError)
      expect((err as OAuthStateError).code).toBe('expired')
    }
  })

  it('throws OAuthStateError(user_mismatch) on different user', () => {
    const cookie = makePayload()
    try {
      verifyOAuthState({ cookie, expectedUserId: 'u2', now })
      fail('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthStateError)
      expect((err as OAuthStateError).code).toBe('user_mismatch')
    }
  })

  it('throws on providerKey mismatch when expected', () => {
    const cookie = makePayload({ providerKey: 'gmail' })
    try {
      verifyOAuthState({ cookie, expectedUserId: 'u1', expectedProviderKey: 'imap', now })
      fail('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthStateError)
      expect((err as OAuthStateError).code).toBe('invalid_cookie')
    }
  })

  it('throws on state nonce mismatch when expected', () => {
    const cookie = makePayload({ state: 's' })
    try {
      verifyOAuthState({ cookie, expectedUserId: 'u1', expectedState: 'different', now })
      fail('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthStateError)
      expect((err as OAuthStateError).code).toBe('invalid_cookie')
    }
  })
})

describe('consumeOAuthStateOnce', () => {
  function createMemoryStore(): OAuthStateConsumeStore & {
    entries: Map<string, { value: unknown; expiresAt: number | null }>
  } {
    const entries = new Map<string, { value: unknown; expiresAt: number | null }>()
    return {
      entries,
      async has(key: string) {
        const entry = entries.get(key)
        if (!entry) return false
        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
          entries.delete(key)
          return false
        }
        return true
      },
      async set(key: string, value: unknown, options?: { ttl?: number }) {
        entries.set(key, {
          value,
          expiresAt: options?.ttl ? Date.now() + options.ttl : null,
        })
      },
    }
  }

  it('allows the first consume and rejects a replay of the same state', async () => {
    const store = createMemoryStore()
    const payload = {
      state: 'replay-state-' + Math.random().toString(36).slice(2),
      tenantId: 'tenant-1',
      expiresAt: Date.now() + 60_000,
    }

    await consumeOAuthStateOnce(store, payload)
    expect(await store.has(oauthStateConsumedCacheKey(payload.tenantId, payload.state))).toBe(true)

    await expect(consumeOAuthStateOnce(store, payload)).rejects.toMatchObject({
      name: 'OAuthStateError',
      code: 'replay',
    })
  })

  it('stores the used-marker with a TTL bounded by expiresAt', async () => {
    const store = createMemoryStore()
    const now = Date.now()
    const payload = { state: 'ttl-state', tenantId: 'tenant-1', expiresAt: now + 12_000 }

    await consumeOAuthStateOnce(store, payload, now)

    const entry = store.entries.get(oauthStateConsumedCacheKey(payload.tenantId, payload.state))
    expect(entry).toBeDefined()
    expect(entry!.expiresAt).toBeGreaterThanOrEqual(now + 12_000 - 50)
    expect(entry!.expiresAt).toBeLessThanOrEqual(now + 12_000 + 50)
  })

  it('concurrent contenders: pins the race behaviour (has→set is not atomic)', async () => {
    const store = createMemoryStore()
    const payload = {
      state: 'race-' + Math.random().toString(36).slice(2),
      tenantId: 'tenant-1',
      expiresAt: Date.now() + 60_000,
    }
    const results = await Promise.allSettled([
      consumeOAuthStateOnce(store, payload),
      consumeOAuthStateOnce(store, payload),
    ])
    // With a non-atomic has→set, both contenders may pass the has check and both
    // proceed. If the implementation later adds atomic setNx this test will fail
    // loudly, which is the point.
    const fulfilled = results.filter(r => r.status === 'fulfilled')
    const rejected = results.filter(r => r.status === 'rejected')
    // Pin non-atomic store behaviour: both contenders pass has→set and succeed.
    expect(fulfilled).toHaveLength(2)
    expect(rejected).toHaveLength(0)
  })

  it('verify alone still succeeds on replay — consume is what enforces single-use', () => {
    // Regression guard for #3836: crypto verify is intentionally TTL-only;
    // single-use is the consume step's job (callback must call both).
    const cookie = encryptOAuthState({
      state: 's',
      nonce: 'n',
      userId: 'u1',
      tenantId: 't1',
      providerKey: 'gmail',
      expiresAt: Date.now() + 60_000,
    })
    const first = verifyOAuthState({ cookie, expectedUserId: 'u1', expectedState: 's' })
    const second = verifyOAuthState({ cookie, expectedUserId: 'u1', expectedState: 's' })
    expect(first.state).toBe(second.state)
  })
})

describe('createOAuthState', () => {
  it('produces a payload with non-empty state and nonce', () => {
    const { payload, cookie, stateParam } = createOAuthState({
      userId: 'u',
      tenantId: 't',
      providerKey: 'gmail',
    })
    expect(payload.state.length).toBeGreaterThan(0)
    expect(payload.nonce.length).toBeGreaterThan(0)
    expect(payload.expiresAt).toBeGreaterThan(Date.now())
    expect(payload.providerKey).toBe('gmail')
    expect(stateParam).toBe(payload.state)
    expect(typeof cookie).toBe('string')
    expect(cookie.length).toBeGreaterThan(0)
  })

  it('passes through extras for adapter-specific data', () => {
    const { payload } = createOAuthState({
      userId: 'u',
      tenantId: 't',
      providerKey: 'gmail',
      extra: { codeVerifier: 'pkce-verifier' },
    })
    expect(payload.extra).toEqual({ codeVerifier: 'pkce-verifier' })
  })

  it('refuses to encrypt when no secret is configured', () => {
    const previous = process.env.OM_HUB_OAUTH_STATE_KEY
    const previousJwt = process.env.JWT_SECRET
    const previousKms = process.env.KMS_MASTER_KEY
    delete process.env.OM_HUB_OAUTH_STATE_KEY
    delete process.env.JWT_SECRET
    delete process.env.KMS_MASTER_KEY
    try {
      expect(() =>
        createOAuthState({ userId: 'u', tenantId: 't', providerKey: 'gmail' }),
      ).toThrow(OAuthStateError)
    } finally {
      if (previous !== undefined) process.env.OM_HUB_OAUTH_STATE_KEY = previous
      if (previousJwt !== undefined) process.env.JWT_SECRET = previousJwt
      if (previousKms !== undefined) process.env.KMS_MASTER_KEY = previousKms
    }
  })
})

describe('JWT_SECRET fallback key separation', () => {
  const saved = {
    stateKey: process.env.OM_HUB_OAUTH_STATE_KEY,
    kms: process.env.KMS_MASTER_KEY,
    jwt: process.env.JWT_SECRET,
    nodeEnv: process.env.NODE_ENV,
  }

  beforeEach(() => {
    delete process.env.OM_HUB_OAUTH_STATE_KEY
    delete process.env.KMS_MASTER_KEY
    process.env.JWT_SECRET = 'platform-session-signing-secret'
  })

  afterEach(() => {
    if (saved.stateKey !== undefined) process.env.OM_HUB_OAUTH_STATE_KEY = saved.stateKey
    else delete process.env.OM_HUB_OAUTH_STATE_KEY
    if (saved.kms !== undefined) process.env.KMS_MASTER_KEY = saved.kms
    else delete process.env.KMS_MASTER_KEY
    if (saved.jwt !== undefined) process.env.JWT_SECRET = saved.jwt
    else delete process.env.JWT_SECRET
    if (saved.nodeEnv !== undefined) process.env.NODE_ENV = saved.nodeEnv
    else delete process.env.NODE_ENV
  })

  it('refuses the JWT_SECRET fallback in production', () => {
    process.env.NODE_ENV = 'production'
    // Both the create (encrypt) and verify (decrypt) key derivations refuse the
    // JWT_SECRET fallback. encryptOAuthState propagates the guard error; the
    // decrypt path swallows it (returns null) by design, so we assert against the
    // two functions that surface it: createOAuthState and encryptOAuthState.
    expect(() => createOAuthState({ userId: 'u', tenantId: 't', providerKey: 'gmail' })).toThrow(
      'OM_HUB_OAUTH_STATE_KEY or KMS_MASTER_KEY required in production',
    )
    expect(() =>
      encryptOAuthState({
        state: 's',
        nonce: 'n',
        userId: 'u',
        tenantId: 't',
        providerKey: 'gmail',
        expiresAt: Date.now() + 60_000,
      }),
    ).toThrow('OM_HUB_OAUTH_STATE_KEY or KMS_MASTER_KEY required in production')
  })

  it('allows the JWT_SECRET fallback outside production', () => {
    process.env.NODE_ENV = 'test'
    const { cookie } = createOAuthState({ userId: 'u', tenantId: 't', providerKey: 'gmail' })
    const payload = verifyOAuthState({ cookie, expectedUserId: 'u' })
    expect(payload.userId).toBe('u')
  })
})

describe('emitOAuthStateMemoryCacheStartupWarningIfNeeded', () => {
  beforeEach(() => {
    resetOAuthStateMemoryCacheStartupWarningForTests()
    mockLoggerWarn.mockClear()
  })

  it('warns once when CACHE_STRATEGY is memory (or unset)', () => {
    emitOAuthStateMemoryCacheStartupWarningIfNeeded({ CACHE_STRATEGY: 'memory' })
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
    expect(mockLoggerWarn.mock.calls[0][1]).toMatchObject({
      context: 'startup',
      startup: true,
      cacheStrategy: 'memory',
    })

    mockLoggerWarn.mockClear()
    emitOAuthStateMemoryCacheStartupWarningIfNeeded({ CACHE_STRATEGY: 'memory' })
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('is silent when CACHE_STRATEGY is redis', () => {
    emitOAuthStateMemoryCacheStartupWarningIfNeeded({ CACHE_STRATEGY: 'redis' })
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})

describe('OAuth return URL validation', () => {
  it('accepts same-origin relative paths with query and hash', () => {
    expect(isSafeOAuthReturnUrl('/backend/profile/communication-channels?tab=email#gmail')).toBe(true)
    expect(normalizeOAuthReturnUrl('/backend/profile/communication-channels?tab=email#gmail')).toBe(
      '/backend/profile/communication-channels?tab=email#gmail',
    )
  })

  it.each([
    'https://evil.example/backend/profile',
    '//evil.example/backend/profile',
    '/\\evil',
    'backend/profile',
    '',
  ])('rejects unsafe return URL %s', (value) => {
    expect(isSafeOAuthReturnUrl(value)).toBe(false)
    expect(normalizeOAuthReturnUrl(value)).toBe(DEFAULT_OAUTH_RETURN_URL)
  })
})
