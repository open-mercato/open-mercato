import {
  TenantEncryptionSubscriber,
  decryptEntitiesWithFallbackScope,
} from '../subscriber'
import type { TenantDataEncryptionService } from '../tenantDataEncryptionService'

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
