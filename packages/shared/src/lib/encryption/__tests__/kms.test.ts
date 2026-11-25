import crypto from 'node:crypto'
import { buildDerivedKeyFallbackBannerLines, createKmsService, HashicorpVaultKmsService } from '../kms'

jest.mock('../../logger', () => {
  const warn = jest.fn()
  const logger: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn,
    error: jest.fn(),
  }
  logger.child = () => logger
  return { createLogger: () => logger, __warn: warn }
})

const loggerModule = jest.requireMock('../../logger') as { __warn: jest.Mock }
const originalEnv = { ...process.env }

describe('kms timeout handling', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  it('marks Vault unhealthy after a timed out write', async () => {
    // createTenantDek now reads-before-write (#2746): the read probe answers fast
    // with no existing key so the flow reaches the write, which then times out.
    const fetchMock = jest.fn((_url: string, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase()
      if (method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { data: {} } }) })
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch

    const service = new HashicorpVaultKmsService({
      vaultAddr: 'http://vault.test',
      vaultToken: 'token',
      requestTimeoutMs: 10,
    })

    await expect(service.createTenantDek('tenant-1')).resolves.toBeNull()
    expect(service.isHealthy()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2) // read probe + the timed-out write
  })

  it('falls back to derived keys after the primary Vault call times out', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    process.env.VAULT_ADDR = 'http://vault.test'
    process.env.VAULT_TOKEN = 'token'
    process.env.VAULT_REQUEST_TIMEOUT_MS = '10'
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = 'test-fallback-secret'

    const fetchMock = jest.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    )
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch

    const service = createKmsService()
    const dek = await service.createTenantDek('tenant-2')

    expect(dek?.tenantId).toBe('tenant-2')
    expect(typeof dek?.key).toBe('string')
    expect(dek?.key).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not derive tenant keys from auth secrets', async () => {
    process.env.NODE_ENV = 'production'
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    process.env.AUTH_SECRET = 'auth-secret-that-must-not-encrypt-tenant-data'
    process.env.NEXTAUTH_SECRET = 'nextauth-secret-that-must-not-encrypt-tenant-data'
    delete process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
    delete process.env.TENANT_DATA_ENCRYPTION_KEY
    delete process.env.VAULT_ADDR
    delete process.env.VAULT_TOKEN

    const service = createKmsService()
    const dek = await service.createTenantDek('tenant-auth-only')

    expect(service.isHealthy()).toBe(false)
    expect(dek).toBeNull()
  })

  it('never prints the explicit fallback secret or a deterministic verifier in the banner', () => {
    const secret = 'super-secret-tenant-encryption-key'
    const fingerprint = crypto.createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 16)
    for (const nodeEnv of ['development', 'staging', 'preview', 'PRODUCTION', 'production', undefined]) {
      if (nodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = nodeEnv

      const lines = buildDerivedKeyFallbackBannerLines({
        secret,
        source: 'explicit',
        envName: 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY',
      })
      const rendered = lines.join('\n')

      expect(rendered).not.toContain(secret)
      expect(rendered).not.toContain(fingerprint)
      expect(rendered).not.toMatch(/fingerprint|sha-?256/i)
      expect(rendered).toContain('Source: TENANT_DATA_ENCRYPTION_FALLBACK_KEY')
    }
  })

  it('logs fallback activation without the secret or a deterministic verifier', () => {
    const secret = 'structured-log-fallback-secret'
    const fingerprint = crypto.createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 16)
    process.env.NODE_ENV = 'production'
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = secret
    delete process.env.TENANT_DATA_ENCRYPTION_KEY
    delete process.env.VAULT_ADDR
    delete process.env.VAULT_TOKEN
    loggerModule.__warn.mockClear()
    const stderrWrite = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)

    createKmsService()

    const bannerOutput = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join('')
    const structuredOutput = JSON.stringify(loggerModule.__warn.mock.calls)
    for (const output of [bannerOutput, structuredOutput]) {
      expect(output).not.toContain(secret)
      expect(output).not.toContain(fingerprint)
      expect(output).not.toMatch(/secretFingerprint|sha-?256/i)
    }
    expect(bannerOutput).toContain('Source: TENANT_DATA_ENCRYPTION_FALLBACK_KEY')
    expect(loggerModule.__warn).toHaveBeenCalledWith(
      'Using derived tenant encryption keys (Vault unavailable / no DEK)',
      { fallbackSource: 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY' },
    )
  })

  it('does not echo the dev default secret verbatim in the banner either', () => {
    const lines = buildDerivedKeyFallbackBannerLines({
      secret: 'om-dev-tenant-encryption',
      source: 'dev-default',
      envName: 'DEV_DEFAULT',
    })
    const rendered = lines.join('\n')
    expect(rendered).not.toContain('om-dev-tenant-encryption')
    expect(rendered).toContain('Source: dev default secret (do NOT use in production)')
  })

  it('requires an explicit opt-in before using the dev default derived key', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    delete process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
    delete process.env.TENANT_DATA_ENCRYPTION_KEY
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    delete process.env.VAULT_ADDR
    delete process.env.VAULT_TOKEN

    const serviceWithoutOptIn = createKmsService()
    await expect(serviceWithoutOptIn.createTenantDek('tenant-dev')).resolves.toBeNull()

    process.env.ALLOW_DERIVED_KMS_FALLBACK = 'true'
    const serviceWithOptIn = createKmsService()
    const dek = await serviceWithOptIn.createTenantDek('tenant-dev')

    expect(typeof dek?.key).toBe('string')
    expect(dek?.key).toBeTruthy()
  })
})

