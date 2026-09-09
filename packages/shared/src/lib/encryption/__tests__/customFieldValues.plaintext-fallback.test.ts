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
  beforeEach(() => {
    resetEncryptedFieldPlaintextFallbackWarnCache()
    loggerModule.__warn.mockClear()
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

  it('stays silent for the intentional plaintext cases', async () => {
    const disabled = { isEnabled: () => false, getDek: jest.fn(async () => null) } as any

    // Encryption feature turned off.
    expect(await encryptCustomFieldValue('plain', 'tenant-1', disabled)).toBe('plain')
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
})
