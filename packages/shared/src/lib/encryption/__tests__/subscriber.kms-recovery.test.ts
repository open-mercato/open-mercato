// Regression coverage for issue #5948: registration of the tenant-encryption ORM
// subscriber used to be gated on `kmsService.isHealthy()`, evaluated exactly once
// at bootstrap. A KMS outage overlapping process startup therefore left the
// subscriber unregistered — and at-rest encryption off — for the whole process
// lifetime, recoverable only by a restart.
//
// The fix registers on the static config toggle alone and leans on the
// subscriber's own per-operation `service.isEnabled()` check. These tests pin
// that contract: a subscriber registered while the KMS is down must start
// encrypting the moment the KMS recovers, with no re-registration, and must
// leave an ongoing (throttled) signal while it is failing open.

const warn = jest.fn()

jest.mock('../../logger', () => {
  const logger: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: (...args: unknown[]) => warn(...args),
    error: jest.fn(),
  }
  logger.child = () => logger
  return { createLogger: () => logger }
})

import { TenantEncryptionSubscriber, resetEncryptionPausedWarnThrottle } from '../subscriber'
import { registerEntityIds } from '../entityIds'
import type { TenantDataEncryptionService } from '../tenantDataEncryptionService'

const META = {
  className: 'Thing',
  tableName: 'things',
  properties: { secret: { name: 'secret', fieldName: 'secret' } },
} as any

function makeEm() {
  return { getComparator: () => undefined, getMetadata: () => undefined }
}

// Mirrors the production service: `isEnabled()` ANDs the static config toggle
// with the volatile KMS health flag, so it flips as Vault goes down and recovers.
function makeService(kms: { healthy: boolean }): TenantDataEncryptionService {
  return {
    isEnabled: () => kms.healthy,
    async encryptEntityPayload(_entityId: string, target: Record<string, unknown>) {
      return { secret: `enc:${String(target.secret)}` }
    },
    async decryptEntityPayload() {
      return {}
    },
  } as unknown as TenantDataEncryptionService
}

describe('TenantEncryptionSubscriber KMS recovery (issue #5948)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    delete process.env.TENANT_DATA_ENCRYPTION // default => encryption enabled
    registerEntityIds({ test: { thing: 'test:thing' } })
    resetEncryptionPausedWarnThrottle()
    warn.mockClear()
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
    jest.restoreAllMocks()
  })

  async function create(subscriber: TenantEncryptionSubscriber, entity: Record<string, unknown>) {
    await subscriber.beforeCreate({ entity, meta: META, em: makeEm() } as any)
  }

  it('resumes encrypting after the KMS recovers, without re-registering the subscriber', async () => {
    const kms = { healthy: false }
    // The single subscriber instance a boot-time registration would have produced.
    const subscriber = new TenantEncryptionSubscriber(makeService(kms))

    const duringOutage: Record<string, unknown> = { tenantId: 't1', secret: 'plain' }
    await create(subscriber, duringOutage)
    expect(duringOutage.secret).toBe('plain')

    // Vault comes back — the very same subscriber instance must start encrypting.
    kms.healthy = true
    const afterRecovery: Record<string, unknown> = { tenantId: 't1', secret: 'plain' }
    await create(subscriber, afterRecovery)
    expect(afterRecovery.secret).toBe('enc:plain')
  })

  it('warns while writes are failing open to plaintext, throttled to one line per window', async () => {
    const subscriber = new TenantEncryptionSubscriber(makeService({ healthy: false }))

    await create(subscriber, { tenantId: 't1', secret: 'a' })
    await create(subscriber, { tenantId: 't1', secret: 'b' })
    await create(subscriber, { tenantId: 't1', secret: 'c' })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/KMS is unavailable/)
    expect(warn.mock.calls[0][1]).toEqual({ entity: 'Thing' })
  })

  it('stays silent when encryption is deliberately disabled by config', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'false'
    const subscriber = new TenantEncryptionSubscriber(makeService({ healthy: false }))

    const entity: Record<string, unknown> = { tenantId: 't1', secret: 'plain' }
    await create(subscriber, entity)

    expect(entity.secret).toBe('plain')
    expect(warn).not.toHaveBeenCalled()
  })
})
