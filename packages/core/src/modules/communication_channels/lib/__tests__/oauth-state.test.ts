import {
  COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME,
  COMMUNICATION_CHANNELS_OAUTH_STATE_TTL_MS,
  createOAuthState,
  decryptOAuthState,
  DEFAULT_OAUTH_RETURN_URL,
  encryptOAuthState,
  isSafeOAuthReturnUrl,
  normalizeOAuthReturnUrl,
  OAuthStateError,
  verifyOAuthState,
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
