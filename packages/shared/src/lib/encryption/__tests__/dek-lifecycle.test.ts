import { decryptWithAesGcm, generateDek } from '../aes'
import { HashicorpVaultKmsService, type KmsService, type TenantDek } from '../kms'
import { TenantDataEncryptionService } from '../tenantDataEncryptionService'

const originalEnv = { ...process.env }

type DuckResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

function jsonResponse(status: number, body: Record<string, unknown>): DuckResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

// Minimal in-memory Vault KV v2 simulator: GET reads the stored key, POST writes
// it unless a `cas: 0` write loses to an existing version (concurrent create).
function makeVaultSim() {
  const store = new Map<string, string>()
  const counts = { reads: 0, posts: 0, persisted: 0 }
  const fetchMock = jest.fn(async (input: unknown, init?: RequestInit): Promise<DuckResponse> => {
    const url = String(input)
    const path = url.slice(url.indexOf('/v1/') + '/v1/'.length)
    const method = (init?.method || 'GET').toUpperCase()
    if (method === 'GET') {
      counts.reads++
      const key = store.get(path)
      if (!key) return jsonResponse(404, { errors: [] })
      return jsonResponse(200, { data: { data: { key } } })
    }
    counts.posts++
    const body = init?.body ? (JSON.parse(String(init.body)) as { data?: { key?: string }; options?: { cas?: number } }) : {}
    const cas = body.options?.cas
    if (cas === 0 && store.has(path)) {
      return jsonResponse(400, { errors: ['check-and-set parameter did not match the current version'] })
    }
    store.set(path, body.data?.key ?? '')
    counts.persisted++
    return jsonResponse(200, { data: { version: 1 } })
  })
  return { store, counts, fetchMock }
}

function installFetch(fetchMock: jest.Mock) {
  ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
}

const fixedKey = (fill: number) => Buffer.alloc(32, fill).toString('base64')

describe('HashicorpVaultKmsService DEK creation race (issue #2746)', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  it('reuses an existing Vault DEK instead of overwriting it (read-before-write)', async () => {
    const { store, counts, fetchMock } = makeVaultSim()
    installFetch(fetchMock)
    const service = new HashicorpVaultKmsService({ vaultAddr: 'http://vault.test', vaultToken: 'token' })
    const existingKey = fixedKey(7)
    store.set('secret/data/tenant_key_tenant-existing', existingKey)

    const dek = await service.createTenantDek('tenant-existing')

    expect(dek?.key).toBe(existingKey)
    expect(counts.persisted).toBe(0) // never overwrote the active key
  })

  it('converges concurrent createTenantDek calls on a single key via CAS', async () => {
    const { counts, fetchMock } = makeVaultSim()
    installFetch(fetchMock)
    const service = new HashicorpVaultKmsService({ vaultAddr: 'http://vault.test', vaultToken: 'token' })

    const [a, b] = await Promise.all([
      service.createTenantDek('tenant-cas'),
      service.createTenantDek('tenant-cas'),
    ])

    expect(a?.key).toBeTruthy()
    expect(a?.key).toBe(b?.key) // both adopt the same winning key — no orphaned rows
    expect(counts.persisted).toBe(1) // exactly one key persisted, last-write-wins eliminated
  })

  it('invalidateDek forces a re-read from Vault', async () => {
    const { store, counts, fetchMock } = makeVaultSim()
    installFetch(fetchMock)
    const service = new HashicorpVaultKmsService({ vaultAddr: 'http://vault.test', vaultToken: 'token' })
    const path = 'secret/data/tenant_key_tenant-inv'
    store.set(path, fixedKey(3))

    const first = await service.getTenantDek('tenant-inv')
    await service.getTenantDek('tenant-inv') // served from the KMS TTL cache
    expect(counts.reads).toBe(1)

    store.set(path, fixedKey(9)) // operator rotates the key in Vault
    service.invalidateDek('tenant-inv')
    const rotated = await service.getTenantDek('tenant-inv')

    expect(counts.reads).toBe(2)
    expect(rotated?.key).not.toBe(first?.key)
  })
})

