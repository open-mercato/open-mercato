import { createKmsService, HashicorpVaultKmsService } from '../kms'

const originalEnv = { ...process.env }

describe('kms timeout handling', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  it('marks Vault unhealthy after a timed out write', async () => {
    const fetchMock = jest.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    )
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch

    const service = new HashicorpVaultKmsService({
      vaultAddr: 'http://vault.test',
      vaultToken: 'token',
      requestTimeoutMs: 10,
    })

    await expect(service.createTenantDek('tenant-1')).resolves.toBeNull()
    expect(service.isHealthy()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
})
