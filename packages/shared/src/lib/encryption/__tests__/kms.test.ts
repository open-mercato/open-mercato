import { createKmsService, HashicorpVaultKmsService } from '../kms'

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
