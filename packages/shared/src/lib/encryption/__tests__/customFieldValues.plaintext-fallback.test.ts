import {
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

const WARN_MESSAGE = 'Custom field configured as encrypted was stored as plaintext'

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
  } as any
}

describe('encryptCustomFieldValue plaintext fallback (regression: issue #5921)', () => {
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

  it('warns when an encrypted field falls back to plaintext because the DEK is unavailable', async () => {
    const service = unresolvableDekService()

    const stored = await encryptCustomFieldValue('secret', 'tenant-1', service, undefined, {
      entityId: 'customers:person',
      fieldKey: 'national_id',
    })

    expect(stored).toBe('secret')
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
    await encryptCustomFieldValue('super-secret-value', 'tenant-1', unresolvableDekService(), undefined, {
      entityId: 'customers:person',
      fieldKey: 'national_id',
    })

    expect(JSON.stringify(warnCalls()[0])).not.toContain('super-secret-value')
  })

  it('still warns when the caller does not identify the field', async () => {
    await encryptCustomFieldValue('secret', 'tenant-1', unresolvableDekService())

    expect(warnCalls()).toHaveLength(1)
    expect(warnCalls()[0][1]).toMatchObject({ tenantId: 'tenant-1', entity: null, field: null })
  })

  // The issue's own reproduction: VAULT_ADDR points at an unreachable Vault and
  // no fallback secret is set, so createKmsService() hands back a NoopKmsService
  // whose isHealthy() is false while TENANT_DATA_ENCRYPTION is on — which makes
  // service.isEnabled() false. Gating the warning on isEnabled() would go silent
  // in exactly this case, so it must be driven by the env toggle instead.
  it('warns when the KMS is unhealthy and the service therefore reports itself disabled', async () => {
    const unhealthyKms = {
      isEnabled: () => false,
      getDek: jest.fn(async () => null),
      createDek: jest.fn(async () => null),
    } as any

    const stored = await encryptCustomFieldValue('secret', 'tenant-1', unhealthyKms, undefined, {
      entityId: 'customers:person',
      fieldKey: 'national_id',
    })

    expect(stored).toBe('secret')
    expect(warnCalls()).toHaveLength(1)
  })

  it('stays silent for the intentional plaintext cases', async () => {
    // Operator deliberately runs unencrypted, so a plaintext write is correct.
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    expect(await encryptCustomFieldValue('plain', 'tenant-1', unresolvableDekService())).toBe('plain')
    delete process.env.TENANT_DATA_ENCRYPTION

    // No tenant scope, so there is no tenant DEK to resolve.
    expect(await encryptCustomFieldValue('plain', null, unresolvableDekService())).toBe('plain')
    expect(await encryptCustomFieldValue('plain', undefined, unresolvableDekService())).toBe('plain')
    // No encryption service wired at all.
    expect(await encryptCustomFieldValue('plain', 'tenant-1', null)).toBe('plain')
    // Null/undefined values are skipped before key resolution.
    expect(await encryptCustomFieldValue(null, 'tenant-1', unresolvableDekService())).toBe(null)

    expect(warnCalls()).toHaveLength(0)
  })

  it('warns once per tenant/entity/field so a key outage cannot flood the log', async () => {
    const service = unresolvableDekService()
    const field = { entityId: 'customers:person', fieldKey: 'national_id' }

    await encryptCustomFieldValue('a', 'tenant-1', service, undefined, field)
    await encryptCustomFieldValue('b', 'tenant-1', service, undefined, field)
    await encryptCustomFieldValue('c', 'tenant-1', service, undefined, field)

    expect(warnCalls()).toHaveLength(1)
  })

  it('reports each degraded field and tenant separately', async () => {
    const service = unresolvableDekService()

    await encryptCustomFieldValue('a', 'tenant-1', service, undefined, {
      entityId: 'customers:person',
      fieldKey: 'national_id',
    })
    await encryptCustomFieldValue('b', 'tenant-1', service, undefined, {
      entityId: 'customers:person',
      fieldKey: 'passport_no',
    })
    await encryptCustomFieldValue('c', 'tenant-2', service, undefined, {
      entityId: 'customers:person',
      fieldKey: 'national_id',
    })

    expect(warnCalls()).toHaveLength(3)
  })

  // Throttling for the whole process lifetime would report the first outage and
  // hide every later one — the exact blind spot this warning exists to remove.
  it('reports a second outage after the key has recovered in between', async () => {
    const field = { entityId: 'customers:person', fieldKey: 'national_id' }
    const recovered = { isEnabled: () => true, getDek: async () => ({ key: fixedKey }) } as any

    await encryptCustomFieldValue('a', 'tenant-1', unresolvableDekService(), undefined, field)
    expect(warnCalls()).toHaveLength(1)

    const encrypted = await encryptCustomFieldValue('b', 'tenant-1', recovered, undefined, field)
    expect(encrypted).not.toBe('b')

    await encryptCustomFieldValue('c', 'tenant-1', unresolvableDekService(), undefined, field)
    expect(warnCalls()).toHaveLength(2)
  })

  it('does not let one tenant recovering unthrottle another tenant still degraded', async () => {
    const field = { entityId: 'customers:person', fieldKey: 'national_id' }
    const recovered = { isEnabled: () => true, getDek: async () => ({ key: fixedKey }) } as any

    await encryptCustomFieldValue('a', 'tenant-1', unresolvableDekService(), undefined, field)
    await encryptCustomFieldValue('b', 'tenant-2', unresolvableDekService(), undefined, field)
    expect(warnCalls()).toHaveLength(2)

    await encryptCustomFieldValue('c', 'tenant-1', recovered, undefined, field)

    // tenant-2 never recovered, so its warning stays throttled.
    await encryptCustomFieldValue('d', 'tenant-2', unresolvableDekService(), undefined, field)
    expect(warnCalls()).toHaveLength(2)
  })
})
