import {
  normalizeColumnName,
  resetCiphertextLikeWarnCache,
  warnOnCiphertextLikeFallback,
} from '../ciphertext-search-warning'
import { createLogger } from '../../logger'

jest.mock('../../logger', () => {
  const warn = jest.fn()
  const debug = jest.fn()
  const child = jest.fn(() => ({ warn, debug }))
  return { createLogger: jest.fn(() => ({ child })), __warn: warn, __debug: debug }
})

const loggerModule = jest.requireMock('../../logger') as { __warn: jest.Mock; __debug: jest.Mock }

function createService(encryptedFields: string[], overrides: Record<string, unknown> = {}) {
  return {
    isEnabled: () => true,
    getEncryptedFieldNames: jest.fn(async () => encryptedFields),
    ...overrides,
  }
}

describe('warnOnCiphertextLikeFallback', () => {
  beforeEach(() => {
    resetCiphertextLikeWarnCache()
    loggerModule.__warn.mockClear()
    loggerModule.__debug.mockClear()
  })

  it('warns when the filtered column is covered by an encryption map', async () => {
    const service = createService(['email', 'display_name'])
    await warnOnCiphertextLikeFallback({
      entity: 'customers:customer_entity',
      fields: ['display_name'],
      tenantId: 'tenant-1',
      reason: 'no-search-tokens',
      service,
    })

    expect(loggerModule.__warn).toHaveBeenCalledTimes(1)
    const [message, payload] = loggerModule.__warn.mock.calls[0]
    expect(message).toBe('Text search filter cannot match an encrypted column')
    expect(payload).toMatchObject({
      entity: 'customers:customer_entity',
      field: 'display_name',
      reason: 'no-search-tokens',
    })
  })

  it('stays quiet for columns outside the encryption map', async () => {
    await warnOnCiphertextLikeFallback({
      entity: 'currencies:currency',
      fields: ['code', 'symbol'],
      tenantId: 'tenant-1',
      reason: 'no-search-tokens',
      service: createService(['unrelated']),
    })
    expect(loggerModule.__warn).not.toHaveBeenCalled()
  })

  it('does not cache a non-encrypted lookup as already warned', async () => {
    await warnOnCiphertextLikeFallback({
      entity: 'auth:user', fields: ['email'], tenantId: 'tenant-1', reason: 'no-search-tokens', service: createService([]),
    })
    await warnOnCiphertextLikeFallback({
      entity: 'auth:user', fields: ['email'], tenantId: 'tenant-1', reason: 'no-search-tokens', service: createService(['email']),
    })
    expect(loggerModule.__warn).toHaveBeenCalledTimes(1)
  })

  it('matches camelCase filter fields against snake_case map entries', async () => {
    await warnOnCiphertextLikeFallback({
      entity: 'checkout:checkout_transaction',
      fields: ['firstName'],
      tenantId: null,
      reason: 'no-search-tokens',
      service: createService(['first_name']),
    })
    expect(loggerModule.__warn).toHaveBeenCalledTimes(1)
    expect(loggerModule.__warn.mock.calls[0][1]).toMatchObject({ field: 'first_name' })
  })

  it('warns once per entity, tenant and field', async () => {
    const service = createService(['email'])
    const params = {
      entity: 'auth:user',
      fields: ['email'],
      tenantId: 'tenant-1',
      reason: 'no-search-tokens' as const,
      service,
    }
    await warnOnCiphertextLikeFallback(params)
    await warnOnCiphertextLikeFallback(params)
    await warnOnCiphertextLikeFallback(params)

    expect(loggerModule.__warn).toHaveBeenCalledTimes(1)
    expect(service.getEncryptedFieldNames).toHaveBeenCalledTimes(1)
  })

  it('warns separately for a different tenant', async () => {
    const service = createService(['email'])
    await warnOnCiphertextLikeFallback({
      entity: 'auth:user', fields: ['email'], tenantId: 'tenant-1', reason: 'no-search-tokens', service,
    })
    await warnOnCiphertextLikeFallback({
      entity: 'auth:user', fields: ['email'], tenantId: 'tenant-2', reason: 'no-search-tokens', service,
    })
    expect(loggerModule.__warn).toHaveBeenCalledTimes(2)
  })

  it('does nothing when encryption is unavailable or disabled', async () => {
    await warnOnCiphertextLikeFallback({
      entity: 'auth:user', fields: ['email'], tenantId: null, reason: 'no-search-tokens', service: null,
    })
    await warnOnCiphertextLikeFallback({
      entity: 'auth:user',
      fields: ['email'],
      tenantId: null,
      reason: 'no-search-tokens',
      service: createService(['email'], { isEnabled: () => false }),
    })
    expect(loggerModule.__warn).not.toHaveBeenCalled()
  })

  it('ignores custom-field filters', async () => {
    const service = createService(['cf:secret_note'])
    await warnOnCiphertextLikeFallback({
      entity: 'example:todo', fields: ['cf:secret_note'], tenantId: null, reason: 'no-search-tokens', service,
    })
    expect(service.getEncryptedFieldNames).not.toHaveBeenCalled()
    expect(loggerModule.__warn).not.toHaveBeenCalled()
  })

  it('reports the disabled-search reason with its own hint', async () => {
    await warnOnCiphertextLikeFallback({
      entity: 'auth:user', fields: ['email'], tenantId: null, reason: 'search-disabled', service: createService(['email']),
    })
    expect(loggerModule.__warn.mock.calls[0][1]).toMatchObject({ reason: 'search-disabled' })
    expect(loggerModule.__warn.mock.calls[0][1].hint).toContain('OM_SEARCH_ENABLED')
  })

  it('reports values that are too short to tokenize', async () => {
    await warnOnCiphertextLikeFallback({
      entity: 'auth:user', fields: ['email'], tenantId: null, reason: 'no-indexable-tokens', service: createService(['email']),
    })
    expect(loggerModule.__warn.mock.calls[0][1]).toMatchObject({ reason: 'no-indexable-tokens' })
    expect(loggerModule.__warn.mock.calls[0][1].hint).toContain('OM_SEARCH_MIN_LEN')
  })

  it('never rethrows when the encryption lookup fails', async () => {
    const service = {
      isEnabled: () => true,
      getEncryptedFieldNames: jest.fn(async () => { throw new Error('kms down') }),
    }
    await expect(warnOnCiphertextLikeFallback({
      entity: 'auth:user', fields: ['email'], tenantId: null, reason: 'no-search-tokens', service,
    })).resolves.toBeUndefined()
    expect(loggerModule.__warn).not.toHaveBeenCalled()
    expect(loggerModule.__debug).toHaveBeenCalled()
  })
})

describe('normalizeColumnName', () => {
  it('converts camelCase to snake_case and lowercases', () => {
    expect(normalizeColumnName('firstName')).toBe('first_name')
    expect(normalizeColumnName('primaryEmail')).toBe('primary_email')
    expect(normalizeColumnName('display_name')).toBe('display_name')
    expect(normalizeColumnName('Email')).toBe('email')
  })
})

describe('logger wiring', () => {
  it('uses the shared query logger namespace', () => {
    expect(createLogger).toHaveBeenCalledWith('shared')
  })
})