describe('TenantDataEncryptionService DEK lifecycle (issue #2746)', () => {
  const entityId = 'customers:person'
  let tenantSeq = 0
  const uniqueTenant = (label: string) => `tenant-${label}-2746-${tenantSeq++}`

  afterEach(() => {
    jest.restoreAllMocks()
  })

  function makeCreatingKms() {
    const created: string[] = []
    const kms: KmsService = {
      isHealthy: () => true,
      getTenantDek: jest.fn(async (): Promise<TenantDek | null> => null),
      createTenantDek: jest.fn(async (tenantId: string): Promise<TenantDek | null> => {
        const key = generateDek()
        created.push(key)
        return { tenantId, key, fetchedAt: Date.now() }
      }),
    }
    return { kms, created }
  }

  function makeFetchingKms() {
    const kms: KmsService = {
      isHealthy: () => true,
      getTenantDek: jest.fn(async (tenantId: string): Promise<TenantDek | null> => ({
        tenantId,
        key: generateDek(),
        fetchedAt: Date.now(),
      })),
      createTenantDek: jest.fn(async (): Promise<TenantDek | null> => null),
    }
    return { kms }
  }

  it('dedupes concurrent first-time DEK creation so no row is orphaned', async () => {
    const { kms, created } = makeCreatingKms()
    const service = new TenantDataEncryptionService({} as never, { kms })
    jest.spyOn(service, 'isEnabled').mockReturnValue(true)
    ;(service as unknown as { getMap: () => Promise<{ entityId: string; fields: { field: string }[] }> }).getMap =
      jest.fn(async () => ({ entityId, fields: [{ field: 'secret' }] }))
    const tenantId = uniqueTenant('race')

    const rows = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        service.encryptEntityPayload(entityId, { secret: `value-${i}` }, tenantId),
      ),
    )

    expect((kms.createTenantDek as jest.Mock)).toHaveBeenCalledTimes(1)
    expect(new Set(created).size).toBe(1)

    const dek = await service.getDek(tenantId)
    expect(dek).not.toBeNull()
    rows.forEach((row, i) => {
      expect(decryptWithAesGcm(String(row.secret), (dek as TenantDek).key)).toBe(`value-${i}`)
    })
  })

  it('re-fetches a cached DEK after the TTL elapses (no stale key after rotation)', async () => {
    const { kms } = makeFetchingKms()
    const service = new TenantDataEncryptionService({} as never, { kms })
    const tenantId = uniqueTenant('ttl')
    let now = 1_700_000_000_000
    jest.spyOn(Date, 'now').mockImplementation(() => now)

    await service.getDek(tenantId)
    await service.getDek(tenantId)
    expect((kms.getTenantDek as jest.Mock)).toHaveBeenCalledTimes(1) // cached within TTL

    now += 15 * 60 * 1000 + 1
    await service.getDek(tenantId)
    expect((kms.getTenantDek as jest.Mock)).toHaveBeenCalledTimes(2) // expired → re-fetch
  })

  it('invalidateDek clears both the service cache and the KMS cache', async () => {
    const { kms } = makeFetchingKms()
    const kmsInvalidate = jest.fn()
    ;(kms as KmsService).invalidateDek = kmsInvalidate
    const service = new TenantDataEncryptionService({} as never, { kms })
    const tenantId = uniqueTenant('invalidate')

    await service.getDek(tenantId)
    await service.getDek(tenantId)
    expect((kms.getTenantDek as jest.Mock)).toHaveBeenCalledTimes(1)

    service.invalidateDek(tenantId)
    expect(kmsInvalidate).toHaveBeenCalledWith(tenantId)

    await service.getDek(tenantId)
    expect((kms.getTenantDek as jest.Mock)).toHaveBeenCalledTimes(2)
  })
})