describe('kms self-healing circuit breaker (#2661)', () => {
  const vaultAddr = 'http://vault.test'
  const vaultToken = 'token'

  afterEach(() => {
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  it('re-probes Vault and recovers after the cooldown window instead of staying unhealthy forever', async () => {
    let clock = 1_000_000
    jest.spyOn(Date, 'now').mockImplementation(() => clock)

    let calls = 0
    const fetchMock = jest.fn(() => {
      calls += 1
      if (calls === 1) {
        // First read hits a transient 5xx (Vault hiccup) → breaker opens.
        return Promise.resolve({ ok: false, status: 503, json: async () => ({}) })
      }
      // Vault is back: subsequent reads succeed.
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { data: { key: 'recovered-key' } } }) })
    })
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch

    const service = new HashicorpVaultKmsService({ vaultAddr, vaultToken, recoveryCooldownMs: 5_000 })

    // Transient failure flips the instance unhealthy.
    await expect(service.getTenantDek('tenant-1')).resolves.toBeNull()
    expect(service.isHealthy()).toBe(false)

    // Still within the cooldown: the breaker stays open.
    clock += 4_000
    expect(service.isHealthy()).toBe(false)

    // Past the cooldown: half-open — report healthy so the next call re-probes.
    clock += 2_000
    expect(service.isHealthy()).toBe(true)

    // The re-probe succeeds and the breaker fully closes (the never-recover bug).
    const dek = await service.getTenantDek('tenant-1')
    expect(dek?.key).toBe('recovered-key')
    expect(service.isHealthy()).toBe(true)
  })

  it('treats missing VAULT_ADDR/VAULT_TOKEN as a terminal failure that never self-heals', () => {
    let clock = 2_000_000
    jest.spyOn(Date, 'now').mockImplementation(() => clock)

    const service = new HashicorpVaultKmsService({ vaultAddr: '', vaultToken: '', recoveryCooldownMs: 5_000 })
    expect(service.isHealthy()).toBe(false)

    // No cooldown re-probe should ever revive a misconfigured instance.
    clock += 10_000_000
    expect(service.isHealthy()).toBe(false)
  })

  it('keeps Vault healthy on a 404 read so read-before-write DEK creation can proceed', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(3_000_000)

    const fetchMock = jest.fn((_url: string, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase()
      if (method === 'GET') {
        // KV v2 returns 404 for a not-yet-created tenant key — Vault is reachable.
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch

    const service = new HashicorpVaultKmsService({ vaultAddr, vaultToken })

    const dek = await service.createTenantDek('tenant-2')
    expect(typeof dek?.key).toBe('string')
    expect(dek?.key).toBeTruthy()
    expect(service.isHealthy()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2) // 404 read probe + the write
  })
})

