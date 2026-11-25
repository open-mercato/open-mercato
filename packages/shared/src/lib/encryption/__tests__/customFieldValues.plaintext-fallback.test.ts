import { isCrudHttpError } from '../../crud/errors'
import type { TenantDataEncryptionService } from '../tenantDataEncryptionService'
import {
  decryptCustomFieldValue,
  encryptCustomFieldValue,
  resetEncryptedFieldPlaintextFallbackWarnCache,
} from '../customFieldValues'

jest.mock('../../logger', () => {
  const warn = jest.fn()
  const debug = jest.fn()
  const info = jest.fn()
  const error = jest.fn()
  const child = jest.fn(() => ({ warn, debug, info, error }))
  return { createLogger: jest.fn(() => ({ child })), __warn: warn }
})

const loggerModule = jest.requireMock('../../logger') as { __warn: jest.Mock }

const WARN_MESSAGE = 'Encrypted custom field write rejected because the tenant key is unavailable'
const unavailableResponse = { status: 503, body: { code: 'ENCRYPTION_UNAVAILABLE', error: 'api.errors.serviceUnavailable' } }

async function expectUnavailable(write: Promise<unknown>) {
  await expect(write).rejects.toMatchObject(unavailableResponse)
}

const warnCalls = () =>
  loggerModule.__warn.mock.calls.filter(([message]) => message === WARN_MESSAGE)

const fixedKey = Buffer.alloc(32, 1).toString('base64')

/** Encryption is on and the tenant is scoped, but no DEK can be read or created. */
function unresolvableDekService(overrides: Record<string, unknown> = {}) {
  return {
    isEnabled: () => true,
    getDek: jest.fn(async () => null),
    createDek: jest.fn(async () => null),
    ...overrides,
  } as unknown as TenantDataEncryptionService
}

