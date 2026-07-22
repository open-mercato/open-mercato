import {
  TenantEncryptionSubscriber,
  decryptEntitiesWithFallbackScope,
} from '../subscriber'
import type { TenantDataEncryptionService } from '../tenantDataEncryptionService'

// Give every entity a resolvable id so the real decrypt() path proceeds to decryptEntityPayload.
jest.mock('../entityIds', () => ({
  resolveEntityIdFromMetadata: jest.fn(() => 'customers:customer_address'),
}))

describe('decryptEntitiesWithFallbackScope subscriber memoization (issue #2235)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    delete process.env.TENANT_DATA_ENCRYPTION
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
    jest.restoreAllMocks()
  })

  function makeService(): TenantDataEncryptionService {
    return { isEnabled: () => true } as unknown as TenantDataEncryptionService
  }

  function makeEm() {
    return {} as { getMetadata?: () => unknown; getComparator?: () => unknown }
  }

  it('reuses a single subscriber instance across calls with the same service', async () => {
    const seen: TenantEncryptionSubscriber[] = []
    jest
      .spyOn(TenantEncryptionSubscriber.prototype, 'decryptEntityGraph')
      .mockImplementation(async function (this: TenantEncryptionSubscriber) {
        seen.push(this)
      })

    const service = makeService()
    const em = makeEm()

    await decryptEntitiesWithFallbackScope({ id: 'a' }, { em, encryptionService: service })
    await decryptEntitiesWithFallbackScope({ id: 'b' }, { em, encryptionService: service })
    await decryptEntitiesWithFallbackScope([{ id: 'c' }, { id: 'd' }], { em, encryptionService: service })

    expect(seen).toHaveLength(4)
    const first = seen[0]
    expect(seen.every((subscriber) => subscriber === first)).toBe(true)
  })

  it('uses a distinct subscriber per service instance', async () => {
    const seen: TenantEncryptionSubscriber[] = []
    jest
      .spyOn(TenantEncryptionSubscriber.prototype, 'decryptEntityGraph')
      .mockImplementation(async function (this: TenantEncryptionSubscriber) {
        seen.push(this)
      })

    const em = makeEm()
    const serviceA = makeService()
    const serviceB = makeService()

    await decryptEntitiesWithFallbackScope({ id: 'a' }, { em, encryptionService: serviceA })
    await decryptEntitiesWithFallbackScope({ id: 'b' }, { em, encryptionService: serviceB })
    await decryptEntitiesWithFallbackScope({ id: 'c' }, { em, encryptionService: serviceA })

    expect(seen).toHaveLength(3)
    expect(seen[0]).toBe(seen[2])
    expect(seen[0]).not.toBe(seen[1])
  })

  it('skips decryption entirely when the service is disabled', async () => {
    const spy = jest
      .spyOn(TenantEncryptionSubscriber.prototype, 'decryptEntityGraph')
      .mockImplementation(async () => {})

    const disabled = { isEnabled: () => false } as unknown as TenantDataEncryptionService
    await decryptEntitiesWithFallbackScope({ id: 'a' }, { em: makeEm(), encryptionService: disabled })

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('decryptEntitiesWithFallbackScope per-row scope (multi-org safety)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
    jest.restoreAllMocks()
  })

  // Records the (tenantId, organizationId) each row is decrypted with. `decryptEntityPayload` is the
  // exact seam where the row's resolved scope is applied, so capturing its args proves which org key
  // each row decrypts under.
  function makeRecordingService(): {
    service: TenantDataEncryptionService
    calls: Array<{ tenantId: string | null; organizationId: string | null; row: Record<string, unknown> }>
  } {
    const calls: Array<{ tenantId: string | null; organizationId: string | null; row: Record<string, unknown> }> = []
    const service = {
      isEnabled: () => true,
      decryptEntityPayload: jest.fn(
        async (_entityId: string, target: Record<string, unknown>, tenantId: string | null, organizationId: string | null) => {
          calls.push({ tenantId, organizationId, row: target })
          return {}
        },
      ),
    } as unknown as TenantDataEncryptionService
    return { service, calls }
  }

  // A bare entity carrying its own scope + empty metadata (so the deep-decrypt prop loop is a no-op).
  const row = (organizationId: string | null) => ({
    organizationId,
    tenantId: 'tenant-1',
    __meta: { properties: {} },
  })

  it('decrypts each row with the row’s OWN organization, using the fallback org only when a row lacks one', async () => {
    const { service, calls } = makeRecordingService()
    const orgA = 'org-a'
    const orgB = 'org-b'
    const fallbackOrg = 'org-fallback'

    const rowA = row(orgA)
    const rowB = row(orgB)
    const rowNoOrg = row(null)

    // Mirrors the deals-map route under an "All organizations" scope: a single fallback org
    // (orgFilterIds[0]) is passed, but the rows span multiple orgs.
    await decryptEntitiesWithFallbackScope([rowA, rowB, rowNoOrg], {
      em: {} as { getMetadata?: () => unknown; getComparator?: () => unknown },
      tenantId: 'tenant-1',
      organizationId: fallbackOrg,
      encryptionService: service,
    })

    const orgFor = (target: Record<string, unknown>) =>
      calls.find((call) => call.row === target)?.organizationId

    // Each scoped row decrypts with its OWN org — NOT the orgFilterIds[0] fallback. This is what makes
    // the route's single-fallback decryptionScope safe across a multi-org page.
    expect(orgFor(rowA)).toBe(orgA)
    expect(orgFor(rowB)).toBe(orgB)
    // Only a row that carries no org of its own falls back to orgFilterIds[0].
    expect(orgFor(rowNoOrg)).toBe(fallbackOrg)
    expect(calls).toHaveLength(3)
  })
})