describe('derived tenant keys (#8994)', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  function useDerivedKeys(secret: string) {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = secret
    delete process.env.TENANT_DATA_ENCRYPTION_KEY
    delete process.env.VAULT_ADDR
    delete process.env.VAULT_TOKEN
  }

  function legacyDerivedKey(secret: string, tenantId: string): string {
    const root = crypto.createHash('sha256').update(secret).digest()
    return crypto.pbkdf2Sync(root, tenantId, 310_000, 32, 'sha512').toString('base64')
  }

  it('derives the same key as before, so existing ciphertext stays readable', async () => {
    useDerivedKeys('derived-compat-secret')
    const dek = await createKmsService().getTenantDek('tenant-compat')
    expect(dek?.key).toBe(legacyDerivedKey('derived-compat-secret', 'tenant-compat'))
  })

  it('derives each tenant key once per process, asynchronously, across KMS instances', async () => {
    useDerivedKeys('derived-memo-secret')
    const asyncDerive = jest.spyOn(crypto, 'pbkdf2')
    const syncDerive = jest.spyOn(crypto, 'pbkdf2Sync')

    const first = createKmsService()
    const second = createKmsService()
    const keys = await Promise.all([
      first.getTenantDek('tenant-memo'),
      first.getTenantDek('tenant-memo'),
      second.getTenantDek('tenant-memo'),
      second.createTenantDek('tenant-memo'),
    ])

    expect(new Set(keys.map((dek) => dek?.key)).size).toBe(1)
    expect(asyncDerive).toHaveBeenCalledTimes(1)
    expect(syncDerive).not.toHaveBeenCalled()
  })

  it('keeps keys distinct per tenant and per fallback secret', async () => {
    useDerivedKeys('derived-scope-secret-a')
    const serviceA = createKmsService()
    const tenantOne = await serviceA.getTenantDek('tenant-one')
    const tenantTwo = await serviceA.getTenantDek('tenant-two')
    useDerivedKeys('derived-scope-secret-b')
    const otherSecret = await createKmsService().getTenantDek('tenant-one')

    expect(tenantOne?.key).not.toBe(tenantTwo?.key)
    expect(otherSecret?.key).not.toBe(tenantOne?.key)
    expect(otherSecret?.key).toBe(legacyDerivedKey('derived-scope-secret-b', 'tenant-one'))
  })

  it('does not memoize a failed derivation', async () => {
    useDerivedKeys('derived-failure-secret')
    const realDerive = crypto.pbkdf2
    const derive = jest.spyOn(crypto, 'pbkdf2')
    derive.mockImplementationOnce(((...args: unknown[]) => {
      const callback = args[args.length - 1] as (err: Error | null, key: Buffer) => void
      callback(new Error('derivation failed'), Buffer.alloc(0))
    }) as unknown as typeof crypto.pbkdf2)
    derive.mockImplementation(realDerive)

    const service = createKmsService()
    await expect(service.getTenantDek('tenant-failure')).rejects.toThrow('derivation failed')
    const recovered = await service.getTenantDek('tenant-failure')

    expect(recovered?.key).toBe(legacyDerivedKey('derived-failure-secret', 'tenant-failure'))
    expect(derive).toHaveBeenCalledTimes(2)
  })
})

describe('cached Vault keys during the breaker cooldown', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  it('serves a tenant key fetched before the outage instead of the derived fallback key', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    process.env.VAULT_ADDR = 'http://vault.test'
    process.env.VAULT_TOKEN = 'token'
    process.env.VAULT_RECOVERY_COOLDOWN_MS = String(60 * 60 * 1000)
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = 'cooldown-fallback-secret'
    const fetchMock = jest.fn(async (url: string) =>
      url.endsWith('tenant_key_tenant-cached')
        ? { ok: true, status: 200, json: async () => ({ data: { data: { key: 'vault-key' } } }) }
        : { ok: false, status: 503, json: async () => ({}) },
    )
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
    const service = createKmsService()

    await expect(service.getTenantDek('tenant-cached')).resolves.toMatchObject({ key: 'vault-key' })
    await service.getTenantDek('tenant-uncached')
    const readsAfterOutage = fetchMock.mock.calls.length

    expect(service.getCachedTenantDek?.('tenant-cached')?.key).toBe('vault-key')
    await expect(service.getTenantDek('tenant-cached')).resolves.toMatchObject({ key: 'vault-key' })
    expect(fetchMock.mock.calls.length).toBe(readsAfterOutage)
  })
})

describe('derived tenant key retention', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  function useDerivedKeys(secret: string) {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = secret
    delete process.env.TENANT_DATA_ENCRYPTION_KEY
    delete process.env.VAULT_ADDR
    delete process.env.VAULT_TOKEN
  }

  it('re-derives a tenant key once its retention window has passed', async () => {
    useDerivedKeys('retention-ttl-secret')
    process.env.OM_KMS_DERIVED_KEY_CACHE_TTL_MS = '1000'
    let clock = 5_000_000
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    const derive = jest.spyOn(crypto, 'pbkdf2')
    const service = createKmsService()

    const first = await service.getTenantDek('tenant-ttl')
    await service.getTenantDek('tenant-ttl')
    expect(derive).toHaveBeenCalledTimes(1)
    clock += 1_001
    const afterExpiry = await service.getTenantDek('tenant-ttl')

    expect(derive).toHaveBeenCalledTimes(2)
    expect(afterExpiry?.key).toBe(first?.key)
  })

  it('caps how many tenant keys it retains', async () => {
    useDerivedKeys('retention-cap-secret')
    process.env.OM_KMS_DERIVED_KEY_CACHE_MAX_ENTRIES = '1'
    const derive = jest.spyOn(crypto, 'pbkdf2')
    const service = createKmsService()

    await service.getTenantDek('tenant-cap-a')
    await service.getTenantDek('tenant-cap-b')
    await service.getTenantDek('tenant-cap-a')

    expect(derive).toHaveBeenCalledTimes(3)
  })

  it('still coalesces concurrent derivations when retention is off', async () => {
    useDerivedKeys('retention-off-secret')
    process.env.OM_KMS_DERIVED_KEY_CACHE_TTL_MS = '0'
    const derive = jest.spyOn(crypto, 'pbkdf2')
    const service = createKmsService()

    const keys = await Promise.all([service.getTenantDek('tenant-off'), service.getTenantDek('tenant-off')])
    await service.getTenantDek('tenant-off')

    expect(keys[0]?.key).toBe(keys[1]?.key)
    expect(derive).toHaveBeenCalledTimes(2)
  })
})