describe('encryptCustomFieldValue with an unavailable tenant key', () => {
  const previousToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    resetEncryptedFieldPlaintextFallbackWarnCache()
    loggerModule.__warn.mockClear()
    delete process.env.TENANT_DATA_ENCRYPTION
  })

  afterAll(() => {
    if (previousToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousToggle
  })

  it('rejects and warns when a tenant key cannot be read or created', async () => {
    const service = unresolvableDekService()

    const error = await encryptCustomFieldValue('secret', 'tenant-1', service, undefined, {
      entityId: 'customers:person',
      fieldKey: 'national_id',
    }).catch((cause: unknown) => cause)

    expect(isCrudHttpError(error)).toBe(true)
    expect(error).toMatchObject(unavailableResponse)
    expect(service.createDek).toHaveBeenCalledTimes(1)
    expect(warnCalls()).toHaveLength(1)
    const [, payload] = warnCalls()[0]
    expect(payload).toMatchObject({
      tenantId: 'tenant-1',
      entity: 'customers:person',
      field: 'national_id',
    })
    expect(typeof payload.hint).toBe('string')
  })

  it('never puts the field value in the warning payload', async () => {
    await expectUnavailable(encryptCustomFieldValue('super-secret-value', 'tenant-1', unresolvableDekService(), undefined, {
      entityId: 'customers:person',
      fieldKey: 'national_id',
    }))

    expect(JSON.stringify(warnCalls()[0])).not.toContain('super-secret-value')
  })

  it('still warns when the caller does not identify the field', async () => {
    await expectUnavailable(encryptCustomFieldValue('secret', 'tenant-1', unresolvableDekService()))

    expect(warnCalls()).toHaveLength(1)
    expect(warnCalls()[0][1]).toMatchObject({ tenantId: 'tenant-1', entity: null, field: null })
  })

  it('rejects when the encryption service is unhealthy or missing', async () => {
    await expectUnavailable(encryptCustomFieldValue('protected', 'tenant-1', unresolvableDekService({ isEnabled: () => false })))
    await expectUnavailable(encryptCustomFieldValue('protected', 'tenant-2', null))
    expect(warnCalls()).toHaveLength(2)
  })

  it.each(['getDek', 'createDek'])('maps a failing %s call to an unavailable-key error', async (method) => {
    const cause = new Error('[internal] test key provider failure')
    const service = unresolvableDekService({ [method]: jest.fn().mockRejectedValue(cause) })
    await expect(encryptCustomFieldValue('protected', 'tenant-1', service)).rejects.toMatchObject({
      ...unavailableResponse,
      cause,
    })
  })

  it('skips key access for cleared values or intentional plaintext writes', async () => {
    const service = unresolvableDekService()
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    await expect(encryptCustomFieldValue('plain', 'tenant-1', service)).resolves.toBe('plain')
    delete process.env.TENANT_DATA_ENCRYPTION

    await expect(encryptCustomFieldValue('plain', null, service)).resolves.toBe('plain')
    await expect(encryptCustomFieldValue('plain', undefined, service)).resolves.toBe('plain')
    await expect(encryptCustomFieldValue(null, 'tenant-1', service)).resolves.toBeNull()
    await expect(encryptCustomFieldValue(undefined, 'tenant-1', service)).resolves.toBeUndefined()

    expect(service.getDek).not.toHaveBeenCalled()
    expect(service.createDek).not.toHaveBeenCalled()
    expect(warnCalls()).toHaveLength(0)
  })

  it('can create a key for a write after a read cached a miss', async () => {
    const cache = new Map<string | null, string | null>()
    const service = unresolvableDekService({
      createDek: jest.fn(async () => ({ key: fixedKey })),
    })

    await expect(decryptCustomFieldValue('previous value', 'tenant-1', service, cache)).resolves.toBe('previous value')
    expect(cache.get('tenant-1')).toBeNull()
    expect(service.createDek).not.toHaveBeenCalled()

    const encrypted = await encryptCustomFieldValue('protected', 'tenant-1', service, cache)
    expect(service.createDek).toHaveBeenCalledTimes(1)
    expect(cache.get('tenant-1')).toBe(fixedKey)
    await expect(decryptCustomFieldValue(encrypted, 'tenant-1', service, cache)).resolves.toBe('protected')
  })

  it('warns once per tenant/entity/field so a key outage cannot flood the log', async () => {
    const service = unresolvableDekService()
    const field = { entityId: 'customers:person', fieldKey: 'national_id' }

    await expectUnavailable(encryptCustomFieldValue('a', 'tenant-1', service, undefined, field))
    await expectUnavailable(encryptCustomFieldValue('b', 'tenant-1', service, undefined, field))
    await expectUnavailable(encryptCustomFieldValue('c', 'tenant-1', service, undefined, field))

    expect(warnCalls()).toHaveLength(1)
  })

  it('reports each degraded field and tenant separately', async () => {
    const service = unresolvableDekService()

    await expectUnavailable(encryptCustomFieldValue('a', 'tenant-1', service, undefined, {
      entityId: 'customers:person',
      fieldKey: 'national_id',
    }))
    await expectUnavailable(encryptCustomFieldValue('b', 'tenant-1', service, undefined, {
      entityId: 'customers:person',
      fieldKey: 'passport_no',
    }))
    await expectUnavailable(encryptCustomFieldValue('c', 'tenant-2', service, undefined, {
      entityId: 'customers:person',
      fieldKey: 'national_id',
    }))

    expect(warnCalls()).toHaveLength(3)
  })

  // Throttling for the whole process lifetime would report the first outage and
  // hide every later one — the exact blind spot this warning exists to remove.
  it('reports a second outage after the key has recovered in between', async () => {
    const field = { entityId: 'customers:person', fieldKey: 'national_id' }
    const recovered = { isEnabled: () => true, getDek: async () => ({ key: fixedKey }) } as unknown as TenantDataEncryptionService

    await expectUnavailable(encryptCustomFieldValue('a', 'tenant-1', unresolvableDekService(), undefined, field))
    expect(warnCalls()).toHaveLength(1)

    const encrypted = await encryptCustomFieldValue('b', 'tenant-1', recovered, undefined, field)
    expect(encrypted).not.toBe('b')

    await expectUnavailable(encryptCustomFieldValue('c', 'tenant-1', unresolvableDekService(), undefined, field))
    expect(warnCalls()).toHaveLength(2)
  })

  // Regression: hitting the cap used to `.clear()` the whole set, un-throttling
  // every already-reported field at once (worst possible time — the log flood
  // the cap exists to prevent). It must evict only the single oldest entry.
  it('evicts only the oldest entry when the throttle cap is reached, not the whole set', async () => {
    const service = unresolvableDekService()
    const WARN_CAP = 5000
    const fieldAt = (i: number) => ({ entityId: 'customers:person', fieldKey: `field-${i}` })

    for (let i = 0; i < WARN_CAP; i += 1) {
      await expectUnavailable(encryptCustomFieldValue('v', 'tenant-1', service, undefined, fieldAt(i)))
    }
    expect(warnCalls()).toHaveLength(WARN_CAP)

    // One more distinct field crosses the cap and evicts field-0 (the oldest).
    await expectUnavailable(encryptCustomFieldValue('v', 'tenant-1', service, undefined, fieldAt(WARN_CAP)))
    expect(warnCalls()).toHaveLength(WARN_CAP + 1)

    // A still-degraded field reported well before the cap stays throttled.
    await expectUnavailable(encryptCustomFieldValue('v', 'tenant-1', service, undefined, fieldAt(WARN_CAP - 1)))
    expect(warnCalls()).toHaveLength(WARN_CAP + 1)

    // The evicted oldest entry is the one exception: it reports again.
    await expectUnavailable(encryptCustomFieldValue('v', 'tenant-1', service, undefined, fieldAt(0)))
    expect(warnCalls()).toHaveLength(WARN_CAP + 2)
  })

  it('does not let one tenant recovering unthrottle another tenant still degraded', async () => {
    const field = { entityId: 'customers:person', fieldKey: 'national_id' }
    const recovered = { isEnabled: () => true, getDek: async () => ({ key: fixedKey }) } as unknown as TenantDataEncryptionService

    await expectUnavailable(encryptCustomFieldValue('a', 'tenant-1', unresolvableDekService(), undefined, field))
    await expectUnavailable(encryptCustomFieldValue('b', 'tenant-2', unresolvableDekService(), undefined, field))
    expect(warnCalls()).toHaveLength(2)

    await encryptCustomFieldValue('c', 'tenant-1', recovered, undefined, field)

    // tenant-2 never recovered, so its warning stays throttled.
    await expectUnavailable(encryptCustomFieldValue('d', 'tenant-2', unresolvableDekService(), undefined, field))
    expect(warnCalls()).toHaveLength(2)
  })
})
